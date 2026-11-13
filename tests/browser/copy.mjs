import assert from "node:assert/strict";
import { fixtures, context, page, poll, preview, rendered, text, send, setFields, enabled, go, check, contentWorld, readClipboard } from "./harness.mjs";

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

  await check("执行弹窗整体复制排除历史与实际情况，保持表单焦点并跟随下一个用例", async () => {
    const button = page.locator(".modal-header [data-zen-mark-copy-case] .case-copy");
    await button.waitFor({ state: "visible" });
    assert.equal(await button.count(), 1, "Upload dialogs do not receive case copy buttons");
    await page.locator("#caseStepForm").evaluate(form => { form.action = "/zentao/testtask-runCase-999.html"; });
    await page.locator("#resultsContainer").evaluate(node => {
      node.insertAdjacentHTML("beforeend", '<form><div class="resultSteps"><div class="steps-body"><div class="step"><div>HISTORY_ONLY_VALUE</div></div></div></div></form>');
    });
    await page.locator("#result-one").selectOption("fail");
    await page.locator("#real-one").fill("PRIVATE_REAL_VALUE");
    await page.locator("#real-one").evaluate(node => { node.focus(); node.setSelectionRange(2, 8); });
    await button.click();
    await poll(() => button.getAttribute("data-state"), value => value === "success", "execution case copied");
    const copied = await readClipboard();
    for (const expected of ['用例标题：示例执行用例 `AGE`', "用例编号：1", "前置条件：", "DEMO_V1", "步骤 1：", "执行操作", "预期 1：", "保存成功", "步骤 2.1：", "待执行的检查", "预期 2.1：", "${example.value}"]) {
      assert.ok(copied.includes(expected), `${expected} is present in ${JSON.stringify(copied)}`);
    }
    for (const excluded of ["用例编号：999", "HISTORY_ONLY_VALUE", "PRIVATE_REAL_VALUE", "测试结果", "实际情况", "已复制", "上传附件", "pickerMeta"]) assert.ok(!copied.includes(excluded), `Excluded ${excluded}`);
    assert.deepEqual(await page.locator("#real-one").evaluate(node => ({ focused: document.activeElement === node, start: node.selectionStart, end: node.selectionEnd, value: node.value })),
      { focused: true, start: 2, end: 8, value: "PRIVATE_REAL_VALUE" });
    assert.equal(await page.locator("#result-one").inputValue(), "fail");
    assert.equal(await page.evaluate(() => window.saved), undefined);
    await setFields({ precondition: false, steps: false, bugSteps: false });
    await rendered("precondition", false); await rendered("step-one", false); await rendered("expect-one", false);
    await button.click();
    await poll(() => button.getAttribute("aria-busy"), value => value === null, "plain case copy complete");
    assert.equal(await readClipboard(), copied);
    await page.evaluate(html => {
      const replacement = new DOMParser().parseFromString(html, "text/html").querySelector("body > .modal-content");
      replacement.querySelector(".entity-label > .entity-title").textContent = "下一条执行用例";
      replacement.querySelector(".entity-label > .label-id").textContent = "2";
      replacement.querySelector('#caseStepForm input[name="case"]').value = "2";
      replacement.querySelector("#caseStepForm").action = "/zentao/testtask-runCase-1999.html";
      replacement.querySelector("#precondition").textContent = "下一条前置条件 `NEXT_PRE`";
      replacement.querySelector("#step-one").textContent = "下一条步骤 `NEXT_CASE`";
      replacement.querySelector("#expect-one").textContent = "新预期 `NEXT_EXPECT`";
      document.querySelector("body > .modal-content").replaceWith(replacement);
    }, fixtures.execution);
    await button.waitFor({ state: "visible" });
    assert.equal(await button.count(), 1);
    await button.click();
    const updated = await poll(() => readClipboard(), value => value.includes("NEXT_CASE"), "next execution case copied");
    for (const expected of ["用例标题：下一条执行用例", "用例编号：2", "NEXT_PRE", "NEXT_CASE", "NEXT_EXPECT"]) assert.ok(updated.includes(expected), expected);
    assert.ok(!updated.includes("用例编号：1999"));
    assert.ok(!updated.includes("示例执行用例"));
    await enabled(false);
    await poll(() => button.count(), count => count === 0, "execution copy removed when site disabled");
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
}
