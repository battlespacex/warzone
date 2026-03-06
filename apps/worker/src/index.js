import http from "http";

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.end("warzone worker running");
}).listen(PORT);

import cron from "node-cron";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "./supabase.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcesPath = path.join(__dirname, "sources.json");
const rawSources = fs.readFileSync(sourcesPath, "utf-8");

const sources = JSON.parse(
    rawSources.replace(/\$\{SEED_FEED_URL\}/g, process.env.SEED_FEED_URL || "")
);

async function insertEvent(event) {
    const { error } = await supabase
        .from("events")
        .insert([event]);

    if (error) {
        console.error("Insert error:", error.message);
        return false;
    }

    console.log("Event inserted:", event.title);
    return true;
}

function makeDedupeKey(item, feed) {
    if (item.dedupe_key) return item.dedupe_key;

    return [
        feed.name || "feed",
        item.title || "untitled",
        item.occurred_at || "",
        item.location_label || "",
        item.lat ?? "",
        item.lon ?? ""
    ].join("|");
}

async function eventExists(dedupeKey) {
    const { data, error } = await supabase
        .from("events")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .limit(1);

    if (error) {
        console.error("Lookup error:", error.message);
        return false;
    }

    return Array.isArray(data) && data.length > 0;
}

async function processFeed(feed) {
    console.log("Fetching:", feed.name, feed.url);

    const response = await axios.get(feed.url, {
        timeout: 15000,
        headers: {
            "Cache-Control": "no-cache"
        }
    });

    const payload =
        typeof response.data === "string"
            ? JSON.parse(response.data)
            : response.data;

    const items = Array.isArray(payload?.events) ? payload.events : [];

    console.log("Items fetched:", items.length);

    for (const item of items) {
        const dedupeKey = makeDedupeKey(item, feed);
        const exists = await eventExists(dedupeKey);

        if (exists) {
            console.log("Skipped duplicate:", item.title);
            continue;
        }

        const event = {
            category: item.category || feed.category || "strike",
            title: item.title || "Untitled event",
            summary: item.summary || "",
            source_name: item.source_name || feed.name || "Unknown source",
            source_url: item.source_url || feed.url,
            occurred_at: item.occurred_at || new Date().toISOString(),
            lat: Number(item.lat),
            lon: Number(item.lon),
            location_label: item.location_label || "Unknown location",
            confidence: Number(item.confidence ?? 50),
            dedupe_key: dedupeKey
        };

        await insertEvent(event);
    }
}

async function runWorker() {
    console.log("Worker cycle started");

    const activeFeeds = sources.feeds.filter((feed) => feed.enabled !== false);
    console.log("Feeds loaded:", activeFeeds.length);

    for (const feed of activeFeeds) {
        try {
            await processFeed(feed);
        } catch (err) {
            console.error("Feed error:", feed.name, err.message);
        }
    }
}

cron.schedule("*/5 * * * *", () => {
    runWorker();
});

console.log("Worker started");
runWorker();