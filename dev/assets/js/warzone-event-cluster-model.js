const HOTSPOT_DOMAINS = Object.freeze({
    AIR: "AIR",
    STRIKE: "STRIKE",
    MISSILE: "MISSILE",
    ARTILLERY: "ARTILLERY",
    AIR_DEFENCE: "AIR_DEFENCE",
    MARITIME: "MARITIME",
    CYBER: "CYBER",
    GNSS: "GNSS",
    ALERT: "ALERT",
    MIXED: "MIXED",
});

const DEFAULT_CLUSTER_DISTANCE_KM = Object.freeze({
    world: 900,
    theater: 420,
    regional: 190,
    local: 85,
    district: 28,
    street: 0.5,
});

const SEVERITY_WEIGHT = Object.freeze({ low: 0.72, medium: 1, high: 1.55, critical: 2.2 });
const SEVERITY_RANK = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const CORROBORATION_WEIGHT = Object.freeze({
    UNVERIFIED: 0.62,
    REPORTED: 1,
    CORROBORATED: 1.3,
    CONFIRMED: 1.55,
    DISPUTED: 0.7,
});
const SOURCE_TIER_WEIGHT = Object.freeze({ TIER_1: 1.08, TIER_2: 1.03, TIER_3: 0.92, UNRATED: 0.96 });
const DOMAIN_WEIGHT = Object.freeze({
    AIR: 1.05,
    STRIKE: 1.15,
    MISSILE: 1.2,
    ARTILLERY: 1.12,
    AIR_DEFENCE: 1.1,
    MARITIME: 1.04,
    CYBER: 1.02,
    GNSS: 1,
    ALERT: 1.06,
    MIXED: 1,
});

function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeLongitude(value) {
    let lon = Number(value);
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
}

function normalizeText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getEventTimeMs(event = {}) {
    const parsed = Date.parse(event.occurred_at || event.published_at || event.updated_at || "");
    return Number.isFinite(parsed) ? parsed : 0;
}

function getEventQuality(event = {}) {
    const metadata = asObject(event.metadata);
    return asObject(event.event_quality || metadata.event_quality);
}

function getLocationPrecision(event = {}) {
    const metadata = asObject(event.metadata);
    const normalization = asObject(metadata.normalization);
    return String(
        event.location_precision
        || event.display_precision
        || normalization.location_precision
        || metadata.location_precision
        || "UNKNOWN"
    ).trim().toUpperCase();
}

function isDedicatedTelemetry(event = {}) {
    const reportType = String(event.report_type || "").toLowerCase();
    const source = String(event.source_name || "").toLowerCase();
    const tags = Array.isArray(event.tags) ? event.tags.map((tag) => String(tag).toLowerCase()) : [];
    return reportType === "flight_tracking"
        || reportType === "ads_b"
        || reportType === "ads-b"
        || source.includes("ads-b")
        || tags.some((tag) => tag === "ads-b" || tag === "flight_tracking" || tag === "aircraft_telemetry");
}

function isPointClusterEligible(event = {}) {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const precision = getLocationPrecision(event);
    return event.map_eligible !== false
        && event.mapEligible !== false
        && Number.isFinite(lat)
        && Number.isFinite(lon)
        && Math.abs(lat) <= 90
        && Math.abs(lon) <= 180
        && !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001)
        && (precision === "EXACT" || precision === "LOCAL")
        && !isDedicatedTelemetry(event);
}

function classifyEventDomain(event = {}) {
    const category = normalizeText(event.category || event.domain || "").replace(/ /g, "_");
    const subcategory = normalizeText(event.subcategory || event.subtype || "").replace(/ /g, "_");
    const weapon = normalizeText(event.weapon_type || "").replace(/ /g, "_");
    const text = normalizeText([
        event.title,
        event.summary,
        event.description,
        category,
        subcategory,
        weapon,
        Array.isArray(event.tags) ? event.tags.join(" ") : event.tags,
    ].filter(Boolean).join(" "));

    if (/\b(?:gnss|gps jamm|gps spoof|navigation interference)\b/.test(text)) return HOTSPOT_DOMAINS.GNSS;
    if (/\b(?:cyber|malware|ransomware|network attack|internet outage)\b/.test(text) || category === "cyber") return HOTSPOT_DOMAINS.CYBER;
    if (/\b(?:air defence|air defense|sam|intercept|shot down|anti aircraft)\b/.test(text) || subcategory === "air_defence") return HOTSPOT_DOMAINS.AIR_DEFENCE;
    if (/\b(?:artillery|shelling|howitzer|bombardment|mortar)\b/.test(text) || weapon === "artillery") return HOTSPOT_DOMAINS.ARTILLERY;
    if (/\b(?:ballistic missile|cruise missile|missile|rocket)\b/.test(text) || weapon === "missile" || weapon === "rocket") return HOTSPOT_DOMAINS.MISSILE;
    if (/\b(?:naval|maritime|warship|destroyer|frigate|submarine|vessel|tanker|port attack)\b/.test(text) || category === "naval_activity") return HOTSPOT_DOMAINS.MARITIME;
    if (/\b(?:aircraft|fighter|bomber|helicopter|awacs|sortie|uav|drone|air activity|airspace)\b/.test(text) || ["air_activity", "airspace", "recon", "recon_intel"].includes(category)) return HOTSPOT_DOMAINS.AIR;
    if (/\b(?:alert|siren|take shelter|air raid warning)\b/.test(text) || category === "alert") return HOTSPOT_DOMAINS.ALERT;
    if (/\b(?:strike|attack|explosion|blast|detonation|impact)\b/.test(text) || category === "strike") return HOTSPOT_DOMAINS.STRIKE;
    if (["military", "ground_activity"].includes(category)) return HOTSPOT_DOMAINS.STRIKE;
    return HOTSPOT_DOMAINS.MIXED;
}

function getRecencyWeight(event = {}, nowMs = Date.now()) {
    const occurredMs = Date.parse(event.occurred_at || event.published_at || event.updated_at || "");
    if (!Number.isFinite(occurredMs)) return 0.35;
    const ageHours = Math.max(0, (nowMs - occurredMs) / 3600000);
    if (ageHours <= 3) return 1;
    if (ageHours <= 24) return 0.85;
    if (ageHours <= 72) return 0.55;
    if (ageHours <= 168) return 0.25;
    return 0;
}

function calculateEventActivityScore(event = {}, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const quality = getEventQuality(event);
    const recency = getRecencyWeight(event, nowMs);
    if (!(recency > 0)) return 0;
    const severity = String(event.severity || "medium").toLowerCase();
    const corroboration = String(event.corroboration_state || quality.corroboration_state || "REPORTED").toUpperCase();
    const sourceTier = String(event.source_tier || quality.source_tier || "UNRATED").toUpperCase();
    const confidence = clamp(Number(event.confidence ?? event.confidence_score ?? quality.confidence ?? 50), 0, 100);
    const independentFamilies = Math.max(1, Number(event.independent_source_family_count || quality.independent_source_family_count || 1));
    const familyWeight = 1 + Math.min(0.28, Math.log2(independentFamilies) * 0.09);
    const confidenceWeight = 0.65 + (confidence / 100) * 0.7;
    const domain = classifyEventDomain(event);
    return recency
        * (SEVERITY_WEIGHT[severity] || SEVERITY_WEIGHT.medium)
        * (CORROBORATION_WEIGHT[corroboration] || CORROBORATION_WEIGHT.REPORTED)
        * (SOURCE_TIER_WEIGHT[sourceTier] || SOURCE_TIER_WEIGHT.UNRATED)
        * confidenceWeight
        * familyWeight
        * (DOMAIN_WEIGHT[domain] || 1);
}

function scoreToRadius(score, options = {}) {
    const min = Math.max(1, Number(options.min ?? 44));
    const max = Math.max(min, Number(options.max ?? 96));
    const scoreAtMax = Math.max(1, Number(options.scoreAtMax ?? 80));
    const normalized = clamp(Math.log1p(Math.max(0, Number(score) || 0)) / Math.log1p(scoreAtMax), 0, 1);
    return min + (max - min) * Math.sqrt(normalized);
}

function eventKey(event = {}, index = 0) {
    const quality = getEventQuality(event);
    const direct = event.id || event.event_id || event.dedupe_key || quality.event_fingerprint;
    if (direct) return String(direct);
    const hour = String(event.occurred_at || event.published_at || "").slice(0, 13);
    return [
        normalizeText(event.title || event.summary || "event"),
        Number(event.lat).toFixed(4),
        Number(event.lon).toFixed(4),
        hour,
        index,
    ].join("|");
}

function flattenUniqueEvents(events = []) {
    const flattened = [];
    for (const event of Array.isArray(events) ? events : []) {
        const children = Array.isArray(event?._clusterEvents) && event._clusterEvents.length
            ? event._clusterEvents
            : (Array.isArray(event?.cluster_events) && event.cluster_events.length ? event.cluster_events : null);
        if (children) flattened.push(...children);
        else flattened.push(event);
    }
    const unique = new Map();
    flattened.forEach((event, index) => {
        if (!isPointClusterEligible(event)) return;
        const key = eventKey(event, index);
        if (!unique.has(key)) unique.set(key, { ...event, __clusterEventKey: key });
    });
    return [...unique.values()].sort((a, b) => (
        Number(a.lat) - Number(b.lat)
        || normalizeLongitude(a.lon) - normalizeLongitude(b.lon)
        || String(a.__clusterEventKey).localeCompare(String(b.__clusterEventKey))
    ));
}

function haversineDistanceKm(a = {}, b = {}) {
    const lat1 = Number(a.lat) * Math.PI / 180;
    const lat2 = Number(b.lat) * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (normalizeLongitude(b.lon) - normalizeLongitude(a.lon)) * Math.PI / 180;
    if (![lat1, lat2, dLat, dLon].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function weightedSphericalCentroid(events = [], nowMs = Date.now()) {
    let x = 0;
    let y = 0;
    let z = 0;
    let total = 0;
    for (const event of events) {
        const lat = Number(event.lat) * Math.PI / 180;
        const lon = Number(event.lon) * Math.PI / 180;
        const weight = Math.max(0.1, calculateEventActivityScore(event, { nowMs }));
        x += Math.cos(lat) * Math.cos(lon) * weight;
        y += Math.cos(lat) * Math.sin(lon) * weight;
        z += Math.sin(lat) * weight;
        total += weight;
    }
    if (!(total > 0)) return null;
    x /= total;
    y /= total;
    z /= total;
    return {
        lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI,
        lon: normalizeLongitude(Math.atan2(y, x) * 180 / Math.PI),
    };
}

function selectWeightedMedoid(events = [], centroid = null) {
    if (!events.length) return null;
    const center = centroid || weightedSphericalCentroid(events);
    return events.slice().sort((a, b) => (
        haversineDistanceKm(a, center) - haversineDistanceKm(b, center)
        || String(a.__clusterEventKey).localeCompare(String(b.__clusterEventKey))
    ))[0];
}

function buildBounds(events = [], centerLon = 0) {
    const latitudes = events.map((event) => Number(event.lat));
    const unwrappedLongitudes = events.map((event) => {
        let lon = normalizeLongitude(event.lon);
        while (lon - centerLon > 180) lon -= 360;
        while (lon - centerLon < -180) lon += 360;
        return lon;
    });
    const westRaw = Math.min(...unwrappedLongitudes);
    const eastRaw = Math.max(...unwrappedLongitudes);
    return {
        south: Math.min(...latitudes),
        north: Math.max(...latitudes),
        west: normalizeLongitude(westRaw),
        east: normalizeLongitude(eastRaw),
        crosses_antimeridian: westRaw < -180 || eastRaw > 180,
    };
}

function determineDominantDomain(events = [], options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const threshold = clamp(Number(options.dominanceThreshold ?? 0.48), 0.34, 0.9);
    const margin = clamp(Number(options.dominanceMargin ?? 0.12), 0, 0.5);
    const scores = new Map();
    for (const event of events) {
        const domain = classifyEventDomain(event);
        const weight = Math.max(0.05, calculateEventActivityScore(event, { nowMs }));
        scores.set(domain, (scores.get(domain) || 0) + weight);
    }
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = sorted.reduce((sum, entry) => sum + entry[1], 0) || 1;
    const top = sorted[0] || [HOTSPOT_DOMAINS.MIXED, total];
    const second = sorted[1] || [HOTSPOT_DOMAINS.MIXED, 0];
    const topShare = top[1] / total;
    const lead = (top[1] - second[1]) / total;
    const domain = top[0] !== HOTSPOT_DOMAINS.MIXED && topShare >= threshold && lead >= margin
        ? top[0]
        : HOTSPOT_DOMAINS.MIXED;
    return {
        domain,
        top_share: topShare,
        lead_margin: lead,
        distribution: Object.fromEntries(sorted.map(([key, value]) => [key, value / total])),
    };
}

function getClusterSeverity(events = []) {
    return events.reduce((best, event) => {
        const severity = String(event.severity || "medium").toLowerCase();
        return (SEVERITY_RANK[severity] || 2) > (SEVERITY_RANK[best] || 2) ? severity : best;
    }, "low");
}

function getPulseMode(events = [], score = 0, nowMs = Date.now()) {
    let hasMeaningfulThreeHourEvent = false;
    for (const event of events) {
        const occurredMs = Date.parse(event.occurred_at || event.published_at || "");
        if (!Number.isFinite(occurredMs)) continue;
        const ageMinutes = Math.max(0, (nowMs - occurredMs) / 60000);
        const severity = String(event.severity || "medium").toLowerCase();
        if (ageMinutes <= 30 && (severity === "critical" || severity === "high")) return "strong";
        const quality = getEventQuality(event);
        const state = String(event.corroboration_state || quality.corroboration_state || "REPORTED").toUpperCase();
        if (ageMinutes <= 180 && (SEVERITY_RANK[severity] >= 2 || ["CONFIRMED", "CORROBORATED"].includes(state))) {
            hasMeaningfulThreeHourEvent = true;
        }
    }
    return hasMeaningfulThreeHourEvent && score >= 1 ? "subtle" : "none";
}

function hashString(value = "") {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function clusterEventGroups(events = [], distanceKm = 0, nowMs = Date.now()) {
    if (!(distanceKm > 0)) return events.map((event) => [event]);
    const groups = [];
    for (const event of events) {
        let selected = null;
        let selectedDistance = Number.POSITIVE_INFINITY;
        for (const group of groups) {
            const distance = haversineDistanceKm(event, group.centroid);
            if (distance <= distanceKm && distance < selectedDistance) {
                selected = group;
                selectedDistance = distance;
            }
        }
        if (!selected) {
            groups.push({ events: [event], centroid: { lat: Number(event.lat), lon: normalizeLongitude(event.lon) } });
            continue;
        }
        selected.events.push(event);
        selected.centroid = weightedSphericalCentroid(selected.events, nowMs) || selected.centroid;
    }
    return groups.map((group) => group.events);
}

function getClusterDistanceKm(zoomBucket = "regional", overrides = {}) {
    const key = String(zoomBucket || "regional").toLowerCase();
    const value = Number(overrides[key] ?? DEFAULT_CLUSTER_DISTANCE_KM[key] ?? DEFAULT_CLUSTER_DISTANCE_KM.regional);
    return Math.max(0, value);
}

function buildSpatialEventClusters(events = [], options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const zoomBucket = String(options.zoomBucket || "regional").toLowerCase();
    const distanceKm = Number.isFinite(Number(options.distanceKm))
        ? Math.max(0, Number(options.distanceKm))
        : getClusterDistanceKm(zoomBucket, options.distanceByZoom);
    const eligibleEvents = flattenUniqueEvents(events);
    const groups = clusterEventGroups(eligibleEvents, distanceKm, nowMs);
    const clusters = groups.map((groupEvents) => {
        const scores = groupEvents.map((event) => calculateEventActivityScore(event, { nowMs }));
        const baseScore = scores.reduce((sum, score) => sum + score, 0);
        const repeatedActivityWeight = 1 + Math.min(0.24, Math.log2(Math.max(1, groupEvents.length)) * 0.045);
        const activityScore = baseScore * repeatedActivityWeight;
        const centroid = weightedSphericalCentroid(groupEvents, nowMs) || { lat: Number(groupEvents[0].lat), lon: Number(groupEvents[0].lon) };
        const medoid = selectWeightedMedoid(groupEvents, centroid) || groupEvents[0];
        const dominance = determineDominantDomain(groupEvents, {
            nowMs,
            dominanceThreshold: options.dominanceThreshold,
            dominanceMargin: options.dominanceMargin,
        });
        const latest = groupEvents.slice().sort((a, b) => getEventTimeMs(b) - getEventTimeMs(a))[0] || medoid;
        const eventIds = groupEvents.map((event) => event.__clusterEventKey).sort();
        const eventCount = eventIds.length;
        const severity = getClusterSeverity(groupEvents);
        const pulseMode = getPulseMode(groupEvents, activityScore, nowMs);
        const latestTime = latest.occurred_at || latest.published_at || null;
        const recentThreeHours = groupEvents.filter((event) => {
            const time = Date.parse(event.occurred_at || event.published_at || "");
            return Number.isFinite(time) && nowMs - time <= 3 * 3600000;
        }).length;
        const priorDay = groupEvents.filter((event) => {
            const time = Date.parse(event.occurred_at || event.published_at || "");
            return Number.isFinite(time) && nowMs - time > 3 * 3600000 && nowMs - time <= 24 * 3600000;
        }).length;
        const { __clusterEventKey: ignoredClusterKey, ...latestEvent } = latest;
        return {
            ...latestEvent,
            id: eventCount === 1 ? String(medoid.id || medoid.__clusterEventKey) : `cluster-${zoomBucket}-${hashString(eventIds.join("|"))}`,
            cluster_id: `cluster-${zoomBucket}-${hashString(eventIds.join("|"))}`,
            lat: Number(medoid.lat),
            lon: normalizeLongitude(medoid.lon),
            centroid,
            center_method: "weighted_medoid",
            bounds: buildBounds(groupEvents, Number(medoid.lon)),
            event_ids: eventIds,
            event_count: eventCount,
            actual_event_count: eventCount,
            cluster_count: eventCount,
            _clusterCount: eventCount,
            _clusterEvents: groupEvents.map((event) => {
                const { __clusterEventKey, ...original } = event;
                return original;
            }),
            weighted_activity_score: Number(activityScore.toFixed(3)),
            dominant_domain: dominance.domain,
            domain_distribution: dominance.distribution,
            domain_top_share: dominance.top_share,
            domain_lead_margin: dominance.lead_margin,
            severity,
            latest_event_time: latestTime,
            trend_inputs: {
                recent_3h_count: recentThreeHours,
                prior_3h_to_24h_count: priorDay,
            },
            pulse_mode: pulseMode,
            pulse_eligible: false,
            _dominantDomain: dominance.domain,
            _activityScore: Number(activityScore.toFixed(3)),
        };
    });
    const pulseCap = Math.max(0, Math.round(Number(options.pulseCap ?? 12)));
    const pulseIds = new Set(clusters
        .filter((cluster) => cluster.pulse_mode !== "none")
        .sort((a, b) => (
            (b.pulse_mode === "strong" ? 2 : 1) - (a.pulse_mode === "strong" ? 2 : 1)
            || b.weighted_activity_score - a.weighted_activity_score
            || String(a.id).localeCompare(String(b.id))
        ))
        .slice(0, pulseCap)
        .map((cluster) => cluster.id));
    return clusters
        .map((cluster) => ({ ...cluster, pulse_eligible: pulseIds.has(cluster.id) }))
        .sort((a, b) => b.weighted_activity_score - a.weighted_activity_score || String(a.id).localeCompare(String(b.id)));
}

export {
    DEFAULT_CLUSTER_DISTANCE_KM,
    HOTSPOT_DOMAINS,
    buildSpatialEventClusters,
    calculateEventActivityScore,
    classifyEventDomain,
    determineDominantDomain,
    getClusterDistanceKm,
    getLocationPrecision,
    getPulseMode,
    haversineDistanceKm,
    isPointClusterEligible,
    scoreToRadius,
    weightedSphericalCentroid,
};
