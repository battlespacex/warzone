import test from "node:test";
import assert from "node:assert/strict";
import { toPublicSatelliteContext } from "../src/satellite-context.js";

test("publishes only safe available satellite image URLs", () => {
    const context = toPublicSatelliteContext({
        id: "obs-1",
        status: "available",
        collection: "sentinel-2-l2a",
        observation_type: "true_color",
        acquisition_time: "2026-07-26T18:19:01Z",
        event_time_relation: "after",
        cloud_cover: 12,
        image_url: "https://stratops.battlespacex.com/copernicus/2026/07/26/event.png",
        updated_at: "2026-07-26T18:20:00Z"
    });

    assert.equal(context.status, "available");
    assert.equal(context.provider, "Copernicus");
    assert.equal(context.imageUrl, "https://stratops.battlespacex.com/copernicus/2026/07/26/event.png");
    assert.equal(context.imageryType, "Natural colour");
    assert.equal(context.updatedAt, "2026-07-26T18:20:00Z");
});

test("does not publish failed or malformed satellite image rows", () => {
    assert.equal(toPublicSatelliteContext({
        id: "obs-2",
        status: "permanent_error",
        image_url: "https://example.com/image.png"
    }), null);

    assert.equal(toPublicSatelliteContext({
        id: "obs-3",
        status: "available",
        image_url: "/copernicus/local-file.png"
    }), null);
});
