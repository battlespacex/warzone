import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isExcludedTrainerAircraftText, TRAINER_PLATFORM_PATTERNS } from "../../shared/aircraft-trainer-exclusions.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const consumers = [
  "dev/assets/js/warzone-air-ingestion.js",
  "dev/assets/js/warzone-live-airforce.js",
  "dev/assets/js/essential.js",
  "apps/worker/src/index.js",
  "apps/worker/src/adsb-worker.js",
];

test("all five active filtering stages use the shared trainer exclusion module", () => {
  for (const file of consumers) {
    const source = readFileSync(resolve(root, file), "utf8");
    assert.match(source, /import\s*\{\s*isExcludedTrainerAircraftText\s*\}\s*from\s*["'][^"']*aircraft-trainer-exclusions\.js["']/);
    assert.doesNotMatch(source, /const\s+\w*TRAINER_PLATFORM_PATTERNS\s*=/);
    assert.doesNotMatch(source, /function\s+isExcludedTrainerAircraftText\s*\(/);
  }
});

test("requested variants are excluded without overblocking related models", () => {
  for (const identity of [
    "BEECH T-44A PEGASUS MNTNA44", "BEECH T44A PEGASUS",
    "BEECH C-12V HURON PAT322", "C12V HURON",
    "NORTHROP F-5N TIGER II", "F5N TIGER II",
    "CESSNA T-41 MESCALERO", "T41 MESCALERO",
    "DG-1000S TG-16A", "DG1000S TG16A",
    "CIRRUS T-53A", "CIRRUS SR-20", "KAYDET II",
  ]) {
    assert.equal(TRAINER_PLATFORM_PATTERNS.some(pattern => pattern.test(identity)), true, identity);
    assert.equal(isExcludedTrainerAircraftText(identity), true, identity);
  }
  for (const identity of [
    "KC-46 PEGASUS", "C-12 HURON", "F-5E TIGER II",
    "MQ-9 REAPER", "F/A-18E SUPER HORNET",
  ]) {
    assert.equal(TRAINER_PLATFORM_PATTERNS.some(pattern => pattern.test(identity)), false, identity);
    assert.equal(isExcludedTrainerAircraftText(identity), false, identity);
  }
});

test("operational exceptions are retained unless training activity is explicit", () => {
  for (const identity of ["A-29 SUPER TUCANO", "FA-50", "M-346FA", "BLACK HAWK"]) {
    assert.equal(isExcludedTrainerAircraftText(identity), false, identity);
  }
  assert.equal(isExcludedTrainerAircraftText("FA-50 training flight"), true);
  assert.equal(isExcludedTrainerAircraftText("military training aircraft"), true);
  assert.equal(isExcludedTrainerAircraftText(""), false);
});
