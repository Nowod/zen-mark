import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_DEFAULTS, normalizeSettings, webOrigin, hostPattern } from "../extension/settings.js";

test("默认只提供前置条件和用例步骤两个渲染选项，默认全部勾选", () => {
  assert.deepEqual(FIELD_DEFAULTS, { precondition: true, steps: true });
  assert.deepEqual(normalizeSettings(null), { enabledOrigins: [], fields: { precondition: true, steps: true } });
});
test("两个选项可独立取消，全部取消也不恢复默认", () => {
  for (const precondition of [true, false]) for (const steps of [true, false]) {
    assert.deepEqual(normalizeSettings({ fields: { precondition, steps } }).fields, { precondition, steps });
  }
});
test("损坏选项采用默认，未知字段不会进入设置", () => {
  assert.deepEqual(normalizeSettings({ fields: { precondition: "false", steps: null, expect: false } }).fields, FIELD_DEFAULTS);
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
