import assert from "node:assert/strict";
import { context, worker, page, popup, errors, poll, launch, previews, preview, rendered, text, setFields, enabled, go, check } from "./harness.mjs";

export async function runSettingsTests() {
  await check("网站默认关闭，渲染与复制默认开启，正文行距为 2 倍", async () => {
    assert.equal(await previews(), 0);
    assert.equal(await popup.locator("#site-name").textContent(), "zentao.test");
    assert.equal(await popup.locator("#site-enabled").isChecked(), false);
    assert.deepEqual(await popup.locator("#fields input").evaluateAll(inputs => inputs.map(input => [input.id, input.checked])),
      [["field-precondition", true], ["field-steps", true], ["field-bugSteps", true], ["field-copyCase", true], ["field-hideActual", false], ["field-equalStepWidths", true]]);
    assert.deepEqual(await popup.locator("#fields > .option-group > legend").allTextContents(), ["渲染内容", "辅助功能"]);
    assert.equal(await popup.locator('label:has(#field-steps)').textContent(), "步骤与预期");
    assert.equal(await popup.locator("#field-lineHeight").inputValue(), "2");
    assert.deepEqual(await popup.locator("#field-lineHeight option").evaluateAll(options => options.map(option => [option.value, option.textContent])),
      [["default", "默认"], ["1.5", "1.5 倍"], ["2", "2 倍"], ["2.5", "2.5 倍"], ["3", "3 倍"]]);
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
    await setFields({ precondition: false, steps: true, hideActual: true }); await rendered("precondition", false);
    await page.locator("#real-one").waitFor({ state: "hidden" });
    await enabled(false); await poll(previews, count => count === 0, "source restored");
    assert.equal(await page.locator("body > .modal-content > .modal-body").innerHTML(), original);
    assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
    await page.reload(); assert.equal(await previews(), 0);
    await enabled(true); await rendered("step-one");
    assert.equal(await preview("precondition").count(), 0);
    assert.equal(await page.locator("#real-one").isVisible(), false);
  });

  await check("等宽和隐藏实际情况可独立切换，恢复后保留输入和附件入口", async () => {
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    const hideActual = popup.getByRole("checkbox", { name: "隐藏实际情况列" });
    const equalStepWidths = popup.getByRole("checkbox", { name: "步骤与预期等宽" });
    const table = page.locator("#caseStepForm > table");
    const heading = table.locator("thead").getByText("实际情况", { exact: true });
    const actual = page.locator("#real-one");
    const widths = () => table.locator("thead td").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
    const equal = ([step, expect]) => step > 0 && Math.abs(step - expect) < 1;
    const tableLayout = () => table.evaluate(node => getComputedStyle(node).tableLayout);
    await table.evaluate(node => {
      node.insertAdjacentHTML("afterbegin", '<colgroup><col style="width:18%"><col style="width:36%"><col><col style="width:25%"></colgroup>');
      node.tHead.rows[0].cells[0].style.width = "25%";
      node.tHead.rows[0].cells[1].style.width = "35%";
    });
    await actual.fill("已填写的实际情况");
    await popup.locator("#field-steps").uncheck(); await rendered("step-one", false);
    const visibleWidths = await poll(widths, equal, "Steps and expected results use equal widths with the actual column visible");
    await hideActual.check();
    await heading.waitFor({ state: "hidden" });
    const hiddenWidths = await widths();
    assert.ok(equal(hiddenWidths) && hiddenWidths[0] > visibleWidths[0] && hiddenWidths[3] < 1,
      `Steps and expected results share the freed space: ${JSON.stringify(hiddenWidths)}`);
    assert.deepEqual(await table.locator("thead td:visible").allTextContents(), ["步骤", "预期", "测试结果"]);
    assert.equal(await table.locator('textarea[name^="real["]:visible').count(), 0);
    assert.equal(await page.locator("#attachment").isVisible(), false);
    await page.locator("#result-one").selectOption("fail");
    await page.locator("#save").click();
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved["result[1]"], "fail");
    assert.equal(saved["real[1]"], "已填写的实际情况");
    await equalStepWidths.uncheck();
    await poll(tableLayout, value => value === "auto", "Disabling equal widths restores native layout");
    assert.equal(await heading.isVisible(), false);
    assert.equal(await actual.isVisible(), false);
    await hideActual.uncheck();
    await heading.waitFor({ state: "visible" });
    assert.equal(await actual.inputValue(), "已填写的实际情况");
    assert.equal(equal(await widths()), false);
    await page.locator("#attachment").click();
    assert.equal(await page.evaluate(() => window.attachmentClicks), 1);
    await equalStepWidths.check();
    assert.deepEqual(await poll(widths, equal, "Reenabling equal widths keeps the actual column visible"), visibleWidths);
    await table.evaluate(node => { node.closest(".modal-body").style.maxWidth = "760px"; });
    const resizedWidths = await widths();
    assert.ok(equal(resizedWidths) && resizedWidths[0] < visibleWidths[0],
      `Steps and expected results resize together: ${JSON.stringify(resizedWidths)}`);
  });

  await check("正文行距五个档位即时生效并保存，复制开关与标题旁按钮独立", async () => {
    await go("/zentao/testcase-view-1.html");
    await rendered("step-one");
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-copyCase").isChecked(), true);
    assert.equal(await popup.locator("#field-lineHeight").inputValue(), "2");
    const positions = await page.evaluate(() => {
      const title = document.querySelector(".detail-header > .entity-title > .entity-title-text").getBoundingClientRect();
      const button = document.querySelector("[data-zen-mark-copy-case]").getBoundingClientRect();
      return { gap: button.left - title.right, center: Math.abs((button.top + button.bottom) / 2 - (title.top + title.bottom) / 2) };
    });
    assert.ok(positions.gap >= 0 && positions.gap < 32 && positions.center < 4, `Copy button stays beside the title: ${JSON.stringify(positions)}`);
    const spacing = () => preview("step-one").locator(".markdown > p").evaluate(node => ({ line: getComputedStyle(node).lineHeight, size: getComputedStyle(node).fontSize }));
    const inherited = await page.locator("#step-one").evaluate(node => getComputedStyle(node).lineHeight);
    for (const lineHeight of ["default", "1.5", "2", "2.5", "3"]) {
      await popup.locator("#field-lineHeight").selectOption(lineHeight);
      await poll(spacing, value => lineHeight === "default" ? value.line === inherited : parseFloat(value.line) === parseFloat(value.size) * Number(lineHeight), `line-height ${lineHeight} applied without refreshing`);
    }
    await popup.locator("#field-copyCase").uncheck();
    await poll(() => page.locator("[data-zen-mark-copy-case]").count(), count => count === 0, "detail copy hidden");
    await go(); await rendered("step-one");
    assert.equal(await page.locator("[data-zen-mark-copy-case]").count(), 0);
    const newSpacing = await preview("expect-one").locator(".markdown > p").evaluate(node => ({ line: getComputedStyle(node).lineHeight, size: getComputedStyle(node).fontSize }));
    assert.equal(parseFloat(newSpacing.line), parseFloat(newSpacing.size) * 3);
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-copyCase").isChecked(), false);
    assert.equal(await popup.locator("#field-lineHeight").inputValue(), "3");
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings.fields.lineHeight), 3);
    await popup.locator("#field-copyCase").check();
    await poll(() => page.locator("[data-zen-mark-copy-case]").count(), count => count === 1, "execution copy restored");
    await popup.locator("#field-lineHeight").selectOption("default");
    const modalInherited = await page.locator("#expect-one").evaluate(node => getComputedStyle(node).lineHeight);
    await poll(() => preview("expect-one").locator(".markdown > p").evaluate(node => getComputedStyle(node).lineHeight), value => value === modalInherited, "page line-height restored");
    await go("/zentao/testcase-view-1.html"); await rendered("step-one");
    assert.equal(await page.locator(".detail-header > .entity-title > [data-zen-mark-copy-case]").count(), 1);
    assert.equal((await spacing()).line, inherited);
  });

}

export async function runPersistenceTests() {
  await check("刷新、重启浏览器后保留网站和渲染选项的选择", async () => {
    await setFields({ precondition: false, steps: true, hideActual: true, equalStepWidths: false, lineHeight: 2.5 });
    await page.reload(); await rendered("step-one"); await rendered("precondition", false);
    await context.close(); await launch();
    try { await rendered("step-one"); await rendered("precondition", false); }
    catch (error) {
      const state = await worker.evaluate(async () => ({ settings: await chrome.storage.local.get(null), scripts: await chrome.scripting.getRegisteredContentScripts(), permissions: await chrome.permissions.getAll() }));
      throw new Error(`Restart state: ${JSON.stringify(state)}; pageErrors=${JSON.stringify(errors)}`, { cause: error });
    }
    assert.equal(await popup.locator("#field-precondition").isChecked(), false);
    assert.equal(await popup.locator("#field-steps").isChecked(), true);
    assert.equal(await popup.locator("#field-hideActual").isChecked(), true);
    assert.equal(await popup.locator("#field-equalStepWidths").isChecked(), false);
    assert.equal(await page.locator("#real-one").isVisible(), false);
    assert.equal(await page.locator("#caseStepForm > table").evaluate(node => getComputedStyle(node).tableLayout), "auto");
    assert.equal(await popup.locator("#field-lineHeight").inputValue(), "2.5");
    const spacing = await preview("expect-one").locator(".markdown > p").evaluate(node => ({ line: getComputedStyle(node).lineHeight, size: getComputedStyle(node).fontSize }));
    assert.equal(parseFloat(spacing.line), parseFloat(spacing.size) * 2.5);
    assert.equal(await popup.locator("#site-enabled").isChecked(), true);
  });
}
