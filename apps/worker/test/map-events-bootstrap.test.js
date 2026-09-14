import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("initial and region-change map loads use the region-scoped endpoint", async () => {
    const essential = await readSource("../../../dev/assets/js/essential.js");
    const api = await readSource("../../../dev/assets/js/supabase.js");
    const regions = await readSource("../../../dev/assets/js/warzone-region-selector.js");

    assert.match(essential, /api\.getMapEvents\(\s*getMapEventsRegionRequest\(\)/);
    assert.doesNotMatch(essential, /api\.getEvents\(/);
    assert.match(api, /fetchLatest\("events:map", `\$\{API_BASE\}\/events\/map\?/);
    assert.match(regions, /export function getRegionRequestBounds[\s\S]*?getRegionBounds\(region\)/);
});

test("map bootstrap falls back to the legacy endpoint only when the scoped route is missing", async () => {
    const api = await readSource("../../../dev/assets/js/supabase.js");

    assert.match(api, /if \(res\.status === 404\)[\s\S]*?events:map-legacy[\s\S]*?\/events\?window_hours=/);
    assert.match(api, /function filterLegacyMapEventsToRegion[\s\S]*?lat >= bounds\.minLat[\s\S]*?lon <= bounds\.maxLon/);
    assert.match(api, /compatibility_fallback: true/);
    assert.doesNotMatch(api, /res\.status >= 500[\s\S]*?events:map-legacy/);
});

test("rapid region changes cannot let stale map data overwrite the active region", async () => {
    const essential = await readSource("../../../dev/assets/js/essential.js");
    const api = await readSource("../../../dev/assets/js/supabase.js");

    assert.match(essential, /const reloadSeq = \+\+__regionReloadSeq[\s\S]*?if \(reloadSeq !== __regionReloadSeq\) return/);
    assert.match(essential, /requestedRegionId[\s\S]*?getActiveRegion\?\.\(\)\?\.id[\s\S]*?requestedRegionId/);
    assert.match(api, /__activeApiRequests\.get\(requestKey\)\?\.abort\(\)/);
});

test("lens and layer filters still consume the region-scoped map dataset", async () => {
    const essential = await readSource("../../../dev/assets/js/essential.js");

    assert.match(essential, /function applyScopeFilters[\s\S]*?filterEventsToActiveRegion[\s\S]*?isEventInLens/);
    assert.match(essential, /function applyAllFilters[\s\S]*?applyOperationalScopeFilters[\s\S]*?isEventVisible/);
    assert.match(essential, /syncHotspotLayerEvents\([\s\S]*?applyHotspotFilters\(__eventsCache/);
});

test("region cache is bounded, expiring, and merges realtime rows by id", async () => {
    const api = await readSource("../../../dev/assets/js/supabase.js");
    const essential = await readSource("../../../dev/assets/js/essential.js");

    assert.match(api, /MAP_EVENTS_CACHE_TTL_MS = 2 \* 60 \* 1000/);
    assert.match(api, /getMapEventsCacheKey[\s\S]*?MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS/);
    assert.match(api, /function mergeMapEventRows[\s\S]*?rows\.filter[\s\S]*?!== incomingId/);
    assert.match(essential, /api\.mergeRealtimeMapEvent\?\.\(normalized\)/);
});

test("popup renders lightweight data first and enriches details through a small cache", async () => {
    const essential = await readSource("../../../dev/assets/js/essential.js");
    const api = await readSource("../../../dev/assets/js/supabase.js");

    assert.match(essential, /const showPopup = \(detail = \{\}, options = \{\}\) => \{[\s\S]*?popup\.hidden = false[\s\S]*?getCachedEventDetail\(detailId\)/);
    assert.match(essential, /EVENT_DETAIL_CACHE_MAX_ITEMS = 64/);
    assert.match(essential, /catch\(\(\) => \{\s*\/\/ The lightweight popup remains usable/);
    assert.match(api, /async getEventById[\s\S]*?\/events\/\$\{encodeURIComponent\(id\)\}/);
});

test("map request and render performance marks cover successful and empty bootstrap", async () => {
    const essential = await readSource("../../../dev/assets/js/essential.js");
    for (const name of [
        "stratops-map-events-request-start",
        "stratops-map-events-request-end",
        "stratops-map-events-parse-complete",
        "stratops-map-events-render-start",
        "stratops-map-events-render-complete",
    ]) {
        assert.match(essential, new RegExp(`markStartupPerformance\\("${name}"\\)`));
    }
    assert.match(essential, /let events = \[\][\s\S]*?catch \(err\)[\s\S]*?renderAll\(events\)/);
});
