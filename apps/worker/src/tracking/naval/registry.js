import { createAisStreamProvider } from "./providers/aisstream.js";
import { createAisHubProvider } from "./providers/aishub.js";
import { createMarineTrafficProvider } from "./providers/marinetraffic.js";
import { createSpireProvider } from "./providers/spire.js";
import { createVesselFinderProvider } from "./providers/vesselfinder.js";

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
    const priority = priorityMap(env.NAVAL_PROVIDER_PRIORITY, ["aisstream", "aishub", "spire", "marinetraffic", "vesselfinder"]);
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
