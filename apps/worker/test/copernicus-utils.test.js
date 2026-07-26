import test from "node:test";
import assert from "node:assert/strict";
import {
  readCopernicusConfig,
  getCopernicusConfigStatus,
} from "../src/copernicus-config.js";
import {
  buildEventBbox,
  getEventTimeRelation,
  isEventEligibleForCopernicus,
  isValidCoordinate,
  makeSatelliteCacheKey,
  rankCatalogFeatures,
} from "../src/copernicus-utils.js";
import { canStartSatelliteJob } from "../src/copernicus-usage.js";

const enabledConfig = {
  enabled: true,
  searchRadiusKm: 7.5,
  dailyEventLimit: 75,
};

test("normalizes Copernicus service base URLs from env", () => {
  const config = readCopernicusConfig({
    COPERNICUS_CATALOG_URL: "https://sh.dataspace.copernicus.eu",
    COPERNICUS_PROCESS_URL: "https://sh.dataspace.copernicus.eu",
  });
  assert.equal(config.catalogUrl, "https://sh.dataspace.copernicus.eu/catalog/v1");
  assert.equal(config.processUrl, "https://sh.dataspace.copernicus.eu/api/v1/process");
});

test("accepts IAM role mode without static AWS keys", () => {
  const config = readCopernicusConfig({
    COPERNICUS_ENABLED: "true",
    COPERNICUS_CLIENT_ID: "client",
    COPERNICUS_CLIENT_SECRET: "secret",
    AWS_S3_BUCKET: "warzone.battlespacex.com",
    COPERNICUS_AWS_USE_IAM_ROLE: "true",
  });
  const status = getCopernicusConfigStatus(config);
  assert.equal(status.ready, true);
  assert.deepEqual(status.missing, []);
});

test("validates coordinates", () => {
  assert.equal(isValidCoordinate(31.5, 34.4), true);
  assert.equal(isValidCoordinate(95, 34.4), false);
  assert.equal(isValidCoordinate(31.5, 190), false);
  assert.equal(isValidCoordinate(0, 0), false);
});

test("accepts only high-value recent satellite-relevant events", () => {
  const event = {
    id: "evt-1",
    category: "strike",
    severity: "high",
    title: "Explosion reported at industrial depot",
    summary: "Large blast and fire reported",
    occurred_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    lat: 31.5,
    lon: 34.4,
  };
  assert.equal(isEventEligibleForCopernicus(event, enabledConfig).eligible, true);
  assert.equal(isEventEligibleForCopernicus({ ...event, severity: "medium" }, enabledConfig).reason, "severity_not_high");
  assert.equal(isEventEligibleForCopernicus({ ...event, lat: null }, enabledConfig).reason, "invalid_coordinates");
  assert.equal(
    isEventEligibleForCopernicus({
      ...event,
      occurred_at: new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(),
    }, enabledConfig).reason,
    "older_than_72h"
  );
  assert.equal(
    isEventEligibleForCopernicus({
      ...event,
      category: "military",
      title: "Routine patrol aircraft sighting",
      summary: "Routine flight observed",
    }, enabledConfig).reason,
    "category_not_supported"
  );
});

test("builds a small stable bounding box around the event", () => {
  const bbox = buildEventBbox(31.5, 34.4, 7.5);
  assert.equal(bbox.length, 4);
  assert.ok(bbox[0] < 34.4);
  assert.ok(bbox[2] > 34.4);
  assert.ok(bbox[1] < 31.5);
  assert.ok(bbox[3] > 31.5);
});

test("ranks catalog features by post-event preference, cloud cover, and time distance", () => {
  const eventTime = "2026-07-26T12:00:00.000Z";
  const ranked = rankCatalogFeatures([
    { acquisitionTime: "2026-07-26T11:00:00.000Z", cloudCover: 2, sourceItemId: "before-low-cloud" },
    { acquisitionTime: "2026-07-26T13:00:00.000Z", cloudCover: 20, sourceItemId: "after-cloudy" },
    { acquisitionTime: "2026-07-26T14:00:00.000Z", cloudCover: 5, sourceItemId: "after-clear" },
  ], eventTime);
  assert.equal(ranked[0].sourceItemId, "after-clear");
});

test("labels acquisition relation to event time", () => {
  assert.equal(getEventTimeRelation("2026-07-26T12:01:00Z", "2026-07-26T12:00:00Z"), "after");
  assert.equal(getEventTimeRelation("2026-07-26T11:59:00Z", "2026-07-26T12:00:00Z"), "before");
});

test("cache key is stable and changes by visualization dimensions", () => {
  const base = {
    collection: "sentinel-2-l2a",
    sourceItemId: "S2A_1",
    acquisitionTime: "2026-07-26T12:00:00Z",
    bbox: [34.1, 31.2, 34.7, 31.8],
    width: 512,
    height: 512,
  };
  assert.equal(makeSatelliteCacheKey(base), makeSatelliteCacheKey({ ...base }));
  assert.notEqual(makeSatelliteCacheKey(base), makeSatelliteCacheKey({ ...base, width: 256 }));
});

test("quota guard blocks daily limit and persisted rate limit", () => {
  assert.equal(canStartSatelliteJob({ successful_images_generated: 75 }, { dailyEventLimit: 75 }).reason, "daily_limit");
  assert.equal(
    canStartSatelliteJob(
      { successful_images_generated: 1, rate_limited_until: new Date(Date.now() + 60_000).toISOString() },
      { dailyEventLimit: 75 }
    ).reason,
    "rate_limited"
  );
});
