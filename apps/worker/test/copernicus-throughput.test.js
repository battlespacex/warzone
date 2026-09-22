import test from "node:test";
import assert from "node:assert/strict";
import { clearCopernicusToken } from "../src/copernicus-auth.js";
import { readCopernicusConfig } from "../src/copernicus-config.js";
import { buildObservationCacheKey } from "../src/copernicus-service.js";
import { findBestObservation } from "../src/copernicus-service.js";
import { runCopernicusSatelliteSync } from "../src/copernicus-runner.js";
import { buildEventBbox } from "../src/copernicus-utils.js";

function inMemorySupabase(tables) {
  let nextId = 1;
  return {
    from(table) {
      const query = {
        filters: [],
        action: "select",
        payload: null,
        max: Infinity,
        select() { return this; },
        eq(field, value) { this.filters.push((row) => row[field] === value); return this; },
        gt(field, value) { this.filters.push((row) => row[field] > value); return this; },
        gte(field, value) { this.filters.push((row) => row[field] >= value); return this; },
        in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; },
        not(field, operator, value) { assert.equal(operator, "is"); this.filters.push((row) => row[field] !== value); return this; },
        order() { return this; },
        limit(value) { this.max = value; return this; },
        update(payload) { this.action = "update"; this.payload = payload; return this; },
        upsert(payload) { this.action = "upsert"; this.payload = payload; return this; },
        execute(single = false) {
          const rows = tables[table];
          assert.ok(rows, `Unexpected table ${table}`);
          if (this.action === "upsert") {
            const row = { id: `obs-${nextId++}`, attempt_count: 0, ...this.payload };
            rows.push(row);
            return { data: single ? row : [row], error: null };
          }
          const selected = rows.filter((row) => this.filters.every((filter) => filter(row))).slice(0, this.max);
          if (this.action === "update") selected.forEach((row) => Object.assign(row, this.payload));
          return { data: single ? selected[0] || null : selected, error: null };
        },
        maybeSingle() { return Promise.resolve(this.execute(true)); },
        then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); },
      };
      return query;
    },
  };
}

async function runAtPreviewLimit({ cached }) {
  const event = {
    id: "strike-event", category: "strike", severity: "critical",
    title: "Strike reported near airfield", summary: "Blast reported",
    occurred_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    lat: 35, lon: 36,
  };
  const acquisitionTime = new Date(Date.now() - 60 * 60_000).toISOString();
  const config = readCopernicusConfig({
    COPERNICUS_ENABLED: "true", COPERNICUS_CLIENT_ID: "client", COPERNICUS_CLIENT_SECRET: "secret",
    COPERNICUS_BATCH_SIZE: "1", COPERNICUS_DAILY_EVENT_LIMIT: "30",
    COPERNICUS_DAILY_CATALOG_REQUEST_LIMIT: "120",
  });
  const sourceItemId = "S2A_test_product";
  const cacheKey = buildObservationCacheKey(config, {
    collection: "sentinel-2-l2a", sourceItemId, acquisitionTime,
    bbox: buildEventBbox(event.lat, event.lon, config.searchRadiusKm),
  });
  const tables = {
    events: [event],
    copernicus_usage_daily: [{ utc_date: new Date().toISOString().slice(0, 10), successful_images_generated: 30, catalog_requests_attempted: 0, cache_hits: 0 }],
    event_satellite_observations: cached ? [{
      id: "cached-event", event_id: "other-event", status: "available", cache_key: "different-event-framing",
      source_item_id: sourceItemId, bbox: [1, 2, 3, 4],
      image_url: "https://catalogue.dataspace.copernicus.eu/odata/v1/Assets(00000000-0000-0000-0000-000000000001)/$value",
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    }] : [],
  };
  const previousFetch = globalThis.__copernicusFetchOverride;
  let catalogRequests = 0;
  globalThis.__copernicusFetchOverride = async (url) => {
    if (String(url).includes("/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token", expires_in: 3600 }) };
    }
    catalogRequests += 1;
    return { ok: true, status: 200, json: async () => ({ features: [{
      id: sourceItemId, collection: "sentinel-2-l2a", properties: { datetime: acquisitionTime, "eo:cloud_cover": 5 },
    }] }) };
  };
  clearCopernicusToken();
  try {
    const result = await runCopernicusSatelliteSync({
      supabase: inMemorySupabase(tables), config,
      logger: { log() {}, warn() {} },
    });
    return { result, tables, catalogRequests, cacheKey };
  } finally {
    globalThis.__copernicusFetchOverride = previousFetch;
    clearCopernicusToken();
  }
}

test("cached quicklook is reused after the new-preview quota is reached", async () => {
  const { result, tables, catalogRequests, cacheKey } = await runAtPreviewLimit({ cached: true });
  assert.equal(result.cache_hit_count, 1);
  assert.equal(result.available_count, 0);
  assert.equal(catalogRequests, 1);
  assert.equal(tables.copernicus_usage_daily[0].catalog_requests_attempted, 1);
  assert.equal(tables.copernicus_usage_daily[0].successful_images_generated, 30);
  assert.equal(tables.copernicus_usage_daily[0].cache_hits, 1);
  assert.equal(tables.event_satellite_observations.find((row) => row.event_id === "strike-event").status, "available");
  assert.equal(tables.event_satellite_observations.find((row) => row.event_id === "strike-event").cache_key, cacheKey);
  assert.notDeepEqual(tables.event_satellite_observations.find((row) => row.event_id === "strike-event").bbox, [1, 2, 3, 4]);
});

test("uncached product waits until the next UTC day without spending a retry", async () => {
  const { result, tables, catalogRequests } = await runAtPreviewLimit({ cached: false });
  const row = tables.event_satellite_observations.find((item) => item.event_id === "strike-event");
  assert.equal(result.skip_reasons.daily_limit, 1);
  assert.equal(result.processed_count, 1);
  assert.equal(catalogRequests, 1);
  assert.equal(row.status, "pending");
  assert.equal(row.attempt_count, 0);
  assert.ok(Date.parse(row.next_retry_at) > Date.now());
  assert.equal(tables.copernicus_usage_daily[0].successful_images_generated, 30);
});

test("recent no-result event is not searched again before its refresh time", async () => {
  const event = {
    id: "no-result-strike", category: "strike", severity: "high",
    title: "Strike near depot", summary: "Explosion reported",
    occurred_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), lat: 35, lon: 36,
  };
  const config = readCopernicusConfig({
    COPERNICUS_ENABLED: "true", COPERNICUS_CLIENT_ID: "client", COPERNICUS_CLIENT_SECRET: "secret",
    COPERNICUS_BATCH_SIZE: "1",
  });
  const tables = {
    events: [event], event_satellite_observations: [],
    copernicus_usage_daily: [{ utc_date: new Date().toISOString().slice(0, 10), catalog_requests_attempted: 0, successful_images_generated: 0 }],
  };
  const previousFetch = globalThis.__copernicusFetchOverride;
  let catalogRequests = 0;
  globalThis.__copernicusFetchOverride = async (url) => {
    if (String(url).includes("/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token", expires_in: 3600 }) };
    }
    catalogRequests += 1;
    return { ok: true, status: 200, json: async () => ({ features: [] }) };
  };
  clearCopernicusToken();
  try {
    const supabase = inMemorySupabase(tables);
    const options = { supabase, config, logger: { log() {}, warn() {} } };
    const first = await runCopernicusSatelliteSync(options);
    const second = await runCopernicusSatelliteSync(options);
    assert.equal(first.processed_count, 1);
    assert.equal(second.processed_count, 0);
    assert.equal(catalogRequests, 2);
    assert.equal(tables.copernicus_usage_daily[0].catalog_requests_attempted, 2);
    assert.equal(tables.event_satellite_observations[0].status, "unavailable");
    assert.ok(Date.parse(tables.event_satellite_observations[0].next_retry_at) > Date.now());
  } finally {
    globalThis.__copernicusFetchOverride = previousFetch;
    clearCopernicusToken();
  }
});

test("Sentinel Hub numeric Retry-After is interpreted in milliseconds", async () => {
  const config = readCopernicusConfig({ COPERNICUS_CLIENT_ID: "client", COPERNICUS_CLIENT_SECRET: "secret" });
  const previousFetch = globalThis.__copernicusFetchOverride;
  globalThis.__copernicusFetchOverride = async (url) => String(url).includes("/token")
    ? { ok: true, status: 200, json: async () => ({ access_token: "test-token", expires_in: 3600 }) }
    : { ok: false, status: 429, headers: { get: () => "7200000" } };
  clearCopernicusToken();
  try {
    await assert.rejects(
      findBestObservation(config, {
        occurred_at: new Date(Date.now() - 60 * 60_000).toISOString(), lat: 35, lon: 36,
      }),
      (error) => error.status === 429 && error.retryAfterMs === 7_200_000
    );
  } finally {
    globalThis.__copernicusFetchOverride = previousFetch;
    clearCopernicusToken();
  }
});
