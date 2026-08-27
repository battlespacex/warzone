import { createAdsbLolProvider } from "./providers/adsb-lol.js";
import { createAirplanesLiveProvider } from "./providers/airplanes-live.js";
import { createAdsbOneProvider } from "./providers/adsb-one.js";
import { createAdsbExchangeProvider } from "./providers/adsb-exchange.js";
import { createOpenSkyProvider } from "./providers/opensky.js";
import { createPlaneAlertMilitaryDatabase } from "./providers/plane-alert-db.js";
import { createSkyLinkProvider } from "./providers/skylink.js";

function envEnabled(value, fallback = false) {
    if (value == null || value === "") return fallback;
    return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function priorityMap(value, defaults) {
    const ordered = String(value || defaults.join(","))
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .map((item) => item === "adsbone" ? "adsb_one" : item)
        .map((item) => item === "adsb_exchange" ? "adsbx" : item)
        .filter(Boolean);
    return new Map(ordered.map((id, index) => [id, index]));
}

export function createAircraftProviders(env = process.env, dependencies = {}) {
    const priority = priorityMap(env.AIRCRAFT_PROVIDER_PRIORITY, ["adsb_lol", "opensky", "airplanes_live", "adsb_one", "adsbx", "plane_alert_db", "skylink"]);
    const providers = [
        createAdsbLolProvider({
            enabled: envEnabled(env.ADSB_LOL_ENABLED, true),
            baseUrl: env.ADSB_LOL_BASE_URL,
            positionMaxAgeSeconds: Number(env.ADSB_LOL_POSITION_MAX_AGE_SECONDS) || 90,
            minimumIntervalMs: Number(env.ADSB_LOL_MINIMUM_INTERVAL_MS) || 3000,
            fetchImpl: dependencies.fetchImpl,
        }),
        createAirplanesLiveProvider({
            enabled: envEnabled(env.AIRPLANES_LIVE_ENABLED, true),
            baseUrl: env.AIRPLANES_LIVE_BASE_URL || env.AIRCRAFT_FEED_URL,
            fetchImpl: dependencies.fetchImpl,
        }),
        createAdsbOneProvider({
            enabled: envEnabled(env.ADSB_ONE_ENABLED ?? env.ADSBONE_ENABLED, true),
            baseUrl: env.ADSB_ONE_BASE_URL || env.ADSBONE_BASE_URL,
            fetchImpl: dependencies.fetchImpl,
        }),
        createAdsbExchangeProvider({
            enabled: envEnabled(env.ADSB_EXCHANGE_ENABLED, false),
            apiKey: env.ADSB_EXCHANGE_API_KEY,
            baseUrl: env.ADSB_EXCHANGE_BASE_URL,
            fetchImpl: dependencies.fetchImpl,
        }),
        createOpenSkyProvider({
            enabled: envEnabled(env.OPENSKY_ENABLED, false),
            clientId: env.OPENSKY_CLIENT_ID,
            clientSecret: env.OPENSKY_CLIENT_SECRET,
            baseUrl: env.OPENSKY_BASE_URL,
            minimumIntervalMs: Number(env.OPENSKY_MINIMUM_INTERVAL_MS) || (15 * 60 * 1000),
            fetchImpl: dependencies.fetchImpl,
        }),
        createPlaneAlertMilitaryDatabase({
            enabled: envEnabled(env.PLANE_ALERT_DB_ENABLED, true),
            sourceUrl: env.PLANE_ALERT_DB_SOURCE_URL,
            cacheFile: env.PLANE_ALERT_DB_CACHE_FILE,
            cacheTtlMs: Number(env.PLANE_ALERT_DB_CACHE_TTL_MS) || (24 * 60 * 60 * 1000),
            fetchImpl: dependencies.planeAlertFetchImpl || dependencies.fetchImpl,
            logger: dependencies.logger,
            initialCsv: dependencies.planeAlertInitialCsv,
        }),
        createSkyLinkProvider({
            enabled: envEnabled(env.SKYLINK_ENABLED, true),
            apiKey: env.SKYLINK_API_KEY,
            baseUrl: env.SKYLINK_BASE_URL,
            minimumIntervalMs: Number(env.SKYLINK_MINIMUM_INTERVAL_MS) || (60 * 60 * 1000),
            identityCacheTtlMs: Number(env.SKYLINK_IDENTITY_CACHE_TTL_MS) || (7 * 24 * 60 * 60 * 1000),
            negativeCacheTtlMs: Number(env.SKYLINK_NEGATIVE_CACHE_TTL_MS) || (7 * 24 * 60 * 60 * 1000),
            monthlyRequestBudget: Number(env.SKYLINK_MONTHLY_REQUEST_BUDGET) || 1000,
            minRemainingRequests: Number(env.SKYLINK_MIN_REMAINING_REQUESTS) || 50,
            requestTimeoutMs: Number(env.SKYLINK_REQUEST_TIMEOUT_MS) || 15000,
            stateStore: dependencies.skyLinkStateStore,
            fetchImpl: dependencies.skyLinkFetchImpl || dependencies.fetchImpl,
            logger: dependencies.logger,
        }),
    ];
    return providers
        .map((provider) => ({ ...provider, priority: priority.get(provider.id) ?? 999 }))
        .sort((a, b) => a.priority - b.priority);
}
