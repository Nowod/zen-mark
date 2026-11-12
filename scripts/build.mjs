import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
await build({
  absWorkingDir: fileURLToPath(root), entryPoints: ["src/markdown.js"], outfile: "extension/vendor.js",
  bundle: true, format: "iife", minify: true, target: "chrome120", charset: "utf8",
  loader: { ".css": "text" }, legalComments: "linked"
});
await mkdir(new URL("extension/licenses/", root), { recursive: true });
await copyFile(new URL("node_modules/marked/LICENSE", root), new URL("extension/licenses/marked.txt", root));
await copyFile(new URL("node_modules/dompurify/LICENSE", root), new URL("extension/licenses/dompurify.txt", root));
console.log("Built local Markdown parser and sanitizer.");
