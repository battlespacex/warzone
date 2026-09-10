// Fetch-only audit: no ingestion jobs, database writes, or configuration changes.
// Usage: node src/source-audit-once.js [providers|feeds|services|telegram|naval|followup] [local|production]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import Parser from "rss-parser";
import { createAircraftProviders } from "./tracking/aircraft/registry.js";
import { createNavalProviders } from "./tracking/naval/registry.js";
import { createPlaneAlertMilitaryDatabase } from "./tracking/aircraft/providers/plane-alert-db.js";
import { getAllConflictSources } from "./conflict-sources.js";
import { getStatusSources } from "./status-sources.js";
import { enrichConflictItem } from "./conflict-filter.js";
import { readCopernicusConfig } from "./copernicus-config.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.argv[3] === "production" ? "production" : "local";
const env = dotenv.parse(fs.readFileSync(path.join(workerRoot, `.env.${environment}`)));
const report = { checked_at: new Date().toISOString(), environment, results: [] };
const quiet = { log() {}, warn() {}, error() {} };
const flags = {
    adsb_lol: "ADSB_LOL_ENABLED", airplanes_live: "AIRPLANES_LIVE_ENABLED",
    adsb_one: "ADSB_ONE_ENABLED", adsbx: "ADSB_EXCHANGE_ENABLED", opensky: "OPENSKY_ENABLED",
    plane_alert_db: "PLANE_ALERT_DB_ENABLED", skylink: "SKYLINK_ENABLED",
    aisstream: "AISSTREAM_ENABLED", fintraffic: "FINTRAFFIC_ENABLED", vesselapi: "VESSELAPI_ENABLED",
    openais: "OPENAIS_ENABLED", marineplan: "MARINEPLAN_ENABLED", aishub: "AISHUB_ENABLED",
    spire: "SPIRE_AIS_ENABLED", marinetraffic: "MARINETRAFFIC_ENABLED", vesselfinder: "VESSELFINDER_ENABLED",
};
function errorSummary(error) {
    // Never include raw response bodies, credential-bearing URLs or auth headers.
    return { error: error?.code || error?.cause?.code || error?.name || "REQUEST_FAILED", status: error?.status || error?.statusCode || null };
}
function record(result) { report.results.push(result); console.log(JSON.stringify(result)); }
function validPosition(item) {
    return Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
        && Math.abs(item.latitude) <= 90 && Math.abs(item.longitude) <= 180;
}
async function pool(items, concurrency, fn) {
    let index = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (index < items.length) await fn(items[index++]);
    }));
}
async function providers() {
    const forcedEnv = { ...env, ...Object.fromEntries(Object.values(flags).map(flag => [flag, "true"])) };
    const dependencies = { logger: quiet };
    const configured = [...createAircraftProviders(env, dependencies), ...createNavalProviders(env, dependencies)];
    const forced = [...createAircraftProviders(forcedEnv, dependencies), ...createNavalProviders(forcedEnv, dependencies)];
    const samples = {};
    await pool(forced.filter(p => !p.enrichmentOnly), 4, async provider => {
        const row = { group: "tracking", id: provider.id, flag: flags[provider.id], configured_enabled: configured.find(p => p.id === provider.id)?.enabled === true };
        if (!provider.enabled) return record({ ...row, result: "MISSING_CONFIGURATION", reason: provider.disabledReason });
        const started = Date.now();
        try {
            const result = await provider.fetchObservations();
            const observations = Array.isArray(result) ? result : result.observations || [];
            samples[provider.id] = observations;
            const fresh = observations.filter(item => validPosition(item) && Date.now() - Date.parse(item.observed_at) < 30 * 60_000);
            record({ ...row, result: fresh.length ? "LIVE_DATA" : "EMPTY_OR_STALE", observations: observations.length, valid_positions: observations.filter(validPosition).length, fresh_positions: fresh.length, military_hints: fresh.filter(item => item.military_hint || item.provider_military_flag || Number(item.ship_type_code) === 35).length, elapsed_ms: Date.now() - started, diagnostics: result.diagnostics ? Object.fromEntries(Object.entries(result.diagnostics).filter(([k, v]) => typeof v === "number" || typeof v === "boolean" || k === "last_message_at")) : null });
        } catch (error) { record({ ...row, result: "FAILED", ...errorSummary(error), elapsed_ms: Date.now() - started }); }
        finally { provider.shutdown?.(); }
    });
    const database = createPlaneAlertMilitaryDatabase({ sourceUrl: env.PLANE_ALERT_DB_SOURCE_URL, cacheFile: null, logger: quiet });
    const identities = await database.initialize({ forceRefresh: true });
    record({ group: "tracking", id: "plane_alert_db", result: identities.size ? "IDENTITY_DATA" : "FAILED", records: identities.size });
    // Existing quota stores are retained; a single candidate lookup obeys budget and interval guards.
    for (const id of ["skylink", "vesselapi"]) {
        const provider = forced.find(p => p.id === id);
        if (!provider.enabled) { record({ group: "tracking", id, result: "MISSING_CONFIGURATION", reason: provider.disabledReason }); continue; }
        const aircraft = Object.entries(samples).filter(([key]) => ["adsb_lol", "airplanes_live", "adsb_one"].includes(key)).flatMap(([, rows]) => rows).find(r => r.icao24);
        const vessel = [...(samples.aisstream || []), ...(samples.fintraffic || [])].find(r => r.mmsi);
        if ((id === "skylink" && !aircraft) || (id === "vesselapi" && !vessel)) { record({ group: "tracking", id, result: "NO_LIVE_CANDIDATE" }); continue; }
        try {
            const result = id === "skylink" ? await provider.lookupAircraftByIcao24(aircraft.icao24) : await provider.lookupVesselByMmsi(vessel.mmsi);
            record({ group: "tracking", id, result: result.observation ? "IDENTITY_DATA" : "NO_IDENTITY_DATA", diagnostics: result.diagnostics });
        } catch (error) { record({ group: "tracking", id, result: "FAILED", ...errorSummary(error) }); }
    }
    const aircraft = Object.entries(samples).filter(([key]) => ["adsb_lol", "airplanes_live", "adsb_one", "opensky"].includes(key)).flatMap(([, rows]) => rows).filter(validPosition);
    record({ group: "merge_check", id: "aircraft", raw_positions: aircraft.length, unique_icao24: new Set(aircraft.map(r => r.icao24)).size });
}
async function feeds() {
    const definitions = JSON.parse(fs.readFileSync(path.join(workerRoot, "src/sources.json"), "utf8")).feeds;
    const all = [...definitions.map(s => ({ ...s, registry: "sources.json" })), ...getAllConflictSources({ includeDisabled: true }).map(s => ({ ...s, registry: "conflict-sources.js" })), ...getStatusSources().map(s => ({ ...s, registry: "status-sources.js" }))];
    const rssParser = new Parser();
    const requests = new Map();
    await pool(all.filter(source => source.id || source.name), 5, async source => {
        const row = { group: "feed", registry: source.registry, id: source.id || source.name || "unnamed", enabled: source.enabled !== false, parser: source.parser || source.adapter || source.type };
        const rawUrl = source.url || "";
        const missing = [...rawUrl.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m => m[1]).filter(k => !env[k]);
        if (missing.length) return record({ ...row, result: "MISSING_CONFIGURATION", missing });
        const url = rawUrl.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => env[key] || "");
        const isRss = source.parser === "rss" || source.type === "rss";
        if (!isRss) return record({ ...row, result: "NEEDS_ADAPTER_CHECK", has_url: Boolean(url) });
        if (!requests.has(url)) requests.set(url, (async () => {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "StratOps Conflict Feed Worker/1.0" } });
                if (!response.ok) return { result: "HTTP_ERROR", status: response.status };
                const body = await response.text();
                if (/^\s*(?:<!doctype html|<html)/i.test(body)) return { result: "HTML_NOT_RSS", status: response.status };
                const parsed = await rssParser.parseString(body);
                const items = parsed.items || [];
                const dated = items.map(item => Date.parse(item.isoDate || item.pubDate)).filter(Number.isFinite);
                const freshItems = items.filter(item => Date.now() - Date.parse(item.isoDate || item.pubDate) < 14 * 86400_000);
                const relevant = freshItems.filter(item => enrichConflictItem({ title: item.title, summary: item.contentSnippet || item.content || item.summary, source_name: source.name, source_category: source.category }, { minimumScore: 30 }).is_conflict_relevant).length;
                return { result: items.length ? "RSS_DATA" : "EMPTY", items: items.length, fresh_14d: freshItems.length, relevant_fresh_14d: relevant, newest: dated.length ? new Date(Math.max(...dated)).toISOString() : null };
            } catch (error) { return { result: "FAILED", ...errorSummary(error) }; }
        })());
        record({ ...row, ...await requests.get(url) });
    });
}
async function requestJson(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
    const body = await response.text();
    if (!body.trim()) return { empty_body: true };
    return JSON.parse(body.replace(/^\uFEFF/, ""));
}
async function services() {
    const definitions = JSON.parse(fs.readFileSync(path.join(workerRoot, "src/sources.json"), "utf8")).feeds;
    const apiRows = definitions.filter(s => s.name && s.parser !== "rss" && s.parser !== "telegram" && !["adsb-opensky", "ais-stream"].includes(s.type));
    const gdeltRows = apiRows.filter(s => s.parser === "gdelt");
    const check = async source => {
        const row = { group: "api", id: source.name, enabled: source.enabled !== false };
        let url = (source.url || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => env[k] || "");
        let headers = { Accept: "application/json", "User-Agent": "warzone-worker/1.0" };
        try {
            let data;
            if (source.parser === "acled") {
                if (!env.ACLED_EMAIL || !env.ACLED_PASSWORD) return record({ ...row, result: "MISSING_CONFIGURATION" });
                const token = await requestJson("https://acleddata.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: env.ACLED_EMAIL, password: env.ACLED_PASSWORD, grant_type: "password", client_id: "acled" }).toString() });
                if (!token.access_token) return record({ ...row, result: "AUTH_FAILED" });
                data = await requestJson("https://api.acleddata.com/acled/read?limit=50", { headers: { ...headers, Authorization: `Bearer ${token.access_token}` } });
            } else if (source.parser === "x-search") {
                if (!(env.X_BEARER_TOKEN || env.TWITTER_BEARER_TOKEN)) return record({ ...row, result: "MISSING_CONFIGURATION", missing: ["X_BEARER_TOKEN"] });
                url = "https://api.x.com/2/tweets/search/recent?max_results=10&query=from%3AOSINTdefender";
                headers.Authorization = `Bearer ${env.X_BEARER_TOKEN || env.TWITTER_BEARER_TOKEN}`;
            } else if (source.parser === "gdelt") {
                const parsed = new URL(url);
                for (const k of ["query", "mode", "format", "maxrecords", "sort", "timespan"]) if (source[k] != null) parsed.searchParams.set(k, source[k]);
                url = parsed.toString();
            } else if (source.parser === "ucdp") {
                if (!env.UCDP_ACCESS_TOKEN) return record({ ...row, result: "MISSING_CONFIGURATION" });
                headers[ source.auth_header || "x-ucdp-access-token" ] = env.UCDP_ACCESS_TOKEN;
            } else if (source.parser === "network-cloudflare") {
                if (!env.CLOUDFLARE_RADAR_TOKEN) return record({ ...row, result: "MISSING_CONFIGURATION" });
                headers.Authorization = `Bearer ${env.CLOUDFLARE_RADAR_TOKEN}`;
                url += "?limit=50&dateRange=1d";
            } else if (source.parser === "notam-api") {
                if (env.SKYLINK_RAPIDAPI_KEY) {
                    url = `https://skylink-api.p.rapidapi.com/v3/notams/${(env.SKYLINK_NOTAM_AIRPORTS || "LLBG").split(",")[0]}`;
                    headers["x-rapidapi-key"] = env.SKYLINK_RAPIDAPI_KEY;
                    headers["x-rapidapi-host"] = "skylink-api.p.rapidapi.com";
                } else if (env.FAA_CLIENT_ID && env.FAA_CLIENT_SECRET) {
                    url = "https://external-api.faa.gov/notamapi/v1/notams?pageSize=1&pageNum=1&notamType=NOTAM";
                    headers.client_id = env.FAA_CLIENT_ID; headers.client_secret = env.FAA_CLIENT_SECRET;
                } else return record({ ...row, result: "MISSING_CONFIGURATION", missing: ["SKYLINK_RAPIDAPI_KEY or FAA client credentials"] });
            } else if (source.parser === "firms") {
                if (!env.NASA_FIRMS_MAP_KEY) return record({ ...row, result: "MISSING_CONFIGURATION" });
                const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
                if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
                const csv = await response.text();
                const valid = /^latitude,longitude,/i.test(csv);
                return record({ ...row, result: valid ? "CSV_DATA" : "INVALID_RESPONSE", records: valid ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0 });
            }
            const missing = [...(source.url || "").matchAll(/\$\{([A-Z0-9_]+)\}/g)].map(m => m[1]).filter(k => !env[k]);
            if (missing.length) return record({ ...row, result: "MISSING_CONFIGURATION", missing });
            if (!data) data = await requestJson(url, { headers });
            const arrays = [data, data.events, data.data, data.results, data.features, data.articles, data.Result, data.result?.annotations, data.result?.outages, data.data?.children, data.vulnerabilities, data.notams, data.items].filter(Array.isArray);
            const count = arrays.length ? arrays[0].length : 0;
            record({ ...row, result: count ? "API_DATA" : data.success === false || data.error ? "API_ERROR" : "NO_RECORDS", records: count, response_keys: Object.keys(data).slice(0, 12) });
        } catch (error) { record({ ...row, result: "FAILED", ...errorSummary(error) }); }
    };
    await pool(apiRows.filter(s => s.parser !== "gdelt"), 4, check);
    // GDELT has a shared rate limit; do not burst all regional queries together.
    let gdeltRateLimited = false;
    for (const source of gdeltRows) {
        if (gdeltRateLimited) { record({ group: "api", id: source.name, result: "NOT_ATTEMPTED_RATE_LIMIT" }); continue; }
        await check(source);
        gdeltRateLimited = report.results.at(-1)?.status === 429;
        await new Promise(resolve => setTimeout(resolve, 5500));
    }
    const config = readCopernicusConfig(env);
    try {
        const token = await requestJson(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }).toString() });
        if (!token.access_token) throw Object.assign(new Error("AUTH_FAILED"), { code: "AUTH_FAILED" });
        const data = await requestJson(`${config.catalogUrl}/search`, { method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ collections: ["sentinel-2-l2a"], bbox: [34, 30, 36, 33], datetime: `${new Date(Date.now() - 72 * 3600_000).toISOString()}/${new Date().toISOString()}`, limit: 1 }) });
        record({ group: "api", id: "Copernicus catalog", result: data.features?.length ? "API_DATA" : "NO_RECORDS", records: data.features?.length || 0 });
    } catch (error) { record({ group: "api", id: "Copernicus catalog", result: "FAILED", ...errorSummary(error) }); }
    for (const route of ["/health", "/events/aircraft", "/events?window_hours=24&limit=5", "/events/intel-feed?limit=5", "/events/airspace-status", "/events/alerts", "/satellites/military"]) {
        try {
            const data = await requestJson(`https://api.battlespacex.com${route}`);
            record({ group: "deployed_api", id: route, result: "HTTP_200_JSON", tracks: data.tracks?.length, events: data.events?.length, items: data.items?.length, satellites: data.satellites?.length });
        } catch (error) { record({ group: "deployed_api", id: route, result: "FAILED", ...errorSummary(error) }); }
    }
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: "count=exact" };
    for (const [id, query] of Object.entries({ aircraft: "tracks?select=updated_at&track_type=eq.aircraft&order=updated_at.desc&limit=1", naval: "tracks?select=updated_at&track_type=eq.naval&order=updated_at.desc&limit=1", events: "events?select=occurred_at&order=occurred_at.desc&limit=1", intel: "conflict_feed_items?select=fetched_at&order=fetched_at.desc&limit=1", source_registry: "source_registry?select=source_name,enabled&limit=200" })) {
        try {
            const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, { headers, signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
            const data = await response.json();
            record({ group: "database", id, result: "READ_OK", count: response.headers.get("content-range"), latest: id === "source_registry" ? undefined : data[0], enabled: id === "source_registry" ? data.filter(r => r.enabled).length : undefined });
        } catch (error) { record({ group: "database", id, result: "FAILED", ...errorSummary(error) }); }
    }
    for (const source of [...getAllConflictSources({ includeDisabled: true }), ...getStatusSources()].filter(s => s.enabled === false && !["rss", "telegram-preview", "live-html"].includes(s.parser || s.type))) {
        record({ group: "candidate_adapter", id: source.id, enabled: source.enabled, result: /stub$/.test(source.adapter || "") || source.type === "candidate" ? "ADAPTER_NOT_IMPLEMENTED" : "SEPARATE_API_ADAPTER_REQUIRED", note: source.note || null });
    }
    const ooni = getStatusSources().find(s => s.adapter === "ooni_incidents");
    try { const data = await requestJson(ooni.url); record({ group: "api", id: ooni.id, result: "HTTP_200_JSON", records: data.results?.length || data.incidents?.length || 0, response_keys: Object.keys(data) }); }
    catch (error) { record({ group: "api", id: ooni.id, result: "FAILED", ...errorSummary(error) }); }
}
async function telegram() {
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions/index.js");
    const definitions = JSON.parse(fs.readFileSync(path.join(workerRoot, "src/sources.json"), "utf8")).feeds;
    const channels = [...new Set(definitions.filter(s => s.parser === "telegram").flatMap(s => s.channels || []).map(s => s.toLowerCase()))];
    const client = new TelegramClient(new StringSession(env.TELEGRAM_SESSION || ""), Number(env.TELEGRAM_API_ID), env.TELEGRAM_API_HASH, { connectionRetries: 1, requestRetries: 1, retryDelay: 1000, floodSleepThreshold: 0, timeout: 10 });
    client.setLogLevel("none");
    try {
        await client.connect();
        if (!await client.isUserAuthorized()) return record({ group: "telegram", id: "session", result: "UNAUTHORIZED" });
        let rateLimited = false;
        for (const channel of channels) {
            if (rateLimited) { record({ group: "telegram", id: channel, result: "NOT_ATTEMPTED_RATE_LIMIT" }); continue; }
            try {
                const messages = await client.getMessages(channel, { limit: 1 });
                record({ group: "telegram", id: channel, result: messages.length ? "MESSAGE_DATA" : "EMPTY", newest: messages[0]?.date ? new Date(messages[0].date * 1000).toISOString() : null });
            } catch (error) {
                rateLimited = /FLOOD/.test(error.errorMessage || "");
                record({ group: "telegram", id: channel, result: rateLimited ? "RATE_LIMITED" : "FAILED", error: error.errorMessage || error.code || error.name });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) { record({ group: "telegram", id: "session", result: "FAILED", ...errorSummary(error) }); }
    finally { await client.disconnect(); await client.destroy(); }
}
async function navalPipeline() {
    process.env.NODE_ENV = environment === "production" ? "production" : "development";
    const { runAisWorker } = await import("./ais-worker.js");
    const live = createNavalProviders({ ...env, AISSTREAM_DIAGNOSTIC_WINDOW_MS: "60000", FINTRAFFIC_INITIAL_SNAPSHOT_MS: "60000" }, { logger: quiet }).filter(p => ["aisstream", "fintraffic"].includes(p.id));
    let tracks = [];
    try {
        const result = await runAisWorker({ providers: live, logger: quiet, persistence: {
            async upsertEvents() {}, async upsertHistory() {}, async endAliases() {},
            async upsertTracks(items) { tracks = items; return 0; },
        } });
        record({ group: "naval_pipeline", id: "60_second_fetch_only", ...result, persistence_disabled: true, duplicate_track_keys: tracks.length - new Set(tracks.map(r => r.track_key)).size, source_counts: tracks.reduce((a, r) => { a[r.source_name] = (a[r.source_name] || 0) + 1; return a; }, {}) });
    } finally { for (const provider of live) provider.shutdown?.(); }
}
async function followup() {
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    for (const type of ["aircraft", "naval"]) {
        const data = await requestJson(`${env.SUPABASE_URL}/rest/v1/tracks?select=updated_at,occurred_at,source_name&track_type=eq.${type}&order=updated_at.desc&limit=1000`, { headers });
        record({ group: "database", id: type, rows_checked: data.length, newest_updated_at: data[0]?.updated_at, fresh_45m: data.filter(r => Date.now() - Date.parse(r.occurred_at || r.updated_at) < 45 * 60_000).length });
    }
    const sources = await requestJson(`${env.SUPABASE_URL}/rest/v1/source_registry?select=source_name,enabled&limit=200`, { headers });
    record({ group: "database", id: "source_registry", result: "READ_OK", rows: sources.length, enabled: sources.filter(r => r.enabled).length, disabled: sources.filter(r => !r.enabled).map(r => r.source_name) });
    const data = await requestJson("https://api.battlespacex.com/events/aircraft");
    record({ group: "deployed_api", id: "aircraft_freshness", rows: data.tracks?.length, newest_updated_at: data.tracks?.[0]?.updated_at, fresh_45m: (data.tracks || []).filter(r => Date.now() - Date.parse(r.updated_at) < 45 * 60_000).length });
    process.env.NODE_ENV = environment === "production" ? "production" : "development";
    const { fetchSingleTelegramSource } = await import("./conflict-telegram-fetcher.js");
    const { fetchSingleLiveHtmlSource } = await import("./conflict-live-fetcher.js");
    for (const source of getAllConflictSources({ includeDisabled: true }).filter(s => ["live-html", "telegram-preview"].includes(s.parser))) {
        const result = source.parser === "live-html" ? await fetchSingleLiveHtmlSource(source) : await fetchSingleTelegramSource(source);
        record({ group: "adapter", id: source.id, result: result.ok ? "PARSED_DATA" : "FAILED", fetched: result.fetched_count, relevant: result.count });
    }
    for (const [id, url] of [["reliefweb-reports", "https://api.reliefweb.int/v2/reports?appname=battlespacex-stratops-conflict-feed&limit=1"], ["gdacs-alerts", "https://www.gdacs.org/xml/rss.xml"]]) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw Object.assign(new Error("HTTP_ERROR"), { status: response.status });
            const content = await response.text();
            const parsed = id === "gdacs-alerts" ? await new Parser().parseString(content) : JSON.parse(content);
            record({ group: "candidate_api", id, result: "DATA_AVAILABLE_ADAPTER_NOT_ENABLED", records: parsed.items?.length || parsed.data?.length || 0 });
        } catch (error) { record({ group: "candidate_api", id, result: "FAILED", ...errorSummary(error) }); }
    }
}
const mode = process.argv[2] || "providers";
if (mode === "providers") await providers();
else if (mode === "feeds") await feeds();
else if (mode === "services") await services();
else if (mode === "telegram") await telegram();
else if (mode === "naval") await navalPipeline();
else if (mode === "followup") await followup();
else throw new Error("Use providers, feeds, services, telegram, naval or followup");
const output = path.resolve(workerRoot, "../../.generated/source-audit", `${report.checked_at.slice(0, 10)}-${environment}-${mode}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`Saved audit: ${output}`);
