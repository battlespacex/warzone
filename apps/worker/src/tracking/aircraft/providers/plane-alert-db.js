import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { createHash } from "node:crypto";

import { ProviderRequestError } from "../../http.js";
import { normalizeIcao24 } from "../../../../../shared/aircraft-identifiers.js";
import { resolveAircraftIdentity, getAircraftAllocation } from "../../../../../shared/aircraft-identity.js";

const DEFAULT_SOURCE_URL = "https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/plane-alert-mil.csv";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_FILE = path.resolve(moduleDirectory, "../../../../.cache/plane-alert-mil.csv");
const BUNDLED_FILE = path.resolve(moduleDirectory, "../../../../data/aircraft/plane-alert-mil.csv");

function parseCsvRow(line = "") {
    const values = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                value += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            values.push(value.trim());
            value = "";
        } else {
            value += character;
        }
    }
    values.push(value.trim());
    if (quoted) throw new Error("Unterminated CSV field");
    return values;
}

export function inspectPlaneAlertMilitaryCsv(csv = "", provenance = {}) {
    const records = new Map();
    const rejected = [], duplicates = [], conflicted = new Set();
    const lines = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) throw new Error("Empty military registry CSV");
    const headers = parseCsvRow(lines[0]).map((header) => header.replace(/^[$#]+/, "").trim().toLowerCase());
    if (!["icao", "registration", "operator", "type", "icao type", "cmpg"].every(key => headers.includes(key))) throw new Error("Missing military registry CSV columns");
    for (const [index, line] of lines.slice(1).entries()) {
        let values;
        try { values = parseCsvRow(line); } catch { rejected.push({ line: index + 2, reason: "malformed_csv" }); continue; }
        if (values.length !== headers.length) { rejected.push({ line: index + 2, reason: "column_count" }); continue; }
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
        const icao24 = normalizeIcao24(row.icao);
        if (!icao24 || !/^mil$/i.test(row.cmpg) || !row.operator) { rejected.push({ line: index + 2, reason: !icao24 ? "invalid_icao24" : "not_military_reference" }); continue; }
        const record = {
            icao24,
            registration: /^(?:[?*-]+|unknown|n\/?a|none)$/i.test(row.registration) ? "" : String(row.registration || "").trim().toUpperCase(),
            operator: String(row.operator || "").trim(),
            model: String(row.type || "").trim(),
            aircraft_type: String(row["icao type"] || "").trim().toUpperCase(),
            classification: String(row.cmpg || "Mil").trim(),
            category: String(row.category || "").trim(),
            country: getAircraftAllocation(icao24)?.country || "",
            source: "plane-alert-db", source_url: String(row.link || "").trim() || provenance.source_url || DEFAULT_SOURCE_URL,
            source_version: provenance.version || "unversioned", checked_at: provenance.imported_at || null,
            verification_status: "reference_match", verified_at: null,
        };
        if (conflicted.has(icao24)) { duplicates.push({ line: index + 2, icao24, conflict: true }); continue; }
        if (records.has(icao24)) {
            const conflict = JSON.stringify(records.get(icao24)) !== JSON.stringify(record);
            duplicates.push({ line: index + 2, icao24, conflict });
            if (conflict) { records.delete(icao24); conflicted.add(icao24); }
        } else records.set(icao24, record);
    }
    return { records, validation: { input_rows: lines.length - 1, valid_ids: records.size, duplicates, rejected, conflicting_ids: [...conflicted] } };
}

export function parsePlaneAlertMilitaryCsv(csv = "") {
    return inspectPlaneAlertMilitaryCsv(csv).records;
}

async function fetchCsv(url, { fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: { Accept: "text/csv", "User-Agent": "stratops-warzone/1.0" },
        });
        if (!response.ok) {
            throw new ProviderRequestError(`HTTP ${response.status}`, { status: response.status });
        }
        return await response.text();
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new ProviderRequestError(`request timed out after ${timeoutMs}ms`, { code: "ETIMEDOUT" });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function cacheAge(filePath, now) {
    try {
        return Math.max(0, now - fs.statSync(filePath).mtimeMs);
    } catch {
        return Infinity;
    }
}

export function createPlaneAlertMilitaryDatabase({
    enabled = true,
    sourceUrl,
    cacheFile = DEFAULT_CACHE_FILE,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    fetchImpl,
    logger = console,
    initialCsv,
    bundledFile = BUNDLED_FILE,
} = {}) {
    let provenance = null;
    let records = initialCsv == null ? new Map() : parsePlaneAlertMilitaryCsv(initialCsv);
    let loaded = initialCsv != null;
    let loadedAt = initialCsv == null ? null : Date.now();
    const seeded = initialCsv != null;
    let lastRefreshAt = null;
    let lastFailure = null;
    let loadingPromise = null;

    async function initialize({ now = Date.now(), forceRefresh = false } = {}) {
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            if (!sourceUrl && !loaded) {
                if (!fs.existsSync(bundledFile)) throw new Error("Missing pinned military registry; deploy the bundled CSV and manifest");
                const bytes = fs.readFileSync(bundledFile);
                provenance = JSON.parse(fs.readFileSync(`${bundledFile}.manifest.json`, "utf8"));
                if (createHash("sha256").update(bytes).digest("hex") !== provenance.sha256) throw new Error("Bundled military registry checksum mismatch");
                records = inspectPlaneAlertMilitaryCsv(bytes.toString("utf8"), provenance).records;
                loaded = true; loadedAt = now;
            }
            if (!sourceUrl && loaded && !seeded) return records;
            const ttl = Math.max(60_000, Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS);
            const age = cacheFile ? cacheAge(cacheFile, now) : Infinity;
            if (!loaded && cacheFile && Number.isFinite(age)) {
                try {
                    const cachedCsv = fs.readFileSync(cacheFile, "utf8");
                    const hash = createHash("sha256").update(cachedCsv).digest("hex");
                    provenance = { version: `sha256:${hash}`, sha256: hash, source_url: "local-cache-unverified", imported_at: new Date(now - age).toISOString() };
                    records = inspectPlaneAlertMilitaryCsv(cachedCsv, provenance).records;
                    loaded = records.size > 0;
                    loadedAt = now - age;
                } catch {
                    // A failed local cache is followed by the normal remote refresh.
                }
            }
            if (!forceRefresh && loaded && (seeded || age < ttl)) return records;
            try {
                const csv = await fetchCsv(sourceUrl || DEFAULT_SOURCE_URL, { fetchImpl });
                const hash = createHash("sha256").update(csv).digest("hex");
                const refreshedProvenance = { version: `sha256:${hash}`, sha256: hash, source_url: sourceUrl, imported_at: new Date(now).toISOString() };
                const refreshed = inspectPlaneAlertMilitaryCsv(csv, refreshedProvenance).records;
                if (!refreshed.size) throw new ProviderRequestError("empty plane-alert military database", { code: "EBADRESPONSE" });
                records = refreshed;
                provenance = refreshedProvenance;
                loaded = true;
                loadedAt = now;
                lastRefreshAt = new Date(now).toISOString();
                lastFailure = null;
                if (cacheFile) {
                    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                    const temporaryPath = `${cacheFile}.tmp`;
                    fs.writeFileSync(temporaryPath, csv, "utf8");
                    fs.renameSync(temporaryPath, cacheFile);
                }
            } catch (error) {
                lastFailure = error?.message || String(error);
                if (!loaded) logger?.warn?.(`[adsb:plane_alert_db] DEGRADED ${lastFailure}`);
            }
            return records;
        })();
        try {
            return await loadingPromise;
        } finally {
            loadingPromise = null;
        }
    }

    function lookup(icaoValue) {
        return records.get(normalizeIcao24(icaoValue)) || null;
    }

    async function enrichObservations(observations = [], { now = Date.now() } = {}) {
        await initialize({ now });
        let matches = 0;
        const enriched = observations.map((observation) => {
            const record = lookup(observation?.icao24);
            if (!record) return observation;
            matches += 1;
            const metadataSources = new Set([...(observation.metadata_sources || []), "plane-alert-db"]);
            const identity = resolveAircraftIdentity(observation, { record });
            if (!identity.qualified) return { ...observation, metadata: { ...(observation.metadata || {}), aircraft_identity: identity } };
            return {
                ...observation,
                registration: observation.registration || record.registration,
                aircraft_type: observation.aircraft_type || record.aircraft_type,
                model: observation.model || record.model,
                operator: observation.operator || record.operator,
                military_hint: true,
                provider_military_flag: true,
                metadata_sources: [...metadataSources],
                metadata: {
                    ...(observation.metadata || {}),
                    military_identity_source: "plane-alert-db",
                    military_identity_license: "ODbL-1.0",
                    military_identity_category: record.category,
                    aircraft_identity: identity,
                },
            };
        });
        return {
            observations: enriched,
            diagnostics: {
                records: records.size,
                matches,
                loaded_at: loadedAt == null ? null : new Date(loadedAt).toISOString(),
                last_refresh_at: lastRefreshAt,
                last_failure: lastFailure,
            },
        };
    }

    return {
        id: "plane_alert_db",
        enabled: enabled === true,
        enrichmentOnly: true,
        staticIdentityOnly: true,
        disabledReason: enabled === true ? null : "DISABLED_BY_CONFIG",
        initialize,
        lookup,
        enrichObservations,
        getDiagnostics() {
            return { records: records.size, loaded_at: loadedAt, last_refresh_at: lastRefreshAt, last_failure: lastFailure, provenance };
        },
    };
}
