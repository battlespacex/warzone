// Run directly with Node. Measures only duplicate candidate selection, not Cesium FPS.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import vm from "node:vm";
import { createAircraftIdentityIndex } from "../../../dev/assets/js/warzone-aircraft-identity-index.js";

const current = readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const baseline = execFileSync("git", ["show", "HEAD:dev/assets/js/warzone-live-airforce.js"], {
  cwd: new URL("../../..", import.meta.url), encoding: "utf8",
});
function lookupFunction(source) {
  const start = source.indexOf("function findDuplicateLiveTrackKey(");
  return source.slice(start, source.indexOf("\n}", start) + 2);
}

for (const count of [1000, 5000, 10000]) {
  const registry = new Map();
  const index = createAircraftIdentityIndex();
  for (let index = 0; index < count; index += 1) {
    const key = `air-${index}`;
    const icao24 = index.toString(16).padStart(6, "0");
    registry.set(key, { track_key: key, active: true, icao24 });
  }
  for (const entry of registry.values()) {
    index.set(entry.track_key, [`icao:${entry.icao24}`]);
  }
  for (const [mode, source] of [["baseline", baseline], ["indexed", current]]) {
    let comparisons = 0;
    const context = vm.createContext({
      __liveTrackRegistry: registry,
      __liveTrackIdentityIndex: index,
      getTrackDuplicateIdentityTokens: (track) => [`icao:${track.icao24}`],
      areAircraftTracksLikelyDuplicates: (a, b) => { comparisons += 1; return a.track_key !== b.track_key && a.icao24 === b.icao24; },
    });
    vm.runInContext(lookupFunction(source), context);
    const startedAt = performance.now();
    for (let entry = 0; entry < count; entry += 1) {
      context.findDuplicateLiveTrackKey({ track_key: `air-${entry}`, icao24: entry.toString(16).padStart(6, "0") });
    }
    console.log(JSON.stringify({ count, mode, lookupMs: +(performance.now() - startedAt).toFixed(1), comparisons }));
  }
}
