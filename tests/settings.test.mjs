import assert from "node:assert/strict";
import test from "node:test";
import { BOOLEAN_OPTION_KEYS, LINE_HEIGHTS, OPTION_DEFAULTS, normalizeSettings, validOptions, webOrigin, hostPattern } from "../extension/settings.js";

test("渲染和整体复制默认开启，正文行距保留原来的 2 倍", () => {
  assert.deepEqual(OPTION_DEFAULTS, { precondition: true, steps: true, bugSteps: true, copyCase: true, lineHeight: 2 });
  assert.deepEqual(LINE_HEIGHTS, ["default", 1.5, 2, 2.5, 3]);
  assert.deepEqual(normalizeSettings(null), { enabledOrigins: [], fields: OPTION_DEFAULTS });
});
test("选项可独立取消，全部取消也不恢复默认", () => {
  for (const key of BOOLEAN_OPTION_KEYS) {
    const fields = { ...OPTION_DEFAULTS, [key]: false };
    assert.deepEqual(normalizeSettings({ fields }).fields, fields);
  }
  const fields = { ...Object.fromEntries(BOOLEAN_OPTION_KEYS.map(key => [key, false])), lineHeight: "default" };
  assert.deepEqual(normalizeSettings({ fields }).fields, fields);
});
test("原有设置保留用例选项，新增功能默认开启", () => {
  const previous = { enabledOrigins: ["https://a.test"], fields: { precondition: false, steps: false } };
  const snapshot = structuredClone(previous);
  assert.deepEqual(normalizeSettings(previous), { enabledOrigins: ["https://a.test"], fields: { precondition: false, steps: false, bugSteps: true, copyCase: true, lineHeight: 2 } });
  assert.deepEqual(normalizeSettings({ fields: { precondition: false, steps: false, bugSteps: false } }).fields,
    { precondition: false, steps: false, bugSteps: false, copyCase: true, lineHeight: 2 });
  assert.deepEqual(previous, snapshot);
});
test("旧行距勾选映射为 2 倍或页面默认，新的档位优先并且不改原对象", () => {
  for (const doubleSpacing of [true, false]) {
    const previous = { fields: { precondition: false, copyCase: false, doubleSpacing } };
    const snapshot = structuredClone(previous);
    const migrated = normalizeSettings(previous);
    assert.equal(migrated.fields.lineHeight, doubleSpacing ? 2 : "default");
    assert.equal(migrated.fields.precondition, false);
    assert.equal(migrated.fields.copyCase, false);
    assert.equal("doubleSpacing" in migrated.fields, false);
    assert.equal(normalizeSettings({ fields: { doubleSpacing, lineHeight: 2.5 } }).fields.lineHeight, 2.5);
    assert.deepEqual(previous, snapshot);
  }
});
test("正文行距只接受五个档位，损坏值不会写入配置", () => {
  for (const lineHeight of ["default", 1.5, 2, 2.5, 3]) {
    const fields = { ...OPTION_DEFAULTS, lineHeight };
    assert.equal(validOptions(fields), true);
    assert.equal(normalizeSettings({ fields }).fields.lineHeight, lineHeight);
  }
  for (const lineHeight of [undefined, null, false, 0, 1.75, 4, "2.5", "inherit"]) {
    const fields = { ...OPTION_DEFAULTS, lineHeight };
    assert.equal(validOptions(fields), false);
    assert.equal(normalizeSettings({ fields }).fields.lineHeight, 2);
  }
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
