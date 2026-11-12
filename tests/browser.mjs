import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.ZEN_MARK_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "zen-mark-browser-"));
const extension = join(temporary, "extension");
const profile = join(temporary, "profile");
await cp(join(root, "extension"), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
// Only the disposable test installation has pre-granted hosts. Production still
// requests access through the popup's user gesture.
manifest.host_permissions = ["https://zentao.test/*", "http://zentao-http.test/*"];
await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
const fixtures = Object.fromEntries(await Promise.all(["execution", "detail", "classic", "edit"].map(async name =>
  [name, await readFile(join(root, `tests/fixtures/${name}.html`), "utf8")])));
const defaults = { precondition: true, steps: true };
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
    if (url.pathname === "/unrelated") body = '<!doctype html><meta charset="UTF-8"><table><thead><tr><td>步骤</td><td>预期</td></tr></thead><tbody><tr><td>**保持原文**</td><td>`原始预期`</td></tr></tbody></table><p>前置条件</p>';
    const headers = { "content-type": "text/html; charset=utf-8" };
    if (url.searchParams.has("csp")) headers["content-security-policy"] = "default-src 'self'; script-src 'none'; style-src 'none'; require-trusted-types-for 'script'";
    await route.fulfill({ status: 200, headers, body });
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
  // A routed fixture can finish loading before Chrome restores extension scripts.
  // Wait for persisted registrations before opening the first page after restart.
  await poll(() => worker.evaluate(async () => ({
    enabled: ((await chrome.storage.local.get("settings")).settings?.enabledOrigins || []).length,
    registered: (await chrome.scripting.getRegisteredContentScripts()).length
  })), state => !state.enabled || state.registered > 0, "extension registrations ready");
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
  const result = await send("SET_FIELDS", { fields });
  assert.equal(result.ok, true);
}
async function enabled(value) {
  const result = await send("SET_SITE", { enabled: value });
  assert.equal(result.ok, true, JSON.stringify(result));
}
const go = async (path = "/zentao/testtask-cases-1.html") => { await page.goto(`https://zentao.test${path}`); };
async function check(name, run, reset = true) {
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

try {
  await launch();
  await check("网站默认关闭，只有前置条件和用例步骤两个选项，默认都勾选", async () => {
    assert.equal(await previews(), 0);
    assert.equal(await popup.locator("#site-name").textContent(), "zentao.test");
    assert.equal(await popup.locator("#site-enabled").isChecked(), false);
    assert.deepEqual(await popup.locator("#fields input").evaluateAll(inputs => inputs.map(input => [input.id, input.checked])), [["field-precondition", true], ["field-steps", true]]);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), {});
  }, false);

  await check("点击网站开关启用当前网站并立即渲染执行弹窗，动态注册仅包含已选网站", async () => {
    await popup.locator("#site-enabled").check();
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.deepEqual(registered[0].matches, ["https://zentao.test/*"]);
    assert.equal(registered[0].allFrames, true);
    assert.equal(await preview("step-one").locator("h2").textContent(), "执行操作");
    assert.equal(await preview("step-one").locator("pre code").textContent(), '{"result": "ok"}\n');
    assert.equal(await preview("expect-one").locator("table tr").count(), 2);
    assert.equal(await preview("precondition").locator("ul ul li").count(), 2);
    assert.equal(await preview("step-two").locator(".task-box").count(), 2);
    assert.ok((await text("precondition")).includes("${example.value}"));
    const layout = await page.locator("#step-one").boundingBox();
    assert.ok(layout.width > 150 && layout.height < 400, `Readable step column: ${JSON.stringify(layout)}`);
  }, false);

  await check("取消用例步骤会同时还原步骤和预期，取消前置条件可独立生效", async () => {
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    await popup.locator("#field-steps").uncheck();
    await rendered("step-one", false); await rendered("expect-one", false);
    assert.equal(await preview("precondition").count(), 1);
    assert.ok((await page.locator("#step-one").textContent()).includes("**示例页面**"));
    await popup.locator("#field-precondition").uncheck();
    await poll(previews, count => count === 0, "all fields restored");
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-steps").isChecked(), false);
    assert.equal(await popup.locator("#field-precondition").isChecked(), false);
    await page.reload(); assert.equal(await previews(), 0);
    await popup.locator("#field-steps").check();
    await rendered("step-one"); await rendered("expect-one");
    assert.equal(await preview("precondition").count(), 0);
  });

  await check("选择结果、实际情况、附件按钮和保存表单正常，步骤编号保持不变", async () => {
    const controls = await page.locator("#caseStepForm").evaluate(form => [...form.querySelectorAll("input, select, textarea, button")].map(node => node.outerHTML));
    await page.locator("#result-one").selectOption("fail");
    await page.locator("#real-one").fill("实际情况 **保持纯文本**");
    await page.locator("#attachment").click();
    assert.equal(await page.evaluate(() => window.attachmentClicks), 1);
    assert.ok(await page.evaluate(() => window.realInputs > 0));
    assert.deepEqual(await page.locator(".step-item-id").allTextContents(), ["1", "2.1"]);
    await page.locator("#save").click();
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved["result[1]"], "fail");
    assert.equal(saved["real[1]"], "实际情况 **保持纯文本**");
    assert.equal(saved.case, "1"); assert.equal(saved.version, "1"); assert.equal(saved.pickerMeta, "keep");
    await enabled(false);
    await poll(previews, count => count === 0, "disabled restores originals");
    const restored = await page.locator("#caseStepForm").evaluate(form => [...form.querySelectorAll("input, select, textarea, button")].map(node => node.outerHTML));
    assert.deepEqual(restored, controls);
  });

  await check("关闭网站恢复精确原始 DOM，刷新后不注入，重新开启保留选择", async () => {
    await enabled(false); await go();
    const original = await page.locator("body > .modal-body").innerHTML();
    await enabled(true); await rendered("step-one");
    await setFields({ precondition: false, steps: true }); await rendered("precondition", false);
    await enabled(false); await poll(previews, count => count === 0, "source restored");
    assert.equal(await page.locator("body > .modal-body").innerHTML(), original);
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    await page.reload(); assert.equal(await previews(), 0);
    await enabled(true); await rendered("step-one");
    assert.equal(await preview("precondition").count(), 0);
  });

  await check("详情页渲染前置条件、步骤与预期，编号、附件和历史内容保持原样", async () => {
    await go("/zentao/testcase-view-1.html");
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    assert.deepEqual(await page.locator("#stepsTable .nowrap").allTextContents(), ["1", "2.1"]);
    assert.equal(await preview("step-one").locator("strong").textContent(), "示例页面");
    assert.equal(await preview("expect-one").locator("code").textContent(), "ready");
    const colors = await page.evaluate(() => {
      const step = document.querySelector("#step-one");
      const expect = document.querySelector("#expect-one");
      return {
        step: getComputedStyle(step.querySelector("[data-zen-mark-view]").shadowRoot.querySelector("p")).color,
        expect: getComputedStyle(expect.querySelector("[data-zen-mark-view]").shadowRoot.querySelector("p")).color,
        cell: getComputedStyle(step).color,
        number: getComputedStyle(step.querySelector(".nowrap")).color
      };
    });
    assert.equal(colors.step, colors.expect, `Step text keeps the normal body color: ${JSON.stringify(colors)}`);
    assert.equal(colors.step, colors.cell);
    assert.equal(colors.number, "rgb(124, 140, 166)", "Step numbers retain ZenTao's muted color");
    assert.equal(await page.locator("#history [data-zen-mark-view]").count(), 0);
    assert.equal(await page.locator("#existing-file").textContent(), "附件.txt");
    await setFields({ precondition: true, steps: false });
    await rendered("step-one", false); await rendered("expect-one", false);
    assert.equal(await preview("precondition").count(), 1);
    assert.ok((await page.locator("#step-one").textContent()).startsWith("1打开 **示例页面**"));
  });

  await check("兼容经典详情表格，独立编号列和操作按钮不会被当作 Markdown", async () => {
    await go("/zentao/testcase-view-1.html?classic=1");
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    assert.equal(await page.locator("#sequence").innerHTML(), "1");
    assert.deepEqual(await page.locator("#steps").evaluate(table => [...table.querySelectorAll("button")].map(button => button.textContent)), ["批量操作"]);
    assert.equal(await page.locator("#steps button [data-zen-mark-view]").count(), 0);
    assert.equal(await preview("precondition").locator("p").count(), 2);
  });

  await check("弹窗异步加入、下一个用例替换内容后自动渲染，不重复嵌套预览", async () => {
    await page.evaluate(() => { document.querySelector(".modal-body").remove(); });
    await poll(previews, count => count === 0, "old modal removed");
    await page.evaluate(html => { document.body.insertAdjacentHTML("beforeend", new DOMParser().parseFromString(html, "text/html").querySelector(".modal-body").outerHTML); }, fixtures.execution);
    await rendered("step-one");
    await page.locator("#step-one").evaluate(node => { node.textContent = "下一条用例 `NEXT`"; });
    await poll(() => text("step-one"), value => value.includes("NEXT"), "new case rendered");
    assert.equal(await preview("step-one").locator("code").textContent(), "NEXT");
    await page.locator("#step-one > [data-zen-mark-source]").evaluate(node => { node.textContent = "继续修改 **UPDATED**"; });
    await poll(() => text("step-one"), value => value.includes("UPDATED"), "changed source rendered");
    assert.equal(await page.locator("#step-one > [data-zen-mark-view]").count(), 1);
    await page.locator("#step-one > [data-zen-mark-source]").evaluate(node => { node.textContent = ""; });
    await rendered("step-one", false);
    assert.equal(await page.locator("#step-one").textContent(), "");
  });

  await check("编辑区域、实际情况及无关页面不进行 Markdown 替换", async () => {
    await go("/zentao/testcase-edit-1.html");
    assert.equal(await previews(), 0);
    assert.equal(await page.locator("textarea#step-one").inputValue(), "步骤 `source`");
    assert.equal(await page.locator("[contenteditable]").textContent(), "预期 **source**");
    await go("/unrelated"); assert.equal(await previews(), 0);
  });

  await check("同源 iframe 执行弹窗与后续新增 iframe 自动渲染", async () => {
    await page.evaluate(() => {
      const iframe = document.createElement("iframe"); iframe.id = "case-frame";
      iframe.src = "/zentao/testtask-runCase-1.html";
      document.body.append(iframe);
    });
    const frame = page.frameLocator("#case-frame");
    await rendered("step-one", true, frame); await rendered("precondition", true, frame);
    await setFields({ precondition: true, steps: false });
    await rendered("step-one", false, frame); await rendered("expect-one", false, frame);
    assert.equal(await preview("precondition", frame).count(), 1);
  });

  await check("about:srcdoc 弹窗通过父页面来源匹配，外部来源 iframe 不渲染", async () => {
    await page.evaluate(html => {
      const local = document.createElement("iframe"); local.id = "srcdoc-frame"; local.srcdoc = html;
      const external = document.createElement("iframe"); external.id = "external-frame"; external.src = "https://outside.test/zentao/testtask-runCase-1.html";
      document.body.append(local, external);
    }, fixtures.execution);
    const local = page.frameLocator("#srcdoc-frame");
    await rendered("step-one", true, local);
    const external = page.frameLocator("#external-frame");
    await external.locator("#step-one").waitFor();
    assert.equal(await hosts(external).count(), 0);
  });

  await check("HTML 脚本、事件属性与危险链接被清理，代码示例保持字面量", async () => {
    await page.locator("#expect-one").evaluate(node => {
      node.textContent = '**安全内容**\n\n<img src="x" onerror="window.hacked=1"><script>window.hacked=2</script>\n\n[危险](javascript:alert(1))\n\n```html\n<script>literal</script>\n```\n\n<iframe src="https://evil.test"></iframe><form><input name="stolen"></form>';
    });
    await poll(() => text("expect-one"), value => value.includes("安全内容"), "sanitized preview");
    assert.equal(await preview("expect-one").locator("script, iframe, input, form").count(), 0);
    assert.equal(await preview("expect-one").locator("[onerror]").count(), 0);
    assert.equal(await preview("expect-one").locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.hacked), undefined);
    assert.equal(await preview("expect-one").locator("pre code").textContent(), "<script>literal</script>\n");
    await page.locator("#expect-one").evaluate(node => { node.textContent = "<script>literal_only</script>"; });
    await poll(() => text("expect-one"), value => value.includes("<script>literal_only</script>"), "HTML-only source stays visible as text");
    assert.equal(await preview("expect-one").locator("script").count(), 0);
  });

  await check("严格 CSP 和 Trusted Types 页面仍可渲染并应用隔离样式", async () => {
    await go("/zentao/testcase-view-1.html?csp=1");
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    assert.equal(await preview("expect-one").locator("code").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(237, 241, 247)");
  });

  await check("原有富文本、附件图片和相对链接保留在阅读视图中", async () => {
    await page.locator("#expect-one").evaluate(node => {
      node.innerHTML = '<p>保留 <strong>富文本</strong> 和 `inline`。</p><p><a href="/attachment/example.txt">附件</a><img src="/attachment/example.png" alt="示例"></p>';
    });
    await poll(() => text("expect-one"), value => value.includes("富文本"), "rich text preview");
    assert.equal(await preview("expect-one").locator("strong").textContent(), "富文本");
    assert.equal(await preview("expect-one").locator("code").textContent(), "inline");
    assert.equal(await preview("expect-one").locator("a").getAttribute("href"), "/attachment/example.txt");
    assert.equal(await preview("expect-one").locator("a").getAttribute("rel"), "noopener noreferrer");
    assert.equal(await preview("expect-one").locator("img").getAttribute("referrerpolicy"), "no-referrer");
  });

  await check("已有富文本列表、代码和表格可阅读，关闭后恢复原有 HTML", async () => {
    await page.locator("#expect-one").evaluate(node => {
      node.innerHTML = '<h3>原有标题</h3><ul><li>第一项<ul><li>嵌套项</li></ul></li></ul><p><code>value=`one`</code></p><pre><code>if (value &lt; 0) {\n  print(value);\n}</code></pre><table><tr><th>字段</th><th>值</th></tr><tr><td>status</td><td>ready</td></tr></table>';
    });
    await poll(() => text("expect-one"), value => value.includes("原有标题"), "existing rich structures rendered");
    assert.equal(await preview("expect-one").locator("ul ul li").textContent(), "嵌套项");
    assert.equal(await preview("expect-one").locator("p code").textContent(), "value=`one`");
    assert.ok((await preview("expect-one").locator("pre code").textContent()).includes("if (value < 0)"));
    assert.equal(await preview("expect-one").locator("table tr").count(), 2);
    await setFields({ precondition: true, steps: false });
    await rendered("expect-one", false);
    assert.equal(await page.locator("#expect-one > h3").textContent(), "原有标题");
    assert.equal(await page.locator("#expect-one > table tr").count(), 2);
  });

  await check("行内代码悬浮复制表达式，保留输入焦点和选区，不提交表单", async () => {
    const expression = '${V1.SRC.GN}=18 AND ${V1.SRC.GW}>60';
    await page.locator("#expect-one").evaluate((node, value) => { node.textContent = "表达式：`" + value + "`。"; }, expression);
    await poll(() => preview("expect-one").locator("code").textContent(), value => value === expression, "expression rendered");
    await page.locator("#real-one").fill("实际情况中的选中文本");
    await page.locator("#real-one").evaluate(node => { node.focus(); node.setSelectionRange(3, 7); });
    const wrapper = preview("expect-one").locator(".code-inline");
    const button = wrapper.locator(".code-copy");
    await page.mouse.move(1, 1);
    await poll(() => button.evaluate(node => getComputedStyle(node).opacity), value => value === "0", "copy hidden before hover");
    await wrapper.hover();
    await poll(() => button.evaluate(node => getComputedStyle(node).opacity), value => value === "1", "copy shown on hover");
    if (process.env.ZEN_MARK_COPY_PREVIEW_PATH) await page.screenshot({ path: process.env.ZEN_MARK_COPY_PREVIEW_PATH.replace(/\.png$/, "-inline.png") });
    await button.click();
    await poll(() => button.getAttribute("data-state"), value => value === "success", "copied feedback");
    assert.equal(await readClipboard(), expression);
    assert.deepEqual(await page.locator("#real-one").evaluate(node => ({ focused: document.activeElement === node, start: node.selectionStart, end: node.selectionEnd, value: node.value })),
      { focused: true, start: 3, end: 7, value: "实际情况中的选中文本" });
    assert.equal(await page.evaluate(() => window.saved), undefined);
    await poll(() => button.getAttribute("data-state"), value => value === "idle", "feedback resets");
    await page.locator("#expect-one").evaluate(node => { node.textContent = "新内容 `NEXT_VALUE`"; });
    await poll(() => preview("expect-one").locator("code").textContent(), value => value === "NEXT_VALUE", "new code rendered");
    assert.equal(await preview("expect-one").locator(".code-copy").count(), 1);
    await preview("expect-one").locator(".code-inline").hover();
    await preview("expect-one").locator(".code-copy").click();
    await poll(() => readClipboard(), value => value === "NEXT_VALUE", "copy uses current code");
  });

  await check("代码块复制保留缩进、空行和反引号内容，键盘 Enter 也可复制", async () => {
    const source = '  const expression = "${example.value}";  \n\n\tconst label = `value`;\n';
    await page.locator("#expect-one").evaluate((node, value) => { node.textContent = "```text\n" + value + "```"; }, source);
    const block = preview("expect-one").locator(".code-block");
    await poll(() => block.locator("code").textContent(), value => value === source, "block whitespace preserved");
    const button = block.locator(".code-copy");
    await block.hover();
    if (process.env.ZEN_MARK_COPY_PREVIEW_PATH) await page.screenshot({ path: process.env.ZEN_MARK_COPY_PREVIEW_PATH.replace(/\.png$/, "-block.png") });
    await button.click();
    await poll(() => button.getAttribute("data-state"), value => value === "success", "block copied");
    assert.equal(await readClipboard(), source);
    assert.equal(await block.locator("pre button").count(), 0);
    await poll(() => button.getAttribute("data-state"), value => value === "idle", "block feedback resets");
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://zentao.test" });
    await page.evaluate(() => navigator.clipboard.writeText("keyboard baseline"));
    await button.focus();
    await button.press("Enter");
    await poll(() => button.getAttribute("data-state"), value => value === "success", "keyboard copied");
    assert.equal(await readClipboard(), source);
    assert.equal(await button.evaluate(node => node.getRootNode().activeElement === node), true);
  });

  await check("HTTP 页复制可用，复制后普通 Ctrl+C 不会被旧处理器覆盖", async () => {
    const origin = "http://zentao-http.test";
    assert.equal((await send("SET_SITE", { origin, enabled: true })).ok, true);
    await page.goto(`${origin}/zentao/testtask-cases-1.html`);
    await rendered("step-one");
    assert.equal(await page.evaluate(() => isSecureContext), false);
    const code = preview("precondition").locator("code").first();
    const expected = await code.textContent();
    await code.locator("..").hover();
    const button = code.locator("..").locator(".code-copy");
    await button.click();
    await poll(() => button.getAttribute("data-state"), value => value === "success", "HTTP copy succeeds");
    const reader = await context.newPage();
    try {
      await reader.goto("https://zentao.test/unrelated");
      assert.equal(await readClipboard(reader), expected);
      await page.bringToFront();
      await page.locator("#real-one").fill("手动复制的新内容");
      await page.locator("#real-one").selectText();
      await page.locator("#real-one").press("Control+c");
      assert.equal(await readClipboard(reader), "手动复制的新内容");
    } finally {
      await reader.close();
      await send("SET_SITE", { origin, enabled: false });
    }
  });

  await check("复制失败有明确反馈并可重试，现代 API 失败时可兼容复制", async () => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://zentao.test" });
    await page.bringToFront();
    await page.evaluate(() => navigator.clipboard.writeText("unchanged baseline"));
    await contentWorld(`globalThis.originalClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
      globalThis.originalCopyCommand = document.execCommand.bind(document);
      navigator.clipboard.writeText = async () => { throw new Error("Simulated clipboard rejection"); };
      document.execCommand = () => false;`);
    const button = preview("step-one").locator(".code-block > .code-copy");
    const expected = await preview("step-one").locator("pre code").textContent();
    try {
      await preview("step-one").locator(".code-block").hover();
      await button.click();
      await poll(() => button.getAttribute("data-state"), value => value === "error", "copy error shown");
      assert.equal(await button.getAttribute("aria-label"), "复制失败");
      assert.equal(await readClipboard(), "unchanged baseline");
      await contentWorld("document.execCommand = originalCopyCommand;");
      await button.click();
      await poll(() => button.getAttribute("data-state"), value => value === "success", "fallback retry succeeds");
      assert.equal(await readClipboard(), expected);
    } finally {
      await contentWorld("navigator.clipboard.writeText = originalClipboardWrite; document.execCommand = originalCopyCommand;");
    }
  });

  await check("链接中的代码只复制不跳转，取消渲染后复制按钮一同移除", async () => {
    await page.locator("#expect-one").evaluate(node => { node.textContent = "[`LINK_CODE`](/help)"; });
    await poll(() => preview("expect-one").locator("code").textContent(), value => value === "LINK_CODE", "linked code rendered");
    const url = page.url();
    const tabs = context.pages().length;
    await preview("expect-one").locator(".code-inline").hover();
    await preview("expect-one").locator(".code-copy").click();
    await poll(() => readClipboard(), value => value === "LINK_CODE", "linked code copied");
    assert.equal(page.url(), url);
    assert.equal(context.pages().length, tabs);
    await setFields({ precondition: true, steps: false });
    await rendered("expect-one", false);
    assert.equal(await page.locator("#expect-one .code-copy").count(), 0);
    assert.equal(await page.locator("#expect-one").textContent(), "[`LINK_CODE`](/help)");
  });

  await check("跨端口与其他网站未开启时不渲染，设置不携带用例内容", async () => {
    await page.goto("https://zentao.test:8443/zentao/testcase-view-1.html");
    await page.locator("#step-one").waitFor();
    assert.equal(await previews(), 0);
    await page.goto("https://outside.test/zentao/testcase-view-1.html");
    assert.equal(await previews(), 0);
    const store = await worker.evaluate(() => chrome.storage.local.get(null));
    assert.deepEqual(Object.keys(store), ["settings"]);
    assert.deepEqual(Object.keys(store.settings).sort(), ["enabledOrigins", "fields"]);
  });

  await check("权限拒绝或权限 API 同步抛错时开关回退且可重试", async () => {
    await enabled(false);
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    await popup.evaluate(() => { globalThis.requestPermission = chrome.permissions.request; chrome.permissions.request = async () => false; });
    try {
      await popup.locator("#site-enabled").click();
      await poll(() => popup.locator("#status").textContent(), text => text.includes("未授权"), "denied message");
      assert.equal(await popup.locator("#site-enabled").isChecked(), false);
      await popup.evaluate(() => { chrome.permissions.request = () => { throw new Error("Simulated failure"); }; });
      await popup.locator("#site-enabled").click();
      await poll(() => popup.locator("#status").textContent(), text => text.includes("设置失败"), "permission exception");
      assert.equal(await popup.locator("#site-enabled").isChecked(), false);
    } finally { await popup.evaluate(() => { chrome.permissions.request = requestPermission; }); }
    await popup.locator("#site-enabled").check();
    await rendered("step-one");
  });

  await check("紧凑设置无横向溢出，Markdown 样式隔离且长代码可横向滚动", async () => {
    await popup.setViewportSize({ width: 280, height: 350 });
    assert.equal(await popup.evaluate(() => document.body.scrollWidth), 280);
    await page.locator("#expect-one").evaluate(node => { node.textContent = '```text\n' + 'long_code_'.repeat(150) + '\n```'; });
    await poll(() => preview("expect-one").locator("pre").count(), count => count === 1, "long code rendered");
    const sizing = await preview("expect-one").locator("pre").evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(sizing.scroll > sizing.width, JSON.stringify(sizing));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Long code does not widen the page");
    assert.equal(await page.locator("#save").isVisible(), true);
    if (process.env.ZEN_MARK_PREVIEW_PATH) {
      await page.locator("#expect-one").evaluate(node => { node.textContent = '**保存成功**，状态为 `ready`。\n\n| 字段 | 值 |\n| --- | --- |\n| status | ready |'; });
      await poll(() => preview("expect-one").locator("table").count(), count => count === 1, "preview restored");
      await page.screenshot({ path: process.env.ZEN_MARK_PREVIEW_PATH, fullPage: true });
      await popup.locator("body").screenshot({ path: process.env.ZEN_MARK_PREVIEW_PATH.replace(/\.png$/, "-popup.png") });
    }
  });

  await check("刷新、重启浏览器后保留网站和两个选项的选择", async () => {
    await setFields({ precondition: false, steps: true });
    await page.reload(); await rendered("step-one"); await rendered("precondition", false);
    await context.close(); await launch();
    try { await rendered("step-one"); await rendered("precondition", false); }
    catch (error) {
      const state = await worker.evaluate(async () => ({ settings: await chrome.storage.local.get(null), scripts: await chrome.scripting.getRegisteredContentScripts(), permissions: await chrome.permissions.getAll() }));
      throw new Error(`Restart state: ${JSON.stringify(state)}; pageErrors=${JSON.stringify(errors)}`, { cause: error });
    }
    assert.equal(await popup.locator("#field-precondition").isChecked(), false);
    assert.equal(await popup.locator("#field-steps").isChecked(), true);
    assert.equal(await popup.locator("#site-enabled").isChecked(), true);
  });
  assert.deepEqual(errors, [], "No unhandled errors on test pages");
  console.log(`\n${passed} browser scenarios passed with the actual unpacked extension.`);
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
