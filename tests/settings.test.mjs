import assert from "node:assert/strict";
import test from "node:test";
import { OPTION_DEFAULTS, normalizeSettings, webOrigin, hostPattern } from "../extension/settings.js";

test("渲染、整体复制与双倍行距默认全部勾选", () => {
  assert.deepEqual(OPTION_DEFAULTS, { precondition: true, steps: true, bugSteps: true, copyCase: true, doubleSpacing: true });
  assert.deepEqual(normalizeSettings(null), { enabledOrigins: [], fields: OPTION_DEFAULTS });
});
test("选项可独立取消，全部取消也不恢复默认", () => {
  for (const key of Object.keys(OPTION_DEFAULTS)) {
    const fields = { ...OPTION_DEFAULTS, [key]: false };
    assert.deepEqual(normalizeSettings({ fields }).fields, fields);
  }
  const fields = Object.fromEntries(Object.keys(OPTION_DEFAULTS).map(key => [key, false]));
  assert.deepEqual(normalizeSettings({ fields }).fields, fields);
});
test("原有设置保留用例选项，新增功能默认开启", () => {
  const previous = { enabledOrigins: ["https://a.test"], fields: { precondition: false, steps: false } };
  const snapshot = structuredClone(previous);
  assert.deepEqual(normalizeSettings(previous), { enabledOrigins: ["https://a.test"], fields: { precondition: false, steps: false, bugSteps: true, copyCase: true, doubleSpacing: true } });
  assert.deepEqual(normalizeSettings({ fields: { precondition: false, steps: false, bugSteps: false } }).fields,
    { precondition: false, steps: false, bugSteps: false, copyCase: true, doubleSpacing: true });
  assert.deepEqual(previous, snapshot);
});
test("损坏选项采用默认，未知字段不会进入设置", () => {
  assert.deepEqual(normalizeSettings({ fields: { precondition: "false", steps: null, expect: false } }).fields, OPTION_DEFAULTS);
});
test("网站默认关闭；按协议、子域和端口独立启用，移除非网页来源", () => {
  const input = { enabledOrigins: ["https://a.test/path", "https://a.test", "http://a.test", "https://a.test:8443", "https://b.a.test", "file:///tmp/a", "javascript:alert(1)", null] };
  const snapshot = structuredClone(input);
  assert.deepEqual(normalizeSettings(input).enabledOrigins, ["https://a.test", "http://a.test", "https://a.test:8443", "https://b.a.test"]);
  assert.deepEqual(input, snapshot);
});
test("授权范围只含网站主机，精确的端口限制由启用设置执行", () => {
  assert.equal(webOrigin("https://a.test:8443/zentao/testcase-view-1.html"), "https://a.test:8443");
  assert.equal(hostPattern("https://a.test:8443"), "https://a.test/*");
  assert.equal(hostPattern("http://127.0.0.1:8080"), "http://127.0.0.1/*");
  assert.equal(webOrigin("chrome://extensions"), null);
});
