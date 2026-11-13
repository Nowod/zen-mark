import assert from "node:assert/strict";
import { context, page, poll, preview, rendered, setFields, enabled, go, check, readClipboard } from "./harness.mjs";

export async function runCopyTests() {
  await check("用例整体复制包含标题、编号、前置条件、步骤与预期，取消渲染后仍可复制最新文本", async () => {
    await go("/zentao/testcase-view-1.html");
    await rendered("step-one");
    const button = page.locator("[data-zen-mark-copy-case] .case-copy");
    await button.waitFor({ state: "visible" });
    assert.equal(await button.count(), 1);
    assert.equal(await button.getAttribute("aria-label"), "复制用例");
    await button.click();
    await poll(() => button.getAttribute("data-state"), value => value === "success", "case copied");
    const copied = await readClipboard();
    for (const expected of ["用例标题：示例用例标题", "用例编号：1", "前置条件：", "准备 DEMO_V1", "${example.value}", "步骤 1：", "打开 示例页面，保存 DEMO_V2", "预期 1：", "状态为 ready", "步骤 2.1：", "后续检查", "预期 2.1：", "日志可读"]) {
      assert.ok(copied.includes(expected), `${expected} is present in ${JSON.stringify(copied)}`);
    }
    for (const excluded of ["已复制", "复制用例", "原始历史内容", "附件.txt", "**", "`", "<div"]) assert.ok(!copied.includes(excluded), `Excluded ${excluded}`);
    assert.ok(copied.indexOf("步骤 1：") < copied.indexOf("预期 1："));
    assert.ok(copied.indexOf("预期 1：") < copied.indexOf("步骤 2.1："));
    await setFields({ precondition: false, steps: false, bugSteps: false });
    await rendered("precondition", false); await rendered("step-one", false); await rendered("expect-one", false);
    await button.click();
    assert.equal(await readClipboard(), copied);
    await page.locator(".detail-view").evaluate(view => { view.dataset.id = "2"; view.querySelector(".entity-title-text").textContent = "下一条用例"; });
    await page.locator("#step-one").evaluate(node => { node.lastChild.textContent = "更新后的步骤 `CURRENT`"; });
    await button.click();
    const updated = await readClipboard();
    assert.ok(updated.includes("用例标题：下一条用例"));
    assert.ok(updated.includes("用例编号：2"));
    assert.ok(updated.includes("更新后的步骤 CURRENT"));
    assert.ok(!updated.includes("示例用例标题"));
    await enabled(false);
    await poll(() => button.count(), count => count === 0, "case copy removed when site disabled");
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

}
