import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(m?js|json|html|css|svg)$/.test(entry.name)) {
      const source = await readFile(file, "utf8");
      assert.ok(!/[\t ]+$/m.test(source), `Trailing whitespace: ${file}`);
      if (/\.m?js$/.test(file)) {
        const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      if (file.endsWith(".json")) JSON.parse(source);
      count++;
    }
  }
}
for (const folder of ["extension", "src", "scripts", "tests"]) await check(join(root, folder));
const manifest = JSON.parse(await readFile(join(root, "extension/manifest.json"), "utf8"));
const assets = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon), "vendor.js", "targets.js", "content.js", "content.css"];
for (const asset of assets) assert.ok((await stat(join(root, "extension", asset))).isFile(), asset);
assert.deepEqual(manifest.permissions, ["storage", "scripting", "activeTab"]);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
console.log(`PASS: ${count} source files checked; manifest assets exist.`);
