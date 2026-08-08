import test from "node:test";
import assert from "node:assert/strict";
import { resolveDisplayCoordinates } from "../../../dev/assets/js/warzone-location-resolver.js";

test("frontend replaces legacy publisher coordinates with incident capital from report text", () => {
  const placement = resolveDisplayCoordinates({
    category: "strike",
    title: "Drone attack near Riyadh, Saudi Arabia",
    source_country: "South Korea",
    country: "South Korea",
    lat: 37.5667,
    lon: 126.9783
  });

  assert.equal(placement.reason, "incident_capital");
  assert.equal(placement.precision, "LOCAL");
  assert.ok(placement.lat > 24 && placement.lat < 25);
  assert.ok(placement.lon > 46 && placement.lon < 47);
});

test("frontend suppresses regional coordinates instead of showing an exact marker", () => {
  const placement = resolveDisplayCoordinates({
    category: "strike",
    title: "Strikes reported in southern Lebanon",
    lat: 33.25,
    lon: 35.45,
    metadata: {
      normalization: {
        location_precision: "REGIONAL",
        location_method: "text_region",
        event_country: "Lebanon",
        event_region: "Southern Lebanon"
      }
    }
  });

  assert.equal(placement.lat, null);
  assert.equal(placement.lon, null);
  assert.equal(placement.reason, "regional_not_marker_eligible");
});

test("frontend rejects coordinates explicitly identified as publisher geography", () => {
  const placement = resolveDisplayCoordinates({
    category: "strike",
    title: "Incident reported in Iran",
    lat: 35.6762,
    lon: 139.6503,
    metadata: {
      normalization: {
        location_precision: "EXACT",
        location_method: "publisher_coordinates",
        source_country: "Japan",
        event_country: "Iran"
      }
    }
  });

  assert.equal(placement.lat, null);
  assert.equal(placement.lon, null);
  assert.equal(placement.reason, "unsafe_location_method");
});
