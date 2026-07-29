import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=JSON";
const CELESTRAK_SATCAT_URL = "https://celestrak.org/pub/satcat.csv";
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const GP_MAX_BYTES = 8 * 1024 * 1024;
const SATCAT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_RECORDS = 2000;
const CACHE_FILE = process.env.STRATOPS_SATELLITE_CACHE_PATH
    || join(__dirname, "..", ".cache", "strategic-satellites-military.json");
const CURATION_FILE = join(__dirname, "config", "strategic-satellite-catalog.json");

const OWNER_NAMES = {
    AB: "Arab Satellite Communications Organization",
    CA: "Canada",
    CIS: "Commonwealth of Independent States",
    ESA: "European Space Agency",
    FR: "France",
    GER: "Germany",
    IND: "India",
    IRAN: "Iran",
    ISR: "Israel",
    IT: "Italy",
    JPN: "Japan",
    NATO: "NATO",
    PRC: "China",
    ROK: "South Korea",
    RUS: "Russia",
    UK: "United Kingdom",
    UKR: "Ukraine",
    US: "United States",
};

const OPS_STATUS = {
    "+": "Operational",
    "-": "Non-operational",
    P: "Partially operational",
    B: "Backup or standby",
    S: "Spare",
    X: "Extended mission",
    D: "Decayed",
    "?": "Unknown",
};

let memoryCache = null;
let diskCacheLoaded = false;
let inflightRefresh = null;
let lastAttemptMs = 0;
let nextRetryMs = 0;
let failureCount = 0;
let lastLoggedFailure = "";
let curatedCatalog = null;

class UpstreamStatusError extends Error {
    constructor(url, status) {
        super(`CelesTrak returned HTTP ${status}`);
        this.name = "UpstreamStatusError";
        this.url = url;
        this.status = status;
    }
}

function nowIso() {
    return new Date().toISOString();
}

function toIso(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanText(value, fallback = "") {
    return String(value ?? fallback)
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function cleanNullableText(value) {
    const text = cleanText(value, "");
    return text || null;
}

function cleanCatalogId(value) {
    const text = String(value ?? "").trim();
    return /^\d+$/.test(text) ? text : "";
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function ageSeconds(isoValue) {
    const ms = Date.parse(isoValue || "");
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

function createBackoffMs(attempt) {
    const base = 5 * 60 * 1000;
    const exponential = Math.min(2 * 60 * 60 * 1000, base * (2 ** Math.max(0, attempt - 1)));
    const jitter = Math.floor(Math.random() * Math.min(5 * 60 * 1000, exponential * 0.25));
    return exponential + jitter;
}

async function readTextLimited(url, { accept, maxBytes, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                accept: accept || "application/json,text/plain;q=0.8,*/*;q=0.5",
                "user-agent": "StratOps-OrbitalAssets/1.0",
            },
            redirect: "follow",
        });
        if (!response.ok) {
            throw new UpstreamStatusError(url, response.status);
        }
        const length = Number(response.headers.get("content-length") || 0);
        if (Number.isFinite(length) && length > maxBytes) {
            throw new Error("CelesTrak response exceeded configured size limit");
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
            throw new Error("CelesTrak response exceeded configured size limit");
        }
        return buffer.toString("utf8");
    } finally {
        clearTimeout(timeout);
    }
}

async function readJsonLimited(url, options) {
    const text = await readTextLimited(url, { ...options, accept: "application/json" });
    return JSON.parse(text);
}

function parseCsvLine(line = "") {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\"") {
            if (quoted && line[index + 1] === "\"") {
                current += "\"";
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (char === "," && !quoted) {
            cells.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    cells.push(current);
    return cells;
}

function parseSatcatCsv(csv = "") {
    const lines = String(csv || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return new Map();
    const headers = parseCsvLine(lines[0]).map((header) => cleanText(header));
    const map = new Map();
    for (const line of lines.slice(1)) {
        const values = parseCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = cleanText(values[index] ?? "");
        });
        const noradId = cleanCatalogId(row.NORAD_CAT_ID);
        if (noradId) map.set(noradId, row);
    }
    return map;
}

async function readCuratedCatalog() {
    if (curatedCatalog) return curatedCatalog;
    try {
        const raw = await readFile(CURATION_FILE, "utf8");
        const parsed = JSON.parse(raw);
        curatedCatalog = new Map(
            (Array.isArray(parsed) ? parsed : [])
                .map((item) => [cleanCatalogId(item?.noradId), item])
                .filter(([key]) => key)
        );
    } catch {
        curatedCatalog = new Map();
    }
    return curatedCatalog;
}

function missionRuleForRecord(record = {}, satcat = {}) {
    const text = `${record.OBJECT_NAME || ""} ${satcat.OBJECT_NAME || ""}`.toUpperCase();
    const rules = [
        { re: /\b(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|QZSS|IRNSS|SBAS)\b/, mission: "Public navigation", association: "dual-use", confidence: "confirmed-public-classification" },
        { re: /\b(AEHF|WGS|MILSTAR|DSCS|SKYNET|SICRAL|SYRACUSE|MUOS|XTAR)\b/, mission: "Communications", association: "known-military-associated", confidence: "inferred" },
        { re: /\b(SBIRS|DSP|EKS|OKO)\b/, mission: "Early warning", association: "known-military-associated", confidence: "inferred" },
        { re: /\b(SAR|RADARSAT|TERRASAR|TANDEM|COSMO|SKYMED|ICEYE|CAPELLA)\b/, mission: "Radar imaging", association: "dual-use", confidence: "inferred" },
        { re: /\b(LACROSSE|ONYX|TOPAZ|YAOGAN|GAOFEN|OFEC|OPTUS|NROL|USA)\b/, mission: "Mission unconfirmed", association: "likely-military-associated", confidence: "inferred" },
        { re: /\b(ELINT|SIGINT|MENTOR|TRUMPET|ORION)\b/, mission: "Signals intelligence", association: "likely-military-associated", confidence: "inferred" },
        { re: /\b(TECH|EXPERIMENT|DEMO|TACSAT|MICROSAT)\b/, mission: "Technology demonstration", association: "dual-use", confidence: "inferred" },
    ];
    return rules.find((rule) => rule.re.test(text)) || null;
}

function labelToKey(value = "") {
    return cleanText(value, "mission unconfirmed").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeConfidence(value = "") {
    const text = cleanText(value).toLowerCase();
    if (text === "confirmed-public" || text === "confirmed public classification") return "confirmed-public-classification";
    if (text === "high-confidence-public-association") return "high-confidence-public-association";
    if (text === "inferred") return "inferred";
    if (text === "unconfirmed") return "unconfirmed";
    return "high-confidence-public-association";
}

function confidenceLabel(value = "") {
    switch (normalizeConfidence(value)) {
        case "confirmed-public-classification":
            return "Confirmed public classification";
        case "high-confidence-public-association":
            return "High-confidence public association";
        case "inferred":
            return "Inferred";
        default:
            return "Unconfirmed";
    }
}

function associationLabel(value = "") {
    switch (labelToKey(value)) {
        case "known-military-associated":
        case "military-associated":
            return "Known military-associated";
        case "dual-use":
            return "Dual-use";
        case "likely-military-associated":
            return "Likely military-associated";
        default:
            return "Military-associated";
    }
}

function getClassification(record = {}, satcat = {}, override = null) {
    if (override) {
        const mission = cleanText(override.mission, "Mission unconfirmed") || "Mission unconfirmed";
        const association = cleanText(override.association, "military-associated");
        const confidence = normalizeConfidence(override.confidence || "confirmed-public");
        return {
            association: labelToKey(association),
            associationLabel: associationLabel(association),
            mission: labelToKey(mission),
            missionLabel: mission,
            confidence,
            confidenceLabel: confidenceLabel(confidence),
            inferred: confidence === "inferred",
            sourceNote: cleanText(override.sourceNote, "Verified curated public record"),
        };
    }

    const rule = missionRuleForRecord(record, satcat);
    if (rule) {
        return {
            association: labelToKey(rule.association),
            associationLabel: associationLabel(rule.association),
            mission: labelToKey(rule.mission),
            missionLabel: rule.mission,
            confidence: normalizeConfidence(rule.confidence),
            confidenceLabel: confidenceLabel(rule.confidence),
            inferred: true,
            sourceNote: "Classification inferred from public name/operator patterns; mission may be incomplete.",
        };
    }

    return {
        association: "likely-military-associated",
        associationLabel: "Likely military-associated",
        mission: "mission-unconfirmed",
        missionLabel: "Mission unconfirmed",
        confidence: "high-confidence-public-association",
        confidenceLabel: "High-confidence public association",
        inferred: false,
        sourceNote: "Listed in CelesTrak military GP group; mission not independently confirmed by StratOps.",
    };
}

function calculateOrbitClass(record = {}, satcat = {}) {
    const meanMotion = toFiniteNumber(record.MEAN_MOTION);
    const eccentricity = toFiniteNumber(record.ECCENTRICITY) ?? 0;
    const apogee = toFiniteNumber(satcat.APOGEE);
    const perigee = toFiniteNumber(satcat.PERIGEE);
    const avgAltitudeKm = Number.isFinite(apogee) && Number.isFinite(perigee)
        ? (apogee + perigee) / 2
        : null;
    if (Number.isFinite(avgAltitudeKm)) {
        if (avgAltitudeKm < 2000) return "LEO";
        if (avgAltitudeKm < 35700) return eccentricity > 0.2 ? "HEO" : "MEO";
        if (avgAltitudeKm <= 37000) return "GEO / near-GEO";
        if (eccentricity > 0.2) return "HEO";
    }
    if (!Number.isFinite(meanMotion) || meanMotion <= 0) return "Other / unclassified orbit";
    if (meanMotion >= 11) return "LEO";
    if (meanMotion >= 2) return eccentricity > 0.2 ? "HEO" : "MEO";
    if (meanMotion >= 0.8 && meanMotion <= 1.2) return "GEO / near-GEO";
    if (eccentricity > 0.2) return "HEO";
    return "Other / unclassified orbit";
}

function pickOmmFields(record = {}) {
    const keys = [
        "OBJECT_NAME",
        "OBJECT_ID",
        "EPOCH",
        "MEAN_MOTION",
        "ECCENTRICITY",
        "INCLINATION",
        "RA_OF_ASC_NODE",
        "ARG_OF_PERICENTER",
        "MEAN_ANOMALY",
        "EPHEMERIS_TYPE",
        "CLASSIFICATION_TYPE",
        "NORAD_CAT_ID",
        "ELEMENT_SET_NO",
        "REV_AT_EPOCH",
        "BSTAR",
        "MEAN_MOTION_DOT",
        "MEAN_MOTION_DDOT",
    ];
    return keys.reduce((output, key) => {
        if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
            output[key] = record[key];
        }
        return output;
    }, {});
}

function isValidGpRecord(record = {}) {
    const requiredNumeric = [
        "MEAN_MOTION",
        "ECCENTRICITY",
        "INCLINATION",
        "RA_OF_ASC_NODE",
        "ARG_OF_PERICENTER",
        "MEAN_ANOMALY",
    ];
    return (
        cleanCatalogId(record.NORAD_CAT_ID) &&
        toIso(record.EPOCH) &&
        requiredNumeric.every((key) => Number.isFinite(Number(record[key])))
    );
}

function normalizeSatelliteRecord(record = {}, satcat = {}, override = null) {
    const noradId = cleanCatalogId(record.NORAD_CAT_ID);
    if (!noradId || !isValidGpRecord(record)) return null;

    const ownerCode = cleanNullableText(satcat.OWNER);
    const displayName = cleanNullableText(override?.displayName)
        || cleanNullableText(record.OBJECT_NAME)
        || cleanNullableText(satcat.OBJECT_NAME)
        || `NORAD ${noradId}`;
    const classification = getClassification(record, satcat, override);
    const opsCode = cleanNullableText(satcat.OPS_STATUS_CODE);
    const launchDate = cleanNullableText(satcat.LAUNCH_DATE);
    const sourceEpoch = toIso(record.EPOCH);

    return {
        id: `sat-${noradId}`,
        name: displayName,
        objectName: cleanNullableText(record.OBJECT_NAME) || displayName,
        noradId,
        internationalDesignator: cleanNullableText(record.OBJECT_ID || satcat.OBJECT_ID),
        ownerCode: cleanNullableText(override?.country) || ownerCode,
        country: cleanNullableText(override?.country) || (ownerCode ? OWNER_NAMES[ownerCode] || ownerCode : null),
        operator: cleanNullableText(override?.operator),
        launchDate: /^\d{4}-\d{2}-\d{2}$/.test(launchDate || "") ? launchDate : null,
        operationalStatus: opsCode ? OPS_STATUS[opsCode] || "Unknown" : null,
        operationalStatusCode: opsCode,
        orbitClass: calculateOrbitClass(record, satcat),
        classification,
        orbital: {
            epoch: sourceEpoch,
            meanMotion: toFiniteNumber(record.MEAN_MOTION),
            eccentricity: toFiniteNumber(record.ECCENTRICITY),
            inclinationDeg: toFiniteNumber(record.INCLINATION),
            rightAscensionDeg: toFiniteNumber(record.RA_OF_ASC_NODE),
            argumentOfPerigeeDeg: toFiniteNumber(record.ARG_OF_PERICENTER),
            meanAnomalyDeg: toFiniteNumber(record.MEAN_ANOMALY),
            periodMinutes: toFiniteNumber(record.MEAN_MOTION)
                ? 1440 / Math.max(0.000001, Number(record.MEAN_MOTION))
                : null,
        },
        omm: pickOmmFields(record),
    };
}

function calculateSourceEpoch(records = []) {
    const epochs = records
        .map((record) => Date.parse(record?.orbital?.epoch || ""))
        .filter(Number.isFinite);
    if (!epochs.length) return null;
    return new Date(Math.max(...epochs)).toISOString();
}

function withCacheStatus(payload, status = "current", errorMessage = "") {
    const fetchedAt = payload?.fetchedAt || null;
    const cacheAgeSeconds = ageSeconds(fetchedAt);
    const stale = cacheAgeSeconds !== null && cacheAgeSeconds > Math.floor(STALE_AFTER_MS / 1000);
    return {
        ...payload,
        cacheAgeSeconds,
        stale,
        sourceStatus: stale ? "stale" : status,
        statusMessage: errorMessage || (stale ? "Using cached public orbital data" : "Current public orbital data"),
        nextRefreshAt: fetchedAt
            ? new Date(Date.parse(fetchedAt) + CACHE_TTL_MS).toISOString()
            : null,
    };
}

async function loadDiskCache() {
    if (diskCacheLoaded) return memoryCache;
    diskCacheLoaded = true;
    try {
        const raw = await readFile(CACHE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.source === "CelesTrak" && Array.isArray(parsed.satellites)) {
            memoryCache = parsed;
        }
    } catch {
        // No local cache yet.
    }
    return memoryCache;
}

async function saveDiskCache(payload) {
    try {
        await mkdir(dirname(CACHE_FILE), { recursive: true });
        await writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
    } catch {
        // Disk cache failure should not break the API response.
    }
}

async function fetchSatcatMap() {
    try {
        const csv = await readTextLimited(CELESTRAK_SATCAT_URL, {
            accept: "text/csv,text/plain;q=0.8,*/*;q=0.5",
            maxBytes: SATCAT_MAX_BYTES,
        });
        return parseSatcatCsv(csv);
    } catch {
        return new Map();
    }
}

async function refreshSatellitePayload({ logger = console } = {}) {
    const [records, satcatMap, curated] = await Promise.all([
        readJsonLimited(CELESTRAK_GP_URL, { maxBytes: GP_MAX_BYTES }),
        fetchSatcatMap(),
        readCuratedCatalog(),
    ]);
    if (!Array.isArray(records)) {
        throw new Error("CelesTrak military GP payload was not an array");
    }
    const normalized = records
        .map((record) => {
            const noradId = cleanCatalogId(record?.NORAD_CAT_ID);
            const satcat = noradId ? satcatMap.get(noradId) || {} : {};
            return normalizeSatelliteRecord(record, satcat, noradId ? curated.get(noradId) : null);
        })
        .filter(Boolean)
        .slice(0, MAX_RESPONSE_RECORDS);

    const fetchedAt = nowIso();
    const payload = {
        source: "CelesTrak",
        sourceType: "public-orbital-elements",
        sourceUrl: CELESTRAK_GP_URL,
        satcatUrl: CELESTRAK_SATCAT_URL,
        fetchedAt,
        sourceEpoch: calculateSourceEpoch(normalized),
        recordCount: normalized.length,
        count: normalized.length,
        maxResponseRecords: MAX_RESPONSE_RECORDS,
        cachePolicy: {
            minimumFetchIntervalSeconds: Math.floor(CACHE_TTL_MS / 1000),
            staleAfterSeconds: Math.floor(STALE_AFTER_MS / 1000),
        },
        satellites: normalized,
    };

    memoryCache = payload;
    failureCount = 0;
    nextRetryMs = 0;
    lastLoggedFailure = "";
    await saveDiskCache(payload);
    logger.log?.(`[satellites] CelesTrak military GP cache refreshed count=${payload.count}`);
    return withCacheStatus(payload, "current");
}

function shouldRefresh(payload, forceRefresh = false) {
    if (forceRefresh) return true;
    if (!payload?.fetchedAt) return true;
    const fetchedMs = Date.parse(payload.fetchedAt);
    return !Number.isFinite(fetchedMs) || (Date.now() - fetchedMs) >= CACHE_TTL_MS;
}

function logRefreshFailure(error, logger = console) {
    const statusPart = error instanceof UpstreamStatusError ? `http_${error.status}` : error?.name || "error";
    const message = cleanText(error?.message || "unknown error").slice(0, 220);
    const key = `${statusPart}:${message}`;
    if (key === lastLoggedFailure && Date.now() < nextRetryMs) return;
    lastLoggedFailure = key;
    logger.warn?.(`[satellites] CelesTrak refresh failed code=${statusPart} message=${message}`);
}

export async function getMilitarySatellitePayload({ forceRefresh = false, logger = console } = {}) {
    const cached = await loadDiskCache();
    if (cached && !shouldRefresh(cached, forceRefresh)) {
        return withCacheStatus(cached, "cached");
    }

    if (!forceRefresh && nextRetryMs > Date.now()) {
        if (cached) {
            return withCacheStatus(cached, "cached", "Using cached public orbital data");
        }
        return {
            source: "CelesTrak",
            sourceType: "public-orbital-elements",
            sourceUrl: CELESTRAK_GP_URL,
            fetchedAt: null,
            sourceEpoch: null,
            cacheAgeSeconds: null,
            stale: true,
            sourceStatus: "unavailable",
            statusMessage: "Orbital data temporarily unavailable",
            count: 0,
            recordCount: 0,
            satellites: [],
        };
    }

    if (!inflightRefresh) {
        lastAttemptMs = Date.now();
        inflightRefresh = refreshSatellitePayload({ logger })
            .catch((error) => {
                failureCount += 1;
                nextRetryMs = Date.now() + createBackoffMs(failureCount);
                logRefreshFailure(error, logger);
                if (memoryCache) {
                    return withCacheStatus(memoryCache, "cached", "Using cached public orbital data");
                }
                throw error;
            })
            .finally(() => {
                inflightRefresh = null;
            });
    }

    try {
        return await inflightRefresh;
    } catch {
        return {
            source: "CelesTrak",
            sourceType: "public-orbital-elements",
            sourceUrl: CELESTRAK_GP_URL,
            fetchedAt: null,
            sourceEpoch: null,
            cacheAgeSeconds: null,
            stale: true,
            sourceStatus: "unavailable",
            statusMessage: "Orbital data temporarily unavailable",
            count: 0,
            recordCount: 0,
            satellites: [],
            lastAttemptAt: toIso(lastAttemptMs),
        };
    }
}

export function getStrategicSatelliteSourceConfig() {
    return {
        endpoint: "/api/satellites/military",
        gpQuery: CELESTRAK_GP_URL,
        satcatQuery: CELESTRAK_SATCAT_URL,
        minimumFetchIntervalSeconds: Math.floor(CACHE_TTL_MS / 1000),
        staleAfterSeconds: Math.floor(STALE_AFTER_MS / 1000),
        maximumResponseRecords: MAX_RESPONSE_RECORDS,
    };
}
