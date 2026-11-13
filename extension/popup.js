import { OPTION_DEFAULTS, hostPattern, webOrigin } from "./settings.js";

const $ = id => document.getElementById(id);
const optionKeys = Object.keys(OPTION_DEFAULTS);
let origin = null;
let settings = null;
let enabled = false;
let busy = false;
let readId = 0;

async function send(type, details = {}) {
  const result = await chrome.runtime.sendMessage({ type, origin, ...details });
  if (!result?.ok) throw new Error(result?.error || "UNAVAILABLE");
  return result;
}

function render(result) {
  if (result.settings) settings = result.settings;
  if (typeof result.enabled === "boolean") enabled = result.enabled;
  $("site-enabled").checked = enabled;
  $("site-enabled").disabled = busy || !origin;
  $("fields").disabled = busy || !settings;
  for (const key of optionKeys) $("field-" + key).checked = settings?.fields[key] ?? OPTION_DEFAULTS[key];
}

function beginUpdate() {
  busy = true;
  readId++;
  $("status").textContent = "";
  $("site-enabled").disabled = true;
  $("fields").disabled = true;
}

$("site-enabled").addEventListener("change", async event => {
  if (busy || !origin) return;
  const next = event.target.checked;
  // Request access directly in the switch's user gesture, before the first await.
  beginUpdate();
  try {
    if (next && !await chrome.permissions.request({ origins: [hostPattern(origin)] })) { $("status").textContent = "未授权，网站保持关闭"; return; }
    const result = await send("SET_SITE", { enabled: next });
    render(result);
    if (result.refreshRequired) $("status").textContent = "已开启，请刷新页面";
  } catch { $("status").textContent = "设置失败，请重试"; }
  finally { busy = false; render({}); }
});

$("fields").addEventListener("change", async () => {
  if (busy) return;
  const options = Object.fromEntries(optionKeys.map(key => [key, $("field-" + key).checked]));
  beginUpdate();
  try { render(await send("SET_FIELDS", { fields: options })); }
  catch { $("status").textContent = "保存失败，请重试"; }
  finally { busy = false; render({}); }
});

async function refresh() {
  const id = ++readId;
  try {
    const result = await send("STATUS");
    if (id === readId && !busy) render(result);
  } catch { if (id === readId) $("status").textContent = "读取失败，请重新打开插件"; }
}

chrome.permissions.onRemoved.addListener(refresh);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
origin = webOrigin(tab?.url);
$("site-name").textContent = origin ? new URL(origin).host : "请打开禅道页面";
$("site-name").title = origin || "";
await refresh();
