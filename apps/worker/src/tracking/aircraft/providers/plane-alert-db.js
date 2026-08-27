import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

import { ProviderRequestError } from "../../http.js";
import { normalizeIcao24 } from "./skylink.js";

const DEFAULT_SOURCE_URL = "https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/plane-alert-mil.csv";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_FILE = path.resolve(moduleDirectory, "../../../../.cache/plane-alert-mil.csv");

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
    return values;
}

export function parsePlaneAlertMilitaryCsv(csv = "") {
    const records = new Map();
    const lines = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return records;
    const headers = parseCsvRow(lines[0]).map((header) => header.replace(/^[$#]+/, "").trim().toLowerCase());
    for (const line of lines.slice(1)) {
        const values = parseCsvRow(line);
        const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
        const icao24 = normalizeIcao24(row.icao);
        if (!icao24) continue;
        records.set(icao24, {
            icao24,
            registration: String(row.registration || "").trim().toUpperCase(),
            operator: String(row.operator || "").trim(),
            model: String(row.type || "").trim(),
            aircraft_type: String(row["icao type"] || "").trim().toUpperCase(),
            classification: String(row.cmpg || "Mil").trim(),
            category: String(row.category || "").trim(),
        });
    }
    return records;
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
    sourceUrl = DEFAULT_SOURCE_URL,
    cacheFile = DEFAULT_CACHE_FILE,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    fetchImpl,
    logger = console,
    initialCsv,
} = {}) {
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
            const ttl = Math.max(60_000, Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS);
            const age = cacheFile ? cacheAge(cacheFile, now) : Infinity;
            if (!loaded && cacheFile && Number.isFinite(age)) {
                try {
                    records = parsePlaneAlertMilitaryCsv(fs.readFileSync(cacheFile, "utf8"));
                    loaded = records.size > 0;
                    loadedAt = now - age;
                } catch {
                    // A failed local cache is followed by the normal remote refresh.
                }
            }
            if (!forceRefresh && loaded && (seeded || age < ttl)) return records;
            try {
                const csv = await fetchCsv(sourceUrl, { fetchImpl });
                const refreshed = parsePlaneAlertMilitaryCsv(csv);
                if (!refreshed.size) throw new ProviderRequestError("empty plane-alert military database", { code: "EBADRESPONSE" });
                records = refreshed;
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
            return { records: records.size, loaded_at: loadedAt, last_refresh_at: lastRefreshAt, last_failure: lastFailure };
        },
    };
}
