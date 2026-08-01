const SAT_MODEL_BASE = "/assets/images/models/space/";

const SATELLITE_MODEL_PROFILES = Object.freeze({
    "us-wgs": Object.freeze({
        key: "us-wgs",
        uri: `${SAT_MODEL_BASE}Sat-US-WGS.glb`,
        countryCodes: ["US", "USA"],
        countryNames: ["united states", "usa", "u.s.", "us"],
        nameTokens: ["wgs", "wideband global satcom"],
    }),
    "us-muos": Object.freeze({
        key: "us-muos",
        uri: `${SAT_MODEL_BASE}Sat-US-MUOS.glb`,
        countryCodes: ["US", "USA"],
        countryNames: ["united states", "usa", "u.s.", "us"],
        nameTokens: ["muos", "mobile user objective system"],
    }),
    "us-sbirs-geo": Object.freeze({
        key: "us-sbirs-geo",
        uri: `${SAT_MODEL_BASE}Sat-US-SBIRS-Geo.glb`,
        countryCodes: ["US", "USA"],
        countryNames: ["united states", "usa", "u.s.", "us"],
        nameTokens: ["sbirs", "geo", "missile warning"],
    }),
    "uk-skynet": Object.freeze({
        key: "uk-skynet",
        uri: `${SAT_MODEL_BASE}Sat-UK-Skynet.glb`,
        countryCodes: ["UK", "GB", "GBR"],
        countryNames: ["united kingdom", "britain", "uk", "gb"],
        nameTokens: ["skynet"],
    }),
    "fr-cos": Object.freeze({
        key: "fr-cos",
        uri: `${SAT_MODEL_BASE}Sat-FR-COS.glb`,
        countryCodes: ["FR", "FRA"],
        countryNames: ["france", "french"],
        nameTokens: ["cos", "cso", "helios", "ceres", "syracuse"],
    }),
    "ge-sar-lupe": Object.freeze({
        key: "ge-sar-lupe",
        uri: `${SAT_MODEL_BASE}Sat-GE-SAR-Lupe.glb`,
        countryCodes: ["DE", "DEU", "GER", "GE"],
        countryNames: ["germany", "german", "deutschland"],
        nameTokens: ["sar-lupe", "sarlupe", "sar lupe"],
    }),
    "ru-pion-nks": Object.freeze({
        key: "ru-pion-nks",
        uri: `${SAT_MODEL_BASE}Sat-RU-Pion-NKS.glb`,
        countryCodes: ["RU", "RUS"],
        countryNames: ["russia", "russian federation", "russian"],
        nameTokens: ["pion", "nks", "lotos", "kosmos", "cosmos"],
    }),
    "cn-yaogan": Object.freeze({
        key: "cn-yaogan",
        uri: `${SAT_MODEL_BASE}Sat-CN-Yaogan.glb`,
        countryCodes: ["CN", "CHN", "PRC"],
        countryNames: ["china", "chinese", "people's republic of china", "peoples republic of china", "prc"],
        nameTokens: ["yaogan", "gao fen", "gaofen", "shijian", "sj-", "sj ", "tianlian"],
    }),
});

const DEFAULT_US_MODEL_KEYS = Object.freeze(["us-wgs", "us-muos", "us-sbirs-geo"]);
const STARTUP_MODEL_KEYS = Object.freeze([
    "us-wgs",
    "us-muos",
    "us-sbirs-geo",
    "uk-skynet",
    "fr-cos",
    "ge-sar-lupe",
    "ru-pion-nks",
    "cn-yaogan",
]);

function normalizeSatelliteText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function stableIndex(seed = "", length = 1) {
    const size = Math.max(1, Number(length) || 1);
    let hash = 0;
    const text = String(seed || "satellite");
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % size;
}

function getProfile(key = "") {
    return SATELLITE_MODEL_PROFILES[key] || SATELLITE_MODEL_PROFILES["us-wgs"];
}

function getSatelliteModelScale(fallback = 194000) {
    const styles = getComputedStyle(document.documentElement);
    const primary = Number(styles.getPropertyValue("--warzone-satellite-model-scale"));
    if (Number.isFinite(primary)) return primary;
    const legacy = Number(styles.getPropertyValue("--warzone-mil-sat-scale"));
    return Number.isFinite(legacy) ? legacy : fallback;
}

function getSatelliteModelHeadingDeg(fallback = 0) {
    const styles = getComputedStyle(document.documentElement);
    const primary = Number(styles.getPropertyValue("--warzone-satellite-model-heading-deg"));
    if (Number.isFinite(primary)) return primary;
    return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

function getStartupSatelliteModelProfile(indexOrKey = 0) {
    if (typeof indexOrKey === "string" && SATELLITE_MODEL_PROFILES[indexOrKey]) {
        return getProfile(indexOrKey);
    }
    return getProfile(STARTUP_MODEL_KEYS[Math.abs(Number(indexOrKey) || 0) % STARTUP_MODEL_KEYS.length]);
}

function resolveExactSatelliteModelKey(record = {}) {
    const nameText = normalizeSatelliteText([
        record.name,
        record.objectName,
        record.satelliteName,
        record.internationalDesignator,
        record.noradId,
    ].filter(Boolean).join(" "));
    if (!nameText) return "";
    for (const profile of Object.values(SATELLITE_MODEL_PROFILES)) {
        if (profile.nameTokens.some((token) => nameText.includes(token))) return profile.key;
    }
    return "";
}

function resolveCountrySatelliteModelKey(record = {}) {
    const ownerCode = String(record.ownerCode || record.owner_code || record.countryCode || "").trim().toUpperCase();
    const countryText = normalizeSatelliteText([record.country, record.owner, record.operator].filter(Boolean).join(" "));
    for (const profile of Object.values(SATELLITE_MODEL_PROFILES)) {
        if (ownerCode && profile.countryCodes.includes(ownerCode)) return profile.key;
        if (countryText && profile.countryNames.some((name) => countryText.includes(name))) return profile.key;
    }
    return "";
}

function resolveSatelliteModelProfile(record = {}) {
    const exactKey = resolveExactSatelliteModelKey(record);
    if (exactKey) return getProfile(exactKey);
    const countryKey = resolveCountrySatelliteModelKey(record);
    if (countryKey) return getProfile(countryKey);
    const fallbackKey = DEFAULT_US_MODEL_KEYS[stableIndex(record.id || record.noradId || record.name, DEFAULT_US_MODEL_KEYS.length)];
    return getProfile(fallbackKey);
}

export {
    DEFAULT_US_MODEL_KEYS,
    SATELLITE_MODEL_PROFILES,
    STARTUP_MODEL_KEYS,
    getSatelliteModelHeadingDeg,
    getSatelliteModelScale,
    getStartupSatelliteModelProfile,
    resolveSatelliteModelProfile,
    stableIndex,
};
