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

test("legacy feed-region placeholder coordinates are not public map eligible", () => {
    const event = toPublicEvent({
        title: "Reported operational activity",
        summary: "No usable incident place was identified.",
        source_name: "Regional feed",
        location_label: "Middle East",
        lat: 29.5,
        lon: 45
    });

    assert.equal(event.map_eligible, false);
    assert.equal(event.lat, null);
    assert.equal(event.lon, null);
});

test("regional metadata preserves geography but suppresses marker coordinates", () => {
    const event = toPublicEvent({
        id: "evt-regional",
        category: "strike",
        title: "Strikes reported in southern Lebanon",
        location_label: "Southern Lebanon",
        lat: 33.25,
        lon: 35.45,
        metadata: {
            normalization: {
                location_precision: "REGIONAL",
                location_confidence: 52,
                location_method: "text_region",
                event_country: "Lebanon",
                event_region: "Southern Lebanon",
                source_country: "United Kingdom"
            }
        }
    });

    assert.equal(event.lat, null);
    assert.equal(event.lon, null);
    assert.equal(event.map_eligible, false);
    assert.equal(event.location_precision, "REGIONAL");
    assert.equal(event.event_country, "Lebanon");
    assert.equal(event.event_region, "Southern Lebanon");
    assert.equal(event.source_country, "United Kingdom");
});

test("source-derived coordinates are never public map eligible", () => {
    const event = toPublicEvent({
        id: "evt-source-location",
        category: "strike",
        title: "Explosion reported in Iran",
        location_label: "Seoul",
        lat: 37.5667,
        lon: 126.9783,
        metadata: {
            normalization: {
                location_precision: "EXACT",
                location_method: "publisher_coordinates",
                source_country: "South Korea",
                event_country: "Iran"
            }
        }
    });

    assert.equal(event.lat, null);
    assert.equal(event.lon, null);
    assert.equal(event.map_eligible, false);
    assert.equal(event.event_country, "Iran");
    assert.equal(event.source_country, "South Korea");
});

test("hides low-information GDELT fragments from the operational map", () => {
    const event = toPublicEvent({
        id: "evt-gdelt-fragment",
        category: "strike",
        severity: "medium",
        title: ": drones - 12",
        summary: "20260727T044500Z",
        source_name: "GDELT",
        location_label: "Unknown location",
        weapon_type: "drone",
        lat: 29.5,
        lon: 45
    });

    assert.equal(event.display_title, "Drone activity signal");
    assert.equal(event.display_summary, null);
    assert.equal(event.source_name, "GDELT");
    assert.equal(event.map_eligible, false);
});

test("removes timestamp-only GDELT summaries when the headline is useful", () => {
    const event = toPublicEvent({
        id: "evt-gdelt-headline",
        category: "strike",
        severity: "medium",
        title: "Drone attack reported near port facility",
        summary: "20260727T044500Z",
        source_name: "GDELT",
        location_label: "Port area",
        lat: 29.6,
        lon: 45.2
    });

    assert.equal(event.display_title, "Drone attack reported near port facility");
    assert.equal(event.display_summary, null);
    assert.equal(event.map_eligible, true);
});

test("preserves normalized media and satellite availability fields", () => {
    const event = toPublicEvent({
        id: "evt-4",
        category: "strike",
        severity: "high",
        title: "Drone strike on retail store",
        summary: "Article summary",
        source_name: "Ukrinform",
        location_label: "Mykolaiv region, Ukraine",
        lat: 47.0,
        lon: 32.0,
        media: {
            images: [
                {
                    thumb_url: "https://example.com/thumb.jpg",
                    preview_url: "https://example.com/thumb.jpg",
                    full_url: "https://example.com/full.jpg",
                    alt: "Damaged storefront",
                },
            ],
            videos: [],
        },
        primary_image: {
            preview_url: "https://example.com/thumb.jpg",
            full_url: "https://example.com/full.jpg",
            alt: "Damaged storefront",
        },
        additional_images: [
            {
                preview_url: "https://example.com/second-thumb.jpg",
                full_url: "https://example.com/second-full.jpg",
                alt: "Aftermath view",
            },
        ],
        image_source: "Ukrinform",
        image_caption: "Damage after the reported strike",
        image_credit: "Ukrinform",
        image_type: "News Image",
        satellite_context: {
            status: "available",
        },
    });

    assert.equal(event.media.images.length, 1);
    assert.equal(event.primary_image.preview_url, "https://example.com/thumb.jpg");
    assert.equal(event.additional_images.length, 1);
    assert.equal(event.image_type, "News Image");
    assert.equal(event.satellite_available, true);
});
