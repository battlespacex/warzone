import { createAisStreamProvider } from "./providers/aisstream.js";
import { createAisHubProvider } from "./providers/aishub.js";
import { createMarineTrafficProvider } from "./providers/marinetraffic.js";
import { createSpireProvider } from "./providers/spire.js";

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
    const priority = priorityMap(env.NAVAL_PROVIDER_PRIORITY, ["aisstream", "aishub", "spire", "marinetraffic"]);
    const providers = [
        createAisStreamProvider({
            enabled: envEnabled(env.AISSTREAM_ENABLED, true),
            apiKey: env.AISSTREAM_API_KEY,
            baseUrl: env.AISSTREAM_BASE_URL,
            sessionDurationMs: Number(env.AISSTREAM_SESSION_DURATION_MS) || 60_000,
            allowInsecureTlsFallback: envEnabled(env.AISSTREAM_ALLOW_INSECURE_TLS_FALLBACK, true),
            webSocketFactory: dependencies.webSocketFactory,
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
            fetchImpl: dependencies.fetchImpl,
        }),
        createSpireProvider({
            enabled: envEnabled(env.SPIRE_AIS_ENABLED, false),
            token: env.SPIRE_AIS_TOKEN,
            baseUrl: env.SPIRE_AIS_BASE_URL,
            fetchImpl: dependencies.fetchImpl,
        }),
    ];
    return providers
        .map((provider) => ({ ...provider, priority: priority.get(provider.id) ?? 999 }))
        .sort((a, b) => a.priority - b.priority);
}
