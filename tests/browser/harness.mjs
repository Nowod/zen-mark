import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.ZEN_MARK_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "zen-mark-browser-"));
const extension = join(temporary, "extension");
const profile = join(temporary, "profile");
await cp(join(root, "extension"), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
// Only the disposable test installation has pre-granted hosts. Production still
// requests access through the popup's user gesture.
manifest.host_permissions = ["https://zentao.test/*", "http://zentao-http.test/*"];
await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
const fixtures = Object.fromEntries(await Promise.all(["execution", "detail", "classic", "edit", "bug"].map(async name =>
  [name, await readFile(join(root, `tests/fixtures/${name}.html`), "utf8")])));
const defaults = { precondition: true, steps: true, bugSteps: true, copyCase: true, lineHeight: 2 };
const testFilter = process.env.ZEN_MARK_TEST_FILTER ? new RegExp(process.env.ZEN_MARK_TEST_FILTER) : null;
let context;
let worker;
let page;
let popup;
let extensionId;
let passed = 0;
const errors = [];

async function poll(read, accepts, label) {
  const end = Date.now() + 8000;
  let value;
  do {
    value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium", executablePath: process.env.ZEN_MARK_CHROMIUM_EXECUTABLE,
    viewport: { width: 1250, height: 900 }, locale: "zh-CN",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route(/^https?:\/\//, async route => {
    const request = route.request();
    if (request.resourceType() !== "document") { await route.abort(); return; }
    const url = new URL(request.url());
    let body = fixtures.execution;
    if (url.pathname.includes("testcase-view")) body = url.searchParams.has("classic") ? fixtures.classic : fixtures.detail;
    if (url.pathname.includes("testcase-edit")) body = fixtures.edit;
    if (/(?:^|\/)bug[-/]/.test(url.pathname) || url.searchParams.get("m") === "bug") body = fixtures.bug;
    if (url.pathname === "/unrelated") body = '<!doctype html><meta charset="UTF-8"><table><thead><tr><td>步骤</td><td>预期</td></tr></thead><tbody><tr><td>**保持原文**</td><td>`原始预期`</td></tr></tbody></table><p>前置条件</p>';
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (url.searchParams.has("csp")) headers["content-security-policy"] = "default-src 'self'; script-src 'none'; style-src 'none'; require-trusted-types-for 'script'";
    await route.fulfill({ status: 200, headers, body });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  // A routed fixture can finish loading before Chrome restores extension scripts.
  // Wait for persisted registrations before opening the first page after restart.
  await poll(() => worker.evaluate(async () => {
    if (!globalThis.chrome?.storage?.local) return { ready: false };
    return {
      ready: true,
      enabled: ((await chrome.storage.local.get("settings")).settings?.enabledOrigins || []).length,
      registered: (await chrome.scripting.getRegisteredContentScripts()).length
    };
  }), state => state.ready && (!state.enabled || state.registered > 0), "extension registrations ready");
  page = context.pages()[0];
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://zentao.test/zentao/testtask-cases-1.html");
  popup = await context.newPage();
  popup.setDefaultTimeout(8000);
  popup.on("pageerror", error => errors.push(error.message));
  await page.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  try { await popup.waitForFunction(() => !document.querySelector("#fields").disabled); }
  catch (error) { throw new Error(`Popup initialization: ${await popup.locator("body").innerText()}; errors=${JSON.stringify(errors)}`, { cause: error }); }
}

const hosts = target => target.locator("[data-zen-mark-view]");
const previews = () => hosts(page).count();
const preview = (id, target = page) => target.locator(`#${id} > [data-zen-mark-view]`);
const rendered = (id, state = true, target = page) => poll(() => preview(id, target).count(), value => value === Number(state), `${id} rendered ${state}`);
const text = (id, target = page) => preview(id, target).locator(".markdown").textContent();
const send = (type, details = {}) => popup.evaluate(message => chrome.runtime.sendMessage(message), { type, origin: "https://zentao.test", ...details });
async function setFields(fields = defaults) {
  const result = await send("SET_FIELDS", { fields: { ...defaults, ...fields } });
  assert.equal(result.ok, true);
}
async function enabled(value) {
  const result = await send("SET_SITE", { enabled: value });
  assert.equal(result.ok, true, JSON.stringify(result));
}
const go = async (path = "/zentao/testtask-cases-1.html") => { await page.goto(`https://zentao.test${path}`); };
async function check(name, run, reset = true) {
  if (testFilter && !testFilter.test(name)) return;
  if (reset) { await setFields(); await enabled(true); await go(); await rendered("step-one"); }
  await run();
  console.log(`PASS ${++passed}: ${name}`);
}

async function contentWorld(expression) {
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on("Runtime.executionContextCreated", ({ context }) => worlds.push(context));
  try {
    await session.send("Runtime.enable");
    const world = worlds.find(item => item.name.includes(extensionId) || item.origin.includes(extensionId));
    assert.ok(world, "Extension isolated world exists");
    const result = await session.send("Runtime.evaluate", { contextId: world.id, expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result.value;
  } finally { await session.detach(); }
}

async function readClipboard(target = page) {
  await context.grantPermissions(["clipboard-read"], { origin: "https://zentao.test" });
  await target.bringToFront();
  return target.evaluate(() => navigator.clipboard.readText());
}


export async function close() {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}

export { fixtures, defaults, context, worker, page, popup, extensionId, passed, errors, poll, launch, hosts, previews, preview, rendered, text, send, setFields, enabled, go, check, contentWorld, readClipboard };
