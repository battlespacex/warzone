import WebSocket from "ws";
import {
    navalDigits,
    navalNumber,
    navalObservedAt,
    navalText,
    normalizeNavalObservation,
} from "../normalize.js";

const DEFAULT_URL = "wss://stream.aisstream.io/v0/stream";
const GLOBAL_BOX = [[[-90, -180], [90, 180]]];
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 50_000;
const POSITION_MESSAGE_TYPES = new Set([
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "LongRangeAisBroadcastMessage",
]);
const STATIC_MESSAGE_TYPES = new Set(["ShipStaticData", "StaticDataReport"]);
const FILTER_MESSAGE_TYPES = [...POSITION_MESSAGE_TYPES, ...STATIC_MESSAGE_TYPES];
const stateByMmsi = new Map();

function validLatitude(value) {
    return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validLongitude(value) {
    return Number.isFinite(value) && value >= -180 && value <= 180;
}

function normalizedCorner(latitude, longitude) {
    const lat = navalNumber(latitude);
    const lon = navalNumber(longitude);
    if (!validLatitude(lat) || !validLongitude(lon)) {
        throw new TypeError(`Invalid AISStream bounding-box coordinate: ${latitude},${longitude}`);
    }
    return [lat, lon];
}

function normalizeBox(box) {
    if (Array.isArray(box) && box.length === 4 && box.every((value) => navalNumber(value) != null)) {
        const [minLon, minLat, maxLon, maxLat] = box.map(Number);
        const first = normalizedCorner(minLat, minLon);
        const second = normalizedCorner(maxLat, maxLon);
        if (minLat >= maxLat || minLon >= maxLon) throw new TypeError("AISStream bounding box must have increasing minimum and maximum coordinates");
        return [first, second];
    }
    if (Array.isArray(box) && box.length === 2 && box.every((corner) => Array.isArray(corner) && corner.length === 2)) {
        const first = normalizedCorner(box[0][0], box[0][1]);
        const second = normalizedCorner(box[1][0], box[1][1]);
        if (first[0] === second[0] || first[1] === second[1]) throw new TypeError("AISStream bounding box cannot have zero area");
        return [first, second];
    }
    throw new TypeError("AISStream bounding boxes must be [minLon,minLat,maxLon,maxLat] or [[[lat,lon],[lat,lon]]]");
}

export function normalizeAisStreamBoundingBoxes(value) {
    if (value === null || value === undefined || value === "") return GLOBAL_BOX;
    let parsed = value;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch (error) {
            throw new TypeError(`AISSTREAM_BOUNDING_BOXES_JSON is invalid JSON: ${error.message}`);
        }
    }
    if (!Array.isArray(parsed) || !parsed.length) throw new TypeError("AISStream requires at least one bounding box");
    if (parsed.length === 4 && parsed.every((item) => navalNumber(item) != null)) return [normalizeBox(parsed)];
    return parsed.map(normalizeBox);
}

export function pruneAisStreamCache(cache, now, ttlMs = DEFAULT_CACHE_TTL_MS, maxEntries = DEFAULT_CACHE_MAX_ENTRIES) {
    for (const [mmsi, state] of cache) {
        if (now - Number(state.updatedAt || 0) >= ttlMs) cache.delete(mmsi);
    }
    if (cache.size <= maxEntries) return;
    const oldest = [...cache.entries()].sort((a, b) => Number(a[1].updatedAt || 0) - Number(b[1].updatedAt || 0));
    for (const [mmsi] of oldest.slice(0, cache.size - maxEntries)) cache.delete(mmsi);
}

function messageMmsi(message, body, meta) {
    return navalDigits(meta.MMSI ?? meta.Mmsi ?? body?.UserID ?? body?.MMSI ?? message?.UserID);
}

function staticFields(body = {}, meta = {}) {
    const reportA = body.ReportA || {};
    const reportB = body.ReportB || {};
    return {
        vessel_name: navalText(body.Name ?? reportA.Name ?? meta.ShipName),
        country: navalText(body.Country ?? meta.Country),
        ship_type: body.Type ?? body.ShipType ?? reportB.ShipType ?? meta.ShipType ?? null,
        callsign: navalText(body.CallSign ?? reportB.CallSign ?? meta.CallSign),
        imo: navalDigits(body.ImoNumber ?? body.IMO ?? reportB.ImoNumber),
        operator: navalText(body.Operator ?? meta.Operator),
        nav_status: navalText(body.NavigationalStatus ?? meta.NavigationalStatus),
    };
}

function positionFields(body = {}, meta = {}) {
    return {
        latitude: navalNumber(body.Latitude ?? meta.latitude ?? meta.Latitude),
        longitude: navalNumber(body.Longitude ?? meta.longitude ?? meta.Longitude),
        speed_kts: navalNumber(body.Sog ?? body.SpeedOverGround ?? body.Speed),
        heading_deg: navalNumber(body.TrueHeading ?? body.Heading ?? body.Cog),
        course_deg: navalNumber(body.Cog ?? body.CourseOverGround ?? body.Course),
        nav_status: navalText(body.NavigationalStatus ?? body.NavStatus),
        ship_type: body.ShipType ?? meta.ShipType ?? null,
        vessel_name: navalText(meta.ShipName),
        callsign: navalText(meta.CallSign),
        country: navalText(meta.Country),
        imo: navalDigits(meta.IMO ?? meta.ImoNumber),
    };
}

export function processAisStreamMessage(message, {
    now = Date.now(),
    cache = stateByMmsi,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
} = {}) {
    if (message?.error || message?.Error) {
        return { mmsi: "", observation: null, kind: "error", error: navalText(message.error ?? message.Error) };
    }
    const type = navalText(message?.MessageType);
    const body = message?.Message?.[type] || {};
    const meta = message?.MetaData || message?.Metadata || {};
    const mmsi = messageMmsi(message, body, meta);
    if (!mmsi) return { mmsi: "", observation: null, kind: "ignored" };

    const isPosition = POSITION_MESSAGE_TYPES.has(type);
    const isStatic = STATIC_MESSAGE_TYPES.has(type);
    if (!isPosition && !isStatic) return { mmsi, observation: null, kind: "other" };

    pruneAisStreamCache(cache, now, cacheTtlMs, cacheMaxEntries);
    const previous = cache.get(mmsi) || {};
    const update = isPosition ? positionFields(body, meta) : staticFields(body, meta);
    const messageObservedAt = navalObservedAt(meta.time_utc ?? meta.TimeUTC ?? meta.timestamp, now);
    const next = {
        ...previous,
        ...update,
        vessel_name: update.vessel_name || previous.vessel_name || "",
        country: update.country || previous.country || "",
        callsign: update.callsign || previous.callsign || "",
        imo: update.imo || previous.imo || "",
        operator: update.operator || previous.operator || "",
        nav_status: update.nav_status || previous.nav_status || "",
        ship_type: update.ship_type ?? previous.ship_type ?? null,
        positionObservedAt: isPosition ? messageObservedAt : (previous.positionObservedAt || null),
        updatedAt: now,
    };
    cache.set(mmsi, next);
    const observation = next.positionObservedAt
        ? normalizeNavalObservation("aisstream", {
            observed_at: next.positionObservedAt,
            mmsi,
            imo: next.imo,
            callsign: next.callsign,
            vessel_name: next.vessel_name,
            latitude: next.latitude,
            longitude: next.longitude,
            speed_kts: next.speed_kts,
            heading_deg: next.heading_deg,
            course_deg: next.course_deg,
            nav_status: next.nav_status,
            ship_type: next.ship_type,
            ship_type_code: next.ship_type,
            operator: next.operator,
            country: next.country,
            provider_military_flag: Number(next.ship_type) === 35,
            metadata: { message_type: type },
        }, { now })
        : null;
    return { mmsi, observation, kind: isPosition ? "position" : "static" };
}

function createSocket(url, allowInsecureTls, webSocketFactory) {
    if (webSocketFactory) return webSocketFactory(url, { rejectUnauthorized: !allowInsecureTls });
    return allowInsecureTls ? new WebSocket(url, { rejectUnauthorized: false }) : new WebSocket(url);
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createAisStreamProvider({
    enabled,
    apiKey,
    baseUrl = DEFAULT_URL,
    boundingBoxes,
    diagnosticWindowMs = 15_000,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    allowInsecureTlsFallback = false,
    webSocketFactory,
    logger = console,
} = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey);
    const boxes = configured ? normalizeAisStreamBoundingBoxes(boundingBoxes) : GLOBAL_BOX;
    const cache = stateByMmsi;
    const observations = new Map();
    const counters = { received: 0, position: 0, static: 0 };
    let socket = null;
    let connecting = null;
    let connected = false;
    let firstSnapshot = true;
    let subscriptionError = null;
    let shuttingDown = false;
    let subscriptionErrorLogged = "";

    const connectOnce = (insecure = false) => new Promise((resolve, reject) => {
        const candidate = createSocket(baseUrl || DEFAULT_URL, insecure, webSocketFactory);
        let opened = false;
        const failBeforeOpen = (error) => {
            if (!opened) reject(error);
        };
        candidate.on("open", () => {
            opened = true;
            socket = candidate;
            connected = true;
            candidate.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boxes, FilterMessageTypes: FILTER_MESSAGE_TYPES }));
            resolve();
        });
        candidate.on("message", (raw) => {
            counters.received += 1;
            let message;
            try {
                message = JSON.parse(raw.toString());
            } catch (error) {
                logger?.warn?.(`[ais:aisstream] INVALID_MESSAGE ${error.message}`);
                return;
            }
            const parsed = processAisStreamMessage(message, { cache, cacheTtlMs, cacheMaxEntries });
            if (parsed.kind === "error") {
                const error = new Error(`AISStream subscription error: ${parsed.error}`);
                error.code = "AISSTREAM_SUBSCRIPTION_ERROR";
                error.status = 400;
                subscriptionError = error;
                if (subscriptionErrorLogged !== parsed.error) {
                    subscriptionErrorLogged = parsed.error;
                    logger?.warn?.(`[ais:aisstream] SUBSCRIPTION_ERROR ${parsed.error}`);
                }
                firstSnapshot = true;
                connected = false;
                try { candidate.close(); } catch { /* provider health owns retry cadence */ }
                return;
            }
            if (parsed.kind === "position") counters.position += 1;
            if (parsed.kind === "static") counters.static += 1;
            if (parsed.observation) observations.set(parsed.mmsi, parsed.observation);
        });
        candidate.on("error", failBeforeOpen);
        candidate.on("close", () => {
            if (socket === candidate) socket = null;
            connected = false;
            if (!shuttingDown) firstSnapshot = true;
            if (!shuttingDown && !opened) failBeforeOpen(new Error("AISStream socket closed before opening"));
        });
    });

    const ensureConnected = async () => {
        if (connected && socket) return;
        if (connecting) return connecting;
        connecting = (async () => {
            try {
                await connectOnce(false);
            } catch (error) {
                const expired = /certificate has expired/i.test(String(error?.message || error));
                if (!allowInsecureTlsFallback || !expired) throw error;
                await connectOnce(true);
            } finally {
                connecting = null;
            }
        })();
        return connecting;
    };

    return {
        id: "aisstream",
        enabled: configured,
        disabledReason: requested && !apiKey ? "MISSING_CREDENTIALS" : "DISABLED_BY_CONFIG",
        minimumIntervalMs: 0,
        async fetchObservations() {
            const baseline = { ...counters };
            subscriptionError = null;
            await ensureConnected();
            if (firstSnapshot) {
                firstSnapshot = false;
                await delay(Math.max(100, Number(diagnosticWindowMs) || 15_000));
            }
            if (subscriptionError) throw subscriptionError;
            if (!connected) {
                const error = new Error("AISStream socket disconnected");
                error.code = "AISSTREAM_DISCONNECTED";
                throw error;
            }
            pruneAisStreamCache(cache, Date.now(), cacheTtlMs, cacheMaxEntries);
            const activeMmsi = new Set(cache.keys());
            for (const mmsi of observations.keys()) {
                if (!activeMmsi.has(mmsi)) observations.delete(mmsi);
            }
            const items = [...observations.values()];
            return {
                observations: items,
                diagnostics: {
                    connected,
                    received: counters.received - baseline.received,
                    position: counters.position - baseline.position,
                    static: counters.static - baseline.static,
                    unique_mmsi: activeMmsi.size,
                    candidates: items.length,
                },
            };
        },
        shutdown() {
            shuttingDown = true;
            connected = false;
            try { socket?.close(); } catch { /* ignore controlled shutdown errors */ }
            socket = null;
        },
    };
}

export function resetAisStreamCache() {
    stateByMmsi.clear();
}
