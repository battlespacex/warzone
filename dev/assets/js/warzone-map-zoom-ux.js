import {
    classifyEventDomain,
    isPointClusterEligible,
} from "./warzone-event-cluster-model.js";

const ZOOM_UX_STATES = Object.freeze({
    REGIONAL: "REGIONAL",
    LOCAL_STACK: "LOCAL_STACK",
    LOCALITY: "LOCALITY",
    EVENT: "EVENT",
});

const DEFAULT_ZOOM_THRESHOLDS = Object.freeze({
    regionalMinHeight: 5200000,
    localStackMinHeight: 2600000,
    localityMinHeight: 620000,
});

function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanLabel(value = "") {
    return String(value || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizedKey(value = "") {
    return cleanLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function eventTimeMs(event = {}) {
    const parsed = Date.parse(event.occurred_at || event.published_at || event.updated_at || "");
    return Number.isFinite(parsed) ? parsed : 0;
}

function getZoomUxState(cameraHeight = 0, thresholds = {}) {
    const height = Math.max(0, Number(cameraHeight) || 0);
    const regionalMinHeight = Number(thresholds.regionalMinHeight ?? DEFAULT_ZOOM_THRESHOLDS.regionalMinHeight);
    const localStackMinHeight = Number(thresholds.localStackMinHeight ?? DEFAULT_ZOOM_THRESHOLDS.localStackMinHeight);
    const localityMinHeight = Number(thresholds.localityMinHeight ?? DEFAULT_ZOOM_THRESHOLDS.localityMinHeight);
    if (height > regionalMinHeight) return ZOOM_UX_STATES.REGIONAL;
    if (height > localStackMinHeight) return ZOOM_UX_STATES.LOCAL_STACK;
    if (height > localityMinHeight) return ZOOM_UX_STATES.LOCALITY;
    return ZOOM_UX_STATES.EVENT;
}

function getClusterBucketForZoomState(zoomState, currentBucket = "regional") {
    switch (zoomState) {
        case ZOOM_UX_STATES.LOCAL_STACK: return "local";
        case ZOOM_UX_STATES.LOCALITY: return "district";
        case ZOOM_UX_STATES.EVENT: return "street";
        case ZOOM_UX_STATES.REGIONAL:
        default:
            return ["world", "theater"].includes(String(currentBucket || "").toLowerCase())
                ? String(currentBucket).toLowerCase()
                : "theater";
    }
}

function getEventLocation(event = {}) {
    const metadata = asObject(event.metadata);
    const normalization = asObject(metadata.normalization);
    const eventLocation = asObject(metadata.event_location);
    return {
        country: cleanLabel(event.event_country || eventLocation.event_country || normalization.event_country || ""),
        region: cleanLabel(event.event_region || eventLocation.event_region || normalization.event_region || event.province || ""),
        city: cleanLabel(event.event_city || eventLocation.event_city || normalization.event_city || event.city || ""),
        place: cleanLabel(event.event_place || eventLocation.event_place || normalization.event_place || event.place || ""),
        precision: String(event.location_precision || normalization.location_precision || metadata.location_precision || "UNKNOWN").toUpperCase(),
        display: cleanLabel(event.display_location_label || event.location_label || event.impact_label || ""),
    };
}

function isUsefulLocationLabel(label = "", country = "") {
    const key = normalizedKey(label);
    if (!key || key === normalizedKey(country)) return false;
    return !["unknown", "reported location", "local activity", "n a"].includes(key);
}

function chooseEventLocalityCandidate(event = {}) {
    const location = getEventLocation(event);
    if (location.precision === "EXACT" && isUsefulLocationLabel(location.place, location.country)) {
        return { label: location.place, kind: "facility", specificity: 3 };
    }
    if (isUsefulLocationLabel(location.city, location.country)) {
        return { label: location.city, kind: "city", specificity: 2 };
    }
    if (isUsefulLocationLabel(location.place, location.country)) {
        return { label: location.place, kind: "place", specificity: 2 };
    }
    if (isUsefulLocationLabel(location.region, location.country)) {
        return { label: location.region, kind: "region", specificity: 1 };
    }
    if (isUsefulLocationLabel(location.display, location.country)) {
        const first = location.display.split(",").map((part) => part.trim()).filter(Boolean)[0] || "";
        if (isUsefulLocationLabel(first, location.country)) return { label: first, kind: "display", specificity: 1 };
    }
    return null;
}

function getClusterEvents(cluster = {}) {
    const items = Array.isArray(cluster._clusterEvents) && cluster._clusterEvents.length
        ? cluster._clusterEvents
        : (Array.isArray(cluster.cluster_events) && cluster.cluster_events.length ? cluster.cluster_events : [cluster]);
    const seen = new Set();
    return items.filter((event, index) => {
        if (!event) return false;
        const key = String(event.id || event.event_id || event.dedupe_key || `${event.lat}|${event.lon}|${eventTimeMs(event)}|${index}`);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function selectClusterLocalityLabel(cluster = {}) {
    const events = getClusterEvents(cluster);
    const candidates = new Map();
    for (const event of events) {
        const candidate = chooseEventLocalityCandidate(event);
        if (!candidate) continue;
        const key = normalizedKey(candidate.label);
        const current = candidates.get(key) || { ...candidate, count: 0, latest: 0 };
        current.count += 1;
        current.latest = Math.max(current.latest, eventTimeMs(event));
        current.specificity = Math.max(current.specificity, candidate.specificity);
        candidates.set(key, current);
    }
    const minimumFacilitySupport = Math.max(1, Math.ceil(events.length * 0.5));
    const ordered = [...candidates.values()].sort((a, b) => (
        b.count - a.count || b.specificity - a.specificity || b.latest - a.latest || a.label.localeCompare(b.label)
    ));
    const supportedFacility = ordered.find((candidate) => candidate.kind === "facility" && candidate.count >= minimumFacilitySupport);
    const local = supportedFacility || ordered.find((candidate) => candidate.kind !== "facility") || ordered[0];
    return local?.label || "Local activity";
}

function clusterScreenBounds(clusters = []) {
    const visible = clusters.filter((cluster) => Number.isFinite(cluster?.screen?.x) && Number.isFinite(cluster?.screen?.y));
    if (!visible.length) return null;
    const xs = visible.map((cluster) => Number(cluster.screen.x));
    const ys = visible.map((cluster) => Number(cluster.screen.y));
    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
        centerX: xs.reduce((sum, value) => sum + value, 0) / xs.length,
        centerY: ys.reduce((sum, value) => sum + value, 0) / ys.length,
    };
}

function groupVisibleClusters(clusters = [], maxGapPx = 340) {
    const remaining = clusters.filter((cluster) => Number.isFinite(cluster?.screen?.x) && Number.isFinite(cluster?.screen?.y));
    const groups = [];
    const visited = new Set();
    for (let start = 0; start < remaining.length; start += 1) {
        if (visited.has(start)) continue;
        const indices = [start];
        const members = [];
        visited.add(start);
        while (indices.length) {
            const currentIndex = indices.shift();
            const current = remaining[currentIndex];
            members.push(current);
            for (let index = 0; index < remaining.length; index += 1) {
                if (visited.has(index)) continue;
                const candidate = remaining[index];
                const fitsGroup = members.every((member) => (
                    Math.hypot(candidate.screen.x - member.screen.x, candidate.screen.y - member.screen.y) <= maxGapPx
                ));
                if (fitsGroup) {
                    visited.add(index);
                    indices.push(index);
                }
            }
        }
        groups.push({ clusters: members, bounds: clusterScreenBounds(members) });
    }
    return groups;
}

function selectActiveClusterGroup(clusters = [], options = {}) {
    const viewportWidth = Math.max(1, Number(options.viewportWidth) || 1);
    const viewportHeight = Math.max(1, Number(options.viewportHeight) || 1);
    const groups = groupVisibleClusters(clusters, Math.max(40, Number(options.maxGapPx) || 340));
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const maxDistance = Math.hypot(centerX, centerY) || 1;
    const ranked = groups.map((group) => {
        const distance = Math.hypot(group.bounds.centerX - centerX, group.bounds.centerY - centerY);
        const proximity = Math.max(0, 1 - distance / maxDistance);
        const activity = group.clusters.reduce((sum, cluster) => sum + Math.max(0, Number(cluster.weighted_activity_score || cluster._activityScore || 0)), 0);
        const incidents = group.clusters.reduce((sum, cluster) => sum + Math.max(1, Number(cluster.actual_event_count || cluster.event_count || cluster.count || 1)), 0);
        return { ...group, relevance: Math.log1p(activity) * 1.6 + proximity * 2.4 + Math.log1p(incidents) * 0.35 };
    }).sort((a, b) => b.relevance - a.relevance || b.clusters.length - a.clusters.length || a.bounds.centerX - b.bounds.centerX);
    const best = ranked[0] || null;
    const preferredIds = new Set((options.preferredClusterIds || []).map(String));
    const switchMargin = Math.max(0, Number(options.switchMargin) || 0);
    if (!best || !preferredIds.size || !(switchMargin > 0)) return best;
    const preferred = ranked
        .map((group) => ({
            group,
            overlap: group.clusters.reduce((count, cluster) => (
                count + (preferredIds.has(String(cluster.cluster_id || cluster.id)) ? 1 : 0)
            ), 0),
        }))
        .filter((candidate) => candidate.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || b.group.relevance - a.group.relevance)[0]?.group;
    return preferred && best.relevance - preferred.relevance <= switchMargin ? preferred : best;
}

function chooseStackSide(groupBounds, options = {}) {
    if (!groupBounds) return "right";
    const viewportWidth = Math.max(1, Number(options.viewportWidth) || 1);
    const leftInset = Math.max(0, Number(options.leftInset) || 0);
    const rightInset = Math.max(0, Number(options.rightInset) || 0);
    const freeLeft = groupBounds.left - leftInset;
    const freeRight = viewportWidth - rightInset - groupBounds.right;
    const currentSide = ["left", "right"].includes(options.currentSide) ? options.currentSide : "";
    const hysteresisPx = Math.max(0, Number(options.hysteresisPx) || 0);
    const difference = freeLeft - freeRight;
    if (currentSide === "left" && difference >= -hysteresisPx) return "left";
    if (currentSide === "right" && difference <= hysteresisPx) return "right";
    return freeLeft > freeRight ? "left" : "right";
}

function selectCollisionSafeLabels(items = [], options = {}) {
    const gap = Math.max(0, Number(options.gapPx) || 0);
    const viewportWidth = Math.max(1, Number(options.viewportWidth) || Number.POSITIVE_INFINITY);
    const viewportHeight = Math.max(1, Number(options.viewportHeight) || Number.POSITIVE_INFINITY);
    const viewportPad = Math.max(0, Number(options.viewportPad) || 0);
    const requestedMax = options.maxVisible == null ? items.length : Number(options.maxVisible);
    const maxVisible = Math.max(0, Math.round(Number.isFinite(requestedMax) ? requestedMax : items.length));
    const cellSize = Math.max(32, Number(options.cellSize) || 96);
    const accepted = new Set();
    const grid = new Map();
    const ordered = items
        .filter((item) => item && item.id != null && Number.isFinite(item?.screen?.x) && Number.isFinite(item?.screen?.y))
        .slice()
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.id).localeCompare(String(b.id)));
    for (const item of ordered) {
        if (accepted.size >= maxVisible) break;
        const width = Math.max(1, Number(item.width) || 1);
        const height = Math.max(1, Number(item.height) || 1);
        const centerX = Number(item.screen.x) + Number(item.centerOffsetX || 0);
        const centerY = Number(item.screen.y) + Number(item.centerOffsetY || 0);
        const box = {
            left: centerX - width / 2 - gap,
            right: centerX + width / 2 + gap,
            top: centerY - height / 2 - gap,
            bottom: centerY + height / 2 + gap,
        };
        if (
            box.right < viewportPad || box.left > viewportWidth - viewportPad
            || box.bottom < viewportPad || box.top > viewportHeight - viewportPad
        ) continue;
        const minCellX = Math.floor(box.left / cellSize);
        const maxCellX = Math.floor(box.right / cellSize);
        const minCellY = Math.floor(box.top / cellSize);
        const maxCellY = Math.floor(box.bottom / cellSize);
        let collides = false;
        for (let x = minCellX; x <= maxCellX && !collides; x += 1) {
            for (let y = minCellY; y <= maxCellY && !collides; y += 1) {
                for (const other of grid.get(`${x}:${y}`) || []) {
                    if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) {
                        collides = true;
                        break;
                    }
                }
            }
        }
        if (collides) continue;
        accepted.add(String(item.id));
        for (let x = minCellX; x <= maxCellX; x += 1) {
            for (let y = minCellY; y <= maxCellY; y += 1) {
                const key = `${x}:${y}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(box);
            }
        }
    }
    return accepted;
}

function getTopDomains(cluster = {}, limit = 3) {
    const distribution = asObject(cluster.domain_distribution);
    const weighted = Object.entries(distribution)
        .filter(([domain, share]) => domain !== "MIXED" && Number(share) > 0)
        .map(([domain, share]) => [domain, Number(share)]);
    if (!weighted.length) {
        const counts = new Map();
        for (const event of getClusterEvents(cluster)) {
            const domain = classifyEventDomain(event);
            if (domain === "MIXED") continue;
            counts.set(domain, (counts.get(domain) || 0) + 1);
        }
        weighted.push(...counts.entries());
    }
    return weighted
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, Math.max(1, limit))
        .map(([domain]) => domain.replace(/_/g, " "));
}

function getCorroborationState(event = {}) {
    const metadata = asObject(event.metadata);
    const quality = asObject(event.event_quality || metadata.event_quality);
    return String(event.corroboration_state || event.verification_state || quality.corroboration_state || "REPORTED").toUpperCase();
}

function calculateActivityTrend(events = [], options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const windowMs = Math.max(60000, Number(options.windowMs) || 3 * 3600000);
    let recent = 0;
    let previous = 0;
    for (const event of events) {
        const age = nowMs - eventTimeMs(event);
        if (age >= 0 && age <= windowMs) recent += 1;
        else if (age > windowMs && age <= windowMs * 2) previous += 1;
    }
    if (!recent && !previous) return null;
    let state = "STEADY";
    if (recent >= previous + 1 && (previous === 0 || recent / previous >= 1.25)) state = "INCREASING";
    else if (previous >= recent + 1 && (recent === 0 || previous / recent >= 1.25)) state = "DECREASING";
    return { state, recent_count: recent, previous_count: previous };
}

function selectAreaLabel(events = []) {
    const countries = new Map();
    const regions = new Map();
    for (const event of events) {
        const location = getEventLocation(event);
        if (location.country) countries.set(location.country, (countries.get(location.country) || 0) + 1);
        if (location.region) regions.set(location.region, (regions.get(location.region) || 0) + 1);
    }
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
    const country = top(countries);
    const region = top(regions);
    if (country && region && !normalizedKey(region).includes(normalizedKey(country))) return `${country} · ${region}`;
    return region || country || "Local activity";
}

function buildLocalActivityStackModel(clusters = [], options = {}) {
    const maxEntries = Math.max(1, Math.round(Number(options.maxEntries) || 6));
    const ordered = clusters.slice().sort((a, b) => (
        Number(b.weighted_activity_score || b._activityScore || 0) - Number(a.weighted_activity_score || a._activityScore || 0)
        || eventTimeMs({ occurred_at: b.latest_event_time || b.occurred_at }) - eventTimeMs({ occurred_at: a.latest_event_time || a.occurred_at })
        || String(a.cluster_id || a.id).localeCompare(String(b.cluster_id || b.id))
    ));
    const entries = ordered.slice(0, maxEntries).map((cluster, index) => ({
        cluster_id: String(cluster.cluster_id || cluster.id),
        number: String(index + 1).padStart(2, "0"),
        locality: selectClusterLocalityLabel(cluster),
        event_count: Math.max(1, Number(cluster.actual_event_count || cluster.event_count || cluster.count || 1)),
        domains: getTopDomains(cluster, 3),
        latest_event_time: cluster.latest_event_time || cluster.occurred_at || null,
        severity: String(cluster.severity || cluster.sev || "medium").toLowerCase(),
        weighted_activity_score: Number(cluster.weighted_activity_score || cluster._activityScore || 0),
    }));
    const allEvents = [];
    const seen = new Set();
    for (const cluster of clusters) {
        for (const event of getClusterEvents(cluster)) {
            const key = String(event.id || event.event_id || event.dedupe_key || `${event.lat}|${event.lon}|${eventTimeMs(event)}`);
            if (seen.has(key)) continue;
            seen.add(key);
            allEvents.push(event);
        }
    }
    const verifiedCount = allEvents.filter((event) => ["CONFIRMED", "CORROBORATED"].includes(getCorroborationState(event))).length;
    const latestEventTime = allEvents.reduce((latest, event) => Math.max(latest, eventTimeMs(event)), 0);
    return {
        area_label: selectAreaLabel(allEvents),
        total_event_count: allEvents.length,
        latest_event_time: latestEventTime ? new Date(latestEventTime).toISOString() : null,
        verified_count: verifiedCount,
        verification_label: "CORROBORATED+",
        trend: calculateActivityTrend(allEvents, options),
        entries,
    };
}

function isIndividualEventMarkerEligible(zoomState, event = {}) {
    return zoomState === ZOOM_UX_STATES.EVENT && isPointClusterEligible(event);
}

export {
    DEFAULT_ZOOM_THRESHOLDS,
    ZOOM_UX_STATES,
    buildLocalActivityStackModel,
    calculateActivityTrend,
    chooseStackSide,
    getClusterBucketForZoomState,
    getZoomUxState,
    isIndividualEventMarkerEligible,
    selectCollisionSafeLabels,
    selectActiveClusterGroup,
    selectClusterLocalityLabel,
};
