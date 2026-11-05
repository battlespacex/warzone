const SOURCE_URL = "https://api.gpsinterference.com/v1/interference";
const SOURCE_LABEL = "GPSInterference.com / adsb.lol globe history";
const CACHE_MS = 60_000; // The provider's latest-map Cache-Control max-age.
const FAILURE_COOLDOWN_MS = 5 * 60_000;
const MAX_RESPONSE_CHARS = 16_000_000;
const MAX_SOURCE_HEXES = 30_000;
const MAX_REGION_CELLS = 12_000;

function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeHex(hex, observedAt, updatedAt) {
    const cellId = String(hex?.h || "");
    const polygon = Array.isArray(hex?.poly) ? hex.poly.map((point) => {
        const lat = Number(point?.[0]);
        const lon = Number(point?.[1]);
        return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
            ? { lat, lon } : null;
    }).filter(Boolean) : [];
    if (!cellId || polygon.length < 6 || polygon.length > 8) return null;
    if (polygon.length > 6 && polygon[0].lat === polygon.at(-1).lat && polygon[0].lon === polygon.at(-1).lon) polygon.pop();
    if (polygon.length !== 6) return null;
    const good = Number(hex.g), affected = Number(hex.b), percent = Number(hex.p);
    if (![good, affected, percent].every(Number.isFinite) || good < 0 || affected < 0 || percent < 0 || percent > 100) return null;
    // Preserve the source's published colour classification. It includes evidence thresholds.
    const severity = ({ g: "low", y: "medium", r: "high", p: "severe" })[hex.c];
    if (!severity) return null;
    const lat = polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length;
    const lon = polygon.reduce((sum, point) => sum + point.lon, 0) / polygon.length;
    return {
        id: "gpsinterference:" + cellId, cellId, lat, lon, polygon, severity,
        affectedPercent: percent, sampleCount: good + affected,
        affectedAircraftCount: affected, goodAircraftCount: good,
        observationPeriod: observedAt, observedAt, updatedAt,
        classification: "Observed GNSS degradation", sourceLabel: SOURCE_LABEL,
        sourceUrl: "https://gpsinterference.com/docs", sourceId: "gpsinterference",
        detectionLimitations: "Low ADS-B position accuracy does not prove deliberate jamming or locate a transmitter. Coverage varies with flights and receivers.",
        isDemo: false,
    };
}

function intersectsBounds(cell, bounds) {
    if (!bounds) return true;
    const { minLat, maxLat, minLon, maxLon } = bounds;
    if (![minLat, maxLat, minLon, maxLon].every(Number.isFinite) || minLat > maxLat || minLon > maxLon) return false;
    const p = cell.polygon;
    const cellMinLon = Math.min(...p.map((v) => v.lon));
    const cellMaxLon = Math.max(...p.map((v) => v.lon));
    const longitudeOverlaps = cellMaxLon - cellMinLon > 180
        ? maxLon >= cellMaxLon || minLon <= cellMinLon
        : cellMaxLon >= minLon && cellMinLon <= maxLon;
    return Math.max(...p.map((v) => v.lat)) >= minLat && Math.min(...p.map((v) => v.lat)) <= maxLat
        && longitudeOverlaps;
}

export function selectGpsInterferenceRegion(snapshot, { bounds = null, limit = MAX_REGION_CELLS } = {}) {
    const regionCells = snapshot.cells.filter((cell) => intersectsBounds(cell, bounds));
    const severityCounts = { low: 0, medium: 0, high: 0, severe: 0 };
    for (const cell of regionCells) severityCounts[cell.severity] += 1;
    const boundedLimit = Math.max(1, Math.min(MAX_REGION_CELLS, Math.floor(Number(limit) || MAX_REGION_CELLS)));
    // If the bounded response is exceeded, retain the highest-signal cells first.
    const rank = { severe: 0, high: 1, medium: 2, low: 3 };
    const selected = regionCells.length > boundedLimit
        ? regionCells.slice().sort((a, b) => rank[a.severity] - rank[b.severity] || a.cellId.localeCompare(b.cellId)).slice(0, boundedLimit)
        : regionCells;
    const message = snapshot.message || (snapshot.stale ? "Showing the last cached GNSS observation; provider refresh is unavailable." : "");
    const capMessage = selected.length < regionCells.length
        ? `Map display bounded to ${selected.length} of ${regionCells.length} regional cells; severity counts include all regional cells.` : "";
    return {
        cells: selected, totalCells: regionCells.length, severityCounts,
        truncated: selected.length < regionCells.length,
        updatedAt: snapshot.updatedAt, observationPeriod: snapshot.observationPeriod,
        coverageHours: snapshot.coverageHours,
        sourceMode: "gpsinterference", sourceHealth: snapshot.sourceHealth || (snapshot.stale ? "stale" : "Available"),
        sourceLabel: SOURCE_LABEL, sourceUrl: "https://gpsinterference.com/docs",
        demoMode: false, liveAvailable: !snapshot.stale && snapshot.sourceHealth !== "unavailable", tableAvailable: false,
        message: [message, capMessage].filter(Boolean).join(" "),
    };
}

const DAY_MS = 86_400_000;
const ROLLING_PERIOD_HOURS = { "24h": 24, "48h": 48, "72h": 72 };

// The provider publishes whole UTC flight days, without timestamps for individual hexes.
// A day crossing the rolling cutoff cannot be counted as a precise observation.
export async function getRollingGpsInterferenceSnapshot(period, { getSnapshot = getGpsInterferenceSnapshot, now = () => Date.now() } = {}) {
    const hours = ROLLING_PERIOD_HOURS[period];
    if (!hours) throw new Error("Invalid GNSS observation period");
    const end = now();
    const start = end - hours * 3_600_000;
    const todayStart = Math.floor(end / DAY_MS) * DAY_MS;
    const firstDay = Math.ceil(start / DAY_MS) * DAY_MS;
    const dates = [];
    for (let day = firstDay; day < todayStart; day += DAY_MS) dates.push(new Date(day).toISOString().slice(0, 10));
    const snapshots = await Promise.all(dates.map((date) => getSnapshot(date)));
    const latestByCell = new Map();
    let coverageHours = 0;
    let stale = false;
    let updatedAt = null;
    snapshots.forEach((snapshot, index) => {
        if (!snapshot || snapshot.observationPeriod !== dates[index] || snapshot.windowMinutes !== 1440 || snapshot.complete === false) return;
        coverageHours += 24;
        stale ||= snapshot.stale === true;
        updatedAt = snapshot.updatedAt || updatedAt;
        for (const cell of snapshot.cells) latestByCell.set(cell.cellId, cell);
    });
    const unavailable = coverageHours === 0;
    const partial = coverageHours < hours;
    return {
        cells: [...latestByCell.values()], updatedAt, stale,
        observationPeriod: `Last ${hours}h / ${coverageHours / 24} UTC day${coverageHours === 24 ? "" : "s"}`,
        sourceHealth: unavailable ? "unavailable" : stale ? "stale" : partial ? "partial" : "Available",
        message: unavailable
            ? `No full UTC flight-day summary is available entirely inside the last ${hours} hours. Overlapping daily summaries cannot be split into precise rolling observations because the provider supplies no per-hexagon timestamps.`
            : `${partial ? "Partial" : "Full"} daily-summary coverage: ${coverageHours / 24} full UTC day${coverageHours === 24 ? "" : "s"} inside the last ${hours} hours. This is not continuous per-hexagon observation coverage; the latest summary per hexagon is shown.${stale ? " A cached summary is shown because provider refresh failed." : ""}`,
        coverageHours, requestedPeriod: period,
    };
}

export function createGpsInterferenceService({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    const cache = new Map();
    const pending = new Map();
    const retryAt = new Map();
    return async function getSnapshot(date = "latest") {
        if (date !== "latest" && !validDate(date)) throw new Error("Invalid GNSS observation date");
        const key = date;
        const cached = cache.get(key);
        if (cached && now() < cached.expiresAt) return { ...cached.snapshot, stale: false };
        if (now() < (retryAt.get(key) || 0)) return cached ? { ...cached.snapshot, stale: true } : null;
        if (pending.has(key)) return pending.get(key);
        const request = (async () => {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15_000);
                let raw;
                try {
                    const response = await fetchImpl(SOURCE_URL + "/" + encodeURIComponent(date), {
                        signal: controller.signal, headers: { accept: "application/json" },
                    });
                    if (!response.ok) throw new Error("GNSS provider HTTP " + response.status);
                    raw = await response.text();
                } finally { clearTimeout(timer); }
                if (raw.length > MAX_RESPONSE_CHARS) throw new Error("GNSS provider response too large");
                const payload = JSON.parse(raw);
                if (!Array.isArray(payload.hexes) || payload.hexes.length > MAX_SOURCE_HEXES) throw new Error("Invalid GNSS provider cells");
                const updatedAt = String(payload.updated || "");
                const observationPeriod = validDate(payload.history_date) ? payload.history_date : validDate(date) ? date : "";
                if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("Invalid GNSS provider timestamp");
                const seen = new Set();
                const cells = [];
                for (const hex of payload.hexes) {
                    const cell = normalizeHex(hex, observationPeriod, updatedAt);
                    if (!cell || seen.has(cell.cellId)) continue;
                    seen.add(cell.cellId);
                    cells.push(cell);
                }
                const snapshot = { cells, updatedAt, observationPeriod, stale: false,
                    windowMinutes: Number(payload.window_minutes), complete: payload.complete !== false };
                cache.set(key, { snapshot, expiresAt: now() + (date === "latest" ? CACHE_MS : 86_400_000) });
                while (cache.size > 2) cache.delete(cache.keys().next().value);
                retryAt.delete(key);
                return snapshot;
            } catch {
                retryAt.set(key, now() + FAILURE_COOLDOWN_MS);
                return cached ? { ...cached.snapshot, stale: true } : null;
            } finally { pending.delete(key); }
        })();
        pending.set(key, request);
        return request;
    };
}

export const getGpsInterferenceSnapshot = createGpsInterferenceService();
