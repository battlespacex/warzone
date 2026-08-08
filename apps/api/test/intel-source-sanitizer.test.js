import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicIntelWireMedia, getPublicSourceLabel, toPublicIntelWireItem } from "../src/intel-source-sanitizer.js";

test("public intel wire media uses same-origin proxy urls without duplicating thumbnail derivatives", () => {
    const item = {
        id: "feed-item-1",
        title: "Regional conflict update",
        summary: "Feed item with media",
        raw: {
            "media:content": [{ url: "https://cdn.example.com/story/full.jpg", width: 1280, height: 720 }],
            "media:thumbnail": [{ url: "https://cdn.example.com/story/thumb.jpg", width: 640, height: 360 }]
        }
    };

    const media = buildPublicIntelWireMedia(item, "https://stratops.battlespacex.com/");

    assert.ok(media);
    assert.equal(media.images.length, 1);
    assert.equal(media.images[0].thumbUrl, "https://stratops.battlespacex.com/events/intel-feed/media/feed-item-1/image/0/thumb");
    assert.equal(media.images[0].fullUrl, "https://stratops.battlespacex.com/events/intel-feed/media/feed-item-1/image/0/full");
});

test("public intel wire items keep legitimate CMS-hosted rss images that live under default/files paths", () => {
    const item = {
        id: "feed-item-2",
        title: "Middle East update",
        summary: "Feed item with safe image",
        source_name: "Middle East Eye",
        source_type: "rss",
        url: "https://www.middleeasteye.net/news/example",
        raw: {
            "media:content": [{ url: "https://www.middleeasteye.net/sites/default/files/styles/crop_16_9/public/images-story/article-photo.jpg", width: 1400, height: 788 }]
        }
    };

    const publicItem = toPublicIntelWireItem(item, { mediaBaseUrl: "https://localhost:8080/" });

    assert.ok(publicItem.media);
    assert.equal(publicItem.media.images.length, 1);
    assert.equal(publicItem.media.images[0].thumbUrl, "https://localhost:8080/events/intel-feed/media/feed-item-2/image/0/thumb");
    assert.equal(publicItem.media.images[0].fullUrl, "https://localhost:8080/events/intel-feed/media/feed-item-2/image/0/full");
});

test("public source labeling recognizes newly added feed ids", () => {
    const nyt = getPublicSourceLabel({
        source_id: "nyt-middle-east",
        source_name: "NYT Middle East",
        source_type: "rss",
        source_category: "regional-conflict"
    });
    const meeLive = getPublicSourceLabel({
        source_id: "middle-east-eye-live",
        source_name: "Middle East Eye Live",
        source_type: "html",
        source_category: "regional-conflict"
    });
    const intelSlava = getPublicSourceLabel({
        source_id: "intelslava",
        source_name: "Intel Slava",
        source_type: "telegram",
        source_category: "osint"
    });

    assert.equal(nyt.sourceLabel, "The New York Times");
    assert.equal(meeLive.sourceLabel, "Middle East Regional Feed");
    assert.equal(intelSlava.sourceLabel, "Intel Slava");
});

test("public Intel Wire quality fields are explicit without exposing provenance", () => {
    const publicItem = toPublicIntelWireItem({
        id: "feed-quality-1",
        title: "Regional incident report",
        source_name: "Regional Alerts",
        source_type: "telegram",
        raw: {
            _event_quality: {
                corroboration_state: "UNVERIFIED",
                raw_report_count: 1,
                independent_source_family_count: 1,
                source_provenance: [{ url: "https://secret.example/raw" }],
            },
        },
    });

    assert.equal(publicItem.corroboration_state, "UNVERIFIED");
    assert.equal(publicItem.verification_state, "UNVERIFIED");
    assert.equal(publicItem.source_class, "TELEGRAM");
    assert.equal(publicItem.source_tier, "TIER_3");
    assert.equal(publicItem.raw_report_count, 1);
    assert.equal("source_provenance" in publicItem, false);
});
