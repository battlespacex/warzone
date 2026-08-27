import { randomUUID } from "node:crypto";
import mqtt from "mqtt";

import { navalDigits, navalNumber, navalText, normalizeNavalObservation, validNavalCoordinates } from "../normalize.js";

const DEFAULT_URL = "wss://meri.digitraffic.fi:443/mqtt";
const DEFAULT_TOPICS = [
    "vessels-v2/+/location",
    "vessels-v2/+/locations",
    "vessels-v2/+/metadata",
    "vessels-v2/status",
];

function parseJson(payload) {
    try {
        const parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload));
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

export function parseFintrafficMessage(topic, payload) {
    const parts = String(topic || "").split("/");
    const data = parseJson(payload);
    if (!data) return { kind: "malformed", mmsi: "", data: null };
    if (parts.length === 2 && parts[1] === "status") return { kind: "status", mmsi: "", data };
    const mmsi = navalDigits(parts[1]);
    const suffix = String(parts[2] || "").toLowerCase();
    if (!mmsi) return { kind: "malformed", mmsi: "", data };
    if (suffix === "metadata") return { kind: "metadata", mmsi, data };
    if (suffix === "location" || suffix === "locations") return { kind: "location", mmsi, data };
    return { kind: "ignored", mmsi, data };
}

export function normalizeFintrafficObservation(mmsi, location = {}, metadata = {}, { now = Date.now() } = {}) {
    const latitude = navalNumber(location.lat ?? location.latitude);
    const longitude = navalNumber(location.lon ?? location.longitude);
    const dimensions = {
        reference_a_m: navalNumber(metadata.refA),
        reference_b_m: navalNumber(metadata.refB),
        reference_c_m: navalNumber(metadata.refC),
        reference_d_m: navalNumber(metadata.refD),
    };
    return normalizeNavalObservation("fintraffic", {
        observed_at: location.time ?? location.timestamp ?? now,
        mmsi,
        imo: metadata.imo,
        callsign: metadata.callSign ?? metadata.callsign,
        vessel_name: metadata.name,
        latitude,
        longitude,
        speed_kts: location.sog,
        course_deg: location.cog,
        heading_deg: location.heading,
        nav_status: location.navStat,
        ship_type: metadata.type,
        ship_type_code: metadata.type,
        metadata: {
            attribution: "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY",
            source_timestamp: location.time ?? location.timestamp ?? null,
            ingested_at: new Date(now).toISOString(),
            destination: navalText(metadata.destination),
            draught_decimeters: navalNumber(metadata.draught),
            eta: metadata.eta ?? null,
            position_type: metadata.posType ?? null,
            rate_of_turn: navalNumber(location.rot),
            position_accurate: location.posAcc === true,
            raim: location.raim === true,
            dimensions,
        },
    }, { now });
}

export function createFintrafficProvider({
    enabled = true,
    baseUrl = DEFAULT_URL,
    topics = DEFAULT_TOPICS,
    applicationName = "StratOps/Warzone 1.0",
    initialSnapshotMs = 15_000,
    cacheTtlMs = 30 * 60_000,
    connectTimeoutMs = 15_000,
    reconnectBaseMs = 2_000,
    reconnectMaxMs = 60_000,
    connectImpl,
    logger = console,
} = {}) {
    const mqttConnect = connectImpl || mqtt.connect.bind(mqtt);
    const configured = enabled === true && Boolean(baseUrl);
    const subscriptions = [...new Set((Array.isArray(topics) ? topics : String(topics || "").split(",")).map((item) => item.trim()).filter(Boolean))];
    const cache = new Map();
    const counters = { received: 0, location: 0, metadata: 0, malformed: 0, invalid: 0 };
    let client = null;
    let connected = false;
    let stopped = false;
    let firstSnapshot = true;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let reconnectCount = 0;
    let lastMessageAt = null;
    let lastError = null;

    const prune = (now = Date.now()) => {
        for (const [mmsi, entry] of cache.entries()) {
            const observedAt = Date.parse(entry.observation?.observed_at || "");
            if (!Number.isFinite(observedAt) || now - observedAt > cacheTtlMs) cache.delete(mmsi);
        }
    };

    const handleMessage = (topic, payload) => {
        counters.received += 1;
        lastMessageAt = new Date().toISOString();
        const parsed = parseFintrafficMessage(topic, payload);
        if (parsed.kind === "malformed") {
            counters.malformed += 1;
            return;
        }
        if (parsed.kind === "status" || parsed.kind === "ignored") return;
        const previous = cache.get(parsed.mmsi) || { location: null, metadata: null, observation: null };
        if (parsed.kind === "metadata") {
            previous.metadata = parsed.data;
            counters.metadata += 1;
        } else {
            previous.location = parsed.data;
            counters.location += 1;
        }
        if (previous.location) {
            const observation = normalizeFintrafficObservation(parsed.mmsi, previous.location, previous.metadata || {});
            if (!validNavalCoordinates(observation.latitude, observation.longitude)) counters.invalid += 1;
            previous.observation = observation;
        }
        cache.set(parsed.mmsi, previous);
    };

    const scheduleReconnect = () => {
        if (stopped || reconnectTimer) return;
        const delayMs = Math.min(reconnectMaxMs, reconnectBaseMs * (2 ** Math.min(reconnectAttempt, 8)));
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectCount += 1;
            startConnection();
        }, delayMs);
        reconnectTimer.unref?.();
    };

    const startConnection = () => {
        if (!configured || stopped || client) return;
        const candidate = mqttConnect(baseUrl, {
            clientId: `${applicationName}; ${randomUUID()}`,
            clean: true,
            protocolVersion: 4,
            keepalive: 30,
            connectTimeout: connectTimeoutMs,
            reconnectPeriod: 0,
            resubscribe: false,
        });
        client = candidate;
        candidate.on("connect", () => {
            if (client !== candidate || stopped) return;
            connected = true;
            reconnectAttempt = 0;
            lastError = null;
            candidate.subscribe(subscriptions, { qos: 0 }, (error) => {
                if (error) {
                    lastError = String(error.message || error);
                    logger?.warn?.(`[ais:fintraffic] subscription failed: ${lastError}`);
                    candidate.end(true);
                }
            });
        });
        candidate.on("message", handleMessage);
        candidate.on("error", (error) => {
            lastError = String(error?.message || error);
        });
        const disconnected = () => {
            if (client !== candidate) return;
            connected = false;
            client = null;
            scheduleReconnect();
        };
        candidate.on("close", disconnected);
        candidate.on("offline", () => { connected = false; });
    };

    const waitForConnection = async () => {
        startConnection();
        if (connected) return;
        const startedAt = Date.now();
        while (!connected && !stopped && Date.now() - startedAt < connectTimeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!connected) {
            const error = new Error(lastError || `Fintraffic MQTT connection timed out after ${connectTimeoutMs}ms`);
            error.code = "FINTRAFFIC_CONNECT_TIMEOUT";
            throw error;
        }
    };

    return {
        id: "fintraffic",
        enabled: configured,
        disabledReason: enabled !== true ? "DISABLED_BY_CONFIG" : "MISSING_BASE_URL",
        minimumIntervalMs: 0,
        async fetchObservations() {
            const baseline = { ...counters };
            await waitForConnection();
            if (firstSnapshot) {
                firstSnapshot = false;
                await new Promise((resolve) => setTimeout(resolve, Math.max(100, Number(initialSnapshotMs) || 15_000)));
            }
            prune();
            const observations = [...cache.values()].map((entry) => entry.observation).filter(Boolean);
            return {
                observations,
                diagnostics: {
                    connected,
                    received: counters.received - baseline.received,
                    location: counters.location - baseline.location,
                    metadata: counters.metadata - baseline.metadata,
                    malformed: counters.malformed - baseline.malformed,
                    invalid: counters.invalid - baseline.invalid,
                    unique_mmsi: cache.size,
                    candidates: observations.length,
                    reconnect_count: reconnectCount,
                    last_message_at: lastMessageAt,
                    last_error: lastError,
                },
            };
        },
        shutdown() {
            stopped = true;
            connected = false;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            try { client?.end?.(true); } catch { /* controlled shutdown */ }
            client = null;
        },
    };
}

export const FINTRAFFIC_DEFAULTS = Object.freeze({ url: DEFAULT_URL, topics: DEFAULT_TOPICS });
