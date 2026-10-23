import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const readSource = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

test("focused aircraft model sizes have standard and ultrawide CSS tiers", async () => {
  const css = await readSource("dev/assets/css/root.css");
  const aircraft = await readSource("dev/assets/js/warzone-live-airforce.js");
  const categories = ["fighter", "transport", "bomber", "tanker", "recon", "awacs", "helicopter", "vip", "drone"];
  const ultrawideBlock = css.match(/@media \(min-width: 2560px\) \{\s*:root \{([\s\S]*?)\n\s*\}\s*\}/)?.[1] || "";

  assert.ok(ultrawideBlock, "the 2560px ultrawide override must exist");
  for (const category of categories) {
    const variable = `--warzone-live-aircraft-model-focused-size-${category}`;
    assert.match(css, new RegExp(`${variable}:\\s*3;`));
    assert.match(ultrawideBlock, new RegExp(`${variable}:\\s*3;`));
  }
  assert.match(aircraft, /getAircraftFocusedCssNumber\("--warzone-live-aircraft-model-focused-size"/);
});
