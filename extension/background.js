import { validOptions, normalizeSettings, webOrigin, hostPattern } from "./settings.js";

const scriptId = "zen-mark-sites";
const js = ["vendor.js", "targets.js", "content.js"];
const css = ["content.css"];
const trusted = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let queue = Promise.resolve();
const enqueue = task => {
  const result = queue.then(() => trusted).then(task);
  queue = result.catch(() => {});
  return result;
};
const read = async () => normalizeSettings((await chrome.storage.local.get("settings")).settings);
const allowed = origin => chrome.permissions.contains({ origins: [hostPattern(origin)] });

async function register(config) {
  const patterns = [...new Set(config.enabledOrigins.map(hostPattern))];
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
  if (!patterns.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    return;
  }
  const script = { id: scriptId, matches: patterns, js, css, allFrames: true,
    matchOriginAsFallback: true, runAt: "document_idle", persistAcrossSessions: true };
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

async function broadcast() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
    chrome.tabs.sendMessage(tab.id, { type: "ZEN_MARK_REFRESH" })));
}

async function reconcile() {
  const config = await read();
  const valid = await Promise.all(config.enabledOrigins.map(async origin => await allowed(origin) ? origin : null));
  const next = { ...config, enabledOrigins: valid.filter(Boolean) };
  await register(next);
  if (next.enabledOrigins.length !== config.enabledOrigins.length) {
    await chrome.storage.local.set({ settings: next });
  }
  return next;
}

async function store(next, previous) {
  await register(next);
  try { await chrome.storage.local.set({ settings: next }); }
  catch (error) { await register(previous).catch(() => {}); throw error; }
}

async function inject(origin) {
  const tabs = await chrome.tabs.query({ url: hostPattern(origin) });
  const results = await Promise.allSettled(tabs.filter(tab => webOrigin(tab.url) === origin).map(async tab => {
    const target = { tabId: tab.id, allFrames: true };
    await chrome.scripting.insertCSS({ target, files: css });
    await chrome.scripting.executeScript({ target, files: js });
  }));
  return results.some(result => result.status === "rejected");
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error("FORBIDDEN");
  const config = await read();
  if (message?.type === "GET_STATE") {
    const origin = webOrigin(sender.url) || webOrigin(sender.origin);
    if (!sender.tab || !origin || sender.tab.incognito) return { enabled: false, fields: config.fields };
    return { enabled: config.enabledOrigins.includes(origin) && await allowed(origin), fields: config.fields };
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) throw new Error("FORBIDDEN");
  const origin = webOrigin(message?.origin);
  if (message.type === "STATUS") return { settings: config, enabled: Boolean(origin && config.enabledOrigins.includes(origin) && await allowed(origin)) };
  if (message.type === "SET_FIELDS") {
    if (!validOptions(message.fields)) throw new Error("INVALID_SETTING");
    const next = normalizeSettings({ ...config, fields: message.fields });
    await chrome.storage.local.set({ settings: next });
    await broadcast();
    return { settings: next };
  }
  if (message.type === "SET_SITE") {
    if (!origin || typeof message.enabled !== "boolean") throw new Error("INVALID_SETTING");
    if (message.enabled && !await allowed(origin)) throw new Error("HOST_PERMISSION_REQUIRED");
    const next = { ...config, enabledOrigins: config.enabledOrigins.filter(item => item !== origin) };
    if (message.enabled) next.enabledOrigins.push(origin);
    await store(next, config);
    // Existing frames restore immediately; newly permitted pages also receive scripts.
    await broadcast();
    const refreshRequired = message.enabled ? await inject(origin) : false;
    return { settings: next, enabled: message.enabled, refreshRequired };
  }
  throw new Error("UNKNOWN_MESSAGE");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  enqueue(() => handle(message, sender)).then(result => respond({ ok: true, ...result }), error => {
    const known = new Set(["FORBIDDEN", "INVALID_SETTING", "HOST_PERMISSION_REQUIRED", "UNKNOWN_MESSAGE"]);
    respond({ ok: false, error: known.has(error.message) ? error.message : "OPERATION_FAILED" });
  });
  return true;
});
const refreshRegistration = () => enqueue(async () => { await reconcile(); await broadcast(); }).catch(() => {});
chrome.runtime.onInstalled.addListener(refreshRegistration);
chrome.runtime.onStartup.addListener(refreshRegistration);
chrome.permissions.onRemoved.addListener(refreshRegistration);
chrome.permissions.onAdded.addListener(refreshRegistration);
enqueue(reconcile).catch(() => {});
