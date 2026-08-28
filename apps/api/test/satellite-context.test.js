import test from "node:test";
import assert from "node:assert/strict";
import { attachSatelliteContextToEvents, toPublicSatelliteContext } from "../src/satellite-context.js";

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

test("attaches satellite context in bounded event-id batches", async () => {
    const events = Array.from({ length: 205 }, (_, index) => ({ id: `event-${index}` }));
    const requestedBatches = [];
    const supabase = {
        from() {
            const query = {
                eventIds: [],
                select() { return query; },
                in(column, values) {
                    if (column === "event_id") query.eventIds = values;
                    return query;
                },
                order() {
                    requestedBatches.push(query.eventIds);
                    return Promise.resolve({
                        data: query.eventIds.includes("event-204") ? [{
                            id: "observation-204",
                            event_id: "event-204",
                            status: "available",
                            image_url: "https://stratops.battlespacex.com/copernicus/event-204.png",
                            updated_at: "2026-08-27T20:00:00Z",
                        }] : [],
                        error: null,
                    });
                },
            };
            return query;
        },
    };

    const attached = await attachSatelliteContextToEvents(supabase, events);

    assert.deepEqual(requestedBatches.map((batch) => batch.length), [100, 100, 5]);
    assert.equal(attached[204].satellite_context.id, "observation-204");
    assert.equal(attached[0].satellite_context, undefined);
});
