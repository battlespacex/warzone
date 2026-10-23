import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const readSource = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

test("mobile entry warning is controlled by the centralized system flag", async () => {
  const config = await readSource("dev/assets/js/stratops-feature-config.js");
  const essential = await readSource("dev/assets/js/essential.js");

  assert.match(config, /system:\s*\{[\s\S]*?mobileWarning:\s*false/);
  assert.match(
    essential,
    /if \(isStratOpsFeatureEnabled\("system\.mobileWarning", false\) && isMobileStratopsViewport\(\)\) \{[\s\S]*?openMobileWarningModal\(\);[\s\S]*?return;[\s\S]*?openIntroModal\(\);/
  );
});
