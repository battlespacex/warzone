import test from "node:test";
import assert from "node:assert/strict";
import { buildIodaQuery, parseIodaCountryOutages, normalizeIodaCountryOutage, unwrapIodaEvents } from "../src/ioda-outage-adapter.js";

test("query uses a bounded six-hour UTC window and country scope", () => {
  assert.deepEqual(buildIodaQuery(1_800_000_000_000), {
    from: 1799978400, until: 1800000000, entityType: "country", format: "codf", limit: 100, page: 0
  });
});
test("CODF country events produce valid UTC time and stable dedupe keys", () => {
  const [row] = parseIodaCountryOutages({ data: [{
    location: "country/US", location_name: "United States", datasource: "bgp", start: 1799996400, score: 12
  }] });
  assert.equal(row.countryCode, "US");
  assert.equal(row.countryName, "United States");
  assert.equal(row.startedAt, new Date(1799996400 * 1000).toISOString());
  assert.equal(row.dedupeKey, `IODA|country/US|bgp|${row.startedAt}`);
});
test("reject ASN, missing location name and invalid timestamp instead of inventing map positions", () => {
  assert.equal(normalizeIodaCountryOutage({ location: "asn/123", start: 1799996400 }), null);
  assert.equal(normalizeIodaCountryOutage({ location: "country/US", start: 1799996400 }), null);
  assert.equal(normalizeIodaCountryOutage({ location: "country/US", location_name: "United States", start: "bad" }), null);
});
test("dedupes repeated records within the same provider response", () => {
  const e = { location: "country/US", location_name: "United States", start: 1799996400, datasource: "bgp" };
  assert.equal(parseIodaCountryOutages({ data: [e, e, { ...e, datasource: "ping-slash24" }] }, 2).length, 2);
});
test("malformed API payloads fail visibly", () => {
  assert.throws(() => unwrapIodaEvents({ message: "failure" }), /Unexpected/);
  assert.throws(() => unwrapIodaEvents({ error: "denied" }), /denied/);
});
