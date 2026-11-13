import assert from "node:assert/strict";
import { fixtures, page, popup, poll, previews, preview, rendered, text, setFields, enabled, go, check, readClipboard } from "./harness.mjs";

export async function runRenderingTests() {
  await check("选择结果、实际情况、附件按钮和保存表单正常，步骤编号保持不变", async () => {
    const controls = await page.locator("#caseStepForm").evaluate(form => [...form.querySelectorAll("input, select, textarea, button")].map(node => node.outerHTML));
    await page.locator("#result-one").selectOption("fail");
    await page.locator("#real-one").fill("实际情况 **保持纯文本**");
    await page.locator("#attachment").click();
    assert.equal(await page.evaluate(() => window.attachmentClicks), 1);
    assert.ok(await page.evaluate(() => window.realInputs > 0));
    assert.deepEqual(await page.locator(".step-item-id").allTextContents(), ["1", "2.1"]);
    await page.locator("#save").click();
    const saved = await page.evaluate(() => window.saved);
    assert.equal(saved["result[1]"], "fail");
    assert.equal(saved["real[1]"], "实际情况 **保持纯文本**");
    assert.equal(saved.case, "1"); assert.equal(saved.version, "1"); assert.equal(saved.pickerMeta, "keep");
    await enabled(false);
    await poll(previews, count => count === 0, "disabled restores originals");
    const restored = await page.locator("#caseStepForm").evaluate(form => [...form.querySelectorAll("input, select, textarea, button")].map(node => node.outerHTML));
    assert.deepEqual(restored, controls);
  });

  await check("详情页渲染前置条件、步骤与预期，编号、附件和历史内容保持原样", async () => {
    await go("/zentao/testcase-view-1.html");
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    assert.deepEqual(await page.locator("#stepsTable .nowrap").allTextContents(), ["1", "2.1"]);
    assert.equal(await preview("step-one").locator("strong").textContent(), "示例页面");
    assert.equal(await preview("expect-one").locator("code").textContent(), "ready");
    const colors = await page.evaluate(() => {
      const step = document.querySelector("#step-one");
      const expect = document.querySelector("#expect-one");
      return {
        step: getComputedStyle(step.querySelector("[data-zen-mark-view]").shadowRoot.querySelector("p")).color,
        expect: getComputedStyle(expect.querySelector("[data-zen-mark-view]").shadowRoot.querySelector("p")).color,
        cell: getComputedStyle(step).color,
        number: getComputedStyle(step.querySelector(".nowrap")).color
      };
    });
    assert.equal(colors.step, colors.expect, `Step text keeps the normal body color: ${JSON.stringify(colors)}`);
    assert.equal(colors.step, colors.cell);
    assert.equal(colors.number, "rgb(124, 140, 166)", "Step numbers retain ZenTao's muted color");
    assert.equal(await page.locator("#history [data-zen-mark-view]").count(), 0);
    assert.equal(await page.locator("#existing-file").textContent(), "附件.txt");
    await setFields({ precondition: true, steps: false });
    await rendered("step-one", false); await rendered("expect-one", false);
    assert.equal(await preview("precondition").count(), 1);
    assert.ok((await page.locator("#step-one").textContent()).startsWith("1打开 **示例页面**"));
  });

  await check("Bug 详情渲染富文本与 Markdown，代码可复制，图片链接保留且可独立还原", async () => {
    await go("/zentao/bug-view-1.html");
    await rendered("bug-steps");
    assert.equal(await previews(), 1);
    assert.equal(await page.locator("[data-zen-mark-copy-case]").count(), 0);
    const body = preview("bug-steps");
    const original = await page.locator("#bug-steps > [data-zen-mark-source]").innerHTML();
    assert.equal(await body.locator("h3").count(), 5);
    assert.equal(await body.locator("ul").count(), 2);
    assert.equal(await body.locator("ol").count(), 3);
    assert.equal(await body.locator("ol strong").textContent(), "示例页面");
    assert.equal(await body.locator("a:has(img)").getAttribute("href"), "/attachment/example.png");
    assert.equal(await body.locator("img").getAttribute("src"), "/attachment/example.png");
    assert.equal(await page.locator("#history [data-zen-mark-view], #bug-editor [data-zen-mark-view]").count(), 0);
    assert.equal(await page.locator("#bug-file").textContent(), "附件.txt");
    const code = body.locator("code").first();
    await code.hover();
    await code.locator("..").locator(".code-copy").click();
    assert.equal(await readClipboard(), "DEMO+#NAME");
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-bugSteps").isChecked(), true);
    await popup.locator("#field-bugSteps").uncheck();
    await rendered("bug-steps", false);
    assert.equal(await page.locator("#bug-steps").innerHTML(), original);
    await go("/zentao/testcase-view-1.html");
    await rendered("precondition"); await rendered("step-one"); await rendered("expect-one");
    await popup.reload(); await popup.waitForFunction(() => !document.querySelector("#fields").disabled);
    assert.equal(await popup.locator("#field-bugSteps").isChecked(), false);
    await popup.locator("#field-bugSteps").check();
    await setFields({ precondition: false, steps: false, bugSteps: true });
    await rendered("precondition", false); await rendered("step-one", false); await rendered("expect-one", false);
    await go("/zentao/bug-view-1.html"); await rendered("bug-steps");
    await enabled(false); await rendered("bug-steps", false);
    assert.equal(await page.locator("#bug-steps").innerHTML(), original);
  });

  await check("弹窗异步加入、下一个用例替换内容后自动渲染，不重复嵌套预览", async () => {
    await page.evaluate(() => { document.querySelector(".modal-body").remove(); });
    await poll(previews, count => count === 0, "old modal removed");
    await page.evaluate(html => { document.body.insertAdjacentHTML("beforeend", new DOMParser().parseFromString(html, "text/html").querySelector(".modal-body").outerHTML); }, fixtures.execution);
    await rendered("step-one");
    await page.locator("#step-one").evaluate(node => { node.textContent = "下一条用例 `NEXT`"; });
    await poll(() => text("step-one"), value => value.includes("NEXT"), "new case rendered");
    assert.equal(await preview("step-one").locator("code").textContent(), "NEXT");
    await page.locator("#step-one > [data-zen-mark-source]").evaluate(node => { node.textContent = "继续修改 **UPDATED**"; });
    await poll(() => text("step-one"), value => value.includes("UPDATED"), "changed source rendered");
    assert.equal(await page.locator("#step-one > [data-zen-mark-view]").count(), 1);
    await page.locator("#step-one > [data-zen-mark-source]").evaluate(node => { node.textContent = ""; });
    await rendered("step-one", false);
    assert.equal(await page.locator("#step-one").textContent(), "");
  });

  await check("编辑区域、实际情况及无关页面不进行 Markdown 替换", async () => {
    await go("/zentao/testcase-edit-1.html");
    assert.equal(await previews(), 0);
    assert.equal(await page.locator("textarea#step-one").inputValue(), "步骤 `source`");
    assert.equal(await page.locator("[contenteditable]").textContent(), "预期 **source**");
    await go("/unrelated"); assert.equal(await previews(), 0);
  });

  await check("HTML 脚本、事件属性与危险链接被清理，代码示例保持字面量", async () => {
    await page.locator("#expect-one").evaluate(node => {
      node.textContent = '**安全内容**\n\n<img src="x" onerror="window.hacked=1"><script>window.hacked=2</script>\n\n[危险](javascript:alert(1))\n\n```html\n<script>literal</script>\n```\n\n<iframe src="https://evil.test"></iframe><form><input name="stolen"></form>';
    });
    await poll(() => text("expect-one"), value => value.includes("安全内容"), "sanitized preview");
    assert.equal(await preview("expect-one").locator("script, iframe, input, form").count(), 0);
    assert.equal(await preview("expect-one").locator("[onerror]").count(), 0);
    assert.equal(await preview("expect-one").locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.hacked), undefined);
    assert.equal(await preview("expect-one").locator("pre code").textContent(), "<script>literal</script>\n");
    await page.locator("#expect-one").evaluate(node => { node.textContent = "<script>literal_only</script>"; });
    await poll(() => text("expect-one"), value => value.includes("<script>literal_only</script>"), "HTML-only source stays visible as text");
    assert.equal(await preview("expect-one").locator("script").count(), 0);
  });

}
