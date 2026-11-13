import assert from "node:assert/strict";
import { context, worker, page, popup, errors, poll, launch, previews, preview, rendered, text, setFields, enabled, go, check } from "./harness.mjs";

export async function runSettingsTests() {
  await check("网站默认关闭，渲染与功能选项默认都勾选", async () => {
    assert.equal(await previews(), 0);
    assert.equal(await popup.locator("#site-name").textContent(), "zentao.test");
    assert.equal(await popup.locator("#site-enabled").isChecked(), false);
    assert.deepEqual(await popup.locator("#fields input").evaluateAll(inputs => inputs.map(input => [input.id, input.checked])), [["field-precondition", true], ["field-steps", true], ["field-bugSteps", true], ["field-copyCase", true], ["field-doubleSpacing", true]]);
    assert.deepEqual(await popup.locator("#fields > .option-group > legend").allTextContents(), ["渲染内容", "辅助功能"]);
    assert.equal(await popup.locator('label:has(#field-steps)').textContent(), "步骤与预期");
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

  await check("关闭网站恢复精确原始 DOM，刷新后不注入，重新开启保留选择", async () => {
    await enabled(false); await go();
    const original = await page.locator("body > .modal-content > .modal-body").innerHTML();
    await enabled(true); await rendered("step-one");
    await setFields({ precondition: false, steps: true }); await rendered("precondition", false);
    await enabled(false); await poll(previews, count => count === 0, "source restored");
    assert.equal(await page.locator("body > .modal-content > .modal-body").innerHTML(), original);
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    await page.reload(); assert.equal(await previews(), 0);
    await enabled(true); await rendered("step-one");
    assert.equal(await preview("precondition").count(), 0);
  });

  await check("可选复制与双倍行距即时生效并保存，详情页按钮紧邻用例标题", async () => {
    await go("/zentao/testcase-view-1.html");
    await rendered("step-one");
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-copyCase").isChecked(), true);
    assert.equal(await popup.locator("#field-doubleSpacing").isChecked(), true);
    const positions = await page.evaluate(() => {
      const title = document.querySelector(".detail-header > .entity-title > .entity-title-text").getBoundingClientRect();
      const button = document.querySelector("[data-zen-mark-copy-case]").getBoundingClientRect();
      return { gap: button.left - title.right, center: Math.abs((button.top + button.bottom) / 2 - (title.top + title.bottom) / 2) };
    });
    assert.ok(positions.gap >= 0 && positions.gap < 32 && positions.center < 4, `Copy button stays beside the title: ${JSON.stringify(positions)}`);
    const spacing = () => preview("step-one").locator(".markdown > p").evaluate(node => ({ line: getComputedStyle(node).lineHeight, size: getComputedStyle(node).fontSize }));
    const doubled = await spacing();
    assert.equal(parseFloat(doubled.line), parseFloat(doubled.size) * 2);
    const inherited = await page.locator("#step-one").evaluate(node => getComputedStyle(node).lineHeight);
    await popup.locator("#field-doubleSpacing").uncheck();
    await poll(spacing, value => value.line === inherited, "page line-height restored without refreshing");
    await popup.locator("#field-copyCase").uncheck();
    await poll(() => page.locator("[data-zen-mark-copy-case]").count(), count => count === 0, "detail copy hidden");
    await go(); await rendered("step-one");
    assert.equal(await page.locator("[data-zen-mark-copy-case]").count(), 0);
    const modalInherited = await page.locator("#step-one").evaluate(node => getComputedStyle(node).lineHeight);
    assert.equal(await preview("expect-one").locator(".markdown > p").evaluate(node => getComputedStyle(node).lineHeight), modalInherited);
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-copyCase").isChecked(), false);
    assert.equal(await popup.locator("#field-doubleSpacing").isChecked(), false);
    await popup.locator("#field-copyCase").check();
    await poll(() => page.locator("[data-zen-mark-copy-case]").count(), count => count === 1, "execution copy restored");
    await popup.locator("#field-doubleSpacing").check();
    await poll(() => preview("expect-one").locator(".markdown > p").evaluate(node => ({ line: getComputedStyle(node).lineHeight, size: getComputedStyle(node).fontSize })),
      value => parseFloat(value.line) === parseFloat(value.size) * 2, "double line-height restored");
    await go("/zentao/testcase-view-1.html"); await rendered("step-one");
    assert.equal(await page.locator(".detail-header > .entity-title > [data-zen-mark-copy-case]").count(), 1);
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
}

export async function runPersistenceTests() {
  await check("刷新、重启浏览器后保留网站和渲染选项的选择", async () => {
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
}
