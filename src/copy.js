import fallbackCopy from "./icons/copy.json";

const windowsCopy = /win/i.test(navigator.userAgentData?.platform || navigator.platform);

function fallbackIcon(definition = fallbackCopy) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", definition.tag);
  for (const [key, value] of Object.entries(definition.attributes)) node.setAttribute(key, value);
  for (const child of definition.children) node.append(fallbackIcon(child));
  return node;
}

function floatInline(wrapper, code, button, copy) {
  let timer;
  button.setAttribute("popover", "manual");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("aria-label", "代码，按 Enter 复制");
  function close() {
    clearTimeout(timer);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
    if (button.matches(":popover-open")) button.hidePopover();
  }
  function show() {
    clearTimeout(timer);
    if (!button.isConnected) return;
    const rectangles = code.getClientRects();
    const anchor = rectangles[rectangles.length - 1];
    if (!anchor) return;
    const limit = Math.min(wrapper.closest(".markdown").getBoundingClientRect().right, innerWidth - 4);
    let x = anchor.right + 2;
    let y = anchor.top + (anchor.height - 20) / 2;
    if (x + 20 > limit) {
      x = Math.min(anchor.right - 20, limit - 20);
      y = anchor.top >= 26 ? anchor.top - 22 : anchor.bottom + 2;
    }
    button.style.left = `${Math.max(4, Math.min(x, innerWidth - 24))}px`;
    button.style.top = `${Math.max(4, Math.min(y, innerHeight - 24))}px`;
    if (!button.matches(":popover-open")) button.showPopover();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
  }
  function leave() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!wrapper.matches(":hover, :focus-within")) close();
    }, 140);
  }
  wrapper.addEventListener("mouseenter", show);
  wrapper.addEventListener("mouseleave", leave);
  wrapper.addEventListener("focusin", show);
  wrapper.addEventListener("focusout", leave);
  button.addEventListener("mouseenter", show);
  button.addEventListener("mouseleave", leave);
  wrapper.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "Enter" && event.target === wrapper) copy(event);
  });
  return close;
}

function copyWithCommand(text) {
  let handled = false;
  const copy = event => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData("text/plain", text);
    handled = true;
  };
  // The synchronous click fallback also works on HTTP pages. No temporary input,
  // selection changes, or clipboard-reading permission is needed.
  window.addEventListener("copy", copy, true);
  try { return document.execCommand("copy") && handled; }
  finally { window.removeEventListener("copy", copy, true); }
}

async function writeText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* A page policy may block the async API; try the user-gesture copy. */ }
  }
  if (!copyWithCommand(text)) throw new Error("COPY_FAILED");
}

export function createCopyButton(readText, idleLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  const icon = document.createElement("span");
  icon.className = "copy-icon";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "copy-status";
  label.setAttribute("role", "status");
  label.setAttribute("aria-live", "polite");
  button.append(icon, label);
  let busy = false;
  let disposed = false;
  let timer;
  function status(state) {
    button.dataset.state = state;
    const message = state === "success" ? "已复制" : state === "error" ? "复制失败" : "复制";
    label.textContent = message;
    icon.classList.toggle("copy-icon-windows", state === "idle" && windowsCopy);
    icon.replaceChildren();
    if (state !== "idle") icon.textContent = state === "success" ? "✓" : "!";
    else if (!windowsCopy) icon.append(fallbackIcon());
    button.setAttribute("aria-label", state === "idle" ? idleLabel : message);
  }
  button.addEventListener("mousedown", event => event.preventDefault());
  const copy = async event => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || disposed || !event.isTrusted) return;
    busy = true;
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-busy", "true");
    clearTimeout(timer);
    try {
      await writeText(readText());
      if (!disposed) status("success");
    } catch { if (!disposed) status("error"); }
    finally {
      busy = false;
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-busy");
      if (!disposed) timer = setTimeout(() => status("idle"), 1400);
    }
  };
  button.addEventListener("click", copy);
  status("idle");
  return { button, copy, dispose() { disposed = true; clearTimeout(timer); } };
}

export function decorateCode(container) {
  const cleanup = [];
  for (const code of container.querySelectorAll("code")) {
    if (code.closest(".code-inline, .code-block")) continue;
    const block = code.parentElement?.localName === "pre";
    const content = block ? code.parentElement : code;
    const wrapper = document.createElement(block ? "div" : "span");
    wrapper.className = block ? "code-block" : "code-inline";
    // Read the code element itself: labels and Markdown delimiters are excluded.
    const control = createCopyButton(() => code.textContent, block ? "复制代码块" : "复制代码");
    const close = block ? () => {} : floatInline(wrapper, code, control.button, control.copy);
    content.replaceWith(wrapper);
    wrapper.append(content, control.button);
    cleanup.push(() => { control.dispose(); close(); });
  }
  return () => cleanup.forEach(dispose => dispose());
}
