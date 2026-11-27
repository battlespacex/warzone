const SAT_MODEL_BASE = "/assets/images/models/space/";

const SATELLITE_MODEL_PROFILES = Object.freeze({
    "iss": Object.freeze({ key: "iss", uri: `${SAT_MODEL_BASE}Sat-ISS.glb`, countryCodes: [], countryNames: [], nameTokens: [] }),
    "css": Object.freeze({ key: "css", uri: `${SAT_MODEL_BASE}Sat-CSS.glb`, countryCodes: [], countryNames: [], nameTokens: [] }),
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
    const rotateZ = Number(styles.getPropertyValue("--warzone-satellite-model-rotate-z-deg"));
    if (Number.isFinite(rotateZ)) return rotateZ;
    const primary = Number(styles.getPropertyValue("--warzone-satellite-model-heading-deg"));
    if (Number.isFinite(primary)) return primary;
    return Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
}

function getSatelliteModelPitchDeg(fallback = -150) {
    const styles = getComputedStyle(document.documentElement);
    const primary = Number(styles.getPropertyValue("--warzone-satellite-model-rotate-y-deg"));
    return Number.isFinite(primary) ? primary : (Number.isFinite(Number(fallback)) ? Number(fallback) : -150);
}

function getSatelliteModelRollDeg(fallback = -15) {
    const styles = getComputedStyle(document.documentElement);
    const primary = Number(styles.getPropertyValue("--warzone-satellite-model-rotate-x-deg"));
    return Number.isFinite(primary) ? primary : (Number.isFinite(Number(fallback)) ? Number(fallback) : -15);
}

function getStartupSatelliteModelProfile(indexOrKey = 0) {
    if (typeof indexOrKey === "string" && SATELLITE_MODEL_PROFILES[indexOrKey]) {
        return getProfile(indexOrKey);
    }
    return getProfile(STARTUP_MODEL_KEYS[Math.abs(Number(indexOrKey) || 0) % STARTUP_MODEL_KEYS.length]);
}

function resolveExactSatelliteModelKey(record = {}) {
    const norad = String(record.noradId ?? record.norad_id ?? record.NORAD_CAT_ID ?? "").trim();
    if (norad === "25544") return "iss";
    if (norad === "48274") return "css";
    if (!norad) {
        const name = String(record.name || record.objectName || record.satelliteName || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
        if (["ISS", "ISS ZARYA", "INTERNATIONAL SPACE STATION", "ZARYA"].includes(name)) return "iss";
        if (["CSS", "CSS TIANHE", "TIANHE", "TIANGONG", "CHINESE SPACE STATION"].includes(name)) return "css";
    }
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
    getSatelliteModelPitchDeg,
    getSatelliteModelRollDeg,
    getSatelliteModelScale,
    getStartupSatelliteModelProfile,
    resolveSatelliteModelProfile,
    stableIndex,
};

const operationalStyleCache = new Map();
export function invalidateOperationalSatelliteStyles() { operationalStyleCache.clear(); }
export function getOperationalSatelliteModelStyle(record = {}, focused = false) {
    const key = resolveSatelliteModelProfile(record).key;
    const cacheKey = `${key}:${focused}`;
    if (operationalStyleCache.has(cacheKey)) return operationalStyleCache.get(cacheKey);
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback, units = "") => {
        const prefixes = ["iss", "css"].includes(key) ? [`--warzone-live-satellite-${key}-model-`, "--warzone-live-satellite-model-"] : ["--warzone-live-satellite-model-"];
        for (const prefix of prefixes) {
            const text = styles.getPropertyValue(prefix + name).trim();
            if (new RegExp(`^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:${units || '(?!)'})?$`).test(text)) {
                const n = parseFloat(text); if (Number.isFinite(n)) return n;
            }
        }
        return fallback;
    };
    const min = Math.max(0, read("scale-min", 0));
    const max = Math.max(min, read("scale-max", 260000));
    const legacy = (name, fallback) => {
        const text = styles.getPropertyValue(name).trim();
        return text && Number.isFinite(Number(text)) ? Number(text) : fallback;
    };
    const legacyScale = legacy("--warzone-satellite-model-scale", 170000);
    const style = {
        scale: Math.max(min, Math.min(max, read(focused ? "focused-size" : "scale", legacyScale))),
        minimumPixelSize: Math.max(0, read(focused ? "focused-min-pixel-size" : "min-pixel-size", 18, "px")),
        maximumScale: max,
        heading: read("heading", legacy("--warzone-satellite-model-rotate-z-deg", legacy("--warzone-satellite-model-heading-deg", 0)), "deg"),
        pitch: read("pitch", legacy("--warzone-satellite-model-rotate-y-deg", -150), "deg"),
        roll: read("roll", legacy("--warzone-satellite-model-rotate-x-deg", -15), "deg"),
    };
    operationalStyleCache.set(cacheKey, style);
    return style;
}
