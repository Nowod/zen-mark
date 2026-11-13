import { createCopyButton } from "./copy.js";

function detailMetadata(view) {
  const header = view.querySelector(":scope > .detail-header");
  const title = header?.querySelector(":scope > .entity-title > .entity-title-text, :scope > .entity-title > .entity-title-link")?.textContent.trim();
  const id = view.dataset.id;
  return header && title && /^[1-9]\d*$/.test(id || "") ? { header, title, id } : null;
}

function executionMetadata(view) {
  const header = view.querySelector(":scope > .modal-header");
  const body = view.querySelector(":scope > .modal-body");
  const form = body?.querySelector("#caseStepForm");
  if (!form || form.closest(".modal-content") !== view) return null;
  const entity = header?.querySelector(".entity-label");
  const title = entity?.querySelector(":scope > .entity-title")?.textContent.trim();
  // The run ID in the form action is different from the actual case ID.
  const id = form.querySelector('input[name="case"]')?.value
    || entity?.querySelector(":scope > .label-id")?.textContent.trim().replace(/^#\s*/, "");
  return header && title && /^[1-9]\d*$/.test(id || "") ? { header, title, id, body, form } : null;
}

function metadata(view) {
  return view.matches(".modal-content") ? executionMetadata(view) : detailMetadata(view);
}

function detailFields(view) {
  const targets = globalThis.ZenMarkTargets.find(view, { precondition: true, steps: false, bugSteps: false });
  const preconditions = [...targets].filter(([element, kind]) => kind === "precondition" && element.closest(".detail-view, .modal-content") === view)
    .map(([element]) => element);
  const steps = [...view.querySelectorAll("#stepsTable .steps-body > .step")]
    .filter(row => row.closest(".detail-view, .modal-content") === view)
    .map((row, index) => {
      const [step, expect] = row.children;
      const number = step?.querySelector(":scope > span.nowrap")?.textContent.trim() || String(index + 1);
      return { number, step, expect };
    });
  return { preconditions, steps };
}

function executionFields({ body, form }) {
  const precondition = body.querySelector(":scope > table .case-precondition")?.nextElementSibling;
  const steps = [...form.querySelectorAll(":scope > table > tbody > tr.step")].map((row, index) => {
    const [cell, expect] = row.cells;
    const step = cell?.querySelector(".inputGroup > .wrap, .input-group > .wrap, .step-desc, .step-description") || cell;
    const number = cell?.querySelector(".step-item-id")?.textContent.trim() || String(index + 1);
    return { number, step, expect };
  });
  return { preconditions: precondition ? [precondition] : [], steps };
}

function formatCaseText({ title, id, precondition, steps }) {
  const parts = [`用例标题：${title}`, `用例编号：${id}`, `前置条件：\n${precondition || "（无）"}`];
  if (!steps.length) parts.push("用例步骤：\n（无）");
  for (const { number, step, expect } of steps) {
    parts.push(`步骤 ${number}：\n${step || "（无）"}\n\n预期 ${number}：\n${expect || "（无）"}`);
  }
  return parts.join("\n\n");
}

function findCopyTargets() {
  const targets = new Map();
  for (const view of document.querySelectorAll('.detail-view[data-type="testcase"]')) {
    const info = detailMetadata(view);
    if (info && view.querySelector("#stepsTable")) targets.set(view, info.header.querySelector(":scope > .entity-title") || info.header);
  }
  for (const form of document.querySelectorAll("#caseStepForm")) {
    const view = form.closest(".modal-content");
    const info = view && executionMetadata(view);
    if (info?.form === form) targets.set(view, info.header.querySelector(":scope > .flex") || info.header);
  }
  return targets;
}

export function createCaseCopier({ sourceText, plainText, styles }) {
  const managed = new Map();
  let sheet;
  function fieldText(element) {
    if (!element) return "";
    const source = element.querySelector(":scope > [data-zen-mark-source]") || element;
    const nodes = [...source.childNodes].filter(node => !globalThis.ZenMarkTargets.stepNumber(node, element));
    return plainText(sourceText(nodes));
  }
  function readCase(view) {
    const info = metadata(view);
    if (!info) throw new Error("CASE_NOT_FOUND");
    const fields = info.form ? executionFields(info) : detailFields(view);
    return formatCaseText({
      title: info.title,
      id: info.id,
      precondition: fields.preconditions.map(fieldText).filter(Boolean).join("\n"),
      steps: fields.steps.map(({ number, step, expect }) => ({ number, step: fieldText(step), expect: fieldText(expect) }))
    });
  }
  function remove(view, state) {
    state.control.dispose();
    state.host.remove();
    managed.delete(view);
  }
  return enabled => {
    const targets = enabled ? findCopyTargets() : new Map();
    for (const [view, state] of managed) {
      if (!view.isConnected || targets.get(view) !== state.host.parentNode) remove(view, state);
    }
    for (const [view, anchor] of targets) {
      if (managed.has(view)) continue;
      if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(styles); }
      const control = createCopyButton(() => readCase(view), "复制用例");
      control.button.classList.add("case-copy");
      control.button.title = "复制用例";
      const host = document.createElement("span");
      host.setAttribute("data-zen-mark-copy-case", "");
      const shadow = host.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [sheet];
      shadow.append(control.button);
      anchor.append(host);
      managed.set(view, { host, control });
    }
  };
}
