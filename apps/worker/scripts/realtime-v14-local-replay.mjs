// Isolated local Supabase replay only. Never imports the worker env loader,
// which otherwise overrides process env from the project's production-linked files.
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
if (!new Set(["before", "after"]).has(phase)) {
    throw new Error("Specify --phase=before or --phase=after");
}
const rawUrl = process.env.STRATOPS_V14_LOCAL_URL;
const key = process.env.STRATOPS_V14_LOCAL_SERVICE_ROLE_KEY;
if (!rawUrl || !key) throw new Error("Local Supabase URL and service key are required");
const url = new URL(rawUrl);
if (url.protocol !== "http:" || !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)
    || url.username || url.password) {
    throw new Error("V1.4 replay accepts only an unauthenticated loopback HTTP URL");
}

const client = createClient(url.toString(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomBytes(5).toString("hex");
const prefix = `ais-v14-${phase}-${runId}-`;
const messages = { INSERT: 0, UPDATE: 0, DELETE: 0 };
const cycleReturned = [];
const cycleDurationMs = [];
let channel;

function assert(condition, label) {
    if (!condition) throw new Error(`V1.4 replay assertion failed: ${label}`);
}

async function upsert(table, rows, conflict) {
    const started = performance.now();
    const response = await client.from(table)
        .upsert(rows, { onConflict: conflict, ignoreDuplicates: false })
        .select("id");
    if (response.error) {
        throw new Error(`${table} UPSERT failed: ${response.error.code || "unknown"} ${response.error.message}`);
    }
    return { returned: response.data?.length ?? 0, durationMs: performance.now() - started };
}

async function subscribe() {
    channel = client.channel(`v14-local-${phase}-${runId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, (payload) => {
            const sourceKey = String(payload.new?.source_key || payload.old?.source_key || "");
            if (!sourceKey.startsWith(prefix)) return;
            const type = String(payload.eventType || "").toUpperCase();
            if (type in messages) messages[type] += 1;
        });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Local Realtime subscription timed out")), 10000);
        channel.subscribe((status) => {
            if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                clearTimeout(timer); reject(new Error(`Local Realtime subscription: ${status}`));
            }
        });
    });
}

const occurredAt = new Date().toISOString();
const rows = Array.from({ length: 84 }, (_, i) => {
    const mmsi = String(990000000 + i);
    const identity = `${prefix}${mmsi}`;
    return {
        dedupe_key: identity,
        source_key: identity,
        source_name: "AIS / AISStream.io",
        category: "military",
        subcategory: "patrol",
        title: `V1.4 Synthetic Naval Contact ${i}`,
        summary: `Synthetic MMSI ${mmsi}`,
        lat: 35 + i * 0.001,
        lon: -70 - i * 0.001,
        confidence: 75,
        severity: "medium",
        report_type: "signal",
        status: "signal",
        occurred_at: occurredAt,
        metadata: { mmsi, speed_kts: 12, heading: 90, source_count: 1 },
    };
});

try {
    await subscribe();
    for (let cycle = 0; cycle < 4; cycle += 1) {
        const started = performance.now();
        const result = await upsert("events", rows, "dedupe_key");
        cycleReturned.push(result.returned);
        cycleDurationMs.push(Number(result.durationMs.toFixed(2)));
        if (cycle < 3) await sleep(Math.max(0, 5000 - (performance.now() - started)));
    }
    const expectedReturned = phase === "before" ? [84, 84, 84, 84] : [84, 0, 0, 0];
    assert(JSON.stringify(cycleReturned) === JSON.stringify(expectedReturned),
        `event UPSERT returned ${cycleReturned}, expected ${expectedReturned}`);

    const changed = { ...rows[0] };
    const changedReturned = [];
    const repeatReturned = [];
    for (const patch of [
        { lat: changed.lat + 0.01 },
        { occurred_at: new Date(Date.parse(occurredAt) + 5000).toISOString() },
        { metadata: { ...changed.metadata, source_count: 2 } },
        { status: "verified" },
    ]) {
        Object.assign(changed, patch);
        changedReturned.push((await upsert("events", changed, "dedupe_key")).returned);
        repeatReturned.push((await upsert("events", changed, "dedupe_key")).returned);
    }
    assert(changedReturned.every((n) => n === 1), "every meaningful AIS change must update");
    assert(repeatReturned.every((n) => n === (phase === "before" ? 1 : 0)),
        "exact AIS replays must match phase behavior");
    const concurrentReturned = await Promise.all([
        upsert("events", changed, "dedupe_key"),
        upsert("events", changed, "dedupe_key"),
    ]);
    assert(concurrentReturned.every((item) => item.returned === (phase === "before" ? 1 : 0)),
        "concurrent identical AIS UPSERTs must preserve phase behavior");
    const { count: canonicalCount, error: canonicalError } = await client.from("events")
        .select("id", { count: "exact", head: true }).eq("dedupe_key", changed.dedupe_key);
    assert(!canonicalError && canonicalCount === 1, "concurrent UPSERTs must keep one canonical event");

    const aircraft = {
        ...rows[0],
        dedupe_key: `ADSB|v14|${phase}|${runId}`,
        source_key: `adsb-v14-${phase}-${runId}`,
        report_type: "flight_tracking",
    };
    const unrelated = {
        ...rows[0],
        dedupe_key: `other-v14-${phase}-${runId}`,
        source_key: `other-v14-${phase}-${runId}`,
    };
    const aircraftReturned = [
        (await upsert("events", aircraft, "source_key")).returned,
        (await upsert("events", aircraft, "source_key")).returned,
    ];
    const unrelatedReturned = [
        (await upsert("events", unrelated, "dedupe_key")).returned,
        (await upsert("events", unrelated, "dedupe_key")).returned,
    ];
    assert(JSON.stringify(aircraftReturned) === "[1,1]", "aircraft events remain unaffected");
    assert(JSON.stringify(unrelatedReturned) === "[1,1]", "non-AIS signal remains unaffected");

    const firstSeen = new Date().toISOString();
    const lastSeen = new Date(Date.parse(firstSeen) + 5000).toISOString();
    const trackKey = `${prefix}heartbeat`;
    const track = {
        track_key: trackKey, track_type: "naval", category: "military",
        lat: 35, lon: -70, status: "active", metadata: { mmsi: "990000999" },
        occurred_at: occurredAt, updated_at: firstSeen,
    };
    assert((await upsert("tracks", track, "track_key")).returned === 1, "track insert");
    assert((await upsert("tracks", { ...track, updated_at: lastSeen }, "track_key")).returned === 1,
        "track heartbeat update");
    const historyMmsi = String((phase === "before" ? 910000000 : 920000000)
        + (parseInt(runId.slice(0, 6), 16) % 10000000));
    const history = { mmsi: historyMmsi, lat: 35, lon: -70, last_seen_at: firstSeen };
    assert((await upsert("naval_tracks_log", history, "mmsi")).returned === 1, "history insert");
    assert((await upsert("naval_tracks_log", { ...history, last_seen_at: lastSeen }, "mmsi")).returned === 1,
        "history heartbeat update");
    const { data: storedTrack, error: trackError } = await client.from("tracks")
        .select("updated_at").eq("track_key", trackKey).single();
    const { data: storedHistory, error: historyError } = await client.from("naval_tracks_log")
        .select("last_seen_at").eq("mmsi", history.mmsi).single();
    assert(!trackError && Date.parse(storedTrack.updated_at) === Date.parse(lastSeen), "track freshness retained");
    assert(!historyError && Date.parse(storedHistory.last_seen_at) === Date.parse(lastSeen), "history freshness retained");

    await sleep(2500); // Allow local Realtime delivery to settle for measurement.
    const expectedReplayUpdates = phase === "before" ? 252 : 0;
    const measurement = {
        phase, runId, vesselCount: 84, cycles: 4, cadenceMs: 5000,
        cycleReturned, cycleDurationMs, changedReturned, repeatReturned,
        concurrentReturned: concurrentReturned.map((item) => item.returned),
        aircraftReturned, unrelatedReturned,
        realtimeMessages: messages,
        expectedCycleUpdateMessages: expectedReplayUpdates,
        note: "Realtime includes four changed AIS updates and baseline exact/concurrent repeats after the cycle replay.",
    };
    console.log(JSON.stringify(measurement));
    const expectedTotalUpdates = expectedReplayUpdates + 4 + (phase === "before" ? 6 : 0);
    assert(messages.INSERT === 84 && messages.UPDATE === expectedTotalUpdates,
        `local Realtime count ${JSON.stringify(messages)} does not match expected fixture count`);
} finally {
    if (channel) await client.removeChannel(channel);
    await client.realtime.disconnect();
}
