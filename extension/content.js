(() => {
  "use strict";
  if (globalThis.__zenMark) { globalThis.__zenMark.refresh(); return; }
  const Targets = globalThis.ZenMarkTargets;
  const Markdown = globalThis.ZenMarkMarkdown;
  const styles = new CSSStyleSheet();
  styles.replaceSync(Markdown.styles);
  const managed = new Map();
  let enabled = false;
  let options = Markdown.optionDefaults;
  let scheduled = false;
  let readId = 0;
  const observer = new MutationObserver(mutations => {
    if (mutations.every(mutation => mutation.target.nodeType === Node.ELEMENT_NODE
      && mutation.target.closest('textarea, input, select, .picker, .file-selector, #resultsContainer, [data-zen-mark-view]'))) return;
    schedule();
  });
  const observe = () => observer.observe(document, { childList: true, subtree: true, characterData: true });

  function restore(element, state) {
    state.dispose?.();
    if (state.source.parentNode === element) state.source.replaceWith(...state.source.childNodes);
    state.host.remove();
    managed.delete(element);
  }

  function render(element, kind) {
    let state = managed.get(element);
    if (state && (state.source.parentNode !== element || state.host.parentNode !== element)) {
      state.dispose?.();
      // A page morph replaced the field. Its current nodes are the new source.
      if (state.source.parentNode === element) state.source.replaceWith(...state.source.childNodes);
      state.host.remove();
      managed.delete(element);
      state = null;
    }
    if (state) {
      state.host.toggleAttribute("data-zen-mark-double-spacing", options.doubleSpacing);
      for (const node of [...element.childNodes]) {
        if (node !== state.source && node !== state.host && !Targets.stepNumber(node, element)) state.source.append(node);
      }
    }
    const nodes = state ? [...state.source.childNodes] : [...element.childNodes].filter(node => !Targets.stepNumber(node, element));
    const source = Markdown.sourceText(nodes);
    if (!source.trim() || source.length > 200000) { if (state) restore(element, state); return; }
    if (state?.text === source) return;
    // Build before hiding the original: parsing failures always preserve readable text.
    const content = Markdown.fragment(source);
    if (!content.hasChildNodes()) { if (state) restore(element, state); return; }
    if (!state) {
      const original = document.createElement("span");
      original.setAttribute("data-zen-mark-source", "");
      original.hidden = true;
      // ZenTao reserves direct span children of .step-id for muted step numbers.
      const host = document.createElement("div");
      host.setAttribute("data-zen-mark-view", kind);
      host.toggleAttribute("data-zen-mark-double-spacing", options.doubleSpacing);
      const shadow = host.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [styles];
      const body = document.createElement("div");
      body.className = "markdown";
      shadow.append(body);
      for (const node of nodes) original.append(node);
      element.append(original, host);
      state = { source: original, host, body, text: "", kind };
      managed.set(element, state);
    }
    state.dispose?.();
    state.body.replaceChildren(content);
    state.dispose = Markdown.decorateCode(state.body);
    state.text = source;
  }

  function flush() {
    scheduled = false;
    observer.disconnect();
    try {
      const targets = enabled ? Targets.find(document, options) : new Map();
      for (const [element, state] of managed) {
        if (!element.isConnected || !targets.has(element)) restore(element, state);
      }
      for (const [element, kind] of targets) {
        try { render(element, kind); }
        catch { const state = managed.get(element); if (state) restore(element, state); }
      }
      Markdown.syncCaseCopy(enabled && options.copyCase);
    } finally { if (enabled) observe(); }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (document.visibilityState === "hidden") setTimeout(flush, 0);
    else requestAnimationFrame(flush);
  }

  async function refresh() {
    const id = ++readId;
    try {
      const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      if (id !== readId || !state?.ok) return;
      enabled = state.enabled === true;
      options = state.fields;
      flush();
    } catch { /* Preserve the current view while the extension worker restarts. */ }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === "ZEN_MARK_REFRESH") refresh();
  });
  for (const event of ["pageshow", "popstate", "hashchange"]) window.addEventListener(event, refresh);
  window.navigation?.addEventListener("currententrychange", schedule);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  globalThis.__zenMark = Object.freeze({ refresh });
  refresh();
})();
