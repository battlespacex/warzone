import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sources = [
  ["dev/assets/js/warzone-live-airforce.js", "LIVE_TRACK_TRAINER_PLATFORM_PATTERNS"],
  ["apps/worker/src/adsb-worker.js", "TRAINER_PLATFORM_PATTERNS"],
  ["apps/worker/src/index.js", "TRAINER_AIRCRAFT_PLATFORM_PATTERNS"],
];

for (const [file, name] of sources) {
  test(`${file} excludes requested trainer variants without broad platform matches`, () => {
    const source = readFileSync(resolve(root, file), "utf8");
    const declaration = source.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
    assert.ok(declaration, `${name} must exist`);
    const patterns = vm.runInNewContext(declaration[1]);
    const matches = (identity) => patterns.some((pattern) => pattern.test(identity));
    for (const identity of [
      "BEECH T-44A PEGASUS MNTNA44", "BEECH T44A PEGASUS", "BEECH C-12V HURON PAT322",
      "C12V HURON", "NORTHROP F-5N TIGER II", "F5N TIGER II",
      "CESSNA T-41 MESCALERO", "T41 MESCALERO", "DG-1000S TG-16A", "DG1000S TG16A",
    ]) assert.equal(matches(identity), true, identity);
    for (const identity of ["KC-46 PEGASUS", "C-12 HURON", "F-5E TIGER II", "MQ-9 REAPER", "F/A-18E SUPER HORNET"]) {
      assert.equal(matches(identity), false, identity);
    }
  });
}
