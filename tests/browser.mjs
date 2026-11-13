import assert from "node:assert/strict";
import { launch, close, passed, errors } from "./browser/harness.mjs";
import { runSettingsTests, runPersistenceTests } from "./browser/settings.mjs";
import { runRenderingTests } from "./browser/rendering.mjs";
import { runCopyTests } from "./browser/copy.mjs";

try {
  await launch();
  await runSettingsTests();
  await runRenderingTests();
  await runCopyTests();
  await runPersistenceTests();
  assert.deepEqual(errors, [], "No unhandled errors on test pages");
  assert.ok(passed > 0, "At least one browser scenario matched the selected filter");
  console.log(`\n${passed} browser scenarios passed with the actual unpacked extension.`);
} finally {
  await close();
}
