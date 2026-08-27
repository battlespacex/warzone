import { createAisStreamProvider } from "./providers/aisstream.js";
import { createAisHubProvider } from "./providers/aishub.js";
import { createFintrafficProvider } from "./providers/fintraffic.js";
import { createMarinePlanProvider } from "./providers/marineplan.js";
import { createMarineTrafficProvider } from "./providers/marinetraffic.js";
import { createOpenAisProvider } from "./providers/openais.js";
import { createSpireProvider } from "./providers/spire.js";
import { createVesselFinderProvider } from "./providers/vesselfinder.js";
import { createVesselApiProvider } from "./providers/vesselapi.js";

function envEnabled(value, fallback = false) {
    if (value == null || value === "") return fallback;
    return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function priorityMap(value, defaults) {
    const ordered = String(value || defaults.join(","))
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    return new Map(ordered.map((id, index) => [id, index]));
}

export function createNavalProviders(env = process.env, dependencies = {}) {
    const priority = priorityMap(env.NAVAL_PROVIDER_PRIORITY, ["aisstream", "fintraffic", "vesselapi", "openais", "marineplan", "aishub", "spire", "marinetraffic", "vesselfinder"]);
    const providers = [
        createAisStreamProvider({
            enabled: envEnabled(env.AISSTREAM_ENABLED, true),
            apiKey: env.AISSTREAM_API_KEY,
            baseUrl: env.AISSTREAM_URL || env.AISSTREAM_BASE_URL,
            boundingBoxes: env.AISSTREAM_BOUNDING_BOXES_JSON,
            diagnosticWindowMs: Number(env.AISSTREAM_DIAGNOSTIC_WINDOW_MS || env.AISSTREAM_SESSION_DURATION_MS) || 15_000,
            cacheTtlMs: (Number(env.AISSTREAM_STATIC_CACHE_TTL_MINUTES) || 30) * 60_000,
            allowInsecureTlsFallback: envEnabled(env.AISSTREAM_ALLOW_INSECURE_TLS_FALLBACK, false),
            webSocketFactory: dependencies.webSocketFactory,
            logger: dependencies.logger,
        }),
        createFintrafficProvider({
            enabled: envEnabled(env.FINTRAFFIC_ENABLED, true),
            baseUrl: env.FINTRAFFIC_MQTT_URL,
            topics: env.FINTRAFFIC_TOPICS,
            applicationName: env.FINTRAFFIC_APPLICATION_NAME,
            initialSnapshotMs: Number(env.FINTRAFFIC_INITIAL_SNAPSHOT_MS) || 15_000,
            cacheTtlMs: (Number(env.FINTRAFFIC_CACHE_TTL_MINUTES) || 30) * 60_000,
            connectTimeoutMs: Number(env.FINTRAFFIC_CONNECT_TIMEOUT_MS) || 15_000,
            reconnectBaseMs: Number(env.FINTRAFFIC_RECONNECT_BASE_MS) || 2_000,
            reconnectMaxMs: Number(env.FINTRAFFIC_RECONNECT_MAX_MS) || 60_000,
            connectImpl: dependencies.mqttConnect,
            logger: dependencies.logger,
        }),
        createVesselApiProvider({
            enabled: envEnabled(env.VESSELAPI_ENABLED, false),
            apiKey: env.VESSELAPI_API_KEY,
            baseUrl: env.VESSELAPI_BASE_URL,
            minimumIntervalMs: Number(env.VESSELAPI_MINIMUM_INTERVAL_MS) || 18_000_000,
            identityCacheTtlMs: Number(env.VESSELAPI_IDENTITY_CACHE_TTL_MS) || 604_800_000,
            monthlyRequestBudget: Number(env.VESSELAPI_MONTHLY_REQUEST_BUDGET) || 150,
            minRemainingRequests: Number(env.VESSELAPI_MIN_REMAINING_REQUESTS) || 10,
            stateStore: dependencies.vesselApiStateStore,
            fetchImpl: dependencies.fetchImpl,
            logger: dependencies.logger,
        }),
        createOpenAisProvider({
            enabled: envEnabled(env.OPENAIS_ENABLED, false),
            baseUrl: env.OPENAIS_BASE_URL,
            collectionPath: env.OPENAIS_COLLECTION_PATH,
            apiToken: env.OPENAIS_API_TOKEN,
            minimumIntervalMs: Number(env.OPENAIS_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createMarinePlanProvider({
            enabled: envEnabled(env.MARINEPLAN_ENABLED, false),
            apiKey: env.MARINEPLAN_API_KEY,
            area: env.MARINEPLAN_AREA,
            baseUrl: env.MARINEPLAN_BASE_URL,
            minimumIntervalMs: Number(env.MARINEPLAN_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createAisHubProvider({
            enabled: envEnabled(env.AISHUB_ENABLED, false),
            username: env.AISHUB_USERNAME,
            baseUrl: env.AISHUB_BASE_URL,
            minimumIntervalMs: Number(env.AISHUB_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createMarineTrafficProvider({
            enabled: envEnabled(env.MARINETRAFFIC_ENABLED, false),
            apiKey: env.MARINETRAFFIC_API_KEY,
            baseUrl: env.MARINETRAFFIC_BASE_URL,
            minimumIntervalMs: Number(env.MARINETRAFFIC_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createSpireProvider({
            enabled: envEnabled(env.SPIRE_AIS_ENABLED, false),
            token: env.SPIRE_AIS_TOKEN,
            baseUrl: env.SPIRE_AIS_BASE_URL,
            minimumIntervalMs: Number(env.SPIRE_AIS_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createVesselFinderProvider({
            enabled: envEnabled(env.VESSELFINDER_ENABLED, false),
            apiKey: env.VESSELFINDER_API_KEY,
            baseUrl: env.VESSELFINDER_BASE_URL,
            minimumIntervalMs: Number(env.VESSELFINDER_MINIMUM_INTERVAL_MS) || 60_000,
            fetchImpl: dependencies.fetchImpl,
        }),
    ];
    return providers
        .map((provider) => ({ ...provider, priority: priority.get(provider.id) ?? 999 }))
        .sort((a, b) => a.priority - b.priority);
}
