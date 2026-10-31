import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../../../dev/assets/js/essential.js", import.meta.url)), "utf8");
const hints = source.match(/const REGION_COUNTRY_HINTS = \{[\s\S]*?\n\};/)?.[0];
const priority = source.match(/function statusPriority\(status\) \{[\s\S]*?\n\}/)?.[0];
const rank = source.match(/function rankCountryRows\(events, type, max = 10\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(hints && priority && rank);

const context = vm.createContext({
  getActiveRegion: () => ({ id: "middle_east" }),
  getStatusScopedEvents: (events) => events,
  deriveFocusCountries: () => [],
  getEventResolvedCountry: (event) => event.country,
  normalizeCountryName: (country) => String(country || "").trim(),
  deriveCountryStatus: (events, country) => events.find((event) => event.country === country)?.status || "unknown",
  getCountryMatchCount: (events, country) => events.filter((event) => event.country === country).length,
});
vm.runInContext(`${hints}\n${priority}\n${rank}`, context);

test("all selectable regions retain country rows with unknown status when signals are absent", () => {
  const regionIds = ["middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"];
  for (const id of regionIds) {
    context.getActiveRegion = () => ({ id });
    for (const domain of ["cyber", "airspace"]) {
      const rows = vm.runInContext(`rankCountryRows([], "${domain}")`, context);
      assert.ok(rows.length > 0, `${id} ${domain}`);
      assert.ok(rows.every((row) => row.status === "unknown"), `${id} must not imply normal status`);
    }
  }
});

test("a reported country keeps its status while other countries remain unknown", () => {
  context.getActiveRegion = () => ({ id: "middle_east" });
  const rows = vm.runInContext('rankCountryRows([{ country: "Saudi Arabia", status: "restricted" }], "airspace")', context);
  assert.equal(rows.find((row) => row.label === "Saudi Arabia").status, "restricted");
  assert.equal(rows.find((row) => row.label === "Qatar").status, "unknown");
});
