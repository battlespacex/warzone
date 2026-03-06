import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import pg from "pg";
const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false }
});
const RUN_EVERY_SECONDS = Number(process.env.RUN_EVERY_SECONDS || 60);
function sha1(s) {
    return crypto.createHash("sha1").update(s).digest("hex");
}
async function insertEvent(e) {
    const dedupeKey =
        e.dedupe_key ||
        sha1(
            [
                e.category || "strike",
                e.title,
                new Date(e.occurred_at).toISOString(),
                Number(e.lat).toFixed(4),
                Number(e.lon).toFixed(4),
                e.source_url || ""
            ].join("|")
        );
    const sql = `
 INSERT INTO events (category, title, summary, source_name, source_url,
occurred_at, lat, lon, location_label, confidence, dedupe_key)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
 ON CONFLICT (dedupe_key) DO NOTHING
 `;
    const vals = [
        e.category || "strike",
        e.title,
        e.summary || null,
        e.source_name || null,
        e.source_url || null,
        new Date(e.occurred_at),
        Number(e.lat),
        Number(e.lon),
        e.location_label || null,
        Number.isFinite(e.confidence) ? e.confidence : 50,
        dedupeKey
    ];
    await pool.query(sql, vals);
}
async function fetchJson(url) {
    const res = await fetch(url, {
        headers: { "user-agent": "warzone-worker/1.0" }
    });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
    return res.json();
}
async function runOnce() {
    const raw = fs.readFileSync(new URL("./sources.json", import.meta.url));
    const sources = JSON.parse(raw.toString());
    for (const feed of sources.feeds || []) {
        if (feed.type !== "manual-json") continue;
        const data = await fetchJson(feed.url);
        const events = Array.isArray(data.events) ? data.events : [];
        for (const e of events) {
            if (!e.title || !e.occurred_at) continue;
            if (!Number.isFinite(Number(e.lat)) || !Number.isFinite(Number(e.lon)))
                continue;
            await insertEvent({
                ...e,
                category: e.category || feed.category || "strike",
                source_name: e.source_name || feed.name,
                source_url: e.source_url || feed.url
            });
        }
    }
}
async function loop() {
    for (; ;) {
        try {
            await runOnce();
            console.log("worker cycle ok", new Date().toISOString());
        } catch (err) {
            console.error("worker cycle error", err);
        }
        await new Promise((resolve) => setTimeout(resolve, RUN_EVERY_SECONDS *
            1000));
    }
}
loop();

