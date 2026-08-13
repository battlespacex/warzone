import WebSocket from "ws";

const DEFAULT_URL = "wss://stream.aisstream.io/v0/stream";
const GLOBAL_BOX = [[[-90, -180], [90, 180]]];
const CACHE_TTL_MS = 30 * 60 * 1000;
const stateByMmsi = new Map();

function string(value) {
    return String(value || "").trim();
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function pruneCache(now) {
    for (const [mmsi, state] of stateByMmsi) {
        if (now - state.updatedAt > CACHE_TTL_MS) stateByMmsi.delete(mmsi);
    }
}

function messageMmsi(message, body, meta) {
    return string(meta.MMSI || body?.UserID || message?.UserID).replace(/\D/g, "");
}

function staticFields(body = {}, meta = {}) {
    const reportA = body.ReportA || {};
    const reportB = body.ReportB || {};
    return {
        vessel_name: string(body.Name || reportA.Name || meta.ShipName),
        country: string(body.Country || meta.Country),
        ship_type: body.Type ?? reportB.ShipType ?? meta.ShipType ?? null,
        callsign: string(body.CallSign || reportB.CallSign || meta.CallSign),
        imo: string(body.ImoNumber ?? reportB.ImoNumber ?? "").replace(/\D/g, ""),
    };
}

function positionFields(body = {}, meta = {}) {
    return {
        latitude: numberOrNull(body.Latitude ?? meta.latitude),
        longitude: numberOrNull(body.Longitude ?? meta.longitude),
        speed_kts: numberOrNull(body.Sog),
        heading_deg: numberOrNull(body.TrueHeading ?? body.Cog),
        course_deg: numberOrNull(body.Cog),
        ship_type: body.ShipType ?? meta.ShipType ?? null,
        vessel_name: string(meta.ShipName),
    };
}

export function processAisStreamMessage(message, { now = Date.now(), cache = stateByMmsi } = {}) {
    const type = string(message?.MessageType);
    const body = message?.Message?.[type] || {};
    const meta = message?.MetaData || message?.Metadata || {};
    const mmsi = messageMmsi(message, body, meta);
    if (!mmsi) return { mmsi: "", observation: null, kind: "ignored" };

    const previous = cache.get(mmsi) || {};
    const isPosition = /PositionReport/i.test(type);
    const isStatic = /StaticData|ShipStaticData/i.test(type);
    if (!isPosition && !isStatic) return { mmsi, observation: null, kind: "other" };

    const update = isPosition ? positionFields(body, meta) : staticFields(body, meta);
    const next = {
        ...previous,
        ...update,
        vessel_name: update.vessel_name || previous.vessel_name || "",
        country: update.country || previous.country || "",
        callsign: update.callsign || previous.callsign || "",
        imo: update.imo || previous.imo || "",
        ship_type: update.ship_type ?? previous.ship_type ?? null,
        positionObservedAt: isPosition ? now : (previous.positionObservedAt || null),
        updatedAt: now,
    };
    cache.set(mmsi, next);
    const observation = Number.isFinite(next.latitude) && Number.isFinite(next.longitude)
        ? {
            domain: "naval",
            source: "aisstream",
            observed_at: new Date(next.positionObservedAt || now).toISOString(),
            mmsi,
            imo: next.imo || "",
            callsign: next.callsign || "",
            vessel_name: next.vessel_name || "",
            latitude: next.latitude,
            longitude: next.longitude,
            speed_kts: next.speed_kts ?? null,
            heading_deg: next.heading_deg ?? null,
            course_deg: next.course_deg ?? null,
            ship_type: next.ship_type ?? null,
            country: next.country || "",
            military_hint: Number(next.ship_type) === 35,
        }
        : null;
    return { mmsi, observation, kind: isPosition ? "position" : "static" };
}

function createSocket(url, allowInsecureTls, webSocketFactory) {
    if (webSocketFactory) return webSocketFactory(url, { rejectUnauthorized: !allowInsecureTls });
    return allowInsecureTls ? new WebSocket(url, { rejectUnauthorized: false }) : new WebSocket(url);
}

export function createAisStreamProvider({
    enabled,
    apiKey,
    baseUrl = DEFAULT_URL,
    sessionDurationMs = 60_000,
    allowInsecureTlsFallback = false,
    webSocketFactory,
} = {}) {
    return {
        id: "aisstream",
        enabled: Boolean(enabled && apiKey),
        fetchObservations() {
            pruneCache(Date.now());
            return new Promise((resolve, reject) => {
                let socket;
                let timer;
                let settled = false;
                let insecureRetryUsed = false;
                const diagnostics = { received: 0, unique: 0, positions: 0, static: 0 };
                const unique = new Set();
                const observations = new Map();

                const complete = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    try { socket?.close(); } catch { /* ignore shutdown errors */ }
                    resolve({ observations: [...observations.values()], diagnostics });
                };
                const fail = (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    try { socket?.terminate?.(); } catch { /* ignore shutdown errors */ }
                    reject(error);
                };
                const bind = (allowInsecureTls = false) => {
                    socket = createSocket(baseUrl, allowInsecureTls, webSocketFactory);
                    clearTimeout(timer);
                    timer = setTimeout(complete, sessionDurationMs);
                    socket.on("open", () => socket.send(JSON.stringify({
                        APIKey: apiKey,
                        BoundingBoxes: GLOBAL_BOX,
                        FilterMessageTypes: [
                            "PositionReport",
                            "StandardClassBPositionReport",
                            "ExtendedClassBPositionReport",
                            "ShipStaticData",
                            "StaticDataReport",
                        ],
                    })));
                    socket.on("message", (raw) => {
                        try {
                            diagnostics.received += 1;
                            const message = JSON.parse(raw.toString());
                            if (message?.error) throw new Error(`AISStream subscription error: ${message.error}`);
                            const parsed = processAisStreamMessage(message);
                            if (parsed.mmsi) unique.add(parsed.mmsi);
                            diagnostics.unique = unique.size;
                            if (parsed.kind === "position") diagnostics.positions += 1;
                            if (parsed.kind === "static") diagnostics.static += 1;
                            if (parsed.observation) observations.set(parsed.mmsi, parsed.observation);
                        } catch (error) {
                            fail(error);
                        }
                    });
                    socket.on("error", (error) => {
                        const expired = /certificate has expired/i.test(String(error?.message || error));
                        if (allowInsecureTlsFallback && !allowInsecureTls && !insecureRetryUsed && expired) {
                            insecureRetryUsed = true;
                            try { socket?.terminate?.(); } catch { /* ignore retry shutdown */ }
                            bind(true);
                            return;
                        }
                        fail(error);
                    });
                    socket.on("close", complete);
                };
                bind(false);
            });
        },
    };
}

export function resetAisStreamCache() {
    stateByMmsi.clear();
}
