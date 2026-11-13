export function fragmentText(root) {
  const children = node => [...node.childNodes].map(read).join("");
  function read(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node.nodeType !== Node.ELEMENT_NODE) return children(node);
    const tag = node.localName;
    if (tag === "br") return "\n";
    if (tag === "img") return node.getAttribute("alt") || "";
    if (tag === "pre") return `\n${node.textContent}\n`;
    if (tag === "ul" || tag === "ol") {
      const start = Number(node.getAttribute("start")) || 1;
      const items = [...node.children].filter(child => child.localName === "li");
      return "\n" + items.map((item, index) => {
        const prefix = tag === "ol" ? `${start + index}. ` : "- ";
        return prefix + children(item).trim().replace(/\n/g, "\n" + " ".repeat(prefix.length));
      }).join("\n") + "\n";
    }
    if (tag === "table") return "\n" + [...node.rows].map(row => [...row.cells].map(cell => children(cell).trim()).join("\t")).join("\n") + "\n";
    if (/^(p|h[1-6]|blockquote|div)$/.test(tag)) return `\n${children(node)}\n`;
    if (tag === "hr") return "\n\n";
    return children(node);
  }
  return read(root).replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}
