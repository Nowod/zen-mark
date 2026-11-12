import assert from "node:assert/strict";
import test from "node:test";

test("真实后台消息：网站授权、动态注册、两个选项及来源隔离", async t => {
  const store = {};
  const scripts = new Map();
  const permissions = new Set();
  const events = {};
  let handler;
  let failWrite = false;
  let failRegister = false;
  let storageAccess;
  const event = name => ({ addListener(callback) { events[name] = callback; } });
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "extension-id", getURL: path => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener(callback) { handler = callback; } }, onInstalled: event("installed"), onStartup: event("startup") },
    storage: { local: {
      async setAccessLevel(value) { storageAccess = value; },
      async get(key) { return { [key]: structuredClone(store[key]) }; },
      async set(value) { if (failWrite) throw new Error("Disk error"); Object.assign(store, structuredClone(value)); }
    } },
    permissions: { async contains({ origins }) { return origins.every(origin => permissions.has(origin)); }, onRemoved: event("removed"), onAdded: event("added") },
    scripting: {
      async getRegisteredContentScripts() { return [...scripts.values()]; },
      async registerContentScripts(values) { if (failRegister) throw new Error("Registration error"); for (const value of values) scripts.set(value.id, value); },
      async updateContentScripts(values) { if (failRegister) throw new Error("Registration error"); for (const value of values) scripts.set(value.id, value); },
      async unregisterContentScripts({ ids }) { for (const id of ids) scripts.delete(id); },
      async insertCSS() {}, async executeScript() {}
    },
    tabs: { async query() { return []; }, async sendMessage() {} }
  };
  const popup = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
  const content = (url = "https://a.test/zentao/testcase-view-1.html") => ({ id: "extension-id", url, origin: new URL(url).origin, tab: { id: 1, incognito: false } });
  const send = (message, sender = popup) => new Promise(resolve => handler(message, sender, resolve));
  try {
    await import(`../extension/background.js?test=${Date.now()}`);
    await t.test("没有网站默认启用，存储仅对可信扩展上下文开放", async () => {
      const status = await send({ type: "STATUS", origin: "https://a.test" });
      assert.deepEqual(storageAccess, { accessLevel: "TRUSTED_CONTEXTS" });
      assert.equal(status.enabled, false);
      assert.deepEqual(status.settings, { enabledOrigins: [], fields: { precondition: true, steps: true } });
      assert.equal(scripts.size, 0);
      assert.equal((await send({ type: "GET_STATE" }, content())).enabled, false);
      assert.equal((await send({ type: "STATUS", origin: "https://a.test" }, { ...popup, tab: { id: 2 } })).ok, true);
    });
    await t.test("未授权时无法启用，授权后注册所有帧且只匹配该网站", async () => {
      assert.equal((await send({ type: "SET_SITE", origin: "https://a.test", enabled: true })).error, "HOST_PERMISSION_REQUIRED");
      permissions.add("https://a.test/*");
      assert.equal((await send({ type: "SET_SITE", origin: "https://a.test", enabled: true })).enabled, true);
      const [script] = [...scripts.values()];
      assert.deepEqual(script.matches, ["https://a.test/*"]);
      assert.equal(script.allFrames, true);
      assert.equal(script.matchOriginAsFallback, true);
      assert.equal(script.persistAcrossSessions, true);
      assert.equal((await send({ type: "GET_STATE" }, content())).enabled, true);
      assert.equal((await send({ type: "GET_STATE" }, content("https://a.test:8443/testcase-view-1.html"))).enabled, false);
      assert.equal((await send({ type: "GET_STATE" }, content("https://b.test/testcase-view-1.html"))).enabled, false);
    });
    await t.test("网页只能读取本身的启用状态和两个选项，不能读全部网站或改设置", async () => {
      assert.equal((await send({ type: "STATUS" }, content())).error, "FORBIDDEN");
      assert.equal((await send({ type: "SET_FIELDS", fields: { precondition: false, steps: false } }, content())).error, "FORBIDDEN");
      const state = await send({ type: "GET_STATE" }, content());
      assert.deepEqual(Object.keys(state).sort(), ["enabled", "fields", "ok"]);
      assert.equal((await send({ type: "GET_STATE" }, { ...content(), id: "other-id" })).error, "FORBIDDEN");
    });
    await t.test("无痕和缺少标签页来源的请求不启用渲染", async () => {
      const sender = content(); sender.tab.incognito = true;
      assert.equal((await send({ type: "GET_STATE" }, sender)).enabled, false);
      assert.equal((await send({ type: "GET_STATE" }, popup)).enabled, false);
    });
    await t.test("两个渲染选项独立保存，不接受缺失或非布尔参数", async () => {
      const saved = await send({ type: "SET_FIELDS", fields: { precondition: false, steps: true } });
      assert.deepEqual(saved.settings.fields, { precondition: false, steps: true });
      const snapshot = structuredClone(store);
      assert.equal((await send({ type: "SET_FIELDS", fields: { precondition: false } })).error, "INVALID_SETTING");
      assert.equal((await send({ type: "SET_FIELDS", fields: { precondition: "false", steps: true } })).error, "INVALID_SETTING");
      assert.deepEqual(store, snapshot);
    });
    await t.test("写入失败时恢复原动态注册；后续请求仍可正常工作", async () => {
      failWrite = true;
      assert.equal((await send({ type: "SET_SITE", origin: "https://a.test", enabled: false })).error, "OPERATION_FAILED");
      assert.equal(scripts.size, 1);
      failWrite = false;
      assert.equal((await send({ type: "GET_STATE" }, content())).enabled, true);
      failRegister = true;
      permissions.add("https://b.test/*");
      assert.equal((await send({ type: "SET_SITE", origin: "https://b.test", enabled: true })).error, "OPERATION_FAILED");
      failRegister = false;
      assert.deepEqual(store.settings.enabledOrigins, ["https://a.test"]);
    });
    await t.test("关闭网站撤销动态注入，保留两个选项的选择", async () => {
      const result = await send({ type: "SET_SITE", origin: "https://a.test", enabled: false });
      assert.equal(result.enabled, false);
      assert.equal(scripts.size, 0);
      assert.deepEqual(result.settings.fields, { precondition: false, steps: true });
    });
    await t.test("撤销主机权限后不再视为启用，重新同步会清理注册", async () => {
      await send({ type: "SET_SITE", origin: "https://a.test", enabled: true });
      permissions.delete("https://a.test/*");
      assert.equal((await send({ type: "GET_STATE" }, content())).enabled, false);
      await events.removed();
      await send({ type: "STATUS" });
      assert.equal(scripts.size, 0);
      assert.deepEqual(store.settings.enabledOrigins, []);
    });
  } finally { globalThis.chrome = previousChrome; }
});
