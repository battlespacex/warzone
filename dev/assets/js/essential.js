// File Path: /assets/js/essential.js
import { initSmoothHomeAnchors } from "./home-anchors.js";
import { supabase, api } from "./supabase.js";
import { updateNewsTicker, updateDefcon } from "./warzone-ui.js";
import { createWarzoneHotspotLayer } from "./warzone-hotspots.js";
import { showSirenAlert, sirenAlertFromEvent, isSirenEvent } from "./warzone-siren-alert.js";
import { initMilitaryTracks, isMilitaryTrackEvent } from "./warzone-military-tracks.js";
import { onRegionChange, filterEventsByRegion, getActiveRegion, getActiveLens } from "./warzone-region-selector.js";
import { initLayerPanel, onLayerChange, isEventVisible, isLayerEnabled, getEventLayerId } from "./warzone-layers.js";
import { renderRanges, clearRanges } from "./warzone-ranges.js";
import { renderSweepers, clearSweepers } from "./warzone-sweeper.js";
import { resolveEventTheater, getTheaterById } from "./warzone-theaters.js";
import { theaterMatchesRegion } from "./warzone-theaters.js";
import { updateTheaterPanel } from "./warzone-theater-panel.js";
import { resolveDisplayCoordinates, eventMatchesBounds } from "./warzone-location-resolver.js";
import {
    upsertLiveTrack,
    clearLiveTrack,
    startDevTrackSimulation,
    stopDevTrackSimulation,
    focusLiveTrack,
    getAllLiveTrackSnapshots,
    toggleLiveTrackSelection,
    getLiveTrackSelection,
} from "./warzone-live-fighter.js";
import { startPublicAirIngestion } from "./warzone-air-ingestion.js";
let __eventsCache = [];
let __visibleEventsCache = [];
let __viewportScoped = false;
let __liveRecentEvents = [];
let __alertAudio = null;
let __scrollClassBound = false;
let __scrollToTargetBound = false;
let __lastSeenOccurredAt = null;
let __hotspotLayer = null;
let __militaryTracks = null;
let __pollTimer = null;
let __viewportFetchTimer = null;
let __lastViewportKey = "";
let __lastGlobeSyncKey = "";
let __lastRangesSyncKey = "";
let __lastSweepersSyncKey = "";
let __aircraftWidgetBound = false;
let __aircraftWidgetFilter = "active";
let __aircraftWidgetSubtypeFilter = "all";
let __aircraftHistoryCache = [];
let __aircraftHistoryLastLoadedAt = 0;
let __aircraftHistoryLoadingPromise = null;
let __aircraftWidgetRenderTimer = 0;
let __aircraftHistoryRefreshTimer = 0;
let __aircraftSubtypeOptionsKey = "";
let __widgetLoadingState = new Map();
const LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = 18;
const AIRCRAFT_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AIRCRAFT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_REFRESH_MS = 3 * 60 * 1000;
const AIRCRAFT_WIDGET_RENDER_THROTTLE_MS = 120;
function isEventInLens(event, lens) {
    if (!event) return false;
    const category = String(event.category || "").toLowerCase();
    const severity = String(event.severity || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const place = eventPlaceText(event);
    const occurredAt = new Date(event.occurred_at || 0).getTime();
    const ageMs = Date.now() - occurredAt;
    const isRecent = Number.isFinite(ageMs) && ageMs <= 14 * 24 * 60 * 60 * 1000;
    const isHighSignal =
        category === "alert" ||
        category === "strike" ||
        category === "military" ||
        severity === "critical" ||
        severity === "high";
    const isStandoffZone =
        place.includes("kashmir") ||
        place.includes("taiwan") ||
        place.includes("south china sea") ||
        place.includes("north korea") ||
        place.includes("south korea") ||
        place.includes("korean peninsula") ||
        place.includes("palestine") ||
        place.includes("israel") ||
        place.includes("levant") ||
        place.includes("armenia") ||
        place.includes("azerbaijan") ||
        place.includes("gulf");
    switch (lens) {
        case "flashpoint":
            return isHighSignal || isRecent;
        case "standoff":
            return isStandoffZone ||
                category === "military" ||
                category === "airspace" ||
                category === "cyber" ||
                weapon.includes("naval") ||
                weapon.includes("fighter") ||
                weapon.includes("missile");
        case "all":
            return true;
        case "live":
            return isRecent || isHighSignal || category === "cyber" || category === "airspace" || category === "thermal" || category === "recon" || category === "military";
        default:
            return true;
    }
}
// Frontend civilian noise blocklist — mirrors worker-side list
const FRONTEND_CIVILIAN_NOISE = [
    "murder", "homicide", "stabbing", "robbery", "armed robbery",
    "carjacking", "kidnapping", "domestic violence", "sexual assault",
    "gang shooting", "drive-by", "mass shooting", "school shooting",
    "police chase", "police arrest", "drug bust", "narcotics",
    "sheriff", "law enforcement", "crime scene", "criminal investigation",
    "car accident", "traffic accident", "road accident", "train derailment",
    "gas leak", "house fire", "building fire", "chemical spill",
    "election", "vote", "ballot", "parliament", "sanctions",
    "ceasefire talks", "peace talks", "trade war", "stock market",
    "protest", "demonstration", "refugee", "migrant",
    "weather alert", "storm warning", "flood warning", "earthquake alert"
];

function isMilitaryRelevant(event) {
    const category = String(event.category || "").toLowerCase();
    const text = [
        event.title,
        event.summary,
        event.description,
        event.weapon_type,
        event.subtype,
        event.subcategory,
        event.source_name
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    // Hard reject civilian noise first
    if (FRONTEND_CIVILIAN_NOISE.some((term) => text.includes(term))) return false;

    // Trusted military categories always pass
    if ([
        "strike", "military", "cyber", "airspace",
        "recon", "thermal", "alert", "signal", "seismic", "network"
    ].includes(category)) return true;

    // Must contain at least one hard military signal
    if (
        text.includes("missile") ||
        text.includes("rocket attack") ||
        text.includes("rocket barrage") ||
        text.includes("drone strike") ||
        text.includes("drone attack") ||
        text.includes("uav strike") ||
        text.includes("airstrike") ||
        text.includes("air strike") ||
        text.includes("air raid") ||
        text.includes("bombardment") ||
        text.includes("artillery") ||
        text.includes("shelling") ||
        text.includes("fighter jet") ||
        text.includes("combat aircraft") ||
        text.includes("awacs") ||
        text.includes("naval") ||
        text.includes("warship") ||
        text.includes("frigate") ||
        text.includes("destroyer") ||
        text.includes("carrier group") ||
        text.includes("submarine") ||
        text.includes("air defense") ||
        text.includes("air-defence") ||
        text.includes("sam site") ||
        text.includes("military base") ||
        text.includes("military convoy") ||
        text.includes("troop movement") ||
        text.includes("ground offensive") ||
        text.includes("red alert") ||
        text.includes("take shelter") ||
        text.includes("siren") ||
        text.includes("sortie") ||
        text.includes("intercept") ||
        text.includes("notam") ||
        text.includes("cyberattack") ||
        text.includes("cyber attack")
    ) {
        return true;
    }

    return false;
}
function resolveStrikeGeometry(event) {
    // keep real data if already present
    if (
        typeof event.origin_lat === "number" &&
        typeof event.origin_lon === "number" &&
        typeof event.impact_lat === "number" &&
        typeof event.impact_lon === "number"
    ) {
        return event;
    }
    const text = `
        ${event.title || ""}
        ${event.summary || ""}
        ${event.location || ""}
        ${event.country || ""}
        ${event.category || ""}
        ${event.subcategory || ""}
        ${event.weapon_type || ""}
    `.toLowerCase();
    const isStrikeLike =
        text.includes("missile") ||
        text.includes("rocket") ||
        text.includes("drone") ||
        text.includes("uav") ||
        text.includes("airstrike") ||
        text.includes("air strike");
    if (!isStrikeLike) return event;
    // no real origin data available → do not fake it
    return {
        ...event,
        impact_lat: event.impact_lat ?? event.lat ?? null,
        impact_lon: event.impact_lon ?? event.lon ?? null
    };
}
function applyAllFilters(events) {
    const region = getActiveRegion?.();
    const lens = getActiveLens?.() || "live";
    const regionalRaw = filterEventsByRegion ? filterEventsByRegion(events, region) : events;
    const regional = regionalRaw.filter(isMilitaryRelevant);
    const byLens = regional.filter((e) => isEventInLens(e, lens));
    return byLens.filter((e) => isEventVisible(e));
}
function roundCoord(value, step = 2) {
    return Math.round(Number(value) / step) * step;
}
function makeViewportKey(bounds, regionId = "global") {
    if (!bounds) return `${regionId}:none`;
    return [
        regionId,
        roundCoord(bounds.minLat, 2),
        roundCoord(bounds.maxLat, 2),
        roundCoord(bounds.minLon, 2),
        roundCoord(bounds.maxLon, 2),
    ].join("|");
}
function makeEventSignature(events = []) {
    return events
        .map((event) => `${event.id || ""}:${event.occurred_at || ""}`)
        .join("|");
}
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
const debouncedRenderUI = debounce((events) => {
    renderStrikeCounters(events);
    renderCyberStatus(events);
    renderAirspaceStatus(events);
    renderEscalation(events);
}, 800);
const debouncedRenderFeed = debounce((events) => {
    renderFeed(events);
}, 400);
const debouncedRenderHeavy = debounce((events) => {
    renderSummary(events);
    renderTimeline(events);
    renderAnalytics(events);
    renderRecon(events);
    renderWeapons(events);
    renderKillChain(events);
}, 2000);
function scheduleViewportFetch(delay = 500) {
    clearTimeout(__viewportFetchTimer);
    __viewportFetchTimer = setTimeout(() => {
        fetchViewportEvents();
    }, delay);
}
function bindScrollClassToggles() {
    if (__scrollClassBound) return;
    __scrollClassBound = true;
    const body = document.body;
    const main = document.querySelector("main");
    const docEl = document.scrollingElement || document.documentElement;
    let ticking = false;
    let lastScrolled = null;
    const getScrollContainer = () => {
        const docScrollable = docEl.scrollHeight - docEl.clientHeight > 2;
        if (docScrollable) return window;
        if (main && main.scrollHeight - main.clientHeight > 2) return main;
        return window;
    };
    let scroller = getScrollContainer();
    const getScrollTop = () => {
        if (scroller === window) {
            return window.pageYOffset || docEl.scrollTop || document.body.scrollTop || 0;
        }
        return scroller.scrollTop || 0;
    };
    const apply = () => {
        const scrolled = getScrollTop() > 2;
        if (scrolled !== lastScrolled) {
            lastScrolled = scrolled;
            body.classList.toggle("on--scroll", scrolled);
        }
        ticking = false;
    };
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(apply);
    };
    const refreshScroller = () => {
        scroller = getScrollContainer();
        apply();
    };
    refreshScroller();
    window.addEventListener("scroll", onScroll, { passive: true });
    if (main) main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", refreshScroller, { passive: true });
}
function bindScrollToTargets() {
    if (__scrollToTargetBound) return;
    __scrollToTargetBound = true;
    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-target]");
        if (!btn) return;
        const el = document.querySelector(btn.dataset.target);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    });
}
function initNav() {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
}
function formatTime(value) {
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value || "";
    }
}
function normalizeEvent(event = {}) {
    const sourceLat = event.source_lat ?? event.raw_lat ?? event.lat ?? event.latitude ?? null;
    const sourceLon = event.source_lon ?? event.raw_lon ?? event.lon ?? event.longitude ?? null;
    const impactLatRaw = event.impact_lat ?? event.impactLatitude ?? event.impactLat ?? null;
    const impactLonRaw = event.impact_lon ?? event.impactLongitude ?? event.impactLon ?? null;
    const base = {
        ...event,
        id: event.id || crypto.randomUUID?.() || `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: event.title || "",
        summary: event.summary || "",
        category: event.category || "",
        subcategory: event.subcategory || "",
        weapon_type: event.weapon_type || "",
        source_lat: sourceLat != null ? Number(sourceLat) : null,
        source_lon: sourceLon != null ? Number(sourceLon) : null,
        impact_lat: impactLatRaw != null ? Number(impactLatRaw) : null,
        impact_lon: impactLonRaw != null ? Number(impactLonRaw) : null,
        origin_lat: event.origin_lat != null ? Number(event.origin_lat) : null,
        origin_lon: event.origin_lon != null ? Number(event.origin_lon) : null,
        country: event.country || event.countryName || "",
        city: event.city || "",
        province: event.province || event.state || event.admin1 || "",
        location: event.location || "",
        location_label: event.location_label || event.impact_label || event.country || "",
        impact_label: event.impact_label || event.location_label || event.country || "",
        occurred_at: event.occurred_at || new Date().toISOString()
    };
    const placement = resolveDisplayCoordinates(base);
    const normalized = {
        ...base,
        display_lat: placement.lat,
        display_lon: placement.lon,
        display_source: placement.reason,
        display_precision: placement.precision,
        inferred_place_type: placement.placeType,
        inferred_country_code: placement.countryCode,
        inferred_country_name: placement.countryName,
        inferred_place_name: placement.resolvedPlaceName,
        location_mismatch: placement.mismatch,
        lat: placement.lat,
        lon: placement.lon
    };
    const impactFirstCategory = ["strike", "alert", "airspace", "thermal", "signal", "seismic", "cyber"].includes(
        String(normalized.category || "").toLowerCase()
    );
    if (
        impactFirstCategory &&
        (!Number.isFinite(normalized.impact_lat) || !Number.isFinite(normalized.impact_lon))
    ) {
        normalized.impact_lat = normalized.display_lat;
        normalized.impact_lon = normalized.display_lon;
    }
    return normalized;
}
function isTrackLikeEvent(event) {
    if (!isMilitaryRelevant(event)) return false;
    const hasOrigin =
        typeof event.origin_lat === "number" &&
        typeof event.origin_lon === "number";
    const hasImpact =
        typeof event.impact_lat === "number" &&
        typeof event.impact_lon === "number";
    if (!hasOrigin || !hasImpact) return false;
    const samePoint =
        Math.abs(event.origin_lat - event.impact_lat) < 0.01 &&
        Math.abs(event.origin_lon - event.impact_lon) < 0.01;
    if (samePoint) return false;
    return true;
}
async function fetchViewportEvents() {
    const region = getActiveRegion?.();
    const regionId = region?.id || "global";
    const globe = window.__warzoneViewer?.__warzone;
    const bounds = globe?.getViewportBounds?.();
    const viewportKey = makeViewportKey(bounds, regionId);
    if (viewportKey === __lastViewportKey) return;
    __lastViewportKey = viewportKey;
    try {
        const merged = [];
        const seen = new Set();
        const pushUnique = (evt) => {
            const normalized = normalizeEvent(evt);
            const key = String(normalized.id || `${normalized.title}-${normalized.occurred_at}`);
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(normalized);
        };
        __eventsCache.forEach(pushUnique);
        __liveRecentEvents.forEach(pushUnique);
        const visible = merged.filter((evt) => {
            if (!bounds) return true;
            return eventMatchesBounds(evt, bounds);
        });
        const nextVisibleEvents = sortEvents(visible);
        __viewportScoped = true;
        __visibleEventsCache = nextVisibleEvents;
        syncFilteredUi(nextVisibleEvents);
        requestAnimationFrame(() => {
            syncInitialEventsToGlobe(nextVisibleEvents, { animateTracks: false });
            if (__hotspotLayer) {
                const hotspotEvents = applyAllFilters(nextVisibleEvents);
                __hotspotLayer.setEvents(hotspotEvents);
            }
            window.__warzoneViewer?.scene?.requestRender?.();
        });
    } catch (err) {
        console.error("Viewport fetch failed:", err);
    }
}
function sortEvents(events) {
    return [...events].sort((a, b) => {
        const aa = new Date(a.occurred_at || 0).getTime();
        const bb = new Date(b.occurred_at || 0).getTime();
        return bb - aa;
    });
}
const REGION_COUNTRY_HINTS = {
    global: [],
    middle_east: ["Israel", "Palestine", "Lebanon", "Syria", "Jordan", "Iraq", "Iran", "Saudi Arabia", "United Arab Emirates", "Yemen", "Qatar", "Bahrain", "Oman", "Kuwait", "Turkey", "Egypt"],
    levant: ["Israel", "Palestine", "Lebanon", "Syria", "Jordan", "Cyprus", "Turkey", "Egypt"],
    ukraine: ["Ukraine", "Russia", "Belarus", "Poland", "Romania", "Moldova", "Lithuania", "Latvia", "Estonia"],
    south_asia: ["Pakistan", "India", "Afghanistan", "China", "Bangladesh", "Sri Lanka", "Nepal"],
    europe: ["Ukraine", "Russia", "Poland", "Romania", "Germany", "France", "United Kingdom", "Belarus", "Lithuania", "Latvia", "Estonia"],
    north_america: ["United States", "Canada", "Mexico", "Greenland"],
    east_asia: ["China", "Taiwan", "North Korea", "South Korea", "Japan", "Philippines", "Vietnam"],
    africa: ["Sudan", "South Sudan", "Ethiopia", "Somalia", "Democratic Republic of the Congo", "Mali", "Niger", "Burkina Faso", "Libya"],
};
const COUNTRY_NAME_ALIASES = {
    "us": "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
    "usa": "United States",
    "america": "United States",
    "united states of america": "United States",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "britain": "United Kingdom",
    "great britain": "United Kingdom",
    "uae": "United Arab Emirates",
    "u.a.e.": "United Arab Emirates",
    "dr congo": "Democratic Republic of the Congo",
    "drc": "Democratic Republic of the Congo",
    "congo kinshasa": "Democratic Republic of the Congo",
    "russian federation": "Russia",
    "republic of korea": "South Korea",
    "korea republic of": "South Korea",
    "democratic people's republic of korea": "North Korea",
    "dprk": "North Korea",
    "czech republic": "Czechia",
    "ivory coast": "Côte d’Ivoire",
    "laos": "Lao People's Democratic Republic",
    "syria": "Syrian Arab Republic",
    "iran": "Iran, Islamic Republic of",
    "moldova": "Moldova, Republic of",
    "venezuela": "Venezuela, Bolivarian Republic of",
    "bolivia": "Bolivia, Plurinational State of",
    "tanzania": "Tanzania, United Republic of",
    "vietnam": "Viet Nam",
    "u.n": "United Nation",
    "un": "United Nation"
};
function normalizeCountryName(value) {
    const raw = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    return COUNTRY_NAME_ALIASES[lower] || raw;
}
function normalizePlace(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/[|]/g, ",")
        .trim();
}
function compactEventPlaceLabel(event = {}) {
    const raw =
        event.location_label ||
        event.impact_label ||
        event.origin_label ||
        event.country ||
        event.region ||
        "";
    const clean = String(raw).trim();
    if (!clean) return "Unknown location";
    const bits = clean.split(",").map((x) => x.trim()).filter(Boolean);
    if (bits.length > 1) {
        const last = bits[bits.length - 1];
        if (/[a-z]/i.test(last) && !/\d/.test(last)) {
            return last;
        }
    }
    return bits[0] || clean;
}
function eventPlaceText(event) {
    return [
        event.location_label,
        event.impact_label,
        event.origin_label,
        event.country,
        event.countryName,
        event.region,
        event.state,
        event.city,
        event.location,
        event.name,
        Array.isArray(event.tags) ? event.tags.join(" ") : "",
    ]
        .filter(Boolean)
        .join(" | ")
        .toLowerCase();
}
function getEventResolvedCountry(event = {}) {
    const direct = normalizeCountryName(
        event.inferred_country_name ||
        event.country ||
        event.countryName ||
        ""
    );
    if (direct) return direct;
    const placeType = String(event.inferred_place_type || "").toLowerCase();
    if (placeType === "country" || placeType === "capital" || placeType === "subdivision") {
        const inferred = normalizeCountryName(event.inferred_place_name || "");
        if (inferred) return inferred;
    }
    return "";
}
function getRegionCountryWhitelist(regionId = "global") {
    return new Set((REGION_COUNTRY_HINTS[regionId] || []).map(normalizeCountryName).filter(Boolean));
}
function getCountryMatchCount(events, country) {
    const canonical = normalizeCountryName(country);
    if (!canonical) return 0;
    return events.reduce((count, event) => {
        return count + (getEventResolvedCountry(event) === canonical ? 1 : 0);
    }, 0);
}
function countryMentionCount(events, country) {
    const canonical = normalizeCountryName(country);
    if (!canonical) return 0;
    return getCountryMatchCount(events, canonical);
}
function deriveFocusCountries(events, max = 10) {
    const lens = getActiveLens?.() || "live";
    const regionId = getActiveRegion?.()?.id || "global";
    const whitelist = getRegionCountryWhitelist(regionId);
    const scoreCountry = (name) => {
        const canonical = normalizeCountryName(name);
        if (!canonical) return 0;
        return events.reduce((score, event) => {
            if (getEventResolvedCountry(event) !== canonical) return score;
            const category = String(event.category || "").toLowerCase();
            const severity = String(event.severity || "").toLowerCase();
            const airspace = String(event.airspace_status || "").toLowerCase();
            const cyber = String(event.cyber_status || "").toLowerCase();
            const occurredAt = new Date(event.occurred_at || 0).getTime();
            const ageMs = Date.now() - occurredAt;
            let points = 1;
            if (category === "alert") points += 6;
            if (category === "strike") points += 5;
            if (category === "military") points += 4;
            if (category === "cyber") points += 3;
            if (category === "thermal") points += 2;
            if (severity === "critical") points += 6;
            else if (severity === "high") points += 4;
            else if (severity === "medium") points += 2;
            if (airspace === "closed") points += 6;
            else if (airspace === "restricted") points += 3;
            if (cyber === "critical") points += 4;
            else if (cyber === "high" || cyber === "elevated") points += 2;
            if (Number.isFinite(ageMs)) {
                if (ageMs <= 6 * 60 * 60 * 1000) points += 4;
                else if (ageMs <= 24 * 60 * 60 * 1000) points += 2;
            }
            return score + points;
        }, 0);
    };
    const dynamic = [...new Set(
        events
            .map((event) => getEventResolvedCountry(event))
            .filter(Boolean)
            .filter((country) => !whitelist.size || whitelist.has(country))
    )]
        .map((name) => ({ name, score: scoreCountry(name), count: getCountryMatchCount(events, name) }))
        .filter((item) => item.score > 0 || item.count > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
        })
        .map((item) => item.name);
    const fallbackHints = [...whitelist]
        .filter((name) => !dynamic.includes(name))
        .map((name) => ({ name, score: scoreCountry(name), count: getCountryMatchCount(events, name) }))
        .filter((item) => item.score > 0 || item.count > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name);
        })
        .map((item) => item.name);
    const merged = [...dynamic, ...fallbackHints];
    if (lens === "flashpoint") {
        return merged.slice(0, max);
    }
    return merged.slice(0, max);
}
function getEventTimestamp(event = {}) {
    const raw =
        event.occurred_at ||
        event.timestamp ||
        event.time ||
        event.datetime ||
        event.occurredAt ||
        event.publishedAt ||
        event.updatedAt ||
        event.updated_at ||
        event.createdAt ||
        event.created_at;
    const ts = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(ts) ? ts : 0;
}
function getEventSeverityScore(event = {}) {
    const severityMap = {
        critical: 5,
        severe: 4,
        high: 4,
        elevated: 3,
        medium: 3,
        moderate: 2,
        low: 1,
        minimal: 1
    };
    const severityRaw =
        String(event.severity || event.priority || event.level || "")
            .toLowerCase()
            .trim();
    let score = severityMap[severityRaw] || 0;
    const typeText = String(
        [
            event.category,
            event.subtype,
            event.type,
            event.title,
            event.summary
        ]
            .filter(Boolean)
            .join(" ")
    ).toLowerCase();
    if (/strike|missile|ballistic|drone attack|airstrike/.test(typeText)) score += 4;
    else if (/airspace|closure|intercept|scramble|military/.test(typeText)) score += 3;
    else if (/cyber|outage|jamming|gps spoof|disruption/.test(typeText)) score += 2;
    else if (/alert|warning|advisory/.test(typeText)) score += 1;
    return score;
}
function getRecencyScore(event = {}) {
    const ts = getEventTimestamp(event);
    if (!ts) return 0;
    const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
    if (ageHours <= 6) return 5;
    if (ageHours <= 24) return 4;
    if (ageHours <= 72) return 3;
    if (ageHours <= 168) return 2;
    if (ageHours <= 336) return 1;
    return 0;
}
function getTheaterEventWeight(event = {}) {
    const text = String(
        [
            event.category,
            event.subtype,
            event.type,
            event.title,
            event.summary
        ]
            .filter(Boolean)
            .join(" ")
    ).toLowerCase();
    if (/strike|missile|ballistic|airstrike|uav strike|drone attack/.test(text)) return 5;
    if (/military|airspace|naval|carrier|awacs|intercept|troop/.test(text)) return 4;
    if (/cyber|jam|spoof|outage|intrusion/.test(text)) return 3;
    if (/alert|warning|advisory/.test(text)) return 2;
    return 1;
}
function theaterPassesLens(theaterDef, lensValue) {
    if (!lensValue || lensValue === "all") return true;
    if (!theaterDef?.lenses?.length) return true;
    return theaterDef.lenses.includes(lensValue) || theaterDef.lenses.includes("all");
}
export function deriveFocusTheaters(events = [], lensValue = "all", limit = 8) {
    const bucket = new Map();
    for (const event of events) {
        const theater = resolveEventTheater(event);
        if (!theater) continue;
        const theaterDef = getTheaterById(theater.id);
        if (!theaterPassesLens(theaterDef, lensValue)) continue;
        const activeRegion = getActiveRegion?.();
        if (!theaterMatchesRegion(theater, activeRegion)) continue;
        const severityScore = getEventSeverityScore(event);
        const recencyScore = getRecencyScore(event);
        const eventWeight = getTheaterEventWeight(event);
        const densityIncrement = 1;
        const weightedScore =
            ((severityScore * 2) + recencyScore + eventWeight + densityIncrement) *
            (theater.weight || 1);
        if (!bucket.has(theater.id)) {
            bucket.set(theater.id, {
                id: theater.id,
                label: theater.label,
                region: theater.region,
                score: 0,
                density: 0,
                maxSeverity: 0,
                latestTimestamp: 0,
                events: []
            });
        }
        const item = bucket.get(theater.id);
        item.score += weightedScore;
        item.density += 1;
        item.maxSeverity = Math.max(item.maxSeverity, severityScore);
        item.latestTimestamp = Math.max(item.latestTimestamp, getEventTimestamp(event));
        item.events.push(event);
    }
    return [...bucket.values()]
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.maxSeverity !== a.maxSeverity) return b.maxSeverity - a.maxSeverity;
            if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
            return b.density - a.density;
        })
        .slice(0, limit);
}
export function deriveTheaterStatus(theaterItem = {}) {
    const score = Number(theaterItem.score || 0);
    const density = Number(theaterItem.density || 0);
    const maxSeverity = Number(theaterItem.maxSeverity || 0);
    if (maxSeverity >= 7 || score >= 40) {
        return "CLOSED";
    }
    if (maxSeverity >= 5 || score >= 24 || density >= 4) {
        return "RESTRICTED";
    }
    if (maxSeverity >= 3 || score >= 12 || density >= 2) {
        return "ELEVATED";
    }
    return "NORMAL";
}
function deriveCountryStatus(events, country, type = "airspace") {
    const canonical = normalizeCountryName(country);
    const relevant = events.filter((event) =>
        getEventResolvedCountry(event) === canonical
    );
    if (!relevant.length) return "unknown";
    if (type === "cyber") {
        const cyberEvents = relevant.filter(
            (e) => String(e.category || "").toLowerCase() === "cyber"
        );
        if (!cyberEvents.length) return "normal";
        if (
            cyberEvents.some((e) =>
                ["critical", "high"].includes(String(e.severity || "").toLowerCase())
            )
        ) {
            return "critical";
        }
        if (
            cyberEvents.some((e) =>
                ["critical", "high", "elevated", "degraded", "disrupted"].includes(
                    String(e.cyber_status || "").toLowerCase()
                )
            )
        ) {
            return "high";
        }
        return "elevated";
    }
    const explicitStatuses = relevant
        .map((e) => String(e.airspace_status || "").toLowerCase())
        .filter((s) => s && s !== "unknown");
    if (explicitStatuses.includes("closed")) return "closed";
    if (explicitStatuses.includes("restricted")) return "restricted";
    if (explicitStatuses.includes("elevated")) return "elevated";
    if (explicitStatuses.includes("normal")) return "normal";
    const alertsCount = relevant.filter(
        (e) => String(e.category || "").toLowerCase() === "alert"
    ).length;
    const recentCutoff = Date.now() - 2 * 60 * 60 * 1000;
    const kineticCount = relevant.filter((e) => {
        const t = new Date(e.occurred_at).getTime();
        const cat = String(e.category || "").toLowerCase();
        return t > recentCutoff && (cat === "strike" || cat === "military");
    }).length;
    if (alertsCount >= 5 || kineticCount >= 3) return "closed";
    if (alertsCount >= 2 || kineticCount >= 1) return "restricted";
    return "normal";
}
function topActors(events, max = 3) {
    return countBy(events, (e) => e.actor_side || "unknown")
        .filter(([name]) => name !== "unknown")
        .slice(0, max);
}
function topLocations(events, max = 3) {
    return countBy(events, (e) => e.location_label || e.impact_label || "unknown")
        .filter(([name]) => name !== "unknown")
        .slice(0, max);
}
function countBy(events, key) {
    const out = new Map();
    for (const item of events) {
        const raw = typeof key === "function" ? key(item) : item[key];
        const value = String(raw || "unknown");
        out.set(value, (out.get(value) || 0) + 1);
    }
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
}
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}
function renderFeed(events) {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;
    feed.innerHTML = "";
    const rows = events.slice(0, 40);
    if (!rows.length) {
        feed.innerHTML = '<div class="feed-empty">No events available yet.</div>';
        return;
    }
    rows.forEach((event) => {
        const card = document.createElement("article");
        card.className = "feed-card";
        card.dataset.eventId = event.id;
        const safeUrl = /^https?:\/\//i.test(event.source_url || "") ? event.source_url : "";
        card.innerHTML = `
            <div class="feed-card__meta">
                <span class="feed-pill">${event.category || "unknown"}</span>
                <time>${formatTime(event.occurred_at)}</time>
            </div>
            <h3 class="feed-card__title">${event.title || "Untitled event"}</h3>
            <p class="feed-card__summary">${event.summary || "No summary available."}</p>
            <div class="feed-card__foot">
                <span>${compactEventPlaceLabel(event)}</span>
                ${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
            </div>
        `;
        feed.appendChild(card);
    });
}
function renderStrikeCounters(events) {
    const mapped = events.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon)).length;
    const topSides = countBy(events, (e) => e.actor_side || "unknown")
        .filter(([name]) => name !== "unknown")
        .slice(0, 2);
    const primaryActor = topSides[0] ? `${topSides[0][0]} (${topSides[0][1]})` : "--";
    const secondaryActor = topSides[1] ? `${topSides[1][0]} (${topSides[1][1]})` : "--";
    setText("stat-total", events.length);
    setText("stat-mapped", mapped);
    setText("analytics-total", events.length);
    setText("analytics-iran", primaryActor);
    setText("analytics-usisr", secondaryActor);
    const latest = events[0]?.occurred_at ? new Date(events[0].occurred_at) : null;
    const oldest = events[events.length - 1]?.occurred_at ? new Date(events[events.length - 1].occurred_at) : null;
    const range = latest && oldest
        ? `${String(oldest.getMonth() + 1).padStart(2, "0")}-${String(oldest.getDate()).padStart(2, "0")} → ${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`
        : "--";
    setText("analytics-range", range);
}
function statusPriority(status) {
    switch (String(status || "").toLowerCase()) {
        case "closed":
        case "critical":
            return 4;
        case "restricted":
        case "high":
            return 3;
        case "elevated":
            return 2;
        case "normal":
            return 1;
        default:
            return 0;
    }
}
function rankCountryRows(events, type, max = 10) {
    const regionId = getActiveRegion?.()?.id || "global";
    const whitelist = getRegionCountryWhitelist(regionId);
    const countries = deriveFocusCountries(events, Math.max(max, 20));
    const rows = countries
        .filter((country) => !whitelist.size || whitelist.has(normalizeCountryName(country)))
        .map((country) => {
            const canonical = normalizeCountryName(country);
            const status = deriveCountryStatus(events, canonical, type);
            const relatedCount = getCountryMatchCount(events, canonical);
            return {
                label: canonical,
                status,
                relatedCount,
                priority: statusPriority(status),
            };
        })
        .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if (b.relatedCount !== a.relatedCount) return b.relatedCount - a.relatedCount;
            return a.label.localeCompare(b.label);
        });
    const strongRows = rows.filter((row) => row.relatedCount > 0 || row.status !== "unknown");
    return (strongRows.length ? strongRows : rows).slice(0, max);
}
function renderCyberStatus(events) {
    const container = document.getElementById("cyber-status-list");
    if (!container) return;
    const rows = rankCountryRows(events, "cyber", 8);
    if (!rows.length) {
        container.innerHTML = '<div class="status-row"><span>No cyber signals</span><strong class="status-pill status-pill--unknown">Unknown</strong></div>';
        return;
    }
    const markup = rows.map((row) => {
        const status = String(row.status || "unknown").toLowerCase();
        const label = status.charAt(0).toUpperCase() + status.slice(1);
        return `
            <div class="status-row">
                <span>${row.label}</span>
                <strong class="status-pill status-pill--${status}">${label}</strong>
            </div>
        `;
    }).join("");
    container.innerHTML = markup;
}
function renderAirspaceStatus(events) {
    const container = document.getElementById("airspace-status-list");
    if (!container) return;
    const rows = rankCountryRows(events, "airspace", 10);
    if (!rows.length) {
        container.innerHTML = '<div class="status-row"><span>No regional airspace signals</span><strong class="status-pill status-pill--unknown">Unknown</strong></div>';
        return;
    }
    const markup = rows.map((row) => {
        const status = String(row.status || "unknown").toLowerCase();
        const label = status.charAt(0).toUpperCase() + status.slice(1);
        return `
            <div class="status-row">
                <span>${row.label}</span>
                <strong class="status-pill status-pill--${status}">${label}</strong>
            </div>
        `;
    }).join("");
    container.innerHTML = markup;
}
function renderEscalation(events) {
    const critical = events.filter((e) => e.severity === "critical").length;
    const high = events.filter((e) => e.severity === "high").length;
    const alerts = events.filter((e) => e.category === "alert").length;
    const strikes = events.filter((e) => e.category === "strike").length;
    const military = events.filter((e) => e.category === "military").length;
    const recon = events.filter((e) => e.category === "recon").length;
    const closedAirspace = events.filter((e) => e.airspace_status === "closed").length;
    const rawScore =
        critical * 12 +
        high * 6 +
        alerts * 5 +
        strikes * 4 +
        military * 3 +
        recon * 2 +
        closedAirspace * 8;
    const score = Math.min(200, rawScore);
    let label = "Moderate";
    if (score >= 160) label = "Extreme";
    else if (score >= 120) label = "Critical";
    else if (score >= 80) label = "High";
    else if (score >= 45) label = "Elevated";
    setText("escalation-score", score);
    setText("escalation-label", label);
    updateDefcon(score);
    const list = document.getElementById("escalation-breakdown");
    if (!list) return;
    list.innerHTML = `
        <li>${critical} critical incidents</li>
        <li>${high} high severity incidents</li>
        <li>${alerts} active alerts / sirens</li>
        <li>${closedAirspace} airspace closures</li>
        <li>${events.length} total incidents in window</li>
    `;
}
function getLensLabel(lens) {
    switch (lens) {
        case "flashpoint": return "Global Flashpoints";
        case "standoff": return "Long-Standing Standoffs";
        case "all": return "All Events";
        default: return "Current Ongoing Conflicts";
    }
}
function renderSummary(events) {
    const p = document.getElementById("executive-summary");
    const meta = document.getElementById("intel-meta-line");
    if (!p || !meta) return;
    const region = getActiveRegion?.();
    const lens = getActiveLens?.() || "live";
    const lensLabel = getLensLabel(lens);
    const regionLabel = region?.label || "Global View";
    const topTheaters = deriveFocusTheaters(events, getActiveLens?.() || "live", 3)
        .map(t => t.label)
        .join(", ");
    const topWeapons = countBy(events, "weapon_type")
        .filter(([name]) => name && name !== "unknown")
        .slice(0, 3)
        .map(([name]) => name)
        .join(", ");
    const criticalCount = events.filter((e) => String(e.severity || "").toLowerCase() === "critical").length;
    const highCount = events.filter((e) => String(e.severity || "").toLowerCase() === "high").length;
    const alertCount = events.filter((e) => String(e.category || "").toLowerCase() === "alert").length;
    const strikeCount = events.filter((e) => String(e.category || "").toLowerCase() === "strike").length;
    p.textContent = `${lensLabel} view is currently focused on ${regionLabel}. The active event picture shows ${events.length} mapped incidents, including ${strikeCount} strike-related events and ${alertCount} alert-driven signals. High-severity activity remains elevated with ${criticalCount} critical and ${highCount} high-severity records in the current filtered stream. Primary theaters currently surfacing in this view are ${topTheaters || "mixed strategic areas"}, while the most frequently observed weapon categories are ${topWeapons || "mixed systems"}.`;
    meta.textContent = `Generated: ${new Date().toLocaleString()} | Lens: ${lensLabel} | Region: ${regionLabel} | Incidents analyzed: ${events.length}`;
}
function renderTimeline(events) {
    const wrap = document.getElementById("timeline-list");
    if (!wrap) return;
    const items = events.slice(0, 15).map((event) => `
        <div class="timeline-item">
            <div class="timeline-time">${formatTime(event.occurred_at)}</div>
            <div class="timeline-body">
                <strong>${event.title}</strong>
                <p>${event.summary || "No summary available."}</p>
                <small>[${compactEventPlaceLabel(event)}]</small>
            </div>
        </div>
    `).join("");
    wrap.innerHTML = items || '<div class="feed-empty">No timeline items.</div>';
}
function renderBars(targetId, rows) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = rows.map(([label, value]) => `
        <div class="bar-row">
            <span>${label}</span>
            <div class="bar-track"><i style="width:${Math.max(2, value)}%"></i></div>
            <strong>${value}</strong>
        </div>
    `).join("");
}
function renderAnalytics(events) {
    const side = countBy(events, "actor_side");
    const weapons = countBy(events, "weapon_type").slice(0, 12);
    const targets = countBy(events, "target_type").slice(0, 12);
    const sideWrap = document.getElementById("analytics-side-breakdown");
    if (sideWrap) {
        sideWrap.innerHTML = side.map(([label, value]) => `
            <div class="ring-stat-card">
                <strong>${value}</strong>
                <span>${label}</span>
            </div>
        `).join("");
    }
    renderBars("analytics-weapons", weapons);
    renderBars("analytics-targets", targets);
}
function renderRecon(events) {
    const regionGrid = document.getElementById("recon-region-grid");
    const alertList = document.getElementById("recon-alert-list");
    const correlationList = document.getElementById("recon-correlation-list");
    const banner = document.getElementById("recon-closure-banner");
    if (banner) {
        const closedCount = events.filter((e) => String(e.airspace_status || "").toLowerCase() === "closed").length;
        banner.textContent = `Regional Airspace Closure Detected — ${closedCount} alerts in dataset`;
    }
    const focusCountries = deriveFocusCountries(events, 12).map(normalizeCountryName).filter(Boolean);
    if (regionGrid) {
        regionGrid.innerHTML = focusCountries.map((name) => {
            const status = deriveCountryStatus(events, name, "airspace");
            const firHit = events.find((e) =>
                eventPlaceText(e).includes(String(name).toLowerCase()) &&
                e.fir_code
            );
            return `
                <div class="region-card">
                    <h4>${name}</h4>
                    <small>${firHit?.fir_code || "Regional FIR"}</small>
                    <strong class="status-pill status-pill--${String(status || "unknown").toLowerCase()}">${String(status || "unknown").toUpperCase()}</strong>
                </div>
            `;
        }).join("");
    }
    if (alertList) {
        alertList.innerHTML = events
            .filter((e) => String(e.airspace_status || "").toLowerCase() !== "unknown")
            .slice(0, 16)
            .map((e) => `
                <div class="recon-alert-row">
                    <strong>${e.fir_code || "FIR"} | ${e.location_label || e.impact_label || e.country || "Unknown location"}</strong>
                    <span>${e.airspace_status}</span>
                    <small>${formatTime(e.occurred_at)}</small>
                </div>
            `)
            .join("");
    }
    if (correlationList) {
        correlationList.innerHTML = events
            .slice(0, 12)
            .map((e) => `
                <div class="correlation-row">
                    <span>${e.fir_code || "FIR"}</span>
                    <p>Airspace ${e.airspace_status} → ${e.title}</p>
                    <strong>${e.severity}</strong>
                </div>
            `)
            .join("");
    }
}
function renderWeapons(events) {
    const grid = document.getElementById("weapons-grid");
    if (!grid) return;
    const rows = countBy(events, "weapon_type").slice(0, 16);
    grid.innerHTML = rows.map(([name, count]) => {
        const related = events.filter((e) => String(e.weapon_type || "") === String(name));
        const topSide = countBy(related, (e) => e.actor_side || "unknown")
            .filter(([label]) => label !== "unknown")[0]?.[0] || "mixed";
        return `
            <article class="weapon-card">
                <div class="weapon-card__top">
                    <h3>${name}</h3>
                    <span>${topSide}</span>
                </div>
                <div class="weapon-badges">
                    <span class="weapon-tag">${name}</span>
                </div>
                <p>Observed in current stream ${count} times. Detailed range, CEP, speed, and warhead data can be filled from your curated database later.</p>
            </article>
        `;
    }).join("");
}
function renderKillChain(events) {
    const list = document.getElementById("killchain-list");
    if (!list) return;
    list.innerHTML = events.slice(0, 8).map((e) => `
        <article class="killchain-card killchain-card--${e.actor_side}">
            <div class="killchain-head">
                <strong>${e.actor_side}</strong>
                <span>${e.location_label}</span>
                <small>${new Date(e.occurred_at).toISOString().slice(0, 10)}</small>
            </div>
            <div class="killchain-flow">
                <div>Launch</div>
                <div>Impact</div>
                <div>Assessment</div>
            </div>
            <p>${e.weapon_type} → ${e.target_type} → ${e.impact_type}</p>
        </article>
    `).join("");
}
function isAircraftTrackSubtype(subtype = "") {
    return [
        "fighter",
        "awacs",
        "recon",
        "isr",
        "tanker",
        "refueler",
        "transport",
        "logistics",
        "logistic",
        "bomber",
        "drone",
        "uav",
        "helicopter"
    ].includes(String(subtype || "").toLowerCase());
}
function formatAircraftAltitude(altitudeFt = 0) {
    const value = Number(altitudeFt || 0);
    if (!Number.isFinite(value) || value <= 0) return "ALT N/A";
    return `FL ${Math.round(value / 100)}`;
}
function formatAircraftSpeed(speedKts = 0) {
    const value = Number(speedKts || 0);
    if (!Number.isFinite(value) || value <= 0) return "SPD N/A";
    return `${Math.round(value)} kt`;
}
function formatAircraftLastSeen(lastSeenAt = 0) {
    const deltaMs = Date.now() - Number(lastSeenAt || 0);
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return "Now";
    if (deltaMs < 15000) return "Now";
    if (deltaMs < 60000) return `${Math.max(1, Math.round(deltaMs / 1000))}s ago`;
    return `${Math.max(1, Math.round(deltaMs / 60000))}m ago`;
}
function formatAircraftEndedAt(endedAt = 0) {
    const deltaMs = Date.now() - Number(endedAt || 0);
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return "Ended";
    if (deltaMs < 60000) return `Ended ${Math.max(1, Math.round(deltaMs / 1000))}s ago`;
    if (deltaMs < 3600000) return `Ended ${Math.max(1, Math.round(deltaMs / 60000))}m ago`;
    if (deltaMs < 86400000) return `Ended ${Math.max(1, Math.round(deltaMs / 3600000))}h ago`;
    return `Ended ${Math.max(1, Math.round(deltaMs / 86400000))}d ago`;
}
function getAircraftSubtypeOptions(items = []) {
    const options = [...new Set(items.map((track) => String(track.subcategory || "").toLowerCase()).filter(Boolean))];
    return options.sort();
}
function getAircraftWidgetStatusLabel(track = {}) {
    return track.active ? "Active" : "Ended";
}
function sanitizeAircraftText(value = "") {
    return String(value || "")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/@[A-Za-z0-9_]+/g, " ")
        .replace(/[^\p{L}\p{N}\s.\-_/()]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isAircraftDisplayTextUsable(value = "") {
    const clean = sanitizeAircraftText(value);
    if (!clean) return false;
    if (clean.length < 2) return false;
    if (/^@+$/.test(clean)) return false;
    if (/^(unknown|empty|null|n\/a)$/i.test(clean)) return false;
    return /[A-Za-z0-9]/.test(clean);
}
function formatAircraftSubtypeLabel(subtype = "") {
    const key = String(subtype || "").trim().toLowerCase();
    if (key === "awacs") return "AWACS";
    if (key === "isr") return "ISR";
    if (key === "uav") return "UAV";
    if (key === "refueler") return "Refueler";
    if (key === "tanker") return "Tanker";
    if (key === "recon") return "Recon";
    if (key === "fighter") return "Fighter";
    if (key === "transport") return "Transport";
    if (key === "logistics" || key === "logistic") return "Logistics";
    if (key === "bomber") return "Bomber";
    if (key === "helicopter") return "Helicopter";
    if (key === "drone") return "Drone";
    if (key === "trainer") return "Trainer";
    if (!key) return "Aircraft";
    return key.charAt(0).toUpperCase() + key.slice(1);
}
function getAircraftDisplayTitle(track = {}) {
    const subtypeLabel = formatAircraftSubtypeLabel(track.subcategory || track.subtype || "aircraft");
    const callsign = sanitizeAircraftText(track.callsign || track.title || "");
    if (isAircraftDisplayTextUsable(callsign)) {
        return callsign;
    }
    const shortKey = String(track.track_key || "").slice(-6).toUpperCase();
    return shortKey ? `${subtypeLabel} ${shortKey}` : subtypeLabel;
}
function getAircraftCountryLabel(track = {}) {
    const raw = sanitizeAircraftText(track.country || track.region || "Unknown");
    return raw || "Unknown";
}
function setWidgetLoading(widgetId = "", isLoading = false) {
    const widget = document.querySelector(`[data-widget-id="${widgetId}"]`);
    if (!widget) return;
    const content = widget.querySelector(".panel-content");
    if (!content) return;
    let loader = content.querySelector(".wz-widget-loader");
    if (isLoading) {
        __widgetLoadingState.set(widgetId, true);
        content.classList.add("is-loading");
        if (!loader) {
            loader = document.createElement("div");
            loader.className = "wz-widget-loader";
            loader.setAttribute("aria-hidden", "true");
            loader.innerHTML = '<img src="/assets/images/web/bx_minloader.gif" alt="" loading="eager" decoding="async">';
            content.appendChild(loader);
        }
        return;
    }
    __widgetLoadingState.delete(widgetId);
    content.classList.remove("is-loading");
    if (loader) {
        loader.remove();
    }
}
function isWidgetLoading(widgetId = "") {
    return __widgetLoadingState.get(widgetId) === true;
}
function requestAircraftMovementsWidgetRender(delay = AIRCRAFT_WIDGET_RENDER_THROTTLE_MS) {
    clearTimeout(__aircraftWidgetRenderTimer);
    __aircraftWidgetRenderTimer = window.setTimeout(() => {
        __aircraftWidgetRenderTimer = 0;
        renderAircraftMovementsWidget();
    }, Math.max(0, Number(delay || 0)));
}
function scheduleAircraftHistoryRefresh(force = false) {
    clearTimeout(__aircraftHistoryRefreshTimer);
    __aircraftHistoryRefreshTimer = window.setTimeout(() => {
        __aircraftHistoryRefreshTimer = 0;
        setWidgetLoading("aircraft", true);
        refreshAircraftHistoryCache(force)
            .finally(() => {
                setWidgetLoading("aircraft", false);
                requestAircraftMovementsWidgetRender(0);
            });
    }, force ? 0 : 350);
}
function normalizeAircraftHistoryRow(row = {}) {
    const subtype = String(row.subtype || row.subcategory || "aircraft").toLowerCase();
    const title = getAircraftDisplayTitle({
        ...row,
        subcategory: subtype,
    });
    const lastSeenAt = new Date(
        row.last_seen_at ||
        row.created_at ||
        Date.now()
    ).getTime();
    const endedAt = row.ended_at ? new Date(row.ended_at).getTime() : 0;
    const active = String(row.status || "active").toLowerCase() !== "ended";
    return {
        track_key: String(row.track_key || ""),
        title,
        callsign: sanitizeAircraftText(row.callsign || ""),
        subcategory: subtype,
        country: String(row.country || row.region || "Unknown"),
        region: String(row.region || ""),
        lat: Number(row.lat),
        lon: Number(row.lon),
        altitude_ft: Number(row.altitude_ft || 0),
        speed_kts: Number(row.speed_kts || 0),
        heading_deg: Number(row.heading_deg || 0),
        active,
        ended_at: endedAt,
        last_seen_at: Number.isFinite(lastSeenAt) ? lastSeenAt : Date.now(),
        occurred_at: row.created_at || row.last_seen_at || new Date().toISOString(),
        __source: "history-db",
    };
}
async function refreshAircraftHistoryCache(force = false) {
    const now = Date.now();
    if (!force && __aircraftHistoryLoadingPromise) return __aircraftHistoryLoadingPromise;
    if (!force && __aircraftHistoryLastLoadedAt && (now - __aircraftHistoryLastLoadedAt) < AIRCRAFT_HISTORY_REFRESH_MS) {
        return __aircraftHistoryCache;
    }
    __aircraftHistoryLoadingPromise = api.getAircraftTracks()
        .then(({ data, error }) => {
            if (error) {
                console.error("Aircraft history fetch error:", error);
                return __aircraftHistoryCache;
            }
            __aircraftHistoryCache = Array.isArray(data)
                ? data.map(normalizeAircraftHistoryRow).filter((row) => row.track_key && isAircraftTrackSubtype(row.subcategory))
                : [];
            __aircraftHistoryLastLoadedAt = Date.now();
            return __aircraftHistoryCache;
        })
        .finally(() => {
            __aircraftHistoryLoadingPromise = null;
        });
    return __aircraftHistoryLoadingPromise;
}
function mergeAircraftWidgetSources(liveItems = [], historyItems = []) {
    const map = new Map();
    historyItems.forEach((track) => {
        if (!track?.track_key) return;
        map.set(String(track.track_key), track);
    });
    liveItems.forEach((track) => {
        if (!track?.track_key) return;
        map.set(String(track.track_key), track);
    });
    return [...map.values()];
}
function syncAircraftWidgetFilterControls() {
    const filterButtons = [...document.querySelectorAll("[data-aircraft-filter]")];
    if (!filterButtons.length) return;
    filterButtons.forEach((btn) => {
        const value = String(btn.dataset.aircraftFilter || "").toLowerCase();
        const isAll = value === "all";
        if (isAll) {
            btn.hidden = true;
            btn.setAttribute("aria-hidden", "true");
            btn.classList.remove("is-active");
            return;
        }
        btn.hidden = false;
        btn.removeAttribute("aria-hidden");
        btn.classList.toggle("is-active", value === __aircraftWidgetFilter);
    });
}
function getAircraftWidgetItems() {
    const liveItems = getAllLiveTrackSnapshots()
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer");
    const historyItems = (__aircraftHistoryCache || [])
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer");
    const allItems = mergeAircraftWidgetSources(liveItems, historyItems);
    let items = [];
    if (__aircraftWidgetFilter === "recent") {
        const recentCutoff = Date.now() - AIRCRAFT_RECENT_WINDOW_MS;
        items = historyItems.filter((track) =>
            Number(track.last_seen_at || 0) >= recentCutoff
        );
    } else if (__aircraftWidgetFilter === "ended") {
        items = historyItems.filter((track) => !track.active);
    } else {
        items = liveItems.filter((track) => track.active);
    }
    if (__aircraftWidgetSubtypeFilter && __aircraftWidgetSubtypeFilter !== "all") {
        items = items.filter(
            (track) => String(track.subcategory || "").toLowerCase() === __aircraftWidgetSubtypeFilter
        );
    }
    items = items
        .sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0))
        .slice(0, LIVE_AIRCRAFT_WIDGET_MAX_ITEMS);
    return {
        allItems,
        items
    };
}
function ensureAircraftWidgetEmptyState(container, hasItems) {
    let emptyEl = container.querySelector(".wz-aircraft-empty");
    if (!hasItems) {
        if (!emptyEl) {
            emptyEl = document.createElement("div");
            emptyEl.className = "wz-aircraft-empty";
            emptyEl.textContent = "No aircraft logs in the current filter";
            container.appendChild(emptyEl);
        }
        return;
    }
    if (emptyEl) {
        emptyEl.remove();
    }
}
function getAircraftWidgetActionLabel(track, selection) {
    const isSelected = selection.track_key === track.track_key;
    return track.active
        ? (isSelected ? "Back" : "Focus")
        : (isSelected ? "Hide" : "Replay");
}
function getAircraftWidgetTimeLabel(track) {
    return track.active
        ? formatAircraftLastSeen(track.last_seen_at)
        : formatAircraftEndedAt(track.ended_at || track.last_seen_at);
}
function updateAircraftWidgetCard(card, track, selection) {
    if (!card || !track) return;
    const subtype = formatAircraftSubtypeLabel(track.subcategory || "aircraft");
    const country = getAircraftCountryLabel(track);
    const title = getAircraftDisplayTitle(track);
    const isSelected = selection.track_key === track.track_key;
    const statusLabel = getAircraftWidgetStatusLabel(track);
    const timeLabel = getAircraftWidgetTimeLabel(track);
    const actionLabel = getAircraftWidgetActionLabel(track, selection);
    card.className = `wz-aircraft-item ${track.active ? "is-active" : "is-ended"} ${isSelected ? "is-selected" : ""}`;
    card.dataset.trackKey = String(track.track_key || "");
    let top = card.querySelector(".wz-aircraft-item__top");
    let titleEl = card.querySelector(".wz-aircraft-item__title");
    let timeEl = card.querySelector(".wz-aircraft-item__time");
    let meta = card.querySelector(".wz-aircraft-item__meta");
    let stats = card.querySelector(".wz-aircraft-item__stats");
    let foot = card.querySelector(".wz-aircraft-item__foot");
    let actionBtn = card.querySelector(".wz-aircraft-action");
    if (!top) {
        top = document.createElement("div");
        top.className = "wz-aircraft-item__top";
        titleEl = document.createElement("strong");
        titleEl.className = "wz-aircraft-item__title";
        timeEl = document.createElement("span");
        timeEl.className = "wz-aircraft-item__time";
        top.appendChild(titleEl);
        top.appendChild(timeEl);
        card.appendChild(top);
    }
    if (!meta) {
        meta = document.createElement("div");
        meta.className = "wz-aircraft-item__meta";
        meta.appendChild(document.createElement("span"));
        meta.appendChild(document.createElement("span"));
        card.appendChild(meta);
    }
    if (!stats) {
        stats = document.createElement("div");
        stats.className = "wz-aircraft-item__stats";
        stats.appendChild(document.createElement("span"));
        stats.appendChild(document.createElement("span"));
        stats.appendChild(document.createElement("span"));
        card.appendChild(stats);
    }
    if (!foot) {
        foot = document.createElement("div");
        foot.className = "wz-aircraft-item__foot";
        actionBtn = document.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = "wz-aircraft-action btn-primary";
        foot.appendChild(actionBtn);
        card.appendChild(foot);
    }
    titleEl = card.querySelector(".wz-aircraft-item__title");
    timeEl = card.querySelector(".wz-aircraft-item__time");
    actionBtn = card.querySelector(".wz-aircraft-action");
    titleEl.innerHTML = `
        <span class="wz-aircraft-title__status ${track.active ? "is-active" : "is-ended"}" aria-label="${statusLabel}">
            <span class="bx-web-ico-status-1-0" aria-hidden="true"></span>
        </span>
        <span class="wz-aircraft-title__text">${title}</span>
    `;
    timeEl.textContent = timeLabel;
    const metaSpans = meta.querySelectorAll("span");
    if (metaSpans[0]) metaSpans[0].textContent = subtype;
    if (metaSpans[1]) metaSpans[1].textContent = country;
    const statSpans = stats.querySelectorAll("span");
    if (statSpans[0]) statSpans[0].textContent = formatAircraftAltitude(track.altitude_ft);
    if (statSpans[1]) statSpans[1].textContent = formatAircraftSpeed(track.speed_kts);
    if (statSpans[2]) statSpans[2].textContent = `HDG ${Math.round(Number(track.heading_deg || 0))}°`;
    actionBtn.dataset.trackToggle = String(track.track_key || "");
    actionBtn.innerHTML = `<span aria-hidden="true"></span>${actionLabel}`;
}

function renderAircraftMovementsWidget() {
    const container = document.getElementById("wz-aircraft-panel");
    const subtypeSelect = document.getElementById("wz-aircraft-filter-subtype");
    if (!container) return;
    syncAircraftWidgetFilterControls();
    const { items, allItems } = getAircraftWidgetItems();
    const selection = getLiveTrackSelection();
    if (subtypeSelect) {
        const currentValue = subtypeSelect.value || __aircraftWidgetSubtypeFilter;
        const options = getAircraftSubtypeOptions(allItems);
        const optionsKey = options.join("|");
        if (__aircraftSubtypeOptionsKey !== optionsKey) {
            subtypeSelect.innerHTML = ['<option value="all">All Types</option>']
                .concat(options.map((value) => `<option value="${value}">${formatAircraftSubtypeLabel(value)}</option>`))
                .join("");
            __aircraftSubtypeOptionsKey = optionsKey;
        }
        subtypeSelect.value = options.includes(currentValue) || currentValue === "all" ? currentValue : "all";
        __aircraftWidgetSubtypeFilter = subtypeSelect.value || "all";
    }
    const wantedKeys = new Set(items.map((track) => String(track.track_key || "")));
    [...container.querySelectorAll(".wz-aircraft-item")].forEach((card) => {
        const key = String(card.dataset.trackKey || "");
        if (!wantedKeys.has(key)) {
            card.remove();
        }
    });
    ensureAircraftWidgetEmptyState(container, items.length > 0);
    if (!items.length) return;
    items.forEach((track) => {
        const trackKey = String(track.track_key || "");
        let card = container.querySelector(`.wz-aircraft-item[data-track-key="${CSS.escape(trackKey)}"]`);
        if (!card) {
            card = document.createElement("article");
            if (!card) return;
            card.className = "wz-aircraft-item";
            card.dataset.trackKey = trackKey;
        }
        updateAircraftWidgetCard(card, track, selection);
        if (!card.isConnected || card.parentElement !== container) {
            container.appendChild(card);
        }
    });
}
function bindAircraftMovementsWidget() {
    if (__aircraftWidgetBound) return;
    __aircraftWidgetBound = true;
    document.addEventListener("click", (event) => {
        const toggleBtn = event.target.closest("[data-track-toggle]");
        if (toggleBtn) {
            const trackKey = String(toggleBtn.dataset.trackToggle || "").trim();
            if (!trackKey) return;
            toggleLiveTrackSelection(trackKey);
            requestAircraftMovementsWidgetRender(0);
            return;
        }
        const filterBtn = event.target.closest("[data-aircraft-filter]");
        if (filterBtn) {
            const nextFilter = String(filterBtn.dataset.aircraftFilter || "active").toLowerCase();
            if (nextFilter === "all") return;
            __aircraftWidgetFilter = nextFilter;
            syncAircraftWidgetFilterControls();
            if (nextFilter !== "active") {
                scheduleAircraftHistoryRefresh(true);
                return;
            }
            requestAircraftMovementsWidgetRender(0);
            return;
        }
    });
    document.addEventListener("change", (event) => {
        const subtypeSelect = event.target.closest("#wz-aircraft-filter-subtype");
        if (!subtypeSelect) return;
        __aircraftWidgetSubtypeFilter = String(subtypeSelect.value || "all");
        if (__aircraftWidgetFilter !== "active") {
            scheduleAircraftHistoryRefresh(true);
            return;
        }
        requestAircraftMovementsWidgetRender(0);
    });
    document.addEventListener("wz:aircraft-log-updated", () => {
        __aircraftHistoryLastLoadedAt = 0;
        if (__aircraftWidgetFilter === "active") {
            requestAircraftMovementsWidgetRender();
            return;
        }
        scheduleAircraftHistoryRefresh(false);
    });
}
function ensureAlertAudio() {
    if (__alertAudio) return __alertAudio;
    __alertAudio = document.getElementById("warzone-alert-audio");
    return __alertAudio;
}
export function triggerWarzoneAlert({ title, location, level = "high", playSound = true } = {}) {
    const alertLevel = level === "critical" ? "red" : level === "high" ? "orange" : "yellow";
    showSirenAlert({
        title: String(title || "ALERT"),
        meta: String(location || ""),
        level: alertLevel,
        sound: playSound,
    });
}
function flashFeedCard(eventId) {
    const card = document.querySelector(`[data-event-id="${eventId}"]`);
    if (!card) return;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1200);
}
function renderAll(events, { replaceCache = true } = {}) {
    const normalizedEvents = sortEvents(
        events.map((event) => {
            const normalized = normalizeEvent(event);
            return {
                ...normalized,
                theater: resolveEventTheater(normalized)
            };
        })
    );
    if (replaceCache) {
        __eventsCache = normalizedEvents;
    }
    __visibleEventsCache = normalizedEvents;
    const filtered = applyAllFilters(normalizedEvents);
    updateTheaterPanel(filtered);
    debouncedRenderFeed(filtered);
    debouncedRenderUI(filtered);
    debouncedRenderHeavy(filtered);
}
function syncFilteredUi(events) {
    const filtered = applyAllFilters(events);
    debouncedRenderFeed(filtered);
    debouncedRenderUI(filtered);
    debouncedRenderHeavy(filtered);
    return filtered;
}
const GLOBE_CLUSTER_RADIUS_DEG = 1;
const GLOBE_CLUSTER_THRESHOLD = 60;
function getGlobeClusterRadiusDeg() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    if (height > 7000000) return 1.1;
    if (height > 4500000) return 0.8;
    if (height > 2800000) return 0.6;
    if (height > 1600000) return 0.45;
    return 0.28;
}
const CAT_PRIORITY = {
    alert: 10,
    strike: 9,
    airspace: 8,
    military: 7,
    recon: 6,
    cyber: 5,
    thermal: 4,
    seismic: 3,
    signal: 2,
};
function catScore(e) {
    return (CAT_PRIORITY[String(e.category || "").toLowerCase()] || 1) +
        (e.severity === "critical" ? 4 : e.severity === "high" ? 2 : 0);
}
function clusterEventsForGlobe(events) {
    if (!Array.isArray(events) || !events.length) return [];
    if (events.length < GLOBE_CLUSTER_THRESHOLD) {
        return events.map((event) => ({
            ...event,
            _clusterCount: Number(event._clusterCount || 1),
            _clusterEvents: Array.isArray(event._clusterEvents) ? event._clusterEvents : [event],
        }));
    }
    const clusterRadiusDeg = getGlobeClusterRadiusDeg();
    const toCluster = events.filter((e) => {
        const src = String(e.source_name || "").toLowerCase();
        return !src.includes("ads-b") && !src.includes("ais");
    });
    const clusters = [];
    for (const event of toCluster) {
        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        let nearest = null;
        let nearestDist = Infinity;
        for (const cluster of clusters) {
            const dLat = cluster.rep.lat - lat;
            const dLon = cluster.rep.lon - lon;
            const dist = Math.sqrt(dLat * dLat + dLon * dLon);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = cluster;
            }
        }
        if (nearest && nearestDist <= clusterRadiusDeg) {
            nearest.events.push(event);
            nearest.count++;
            if (catScore(event) > catScore(nearest.rep)) {
                nearest.rep = event;
            }
        } else {
            clusters.push({ rep: event, count: 1, events: [event] });
        }
    }
    return clusters.map((c) => ({
        ...c.rep,
        _clusterCount: c.count,
        _clusterEvents: c.events,
    }));
}
function syncInitialEventsToGlobe(events, { animateTracks = false } = {}) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;
    const visible = applyAllFilters(events);
    const visibleSignature = makeEventSignature(visible);
    const rangesEnabled = isLayerEnabled("ranges");
    const sweepersEnabled = isLayerEnabled("sweepers");
    globe.setPerformanceMode?.(visible.length);
    if (!visible.length) {
        if (__lastGlobeSyncKey !== "__empty__") {
            globe.clearEventEntities?.();
            __militaryTracks?.setTracks([]);
            __hotspotLayer?.setEvents([]);
            if (window.__warzoneViewer) {
                clearRanges(window.__warzoneViewer);
                clearSweepers(window.__warzoneViewer);
            }
            __lastGlobeSyncKey = "__empty__";
            __lastRangesSyncKey = "__off__";
            __lastSweepersSyncKey = "__off__";
        }
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }
    if (visibleSignature !== __lastGlobeSyncKey) {
        globe.clearEventEntities?.();
        const clustered = clusterEventsForGlobe(
            visible.map((event) => ({
                ...event,
                _layerId: getEventLayerId(event),
            }))
        );
        globe.addEvents?.(clustered);
        if (__militaryTracks) {
            __militaryTracks.setTracks(
                visible.filter((event) => isMilitaryTrackEvent(event) && isEventVisible(event))
            );
        }
        __lastGlobeSyncKey = visibleSignature;
    }
    if (__hotspotLayer) {
        __hotspotLayer.setEvents(visible);
    }
    if (window.__warzoneViewer) {
        const nextRangesKey = rangesEnabled ? visibleSignature : "__off__";
        if (nextRangesKey !== __lastRangesSyncKey) {
            clearRanges(window.__warzoneViewer);
            if (rangesEnabled) {
                renderRanges(window.__warzoneViewer, visible);
            }
            __lastRangesSyncKey = nextRangesKey;
        }
        const nextSweepersKey = sweepersEnabled ? visibleSignature : "__off__";
        if (nextSweepersKey !== __lastSweepersSyncKey) {
            clearSweepers(window.__warzoneViewer);
            if (sweepersEnabled) {
                renderSweepers(window.__warzoneViewer, visible);
            }
            __lastSweepersSyncKey = nextSweepersKey;
        }
    }
    if (animateTracks) {
        const recentTracks = visible
            .filter((event) => isTrackLikeEvent(event))
            .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
            .slice(0, 3);
        for (const event of recentTracks) {
            globe.animateMissileTrack?.(event);
        }
    }
    window.__warzoneViewer?.scene?.requestRender?.();
}
export async function initWarzoneApp() {
    const { data, error } = await api.getEvents();
    if (error) {
        console.error("Supabase events error:", error);
        return [];
    }
    const events = Array.isArray(data) ? data.map((row) => normalizeEvent(row)).filter(Boolean) : [];
    __viewportScoped = false;
    renderAll(events);
    updateNewsTicker(events);
    syncInitialEventsToGlobe(events, { animateTracks: true });
    const hotspotRoot = document.getElementById("warzone-hotspot-layer");
    const viewer = window.__warzoneViewer;
    if (hotspotRoot && viewer && !__hotspotLayer) {
        __hotspotLayer = createWarzoneHotspotLayer(viewer, hotspotRoot, {
            maxCards: 20,
            clusterDistanceLat: 2.6,
            clusterDistanceLon: 3.2,
            stackDistancePx: 90,
            maxVisiblePerHotspot: 3,
            minItemsForCluster: 1,
        });
        window.__hotspotLayer = __hotspotLayer;
    }
    if (hotspotRoot) hotspotRoot.style.display = "";
    __hotspotLayer?.setEvents(applyAllFilters(events));
    if (viewer && !__militaryTracks) {
        __militaryTracks = initMilitaryTracks(viewer);
        window.__militaryTracks = __militaryTracks;
    }
    if (viewer) {
        onRegionChange(() => {
            __lastViewportKey = "";
            scheduleViewportFetch(60);
        });
        if (viewer.camera?.moveEnd) {
            viewer.camera.moveEnd.addEventListener(() => {
                scheduleViewportFetch(500);
            });
        }
    }
    initLayerPanel();
    startPublicAirIngestion();
    setWidgetLoading("aircraft", true);
    refreshAircraftHistoryCache(true)
        .catch((err) => {
            console.error("Initial aircraft history load failed:", err);
        })
        .finally(() => {
            setWidgetLoading("aircraft", false);
            requestAircraftMovementsWidgetRender(0);
        });
    onLayerChange((id) => {
        const globe = window.__warzoneViewer?.__warzone;
        const sourceEvents = __viewportScoped ? __visibleEventsCache : __eventsCache;
        const filtered = applyAllFilters(sourceEvents);
        const hotspotEnabled = isLayerEnabled("hotspots");
        const hotspotRootEl = document.getElementById("warzone-hotspot-layer");
        if (hotspotRootEl) {
            hotspotRootEl.style.display = hotspotEnabled ? "" : "none";
        }
        if (__hotspotLayer) {
            __hotspotLayer.setEvents(hotspotEnabled ? filtered : []);
        }
        if (id === "terrain") {
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
            window.__warzoneViewer?.scene?.requestRender?.();
            return;
        }
        if (id === "*") {
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
        }
        syncFilteredUi(sourceEvents);
        syncInitialEventsToGlobe(sourceEvents, { animateTracks: false });
    });
    window.addEventListener("wz:recluster", () => {
        const sourceEvents = __viewportScoped ? __visibleEventsCache : __eventsCache;
        syncInitialEventsToGlobe(sourceEvents, { animateTracks: false });
    });
    if (__militaryTracks) {
        __militaryTracks.setTracks(applyAllFilters(events).filter(isMilitaryTrackEvent));
    }
    if (events[0]?.occurred_at) {
        __lastSeenOccurredAt = events[0].occurred_at;
    }
    __lastViewportKey = "";
    __viewportScoped = false;
    scheduleViewportFetch(150);
    supabase
        .channel('tracks-live')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'tracks' },
            (payload) => {
                console.log("[TRACK LIVE]", payload);
                const eventType = String(payload.eventType || payload.event || "").toUpperCase();
                const track = payload.new || payload.old;
                if (!track) return;
                if (eventType === "DELETE") {
                    clearLiveTrack(track.track_key);
                    return;
                }
                upsertLiveTrack(track);
            }
        )
        .subscribe((status, err) => {
            console.log("TRACK SUB STATUS:", status);
            if (err) console.error("TRACK ERROR:", err);
        });
    return events;
}
async function pollLatestEvents() {
    try {
        const since = __lastSeenOccurredAt || new Date(Date.now() - 30000).toISOString();
        const { data, error } = await api.getEventsSince(since);
        if (error) {
            console.error("Polling latest events error:", error);
            return;
        }
        const rows = Array.isArray(data) ? data.map((row) => normalizeEvent(row)).filter(Boolean) : [];
        if (!rows.length) return;
        rows
            .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
            .forEach(handleIncomingEvent);
        const newest = rows[0];
        if (newest?.occurred_at) {
            __lastSeenOccurredAt = newest.occurred_at;
        }
    } catch (err) {
        console.error("Polling latest events failed:", err);
    }
}
export function startEventPollingFallback() {
    if (__pollTimer) return;
    __pollTimer = setInterval(() => {
        pollLatestEvents();
    }, 30000);
}
// Global known aggressor origin points per theater
// These are the known or most likely launch zones per active conflict theater
const THEATER_ORIGIN_MAP = {
    // Levant — Gaza rockets, Hezbollah from Lebanon, Iran ballistic
    "levant": [
        {
            match: (t) => t.includes("ballistic") || t.includes("iran") || t.includes("unconventional"),
            origin: { lat: 32.42, lon: 53.69, label: "Iran" }
        },
        {
            match: (t) => t.includes("hezbollah") || t.includes("lebanon") || t.includes("northern"),
            origin: { lat: 33.55, lon: 35.55, label: "Southern Lebanon" }
        },
        {
            match: () => true, // default → Gaza
            origin: { lat: 31.40, lon: 34.32, label: "Gaza Strip" }
        }
    ],
    // Gulf — Yemen Houthis, Iran IRGC
    "gulf": [
        {
            match: (t) => t.includes("houthi") || t.includes("yemen") || t.includes("red sea"),
            origin: { lat: 15.55, lon: 44.20, label: "Yemen" }
        },
        {
            match: (t) => t.includes("iran") || t.includes("irgc") || t.includes("ballistic"),
            origin: { lat: 32.42, lon: 53.69, label: "Iran" }
        },
        {
            match: () => true,
            origin: { lat: 15.55, lon: 44.20, label: "Yemen" }
        }
    ],
    // Ukraine — Russia launches from multiple directions
    "ukraine-front": [
        {
            match: (t) => t.includes("shahed") || t.includes("drone") || t.includes("uav"),
            origin: { lat: 46.47, lon: 30.73, label: "Russian-occupied Territory" }
        },
        {
            match: (t) => t.includes("ballistic") || t.includes("iskander") || t.includes("kinzhal"),
            origin: { lat: 55.75, lon: 37.61, label: "Russia" }
        },
        {
            match: (t) => t.includes("kalibr") || t.includes("cruise") || t.includes("caspian"),
            origin: { lat: 42.50, lon: 50.50, label: "Caspian Sea" }
        },
        {
            match: () => true,
            origin: { lat: 51.67, lon: 39.20, label: "Russia" }
        }
    ],
    // Kashmir — Pakistan / India cross-border
    "kashmir-corridor": [
        {
            match: (t) => t.includes("pakistan") || t.includes("loc") || t.includes("cross-border"),
            origin: { lat: 33.72, lon: 73.04, label: "Pakistan" }
        },
        {
            match: (t) => t.includes("india") || t.includes("iaf"),
            origin: { lat: 28.61, lon: 77.20, label: "India" }
        },
        {
            match: () => true,
            origin: { lat: 33.72, lon: 73.04, label: "Pakistan" }
        }
    ],
    // Taiwan Strait — China PLA
    "taiwan-strait": [
        {
            match: () => true,
            origin: { lat: 26.07, lon: 119.30, label: "Fujian, China" }
        }
    ],
    // Korean Peninsula — North Korea
    "korean-peninsula": [
        {
            match: () => true,
            origin: { lat: 39.03, lon: 125.75, label: "North Korea" }
        }
    ],
    // Sahel / Horn of Africa — militant groups
    "sahel-horn": [
        {
            match: (t) => t.includes("somalia") || t.includes("al-shabaab"),
            origin: { lat: 2.04, lon: 45.34, label: "Somalia" }
        },
        {
            match: (t) => t.includes("sudan") || t.includes("rsf"),
            origin: { lat: 13.51, lon: 30.21, label: "Sudan" }
        },
        {
            match: () => true,
            origin: { lat: 12.36, lon: 1.53, label: "Sahel Region" }
        }
    ],
    // Western Pacific — China PLAN / PLA
    "western-pacific": [
        {
            match: () => true,
            origin: { lat: 22.30, lon: 114.16, label: "China" }
        }
    ],
};

function estimateSirenOrigin(event) {
    const lat = Number(event.lat || event.impact_lat || event.display_lat);
    const lon = Number(event.lon || event.impact_lon || event.display_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    // Resolve which global theater this event belongs to
    const theater = resolveEventTheater(event);
    const theaterId = theater?.id || null;

    // Build searchable text from event
    const combined = [
        event.title,
        event.summary,
        event.weapon_type,
        event.location_label,
        event.country,
        event.actor_side,
    ].filter(Boolean).join(" ").toLowerCase();

    // Look up theater origin rules
    const rules = THEATER_ORIGIN_MAP[theaterId];
    if (rules) {
        for (const rule of rules) {
            if (rule.match(combined)) {
                return {
                    origin_lat: rule.origin.lat,
                    origin_lon: rule.origin.lon,
                    origin_label: rule.origin.label,
                };
            }
        }
    }

    // No theater matched — use geographic fallback
    // Estimate origin as offset from impact point based on known conflict direction
    // This covers any region not in the theater map
    const offsetKm = 400;
    const offsetDeg = offsetKm / 111;

    // Try to use actor_side or weapon clues for direction
    if (combined.includes("russia") || combined.includes("russian")) {
        return { origin_lat: lat + offsetDeg, origin_lon: lon + offsetDeg * 0.5, origin_label: "Russia" };
    }
    if (combined.includes("china") || combined.includes("pla")) {
        return { origin_lat: lat + offsetDeg * 0.3, origin_lon: lon - offsetDeg, origin_label: "China" };
    }
    if (combined.includes("iran") || combined.includes("irgc")) {
        return { origin_lat: lat - offsetDeg * 0.3, origin_lon: lon + offsetDeg, origin_label: "Iran" };
    }
    if (combined.includes("north korea") || combined.includes("dprk")) {
        return { origin_lat: lat + offsetDeg * 0.5, origin_lon: lon - offsetDeg * 0.3, origin_label: "North Korea" };
    }

    // Absolute last fallback — arc from roughly north-east
    // (most aggressor states are relatively east/north of their targets)
    return {
        origin_lat: lat + offsetDeg * 0.6,
        origin_lon: lon + offsetDeg * 0.8,
        origin_label: "Unknown Origin",
    };
}
export function handleIncomingEvent(event) {
    let normalized = normalizeEvent(event);
    normalized = resolveStrikeGeometry(normalized);
    if (!isMilitaryRelevant(normalized)) return;
    __liveRecentEvents.unshift(normalized);
    if (__liveRecentEvents.length > 300) {
        __liveRecentEvents.length = 300;
    }
    const exists = __eventsCache.findIndex((e) => String(e.id) === String(normalized.id));
    if (exists >= 0) {
        __eventsCache[exists] = normalized;
    } else {
        __eventsCache.unshift(normalized);
    }
    renderAll(__eventsCache);
    flashFeedCard(normalized.id);
    updateNewsTicker(__eventsCache.slice(0, 20));
    if (__viewportScoped) {
        __lastViewportKey = "";
        scheduleViewportFetch(180);
    }
    const globe = window.__warzoneViewer?.__warzone;
    const region = getActiveRegion?.();
    const inRegion =
        !filterEventsByRegion ||
        !region ||
        region.id === "global" ||
        eventMatchesBounds(normalized, region.bounds);
    const layerOk = isEventVisible(normalized);
    if (isMilitaryTrackEvent(normalized) && __militaryTracks) {
        if (inRegion && layerOk) __militaryTracks.addTrack(normalized);
    } else if (inRegion && layerOk) {
        globe?.addEvent?.({ ...normalized, _layerId: getEventLayerId(normalized) });
    }
    if (isTrackLikeEvent(normalized) && inRegion && layerOk) {
        globe?.animateMissileTrack?.(normalized);
    }
    if (isLayerEnabled("hotspots") && inRegion && layerOk) {
        __hotspotLayer?.addEvent?.(normalized);
    }
    if (isSirenEvent(normalized)) {
        sirenAlertFromEvent(normalized);
        if (inRegion && layerOk) {
            globe?.highlightAlertRegion?.(normalized);
            // Fire missile arc with estimated origin if no real origin exists
            if (!isTrackLikeEvent(normalized)) {
                const estimated = estimateSirenOrigin(normalized);
                if (estimated) {
                    globe?.animateMissileTrack?.({
                        ...normalized,
                        origin_lat: estimated.origin_lat,
                        origin_lon: estimated.origin_lon,
                        origin_label: estimated.origin_label,
                        impact_lat: Number(normalized.lat),
                        impact_lon: Number(normalized.lon),
                        impact_label: normalized.location_label || normalized.impact_label || "",
                    });
                }
            }
        }
    }
}
function initFloatingPanels() {
    const panels = document.querySelectorAll(".warzone-panel--floating");
    panels.forEach((panel) => {
        const head = panel.querySelector(".panel-head");
        if (!head) return;
        let dragging = false;
        let activePointerId = null;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        function stopDrag() {
            dragging = false;
            if (activePointerId !== null) {
                try { head.releasePointerCapture(activePointerId); } catch { }
            }
            activePointerId = null;
            panel.classList.remove("is-dragging");
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("blur", stopDrag);
        }
        function onPointerMove(e) {
            if (!dragging) return;
            if (activePointerId !== null && e.pointerId !== activePointerId) return;
            const parent = panel.offsetParent || panel.parentElement;
            if (!parent) return;
            let nextLeft = e.clientX - parent.getBoundingClientRect().left - dragOffsetX;
            let nextTop = e.clientY - parent.getBoundingClientRect().top - dragOffsetY;
            const maxLeft = parent.clientWidth - panel.offsetWidth;
            const maxTop = parent.clientHeight - panel.offsetHeight;
            nextLeft = Math.max(0, Math.min(nextLeft, maxLeft));
            nextTop = Math.max(0, Math.min(nextTop, maxTop));
            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        }
        function onPointerUp(e) {
            if (activePointerId !== null && e.pointerId !== activePointerId) return;
            stopDrag();
        }
        head.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button,a,input,select,textarea")) return;
            const parent = panel.offsetParent || panel.parentElement;
            if (!parent) return;
            const parentRect = parent.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            const currentLeft = panelRect.left - parentRect.left;
            const currentTop = panelRect.top - parentRect.top;
            panel.style.left = `${currentLeft}px`;
            panel.style.top = `${currentTop}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            dragOffsetX = e.clientX - panelRect.left;
            dragOffsetY = e.clientY - panelRect.top;
            dragging = true;
            activePointerId = e.pointerId;
            panel.classList.add("is-dragging");
            try { head.setPointerCapture(activePointerId); } catch { }
            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            document.addEventListener("pointercancel", onPointerUp);
            window.addEventListener("blur", stopDrag);
            e.preventDefault();
        });
    });
}
export function initGlobal() {
    bindScrollClassToggles();
    bindScrollToTargets();
    initSmoothHomeAnchors();
    initNav();
    initFloatingPanels();
    bindAircraftMovementsWidget();
    renderAircraftMovementsWidget();
}
export function initBoot() {
    document.addEventListener("DOMContentLoaded", () => {
        initGlobal();
        window.SiteLoader?.forceHide?.();
    });
}
export function initAudio() {
    const audio = document.getElementById("bg-audio");
    const toggle = document.getElementById("audio-toggle");
    const playIcon = toggle?.querySelector(".audio-toggle__icon--play");
    const pauseIcon = toggle?.querySelector(".audio-toggle__icon--pause");
    if (!audio || !toggle || !playIcon || !pauseIcon) return;
    audio.loop = true;
    audio.volume = 0.35;
    let isPlaying = false;
    function syncUi(playing) {
        isPlaying = playing;
        toggle.classList.toggle("is-on", playing);
        toggle.setAttribute("aria-pressed", String(playing));
        playIcon.classList.toggle("is-active", !playing);
        pauseIcon.classList.toggle("is-active", playing);
    }
    async function playAudio() {
        try {
            await audio.play();
            syncUi(true);
        } catch (err) {
            console.warn("Autoplay blocked, waiting for interaction.");
        }
    }
    function pauseAudio() {
        audio.pause();
        syncUi(false);
    }
    toggle.addEventListener("click", async () => {
        if (isPlaying) pauseAudio();
        else await playAudio();
    });
    playAudio();
    const unlock = async () => {
        if (!isPlaying) {
            await playAudio();
        }
        document.removeEventListener("click", unlock);
        document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
    syncUi(false);
}