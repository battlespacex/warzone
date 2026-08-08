import test from "node:test";
import assert from "node:assert/strict";
import {
  ZOOM_UX_STATES,
  buildLocalActivityStackModel,
  calculateActivityTrend,
  chooseStackSide,
  getClusterBucketForZoomState,
  getZoomUxState,
  isIndividualEventMarkerEligible,
  selectActiveClusterGroup,
  selectCollisionSafeLabels,
  selectClusterLocalityLabel,
} from "../../../dev/assets/js/warzone-map-zoom-ux.js";

const NOW = Date.parse("2026-08-08T12:00:00.000Z");

function event(id, overrides = {}) {
  return {
    id,
    title: "Operational incident",
    category: "strike",
    severity: "medium",
    occurred_at: "2026-08-08T11:00:00.000Z",
    event_country: "Lebanon",
    event_region: "South Lebanon",
    event_city: "Tyre",
    location_precision: "LOCAL",
    map_eligible: true,
    lat: 33.2705,
    lon: 35.2038,
    corroboration_state: "REPORTED",
    ...overrides,
  };
}

function cluster(id, screenX, screenY, events, overrides = {}) {
  return {
    id,
    cluster_id: id,
    screen: { x: screenX, y: screenY },
    actual_event_count: events.length,
    event_count: events.length,
    weighted_activity_score: 5,
    latest_event_time: events[0]?.occurred_at,
    severity: "medium",
    domain_distribution: { STRIKE: 1 },
    _clusterEvents: events,
    ...overrides,
  };
}

test("zoom state selection follows the centralized four-state model", () => {
  assert.equal(getZoomUxState(9000000), ZOOM_UX_STATES.REGIONAL);
  assert.equal(getZoomUxState(4000000), ZOOM_UX_STATES.LOCAL_STACK);
  assert.equal(getZoomUxState(1200000), ZOOM_UX_STATES.LOCALITY);
  assert.equal(getZoomUxState(300000), ZOOM_UX_STATES.EVENT);
  assert.equal(getClusterBucketForZoomState(ZOOM_UX_STATES.LOCAL_STACK, "regional"), "local");
  assert.equal(getClusterBucketForZoomState(ZOOM_UX_STATES.LOCALITY, "local"), "district");
});

test("active group selection prefers relevant activity near the viewport focus", () => {
  const central = [
    cluster("central-a", 500, 380, [event("a")], { weighted_activity_score: 10 }),
    cluster("central-b", 610, 410, [event("b")], { weighted_activity_score: 8 }),
  ];
  const edge = [cluster("edge", 1100, 100, [event("c")], { weighted_activity_score: 4 })];
  const active = selectActiveClusterGroup([...central, ...edge], {
    viewportWidth: 1200,
    viewportHeight: 800,
    maxGapPx: 220,
  });

  assert.deepEqual(active.clusters.map((item) => item.id).sort(), ["central-a", "central-b"]);
});

test("locality naming prefers a supported exact facility then city and region", () => {
  const airportEvents = [
    event("airport-a", { event_place: "King Khalid International Airport", event_city: "Riyadh", event_country: "Saudi Arabia", location_precision: "EXACT" }),
    event("airport-b", { event_place: "King Khalid International Airport", event_city: "Riyadh", event_country: "Saudi Arabia", location_precision: "EXACT" }),
    event("riyadh", { event_place: "", event_city: "Riyadh", event_country: "Saudi Arabia" }),
  ];
  assert.equal(selectClusterLocalityLabel(cluster("airport", 0, 0, airportEvents)), "King Khalid International Airport");
  assert.equal(selectClusterLocalityLabel(cluster("city", 0, 0, [event("city", { event_city: "Dammam" })])), "Dammam");
  assert.equal(selectClusterLocalityLabel(cluster("region", 0, 0, [event("region", { event_city: "", event_region: "South Lebanon" })])), "South Lebanon");
});

test("stack verification counts only CONFIRMED and CORROBORATED incidents", () => {
  const states = [
    ...Array.from({ length: 5 }, (_, index) => event(`confirmed-${index}`, { corroboration_state: "CONFIRMED" })),
    ...Array.from({ length: 3 }, (_, index) => event(`corroborated-${index}`, { corroboration_state: "CORROBORATED" })),
    ...Array.from({ length: 3 }, (_, index) => event(`reported-${index}`, { corroboration_state: "REPORTED" })),
    ...Array.from({ length: 2 }, (_, index) => event(`unverified-${index}`, { corroboration_state: "UNVERIFIED" })),
  ];
  const model = buildLocalActivityStackModel([cluster("quality", 0, 0, states)], { nowMs: NOW });

  assert.equal(model.total_event_count, 13);
  assert.equal(model.verified_count, 8);
  assert.equal(model.verification_label, "CORROBORATED+");
});

test("trend compares the recent three hours with the preceding three hours", () => {
  const rising = [
    event("recent-a", { occurred_at: "2026-08-08T11:30:00.000Z" }),
    event("recent-b", { occurred_at: "2026-08-08T10:30:00.000Z" }),
    event("recent-c", { occurred_at: "2026-08-08T10:00:00.000Z" }),
    event("previous", { occurred_at: "2026-08-08T08:00:00.000Z" }),
  ];
  assert.equal(calculateActivityTrend(rising, { nowMs: NOW }).state, "INCREASING");
  assert.equal(calculateActivityTrend(rising.reverse(), { nowMs: NOW }).state, "INCREASING");
});

test("stack side uses available viewport space", () => {
  assert.equal(chooseStackSide({ left: 980, right: 1100 }, { viewportWidth: 1200, leftInset: 80, rightInset: 40 }), "left");
  assert.equal(chooseStackSide({ left: 80, right: 220 }, { viewportWidth: 1200, leftInset: 80, rightInset: 40 }), "right");
  assert.equal(chooseStackSide(
    { left: 500, right: 700 },
    { viewportWidth: 1200, currentSide: "left", hysteresisPx: 80 },
  ), "left");
});

test("active group and stack side hysteresis resist insignificant camera movement", () => {
  const preferred = [cluster("preferred", 430, 380, [event("a")], { weighted_activity_score: 8 })];
  const challenger = [cluster("challenger", 760, 380, [event("b")], { weighted_activity_score: 8.2 })];
  const active = selectActiveClusterGroup([...preferred, ...challenger], {
    viewportWidth: 1200,
    viewportHeight: 800,
    maxGapPx: 120,
    preferredClusterIds: ["preferred"],
    switchMargin: 0.55,
  });
  assert.equal(active.clusters[0].id, "preferred");
});

test("collision suppression keeps higher-priority labels without moving coordinates", () => {
  const visible = selectCollisionSafeLabels([
    { id: "routine", screen: { x: 100, y: 100 }, width: 100, height: 30, priority: 1 },
    { id: "critical", screen: { x: 105, y: 102 }, width: 100, height: 30, priority: 20 },
    { id: "separate", screen: { x: 300, y: 100 }, width: 100, height: 30, priority: 2 },
  ], { viewportWidth: 500, viewportHeight: 300, gapPx: 4 });
  assert.deepEqual([...visible].sort(), ["critical", "separate"]);
});

test("stack entries are relevance ordered and numbers match that order", () => {
  const low = cluster("low", 0, 0, [event("low-event", { event_city: "Tyre" })], { weighted_activity_score: 2 });
  const high = cluster("high", 0, 0, [event("high-event", { event_city: "Nabatieh" })], { weighted_activity_score: 14 });
  const model = buildLocalActivityStackModel([low, high], { nowMs: NOW });

  assert.deepEqual(model.entries.map((entry) => [entry.number, entry.cluster_id]), [["01", "high"], ["02", "low"]]);
});

test("close marker eligibility requires EVENT state and accepted point geography", () => {
  const exact = event("airport", { location_precision: "EXACT" });
  const regional = event("regional", { location_precision: "REGIONAL" });
  assert.equal(isIndividualEventMarkerEligible(ZOOM_UX_STATES.EVENT, exact), true);
  assert.equal(isIndividualEventMarkerEligible(ZOOM_UX_STATES.LOCALITY, exact), false);
  assert.equal(isIndividualEventMarkerEligible(ZOOM_UX_STATES.EVENT, regional), false);
});

test("locality labels and stack data are global rather than theater-specific", () => {
  const globalClusters = [
    cluster("ukraine", 0, 0, [event("kyiv", { event_country: "Ukraine", event_region: "Kyiv Oblast", event_city: "Kyiv", lat: 50.45, lon: 30.52 })]),
    cluster("gulf", 0, 0, [event("dammam", { event_country: "Saudi Arabia", event_region: "Eastern Province", event_city: "Dammam", lat: 26.42, lon: 50.09 })]),
    cluster("taiwan", 0, 0, [event("taipei", { event_country: "Taiwan", event_region: "Northern Taiwan", event_city: "Taipei", lat: 25.03, lon: 121.56 })]),
  ];
  const model = buildLocalActivityStackModel(globalClusters, { nowMs: NOW });
  assert.deepEqual(new Set(model.entries.map((entry) => entry.locality)), new Set(["Kyiv", "Dammam", "Taipei"]));
});
