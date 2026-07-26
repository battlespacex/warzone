import test from "node:test";
import assert from "node:assert/strict";
import {
    cleanLocationLabel,
    cleanSourceName,
    isCoarseCountryCentroid,
    isValidCoordinate,
    toPublicEvent
} from "../src/public-event-normalizer.js";

test("removes unsafe public fallback strings", () => {
    assert.equal(cleanSourceName("Unknown Source"), null);
    assert.equal(cleanLocationLabel("Unknown location"), null);
    assert.equal(cleanLocationLabel("Reported location"), null);
});

test("sanitizes public event display fields while preserving attribution separately", () => {
    const event = toPublicEvent({
        id: "evt-1",
        category: "strike",
        severity: "Unknown",
        title: "Untitled event",
        summary: "<p>Drone strike reported near Chuhuiv</p>",
        source_name: "Unknown Source",
        location_label: "Unknown location",
        lat: 49.84,
        lon: 36.69
    });

    assert.equal(event.title, "Strike update");
    assert.equal(event.summary, "Drone strike reported near Chuhuiv");
    assert.equal(event.source_name, null);
    assert.equal(event.location_label, null);
    assert.equal(event.severity, "medium");
    assert.equal(event.map_eligible, true);
});

test("invalid coordinates are not public map eligible", () => {
    assert.equal(isValidCoordinate(0, 0), false);

    const event = toPublicEvent({
        id: "evt-2",
        category: "military",
        title: "Naval activity reported",
        lat: 0,
        lon: 0
    });

    assert.equal(event.lat, null);
    assert.equal(event.lon, null);
    assert.equal(event.map_eligible, false);
});

test("broad country centroid coordinates are not public map eligible", () => {
    assert.equal(isCoarseCountryCentroid(31.8, 35.0, "Israel"), true);

    const event = toPublicEvent({
        id: "evt-3",
        category: "strike",
        title: "Senior Iranian source says Tehran will halt attacks as long as US holds fire",
        summary: "Diplomatic report mentioning Israel and Iran without a specific impact location.",
        location_label: "Israel",
        lat: 31.8,
        lon: 35.0
    });

    assert.equal(event.lat, null);
    assert.equal(event.lon, null);
    assert.equal(event.map_eligible, false);
});
