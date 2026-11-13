import { Marked } from "marked";
import createDOMPurify from "dompurify";
import styles from "./markdown.css";
import { decorateCode } from "./copy.js";
import { createCaseCopier } from "./case-copy.js";
import { fragmentText } from "./plain-text.js";
import { OPTION_DEFAULTS } from "../extension/settings.js";

const escapeHTML = text => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const parser = new Marked({ gfm: true, breaks: true, renderer: {
  // Test cases often contain literal HTML payloads. Never interpret them as markup.
  html: ({ text }) => escapeHTML(text),
  checkbox: ({ checked }) => `<span class="task-box" aria-hidden="true">${checked ? "☑" : "☐"}</span> `
} });
const purifier = createDOMPurify(window);
const forbiddenTags = ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select", "button", "svg", "math", "video", "audio", "link", "meta"];

function textFrom(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    let text = node.nodeValue.replace(/\u00a0/g, " ");
    if (node.previousSibling?.nodeName === "BR") text = text.replace(/^\r?\n/, "");
    return text;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.localName;
  if (["script", "style", "button", "textarea", "select", "input"].includes(tag)) return "";
  if (tag === "br") return "\n";
  const text = () => [...node.childNodes].map(textFrom).join("");
  if (tag === "p") return `\n\n${text()}\n\n`;
  if (["div", "section", "article"].includes(tag)) return `\n${text()}\n`;
  if (["strong", "b"].includes(tag)) return `**${text()}**`;
  if (["em", "i"].includes(tag)) return `*${text()}*`;
  if (["del", "s", "strike"].includes(tag)) return `~~${text()}~~`;
  if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${text()}\n\n`;
  if (tag === "hr") return "\n\n---\n\n";
  if (tag === "blockquote") return `\n${text().trim().split("\n").map(line => `> ${line}`).join("\n")}\n`;
  if (tag === "pre") {
    const code = node.textContent;
    const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1)));
    return `\n\n${fence}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}\n\n`;
  }
  if (tag === "code" || tag === "kbd") {
    const code = node.textContent;
    const fence = "`".repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1)));
    const pad = code.startsWith("`") || code.endsWith("`") || (code.startsWith(" ") && code.endsWith(" ") && /[^ ]/.test(code)) ? " " : "";
    return `${fence}${pad}${code}${pad}${fence}`;
  }
  if (tag === "a") {
    const href = node.getAttribute("href");
    return href ? `[${text()}](<${href.replace(/[<>\s]/g, char => encodeURIComponent(char))}>)` : text();
  }
  if (tag === "img") {
    const src = node.getAttribute("src");
    const alt = (node.getAttribute("alt") || "").replace(/[\\\[\]]/g, "\\$&");
    return src ? `![${alt}](<${src.replace(/[<>\s]/g, char => encodeURIComponent(char))}>)` : alt;
  }
  if (tag === "ul" || tag === "ol") {
    const start = Number(node.getAttribute("start")) || 1;
    return "\n" + [...node.children].filter(child => child.localName === "li").map((item, index) => {
      const prefix = tag === "ol" ? `${start + index}. ` : "- ";
      const content = [...item.childNodes].map(textFrom).join("").trim();
      return prefix + content.replace(/\n/g, "\n" + " ".repeat(prefix.length));
    }).join("\n") + "\n";
  }
  if (tag === "table") {
    const rows = [...node.rows].map(row => [...row.cells].map(cell => [...cell.childNodes].map(textFrom).join("").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
    if (!rows.length) return "";
    const line = row => `| ${row.join(" | ")} |`;
    return `\n\n${line(rows[0])}\n${line(rows[0].map(() => "---"))}\n${rows.slice(1).map(line).join("\n")}\n\n`;
  }
  return text();
}

function sourceText(nodes) {
  return nodes.map(textFrom).join("").replace(/\r\n?/g, "\n").replace(/^[\u200b-\u200f\ufeff]+/, "").replace(/^\n+|\n+$/g, "");
}

function fragment(source) {
  const clean = purifier.sanitize(parser.parse(source), {
    USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: forbiddenTags, FORBID_ATTR: ["style", "id", "name", "srcset"],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
  });
  for (const link of clean.querySelectorAll("a[href]")) {
    try {
      const url = new URL(link.getAttribute("href"), document.baseURI);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) { link.removeAttribute("href"); continue; }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    } catch { link.removeAttribute("href"); }
  }
  for (const image of clean.querySelectorAll("img")) {
    try {
      const url = new URL(image.getAttribute("src"), document.baseURI);
      if (!["http:", "https:"].includes(url.protocol) && !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(image.getAttribute("src") || "")) { image.remove(); continue; }
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
    } catch { image.remove(); }
  }
  return clean;
}

const plainText = source => fragmentText(fragment(source));
const syncCaseCopy = createCaseCopier({ sourceText, plainText, styles });
globalThis.ZenMarkMarkdown = Object.freeze({ sourceText, fragment, styles, decorateCode, syncCaseCopy, optionDefaults: OPTION_DEFAULTS });
