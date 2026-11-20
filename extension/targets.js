(() => {
  "use strict";
  const controls = 'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), .ke-edit, .tox, .editor-content';
  const executionTables = "#caseStepForm table";
  const label = element => (element?.textContent || "").replace(/[\s:：*＊]/g, "").toLowerCase();
  const preLabels = new Set(["前置条件", "前置條件", "前提条件", "precondition", "preconditions"]);
  const stepColumnLabels = [
    ["step", new Set(["步骤", "步驟", "操作步骤", "步骤描述", "step", "steps", "stepdescription"])],
    ["expect", new Set(["预期", "預期", "预期结果", "預期結果", "期望结果", "expect", "expected", "expectedresult", "expectedresults"])],
    ["actual", new Set(["实际情况", "實際情況", "实际结果", "實際結果", "actual", "actualsituation", "actualresult", "actualresults"])]
  ];
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

  function stepTableLayout(table) {
    const heading = table.tHead?.rows[0] || table.rows[0];
    if (!heading) return null;
    const columns = [];
    let start = 0;
    for (const cell of heading.cells) {
      const text = label(cell);
      const kind = stepColumnLabels.find(([, labels]) => labels.has(text))?.[0];
      const end = start + cell.colSpan;
      if (kind) columns.push({ cell, start, end, kind });
      start = end;
    }
    if (!columns.some(column => column.kind === "step") || !columns.some(column => column.kind === "expect")) return null;
    return { heading, columns };
  }

  function* cellsInColumns(table, heading, columns) {
    let section;
    const occupied = [];
    for (const [index, row] of [...table.rows].entries()) {
      if (row === heading || row.parentElement === table.tHead) continue;
      if (section !== row.parentElement) {
        section = row.parentElement;
        occupied.length = 0;
      }
      let start = 0;
      for (const cell of row.cells) {
        while (occupied[start] > index) start++;
        const end = start + cell.colSpan;
        const until = cell.rowSpan ? index + cell.rowSpan : Infinity;
        for (let column = start; column < end; column++) occupied[column] = until;
        const match = columns.find(column => start >= column.start && end <= column.end);
        if (match) yield [cell, match.kind];
        start = end;
      }
    }
  }

  function findExecutionLayout(root, { hideActual, equalStepWidths }) {
    const elements = new Map();
    if (!hideActual && !equalStepWidths) return elements;
    const hiddenRole = equalStepWidths ? "zero-width" : "hidden";
    const role = kind => kind === "actual" ? hiddenRole : "equal-width";
    for (const table of root.querySelectorAll(executionTables)) {
      const layout = stepTableLayout(table);
      if (!layout) continue;
      const columns = layout.columns.filter(column => column.kind === "actual" ? hideActual : equalStepWidths);
      if (!columns.length) continue;
      const actual = columns.filter(column => column.kind === "actual");
      const overlaps = (start, end) => columns.some(column => start < column.end && end > column.start);
      if (equalStepWidths) elements.set(table, "table");
      for (const { cell, kind } of columns) elements.set(cell, role(kind));
      for (const [cell, kind] of cellsInColumns(table, layout.heading, columns)) elements.set(cell, role(kind));
      let start = 0;
      for (const group of table.querySelectorAll(":scope > colgroup")) {
        const groupStart = start;
        for (const col of group.children.length ? group.children : [group]) {
          const end = start + col.span;
          if (actual.some(column => start >= column.start && end <= column.end)) elements.set(col, hiddenRole);
          else if (equalStepWidths && overlaps(start, end)) elements.set(col, "equal-width");
          start = end;
        }
        if (equalStepWidths && group.children.length && overlaps(groupStart, start)) elements.set(group, "equal-width");
      }
    }
    return elements;
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
      for (const table of root.querySelectorAll(`${executionTables}, table#steps, table.steps, #steps table`)) {
        const layout = stepTableLayout(table);
        if (!layout) continue;
        const columns = layout.columns.filter(column => column.kind !== "actual");
        for (const [cell, kind] of cellsInColumns(table, layout.heading, columns)) {
          if (/^\s*\d+(?:[.．]\d+)*[.．、)]?\s*$/.test(cell.textContent)) continue;
          const body = kind === "step" ? cell.querySelector(".inputGroup > .wrap, .input-group > .wrap, .step-desc, .step-description") : null;
          add(body || cell, "steps");
        }
      }
    }
    return targets;
  }
  globalThis.ZenMarkTargets = Object.freeze({ find, findExecutionLayout, stepNumber });
})();
