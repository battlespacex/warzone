function getMetadata(record = {}) {
    const raw = record?.metadata;
    if (!raw) return {};
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

const CATEGORY_ALIAS_MAP = new Map([
    ["strike", "strike"],
    ["air_activity", "air"],
    ["air", "air"],
    ["air-space", "air"],
    ["official-air", "air"],
    ["naval_activity", "naval"],
    ["naval", "naval"],
    ["official-naval", "naval"],
    ["ground_activity", "ground"],
    ["land", "ground"],
    ["military", "military"],
    ["military-news", "military"],
    ["official-military", "military"],
    ["alert", "alert"],
    ["siren", "alert"],
    ["airspace", "airspace"],
    ["cyber", "cyber"],
    ["network", "cyber"],
    ["recon", "recon"],
    ["recon_intel", "recon"],
    ["defense-intel", "recon"],
    ["osint", "recon"],
    ["intel", "recon"],
    ["thermal", "thermal"],
    ["fire", "thermal"],
    ["fire_thermal", "thermal"],
    ["thermal_anomaly", "thermal"],
    ["signal", "signal"],
    ["signal_sensor", "signal"],
    ["sensor", "signal"],
    ["seismic", "signal"],
    ["defense_tech", "defense-tech"],
    ["defense-tech", "defense-tech"],
    ["unmanned", "defense-tech"],
    ["regional-defense", "regional-defense"],
    ["conflict-analysis", "analysis"],
    ["strategic-analysis", "analysis"],
    ["defense-policy", "strategy"],
    ["arms-sales", "strategy"],
    ["regional-conflict", "conflict-news"],
    ["global-news", "conflict-news"],
    ["global-events", "conflict-news"],
    ["conflict-events", "conflict-news"],
    ["humanitarian-conflict", "conflict-news"],
    ["conflict", "conflict-news"],
    ["defense-news", "military"],
    ["space", "space"],
    ["general", "intel"],
    ["intel_wire", "intel"],
    ["unknown_activity", "unknown"],
    ["unknown", "unknown"],
    ["default", "unknown"],
]);

const DEFAULT_CATEGORY_LABELS = {
    strike: "Strike",
    air: "Air Activity",
    naval: "Naval Activity",
    ground: "Ground Activity",
    military: "Military Activity",
    alert: "Alert",
    airspace: "Airspace",
    cyber: "Cyber",
    recon: "Recon / Intel",
    thermal: "Fire / Thermal",
    signal: "Signal / Sensor",
    "defense-tech": "Defense Tech",
    "regional-defense": "Regional Defense",
    analysis: "Analysis",
    strategy: "Policy / Strategy",
    "conflict-news": "Conflict News",
    space: "Space",
    intel: "Intel",
    unknown: "Unknown Activity",
};

const INTEL_WIRE_CATEGORY_LABELS = {
    ...DEFAULT_CATEGORY_LABELS,
    air: "Air",
    naval: "Naval",
    ground: "Ground",
    military: "Military",
    intel: "Intel Wire",
    unknown: "Intel",
};

function normalizeCategoryToken(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
}

function collectCategoryCandidates(input = {}, options = {}) {
    if (typeof input === "string") {
        return [input];
    }

    const metadata = getMetadata(input);
    const intelWireSurface =
        options.surface === "intel-wire" ||
        String(input?.display_surface || metadata.display_surface || "").toLowerCase() === "intel_wire";

    return intelWireSurface
        ? [
            input?.platform_category,
            metadata.platform_category,
            metadata.source_category,
            input?.source_category,
            input?.category,
            input?.report_type,
        ]
        : [
            input?.platform_category,
            metadata.platform_category,
            input?.category,
            metadata.source_category,
            input?.source_category,
            input?.report_type,
        ];
}

function resolveCategoryKey(input = {}, options = {}) {
    const candidates = collectCategoryCandidates(input, options);
    for (const candidate of candidates) {
        const normalized = normalizeCategoryToken(candidate);
        if (!normalized) continue;
        if (CATEGORY_ALIAS_MAP.has(normalized)) {
            return CATEGORY_ALIAS_MAP.get(normalized);
        }
    }
    return "unknown";
}

function getCategoryLabelsForSurface(surface = "") {
    return surface === "intel-wire" ? INTEL_WIRE_CATEGORY_LABELS : DEFAULT_CATEGORY_LABELS;
}

export function getPlatformCategoryClass(input = {}, options = {}) {
    return resolveCategoryKey(input, options);
}

export function getPlatformCategoryLabel(input = {}, options = {}) {
    const key = resolveCategoryKey(input, options);
    const labels = getCategoryLabelsForSurface(options.surface);
    const fallback = options.fallback || "Unknown";
    const label = labels[key] || DEFAULT_CATEGORY_LABELS[key] || fallback;
    return options.uppercase ? String(label).toUpperCase() : label;
}

export function normalizePlatformSeverity(value = "") {
    const severity = String(value || "").trim().toLowerCase();
    if (!severity) return "unknown";
    if (severity === "red") return "critical";
    if (severity === "orange") return "high";
    if (severity === "yellow") return "medium";
    if (severity === "minor" || severity === "normal") return "low";
    if (["critical", "high", "medium", "low"].includes(severity)) return severity;
    return severity.replace(/[^a-z0-9_-]+/g, "-") || "unknown";
}

export function getPlatformSeverityClass(value = "") {
    return normalizePlatformSeverity(value);
}

export function getPlatformSeverityLabel(value = "", fallback = "Unknown") {
    const severity = normalizePlatformSeverity(value);
    if (severity === "unknown") return fallback;
    return severity.replace(/\b\w/g, (char) => char.toUpperCase());
}
