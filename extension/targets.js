(() => {
  "use strict";
  const controls = 'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), .ke-edit, .tox, .editor-content';
  const label = element => (element?.textContent || "").replace(/[\s:：*＊]/g, "").toLowerCase();
  const preLabels = new Set(["前置条件", "前置條件", "前提条件", "precondition", "preconditions"]);
  const stepLabels = new Set(["步骤", "步驟", "操作步骤", "步骤描述", "step", "steps", "stepdescription"]);
  const expectLabels = new Set(["预期", "預期", "预期结果", "預期結果", "期望结果", "expect", "expected", "expectedresult", "expectedresults"]);
  const bugLabels = new Set(["重现步骤", "重現步驟", "复现步骤", "復現步驟", "stepstoreproduce", "reprosteps"]);

  function viewRoute() {
    const url = new URL(location.href);
    return /(?:^|\/)(?:testcase|testtask)[-/](?:view|runcase)(?:[-/.]|$)/i.test(url.pathname)
      || (/^(testcase|testtask)$/i.test(url.searchParams.get("m") || "") && /^(view|runcase)$/i.test(url.searchParams.get("f") || ""));
  }

  function bugViewRoute() {
    const url = new URL(location.href);
    return /(?:^|\/)bug[-/]view(?:[-/.]|$)/i.test(url.pathname)
      || (/^bug$/i.test(url.searchParams.get("m") || "") && /^view$/i.test(url.searchParams.get("f") || ""));
  }

  function safe(element) {
    return element && !element.matches(controls) && !element.closest(controls)
      && !element.querySelector(controls) && !element.closest("[data-zen-mark-view]");
  }

  function stepNumber(node, element) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches(".step-item-id")) return true;
    return element.matches(".step-id") && node === element.firstElementChild && node.matches("span.nowrap")
      && /^\d+(?:[.．-]\d+)*[.．、)]?$/.test(node.textContent.trim());
  }

  function find(root = document, options = globalThis.ZenMarkMarkdown.optionDefaults) {
    const targets = new Map();
    const hasCase = viewRoute() || root.querySelector("#caseStepForm, #stepsTable");
    const hasBug = bugViewRoute();
    if (!hasCase && !hasBug) return targets;
    const add = (element, kind) => { if (safe(element)) targets.set(element, kind); };
    if (hasBug && options.bugSteps) {
      for (const section of root.querySelectorAll(".detail-section, .detail, fieldset")) {
        const title = section.querySelector(":scope > .detail-section-title, :scope > .detail-title, :scope > legend");
        if (!bugLabels.has(label(title))) continue;
        const content = section.querySelector(":scope > .detail-section-content, :scope > .detail-content");
        add(content?.querySelector(":scope > .article") || content, "bugSteps");
      }
    }
    if (!hasCase) return targets;
    if (options.precondition) {
      for (const caption of root.querySelectorAll("td.case-precondition, th.case-precondition")) add(caption.nextElementSibling, "precondition");
      for (const section of root.querySelectorAll(".detail-section, .detail, fieldset")) {
        const title = section.querySelector(":scope > .detail-section-title, :scope > .detail-title, :scope > legend");
        if (!preLabels.has(label(title))) continue;
        const content = section.querySelector(":scope > .detail-section-content, :scope > .detail-content");
        add(content?.querySelector(":scope > .article") || content, "precondition");
      }
      if (viewRoute()) {
        for (const caption of root.querySelectorAll("th, td")) {
          if (preLabels.has(label(caption)) && caption.closest("tr")?.cells.length === 2) add(caption.nextElementSibling, "precondition");
        }
      }
    }
    if (options.steps) {
      for (const row of root.querySelectorAll("#stepsTable .steps-body > .step")) {
        const cells = [...row.children];
        add(cells[0], "steps");
        add(cells[1], "steps");
      }
      for (const table of root.querySelectorAll("#caseStepForm table, table#steps, table.steps, #steps table")) {
        const rows = [...table.rows];
        const heading = table.tHead?.rows[0] || rows[0];
        if (!heading) continue;
        const columns = [];
        let column = 0;
        for (const cell of heading.cells) {
          const kind = stepLabels.has(label(cell)) ? "step" : expectLabels.has(label(cell)) ? "expect" : null;
          if (kind) columns.push({ start: column, end: column + cell.colSpan, kind });
          column += cell.colSpan;
        }
        if (!columns.some(item => item.kind === "step") || !columns.some(item => item.kind === "expect")) continue;
        const occupied = [];
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index];
          if (row === heading || row.parentElement === table.tHead) continue;
          let start = 0;
          for (const cell of row.cells) {
            while (occupied[start] > index) start++;
            const width = cell.colSpan;
            const height = cell.rowSpan || rows.length - index;
            for (let offset = 0; offset < width; offset++) occupied[start + offset] = index + height;
            const match = columns.find(item => start >= item.start && start + width <= item.end);
            if (match && !/^\s*\d+(?:[.．]\d+)*[.．、)]?\s*$/.test(cell.textContent)) {
              const body = match.kind === "step" ? cell.querySelector(".inputGroup > .wrap, .input-group > .wrap, .step-desc, .step-description") : null;
              add(body || cell, "steps");
            }
            start += width;
          }
        }
      }
    }
    return targets;
  }
  globalThis.ZenMarkTargets = Object.freeze({ find, stepNumber });
})();
