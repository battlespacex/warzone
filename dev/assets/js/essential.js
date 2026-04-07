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
} from "./warzone-live-airforce.js";
import {
    upsertNavalVessel,
    clearNavalVessel,
    renderNavalTrackerWidget,
    getAllNavalSnapshots,
} from "./warzone-live-naval.js";
import { startPublicAirIngestion, refreshPublicAirTracksNow } from "./warzone-air-ingestion.js";
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
let __aircraftWidgetPage = 1;
let __aircraftHistoryCache = [];
let __aircraftHistoryLastLoadedAt = 0;
let __aircraftHistoryLoadingPromise = null;
let __aircraftWidgetRenderTimer = 0;
let __aircraftHistoryRefreshTimer = 0;
let __aircraftSubtypeOptionsKey = "";
let __widgetLoadingState = new Map();
let __navalWidgetRenderTimer = 0;
const LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = 8;
const AIRCRAFT_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const AIRCRAFT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_REFRESH_MS = 3 * 60 * 1000;
const AIRCRAFT_HISTORY_ACTIVE_WINDOW_MS = 8 * 60 * 1000;
const AIRCRAFT_WIDGET_RENDER_THROTTLE_MS = 120;
const NAVAL_WIDGET_RENDER_THROTTLE_MS = 120;
const NAVAL_EVENT_SUBTYPES = new Set([
    "carrier",
    "destroyer",
    "frigate",
    "submarine",
    "logistics",
    "patrol",
    "minesweeper",
    "naval",
]);
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
// ── Layer-filtered widgets — only get events that pass layer toggles ──────────
const debouncedRenderUI = debounce((events) => {
    renderCyberStatus(events);
    renderAirspaceStatus(events);
}, 800);

// ── Raw widgets — ALWAYS use the full event cache, never filtered ─────────────
// Theater Intelligence (strike counts) and Escalation Meter must reflect the
// total event picture regardless of which map layers are toggled on/off.
// Stored as a closure so it always reads the live cache at call time.
const debouncedRenderRaw = debounce(() => {
    const rawEvents = (__viewportScoped ? __visibleEventsCache : __eventsCache) || [];
    renderStrikeCounters(rawEvents);
    renderEscalation(rawEvents);
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
function getEventMetadata(event = {}) {
    const raw = event?.metadata;
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
function getNavalTrackKey(event = {}) {
    const metadata = getEventMetadata(event);
    return String(
        event.dedupe_key ||
        event.source_key ||
        metadata.track_key ||
        (metadata.mmsi ? `ais-${metadata.mmsi}` : "") ||
        event.id ||
        ""
    ).trim();
}
function isNavalSignalEvent(event = {}) {
    const metadata = getEventMetadata(event);
    const category = String(event.category || "").toLowerCase();
    const subcategory = String(event.subcategory || metadata.vessel_class || "").toLowerCase();
    const sourceName = String(event.source_name || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    if (NAVAL_EVENT_SUBTYPES.has(subcategory)) return true;
    if (metadata.mmsi || metadata.vessel_name) return true;
    if (sourceName.includes("ais") || sourceName.includes("vessel") || sourceName.includes("naval")) return true;
    return category === "military" && /warship|vessel|frigate|destroyer|carrier|submarine|patrol ship|naval/.test(title);
}
function requestNavalWidgetRender(delay = NAVAL_WIDGET_RENDER_THROTTLE_MS) {
    if (__navalWidgetRenderTimer) {
        clearTimeout(__navalWidgetRenderTimer);
        __navalWidgetRenderTimer = 0;
    }
    __navalWidgetRenderTimer = window.setTimeout(() => {
        __navalWidgetRenderTimer = 0;
        renderNavalTrackerWidget();
    }, Math.max(0, delay));
}
function syncNavalSignals(events = []) {
    const activeKeys = new Set();
    events
        .filter((event) => isNavalSignalEvent(event) && isEventVisible(event))
        .forEach((event) => {
            const key = getNavalTrackKey(event);
            if (!key) return;
            activeKeys.add(key);
            upsertNavalVessel(event);
        });
    getAllNavalSnapshots().forEach((entry) => {
        const key = String(entry?.track_key || "");
        if (!key || activeKeys.has(key)) return;
        clearNavalVessel(key);
    });
    requestNavalWidgetRender(0);
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
    const rows = events.slice(0, 18);
    if (!rows.length) {
        feed.innerHTML = '<div class="feed-empty">No events available yet.</div>';
        return;
    }
    rows.forEach((event) => {
        const card = document.createElement("article");
        card.className = "timeline-item wz-feed-item";
        card.dataset.eventId = event.id;
        const safeUrl = /^https?:\/\//i.test(event.source_url || "") ? event.source_url : "";
        const sourceName = String(event.source_name || "OSINT feed").trim();
        card.innerHTML = `
            <div class="timeline-time wz-feed-time">
                <span class="feed-pill">${String(event.category || "unknown").toUpperCase()}</span>
                <time>${formatTime(event.occurred_at)}</time>
                <small>${sourceName}</small>
            </div>
            <div class="timeline-body">
                <strong>${event.title || "Untitled event"}</strong>
                <p>${event.summary || "No summary available."}</p>
                <small>
                    ${compactEventPlaceLabel(event)}
                    ${safeUrl ? ` • <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
                </small>
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
        "aircraft",
        "military",
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
    const options = [...new Set(
        items
            .map((track) => resolveAircraftSubtype(track))
            .map((value) => String(value || "").toLowerCase())
            .filter((value) => value && !["military", "aircraft", "unknown", "trainer"].includes(value))
    )];
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
function resolveAircraftSubtype(track = {}) {
    const metadata = getAircraftMetadata(track);
    const raw = String(track.subtype || track.subcategory || metadata.role || "")
        .trim()
        .toLowerCase();
    if (raw && !["military", "aircraft", "unknown"].includes(raw)) {
        return raw;
    }
    const haystack = [
        track.type_code,
        track.icao_type,
        metadata.type_code,
        track.model_name,
        track.model,
        track.variant,
        track.aircraft_type,
        track.description,
        metadata.model_name,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (/(awacs|aew|wedgetail|hawkeye|sentry|e-3\b|e3\b|e-7\b|e7\b|a-50\b|a50\b|phalcon|erieye|kj-200\b|kj200\b|kj-500\b|kj500\b|kj-2000\b|kj2000\b)/.test(haystack)) return "awacs";
    if (/(rivet joint|cobra ball|combat sent|recon|reconnaissance|surveillance|poseidon|orion|rc-135\b|rc135\b|ep-3\b|ep3\b|p-8\b|p8\b|p-3\b|p3\b)/.test(haystack)) return "recon";
    if (/(isr\b|global hawk|triton|jstars|e-8\b|e8\b|rq-4\b|rq4\b|special mission)/.test(haystack)) return "isr";
    if (/(tanker|refuel|refueller|pegasus|extender|stratotanker|kc-135\b|kc135\b|kc-46\b|kc46\b|kc-10\b|kc10\b|a330 mrtt\b|mrtt\b|voyager\b|il-78\b|il78\b|yy-20\b|yy20\b)/.test(haystack)) return "tanker";
    if (/(transport|airlift|cargo|logistics|globemaster|hercules|atlas\b|a400m\b|c-17\b|c17\b|c-5\b|c5\b|c-130\b|hc-130\b|mc-130\b|c130\b|c-40\b|c40\b|an-124\b|an124\b|an-12\b|an12\b|il-76\b|il76\b|y-20\b|y20\b|cn-235\b|cn235\b|c295\b)/.test(haystack)) return "transport";
    if (/(helicopter|rotary|rotorcraft|black hawk|blackhawk|apache|chinook|osprey|seahawk|super stallion|king stallion|lakota|agusta|sikorsky|leonardo|aw-139\b|aw139\b|aw-119\b|aw119\b|th-73\b|th73\b|uh-72\b|uh72\b|uh-60\b|uh60\b|hh-60\b|hh60\b|mh-60\b|mh60\b|h-60\b|h60\b|ch-47\b|ch47\b|ch-53\b|ch53\b|v-22\b|v22\b|mi-8\b|mi8\b|mi-17\b|mi17\b|mi-24\b|mi24\b|mi-28\b|mi28\b|ka-27\b|ka27\b|ka-52\b|ka52\b)/.test(haystack)) return "helicopter";
    if (/(bomber|b-1\b|b1\b|b-2\b|b2\b|b-52\b|b52\b|tu-95\b|tu95\b|tu-160\b|tu160\b|h-6\b|h6\b|ac-130\b|ac130\b|spectre|spooky)/.test(haystack)) return "bomber";
    if (/(uav\b|drone\b|ucav\b|reaper\b|predator\b|mq-9\b|mq9\b|rq-4\b|rq4\b|tb2\b|bayraktar\b|heron\b|hermes\b)/.test(haystack)) return "uav";
    if (/(trainer\b|t-6\b|t6\b|t-38\b|t38\b|hawk\b|m-346\b|m346\b|yak-130\b|yak130\b|pc-21\b|pc21\b)/.test(haystack)) return "trainer";
    if (/(fighter\b|interceptor\b|multirole\b|hornet\b|super hornet\b|strike eagle\b|raptor\b|lightning ii\b|warthog\b|typhoon\b|eurofighter\b|rafale\b|gripen\b|mirage\b|tomcat\b|f-15\b|f15\b|f-16\b|f16\b|f-18\b|f18\b|fa-18\b|f\/a-18\b|f-22\b|f22\b|f-35\b|f35\b|a-10\b|a10\b|su-27\b|su27\b|su-30\b|su30\b|su-35\b|su35\b|mig-29\b|mig29\b|mig-31\b|mig31\b|j-10\b|j10\b|j-16\b|j16\b|j-20\b|j20\b|tejas\b|jf-17\b|jf17\b)/.test(haystack)) return "fighter";
    if (raw && !["military", "aircraft", "unknown"].includes(raw)) return raw;
    return "aircraft";
}
function getAircraftMetadata(track = {}) {
    const raw = track?.metadata;
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
function getAircraftRegistrationLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const registration = sanitizeAircraftText(
        track.registration ||
        track.reg ||
        track.tail_number ||
        metadata.registration ||
        ""
    );
    return isAircraftDisplayTextUsable(registration) ? registration : "";
}
function getAircraftTypeCodeLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const typeCode = sanitizeAircraftText(
        track.type_code ||
        track.icao_type ||
        metadata.type_code ||
        ""
    );
    return isAircraftDisplayTextUsable(typeCode) ? typeCode : "";
}
function getAircraftModelLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const model = sanitizeAircraftText(
        track.model_name ||
        track.model ||
        track.variant ||
        track.aircraft_type ||
        track.description ||
        metadata.model_name ||
        ""
    );
    return isAircraftDisplayTextUsable(model) ? model : "";
}
function getAircraftOperatorLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const operator = sanitizeAircraftText(
        track.operator ||
        track.owner ||
        metadata.operator ||
        ""
    );
    return isAircraftDisplayTextUsable(operator) ? operator : "";
}
function getAircraftIdentityLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const callsign = sanitizeAircraftText(
        track.callsign ||
        track.flight ||
        metadata.callsign ||
        ""
    );
    if (isAircraftDisplayTextUsable(callsign)) {
        return callsign;
    }
    const registration = getAircraftRegistrationLabel(track);
    if (registration) {
        return registration;
    }
    return "";
}
function doesAircraftTitleLookRich(rawTitle = "", model = "", identity = "", affiliation = "") {
    const raw = sanitizeAircraftText(rawTitle);
    if (!isAircraftDisplayTextUsable(raw)) return false;
    const normalized = raw.toLowerCase();
    const modelLabel = sanitizeAircraftText(model).toLowerCase();
    const identityLabel = sanitizeAircraftText(identity).toLowerCase();
    const affiliationLabel = sanitizeAircraftText(affiliation).toLowerCase();
    if (modelLabel && normalized.includes(modelLabel)) return true;
    if (identityLabel && normalized !== identityLabel && raw.length >= Math.max(identityLabel.length + 8, 18)) return true;
    if (affiliationLabel && normalized.includes(affiliationLabel) && raw.length >= 18) return true;
    return raw.length >= 26 && raw.split(/\s+/).length >= 3;
}
function getAircraftDisplayTitle(track = {}) {
    const subtypeLabel = formatAircraftSubtypeLabel(resolveAircraftSubtype(track));
    const rawTitle = sanitizeAircraftText(track.title || "");
    const model = getAircraftModelLabel(track) || getAircraftTypeCodeLabel(track);
    const identity = getAircraftIdentityLabel(track);
    const operator = getAircraftOperatorLabel(track);
    const country = sanitizeAircraftText(track.country || getAircraftMetadata(track).country || "");
    const affiliation = operator || country;
    if (model) {
        if (doesAircraftTitleLookRich(rawTitle, model, identity, affiliation)) {
            return rawTitle;
        }
        if (identity && affiliation) {
            return `${model} — ${identity} (${affiliation})`;
        }
        if (identity) {
            return `${model} — ${identity}`;
        }
        if (affiliation) {
            return `${model} (${affiliation})`;
        }
        return model;
    }
    if (isAircraftDisplayTextUsable(rawTitle)) {
        return rawTitle;
    }
    if (identity && affiliation) {
        return `${identity} (${affiliation})`;
    }
    if (identity) {
        return identity;
    }
    const shortKey = String(track.track_key || "").slice(-6).toUpperCase();
    return shortKey ? `${subtypeLabel} ${shortKey}` : subtypeLabel;
}
function getAircraftCountryLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const raw = sanitizeAircraftText(track.country || metadata.country || track.region || "Unknown");
    return raw || "Unknown";
}
function getAircraftAffiliationLabel(track = {}) {
    return getAircraftOperatorLabel(track) || getAircraftCountryLabel(track);
}
function getAircraftDetailLabel(track = {}) {
    const subtype = formatAircraftSubtypeLabel(resolveAircraftSubtype(track));
    const model = getAircraftModelLabel(track);
    const typeCode = getAircraftTypeCodeLabel(track);
    if (model && typeCode && !model.toLowerCase().includes(typeCode.toLowerCase())) {
        return `${model} • ${typeCode}`;
    }
    if (model) return model;
    if (typeCode) return `${subtype} • ${typeCode}`;
    return subtype;
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
    const metadata = getAircraftMetadata(row);
    const subtype = resolveAircraftSubtype(row);
    const title = getAircraftDisplayTitle({
        ...row,
        subcategory: subtype,
    });
    const lastSeenAt = new Date(
        row.last_seen_at ||
        row.updated_at ||
        row.created_at ||
        row.occurred_at ||
        Date.now()
    ).getTime();
    const status = String(row.status || "active").toLowerCase();
    const active = status !== "ended" && (Date.now() - lastSeenAt) <= AIRCRAFT_HISTORY_ACTIVE_WINDOW_MS;
    const endedAt = row.ended_at
        ? new Date(row.ended_at).getTime()
        : (active ? 0 : lastSeenAt);
    return {
        track_key: String(row.track_key || ""),
        icao24: String(row.icao24 || row.icao || metadata.icao || "").trim().toLowerCase(),
        title,
        callsign: sanitizeAircraftText(row.callsign || metadata.callsign || ""),
        subcategory: subtype,
        country: String(row.country || metadata.country || row.region || "Unknown"),
        operator: getAircraftOperatorLabel(row),
        model_name: getAircraftModelLabel(row),
        type_code: getAircraftTypeCodeLabel(row),
        registration: getAircraftRegistrationLabel(row),
        region: String(row.region || ""),
        lat: Number(row.lat),
        lon: Number(row.lon),
        altitude_ft: Number(row.altitude_ft ?? metadata.altitude_ft ?? 0),
        speed_kts: Number(row.speed_kts ?? metadata.speed_kts ?? 0),
        heading_deg: Number(row.heading_deg ?? metadata.heading ?? 0),
        active,
        ended_at: endedAt,
        last_seen_at: Number.isFinite(lastSeenAt) ? lastSeenAt : Date.now(),
        occurred_at: row.occurred_at || row.updated_at || row.created_at || row.last_seen_at || new Date().toISOString(),
        metadata,
        __source: "tracks-db",
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
function getAircraftMergeKey(track = {}) {
    const metadata = getAircraftMetadata(track);
    const icao = String(track.icao24 || track.icao || metadata.icao || "")
        .trim()
        .toLowerCase();
    if (icao) return `icao:${icao}`;
    const registration = getAircraftRegistrationLabel(track).toLowerCase();
    if (registration) return `reg:${registration}`;
    const callsign = sanitizeAircraftText(track.callsign || track.flight || metadata.callsign || "")
        .trim()
        .toLowerCase();
    if (callsign) return `callsign:${callsign}`;
    return `track:${String(track.track_key || "")}`;
}
function mergeAircraftWidgetTrack(existing = {}, incoming = {}) {
    const existingMeta = getAircraftMetadata(existing);
    const incomingMeta = getAircraftMetadata(incoming);
    const merged = {
        ...existing,
        ...incoming,
        metadata: {
            ...existingMeta,
            ...incomingMeta,
        },
    };
    merged.track_key = String(incoming.track_key || existing.track_key || "");
    merged.icao24 = String(incoming.icao24 || existing.icao24 || incomingMeta.icao || existingMeta.icao || "").trim().toLowerCase();
    merged.callsign = sanitizeAircraftText(incoming.callsign || existing.callsign || incomingMeta.callsign || existingMeta.callsign || "");
    merged.registration = incoming.registration || existing.registration || incomingMeta.registration || existingMeta.registration || "";
    merged.type_code = incoming.type_code || existing.type_code || incomingMeta.type_code || existingMeta.type_code || "";
    merged.model_name = incoming.model_name || existing.model_name || incomingMeta.model_name || existingMeta.model_name || "";
    merged.operator = incoming.operator || existing.operator || incomingMeta.operator || existingMeta.operator || "";
    merged.country = incoming.country || existing.country || incomingMeta.country || existingMeta.country || "";
    merged.last_seen_at = Math.max(Number(existing.last_seen_at || 0), Number(incoming.last_seen_at || 0), 0);
    merged.active = existing.active === true || incoming.active === true;
    merged.ended_at = merged.active
        ? 0
        : Math.max(Number(existing.ended_at || 0), Number(incoming.ended_at || 0), merged.last_seen_at);
    merged.subcategory = resolveAircraftSubtype(merged);
    return merged;
}
function mergeAircraftWidgetSources(liveItems = [], historyItems = []) {
    const map = new Map();
    historyItems.forEach((track) => {
        if (!track?.track_key) return;
        const key = getAircraftMergeKey(track);
        map.set(key, map.has(key) ? mergeAircraftWidgetTrack(map.get(key), track) : track);
    });
    liveItems.forEach((track) => {
        if (!track?.track_key) return;
        const key = getAircraftMergeKey(track);
        map.set(key, map.has(key) ? mergeAircraftWidgetTrack(map.get(key), track) : track);
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
    const liveItems = getAllLiveTrackSnapshots({ includePathHistory: false })
        .map((track) => ({ ...track, subcategory: resolveAircraftSubtype(track) }))
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer");
    const historyItems = (__aircraftHistoryCache || [])
        .map((track) => ({ ...track, subcategory: resolveAircraftSubtype(track) }))
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer");
    const allItems = mergeAircraftWidgetSources(liveItems, historyItems);
    let items = [];
    if (__aircraftWidgetFilter === "recent") {
        const recentCutoff = Date.now() - AIRCRAFT_RECENT_WINDOW_MS;
        items = allItems.filter((track) =>
            Number(track.last_seen_at || 0) >= recentCutoff
        );
    } else if (__aircraftWidgetFilter === "ended") {
        items = allItems.filter((track) => !track.active);
    } else {
        items = allItems.filter((track) => track.active);
    }
    if (__aircraftWidgetSubtypeFilter && __aircraftWidgetSubtypeFilter !== "all") {
        items = items.filter(
            (track) => String(track.subcategory || "").toLowerCase() === __aircraftWidgetSubtypeFilter
        );
    }
    items = items
        .sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0))
        .slice(0, LIVE_AIRCRAFT_WIDGET_MAX_ITEMS * __aircraftWidgetPage);
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
    const detailLabel = getAircraftDetailLabel(track);
    const affiliationLabel = getAircraftAffiliationLabel(track);
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
    if (metaSpans[0]) metaSpans[0].textContent = detailLabel;
    if (metaSpans[1]) metaSpans[1].textContent = affiliationLabel;
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
    const existingCards = [...container.querySelectorAll(".wz-aircraft-item")];
    const existingCardMap = new Map(
        existingCards.map((card) => [String(card.dataset.trackKey || ""), card])
    );
    const wantedKeys = new Set(items.map((track) => String(track.track_key || "")));
    existingCards.forEach((card) => {
        const key = String(card.dataset.trackKey || "");
        if (!wantedKeys.has(key)) {
            card.remove();
            existingCardMap.delete(key);
        }
    });
    ensureAircraftWidgetEmptyState(container, items.length > 0);
    if (!items.length) return;
    const cardsInOrder = [];
    items.forEach((track) => {
        const trackKey = String(track.track_key || "");
        let card = existingCardMap.get(trackKey) || null;
        if (!card) {
            card = document.createElement("article");
            if (!card) return;
            card.className = "wz-aircraft-item";
            card.dataset.trackKey = trackKey;
        }
        updateAircraftWidgetCard(card, track, selection);
        cardsInOrder.push(card);
    });
    const loadMoreBtn = container.querySelector(".wz-aircraft-load-more");
    const fragment = document.createDocumentFragment();
    cardsInOrder.forEach((card) => fragment.appendChild(card));
    if (loadMoreBtn) {
        container.insertBefore(fragment, loadMoreBtn);
    } else {
        container.appendChild(fragment);
    }

    // Load More button
    let nextLoadMoreBtn = loadMoreBtn;
    const allForCount = (() => {
        let all = allItems.filter(t => isAircraftTrackSubtype(resolveAircraftSubtype(t)));
        if (__aircraftWidgetFilter === "active") {
            all = all.filter(t => t.active);
        } else if (__aircraftWidgetFilter === "recent") {
            const recentCutoff = Date.now() - AIRCRAFT_RECENT_WINDOW_MS;
            all = all.filter(t => Number(t.last_seen_at || 0) >= recentCutoff);
        } else if (__aircraftWidgetFilter === "ended") {
            all = all.filter(t => !t.active);
        }
        if (__aircraftWidgetSubtypeFilter && __aircraftWidgetSubtypeFilter !== "all") {
            all = all.filter(t => String(t.subcategory || "").toLowerCase() === __aircraftWidgetSubtypeFilter);
        }
        return all.length;
    })();
    const shownCount = LIVE_AIRCRAFT_WIDGET_MAX_ITEMS * __aircraftWidgetPage;
    const hasMore = allForCount > shownCount;
    if (hasMore) {
        if (!nextLoadMoreBtn) {
            nextLoadMoreBtn = document.createElement("button");
            nextLoadMoreBtn.type = "button";
            nextLoadMoreBtn.className = "wz-aircraft-load-more";
            nextLoadMoreBtn.dataset.aircraftLoadMore = "1";
        }
        const remaining = Math.min(LIVE_AIRCRAFT_WIDGET_MAX_ITEMS, allForCount - shownCount);
        nextLoadMoreBtn.textContent = `Load More (${remaining} more)`;
        container.appendChild(nextLoadMoreBtn); // always move to end after cards
    } else {
        nextLoadMoreBtn?.remove();
    }
}
function bindAircraftMovementsWidget() {
    if (__aircraftWidgetBound) return;
    __aircraftWidgetBound = true;
    document.addEventListener("click", (event) => {
        const loadMoreBtn = event.target.closest("[data-aircraft-load-more]");
        if (loadMoreBtn) {
            __aircraftWidgetPage += 1;
            requestAircraftMovementsWidgetRender(0);
            return;
        }
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
            __aircraftWidgetPage = 1;
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
        __aircraftWidgetPage = 1;
        if (__aircraftWidgetFilter !== "active") {
            scheduleAircraftHistoryRefresh(true);
            return;
        }
        requestAircraftMovementsWidgetRender(0);
    });
    document.addEventListener("wz:aircraft-log-updated", () => {
        requestAircraftMovementsWidgetRender();
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
    debouncedRenderRaw(); // strike counters + escalation always use full cache
}
function syncFilteredUi(events) {
    const filtered = applyAllFilters(events);
    debouncedRenderFeed(filtered);
    debouncedRenderUI(filtered);
    debouncedRenderHeavy(filtered);
    debouncedRenderRaw(); // strike counters + escalation always use full cache
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
    const navalVisible = visible.filter(isNavalSignalEvent);
    syncNavalSignals(navalVisible);
    const globeVisible = visible.filter((event) => !isNavalSignalEvent(event));
    const visibleSignature = makeEventSignature(globeVisible);
    const rangesEnabled = isLayerEnabled("ranges");
    const sweepersEnabled = isLayerEnabled("sweepers");
    globe.setPerformanceMode?.(globeVisible.length);
    if (!globeVisible.length) {
        __hotspotLayer?.setEvents(visible);
        if (__lastGlobeSyncKey !== "__empty__") {
            globe.clearEventEntities?.();
            __militaryTracks?.setTracks([]);
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
            globeVisible.map((event) => ({
                ...event,
                _layerId: getEventLayerId(event),
            }))
        );
        globe.addEvents?.(clustered);
        if (__militaryTracks) {
            __militaryTracks.setTracks(
                globeVisible.filter((event) => isMilitaryTrackEvent(event) && isEventVisible(event))
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
                renderRanges(window.__warzoneViewer, globeVisible);
            }
            __lastRangesSyncKey = nextRangesKey;
        }
        const nextSweepersKey = sweepersEnabled ? visibleSignature : "__off__";
        if (nextSweepersKey !== __lastSweepersSyncKey) {
            clearSweepers(window.__warzoneViewer);
            if (sweepersEnabled) {
                renderSweepers(window.__warzoneViewer, globeVisible);
            }
            __lastSweepersSyncKey = nextSweepersKey;
        }
    }
    if (animateTracks) {
        const recentTracks = globeVisible
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
        if (id === "military-bases" || id === "*") {
            window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
        }
        if (id === "aircraft" || id === "*") {
            if (!isLayerEnabled("aircraft")) {
                getAllLiveTrackSnapshots({ includePathHistory: false }).forEach((track) => {
                    if (track?.track_key) clearLiveTrack(track.track_key);
                });
            } else {
                refreshPublicAirTracksNow().catch(() => { });
            }
            requestAircraftMovementsWidgetRender(0);
        }
        if (id === "*") {
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
        }
        syncFilteredUi(sourceEvents);
        syncInitialEventsToGlobe(sourceEvents, { animateTracks: false });

        // Airspace Status and Cyber Status widgets must always reflect the FULL
        // event cache — they are independent of the "aircraft" layer.
        // warzone-layers.js handles their widget visibility via the "airspace"
        // uiOnly layer toggle. Here we ensure their DATA is never aircraft-filtered.
        renderAirspaceStatus(sourceEvents);
        renderCyberStatus(sourceEvents);
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
                const eventType = String(payload.eventType || payload.event || "").toUpperCase();
                const track = payload.new || payload.old;
                if (!track) return;
                if (!isLayerEnabled("aircraft")) {
                    if (track.track_key) {
                        clearLiveTrack(track.track_key);
                    }
                    return;
                }
                if (eventType === "DELETE") {
                    clearLiveTrack(track.track_key);
                    return;
                }
                upsertLiveTrack(track);
            }
        )
        .subscribe((status, err) => {
            if (status === "CHANNEL_ERROR" && err) console.error("TRACK ERROR:", err);
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
    if (isNavalSignalEvent(normalized)) {
        const trackKey = getNavalTrackKey(normalized);
        if (inRegion && layerOk) {
            upsertNavalVessel(normalized);
        } else if (trackKey) {
            clearNavalVessel(trackKey);
        }
        requestNavalWidgetRender(0);
    } else if (isMilitaryTrackEvent(normalized) && __militaryTracks) {
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
        } catch { }
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

const LOCAL_AUTH_BASES = [
    "http://localhost:55147/api/auth",
];

const PROD_AUTH_BASES = [
    "https://www.battlespacex.com/api/auth",
];

function isLocalHostName(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
}

function getAuthBases() {
    return isLocalHostName(window.location.hostname)
        ? [...LOCAL_AUTH_BASES, ...PROD_AUTH_BASES]
        : [...PROD_AUTH_BASES];
}


function applyResolvedAuthState(isAuthenticated, user = null, resolvedBase = null) {
    window.__stratopsResolvedAuthBase = resolvedBase || null;
    window.__stratopsAuthState = {
        isAuthenticated: !!isAuthenticated,
        user: !!isAuthenticated ? (user || null) : null,
    };

    document.body.classList.toggle("is-authenticated", !!isAuthenticated);

    syncNavLoginButton();

    return !!isAuthenticated;
}

async function fetchAuthJson(url, options = {}) {
    const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        ...options,
        headers: {
            "X-Requested-With": "XMLHttpRequest",
            ...(options.headers || {}),
        },
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { response, data };
}

async function validateAgainstBase(baseUrl) {
    try {
        const { response, data } = await fetchAuthJson(`${baseUrl}/validate`, {
            method: "GET",
        });

        if (!response.ok) {
            return { ok: false, isAuthenticated: false, user: null, baseUrl };
        }

        return {
            ok: true,
            isAuthenticated: !!data?.isAuthenticated,
            user: data || null,
            baseUrl,
        };
    } catch (err) {
        void err;
        return { ok: false, isAuthenticated: false, user: null, baseUrl };
    }
}

async function confirmAuthSession(maxPasses = 2) {
    const bases = getAuthBases();

    for (let pass = 0; pass < maxPasses; pass += 1) {
        for (const baseUrl of bases) {
            const result = await validateAgainstBase(baseUrl);
            if (result.isAuthenticated) {
                return applyResolvedAuthState(true, result.user, baseUrl);
            }
        }

        if (pass < maxPasses - 1) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    return applyResolvedAuthState(false, null, null);
}

function getAuthModalElements() {
    return {
        modal: document.getElementById("wz-login-modal"),
        guestCopy: document.getElementById("auth-guest-copy"),
        authedCopy: document.getElementById("auth-authed-copy"),
        authedUser: document.getElementById("auth-authed-user"),
        loginFields: document.getElementById("auth-login-fields"),
        createAccount: document.getElementById("auth-create-account"),
        email: document.getElementById("auth-email"),
        password: document.getElementById("auth-password"),
        remember: document.getElementById("auth-remember"),
        consent: document.getElementById("auth-disclaimer-check"),
        loginBtn: document.getElementById("auth-login-btn"),
        loginBtnText: document.getElementById("auth-login-btn-text"),
        error: document.getElementById("auth-error"),
    };
}

function setAuthError(message) {
    const { error } = getAuthModalElements();
    if (!error) return;
    if (!message) { error.hidden = true; error.textContent = ""; return; }
    error.hidden = false; error.textContent = message;
}

function syncAuthButtonState() {
    const { loginBtn, consent } = getAuthModalElements();
    if (!loginBtn) return;
    const allowed = !!consent?.checked;
    loginBtn.disabled = !allowed;
    loginBtn.setAttribute("aria-disabled", String(!allowed));
    if (allowed) { loginBtn.classList.remove("is-locked"); loginBtn.style.pointerEvents = ""; }
    else { loginBtn.classList.add("is-locked"); loginBtn.style.pointerEvents = "none"; }
}

function setAuthLoading(isLoading) {
    const { loginBtn, loginBtnText } = getAuthModalElements();
    if (!loginBtn) return;
    loginBtn.classList.toggle("is-loading", isLoading);
    if (loginBtnText) loginBtnText.textContent = isLoading ? "Verifying..."
        : loginBtn.dataset.mode === "authenticated" ? "Enter StratOps" : "Log In";
}

function setAuthMode(isAuthenticated, user = null) {
    const { guestCopy, authedCopy, authedUser, loginFields, createAccount,
        email, password, remember, loginBtn, loginBtnText } = getAuthModalElements();
    if (guestCopy) guestCopy.hidden = !!isAuthenticated;
    if (authedCopy) authedCopy.hidden = !isAuthenticated;
    if (loginFields) loginFields.hidden = !!isAuthenticated;
    if (createAccount) createAccount.hidden = !!isAuthenticated;
    if (authedUser) {
        const n = user?.username || user?.email || "";
        authedUser.textContent = n ? `Logged in as: ${n}` : "";
        authedUser.hidden = !n;
    }
    if (email) { email.disabled = !!isAuthenticated; if (isAuthenticated) email.value = ""; }
    if (password) { password.disabled = !!isAuthenticated; if (isAuthenticated) password.value = ""; }
    if (remember) { remember.disabled = !!isAuthenticated; if (isAuthenticated) remember.checked = false; }
    if (loginBtn) {
        const label = isAuthenticated ? "Enter StratOps" : "Log In";
        loginBtn.dataset.mode = isAuthenticated ? "authenticated" : "guest";
        if (loginBtnText) loginBtnText.textContent = label; else loginBtn.textContent = label;
    }
}

export function showLoginModal(mode = "guest", user = null) {
    const { modal, email, consent } = getAuthModalElements();
    const isAuthenticated = mode === "authenticated";
    setAuthError("");
    setAuthMode(isAuthenticated, user);
    syncAuthButtonState();
    if (!modal) return;
    modal.hidden = false;
    requestAnimationFrame(() => {
        modal.classList.add("is-visible");
    });
    requestAnimationFrame(() => {
        if (isAuthenticated) consent?.focus();
        else email?.focus();
    });
}

export function hideLoginModal() {
    const { modal, password } = getAuthModalElements();
    if (!modal) return;
    modal.classList.remove("is-visible");
    setTimeout(() => {
        modal.hidden = true;
        if (password) password.value = "";
        setAuthError("");
    }, 220);
}

function isLoginModalOpen() {
    const m = document.getElementById("wz-login-modal");
    return m && !m.hidden;
}

export function initStratopsIntro() {
    // ── Elements ────────────────────────────────────────────────────────────
    const introModal = document.getElementById("wz-intro-modal");
    const acceptBtn = document.getElementById("wz-intro-accept");
    const acceptLabel = document.getElementById("wz-intro-accept-label");
    const checkbox = document.getElementById("intro-disclaimer-check");
    const openLoginBtn = document.getElementById("wz-intro-open-login");
    const backBtn = document.getElementById("wz-intro-back");
    const loginHint = document.getElementById("wz-intro-login-hint");
    const contentView = document.getElementById("wz-intro-content-view");
    const loginView = document.getElementById("wz-intro-login-view");

    // Inline login fields (live inside the intro modal — separate from #wz-login-modal)
    const introEmail = document.getElementById("intro-auth-email");
    const introPassword = document.getElementById("intro-auth-password");
    const introRemember = document.getElementById("intro-auth-remember");
    const introError = document.getElementById("intro-auth-error");
    const introForm = document.getElementById("intro-auth-form");

    let isLoginMode = false;

    // ── Helper: show/hide inline error ──────────────────────────────────────
    function setIntroError(msg) {
        if (!introError) return;
        introError.hidden = !msg;
        introError.textContent = msg || "";
    }

    // ── Helper: enable/disable accept button ────────────────────────────────
    function syncIntroBtn() {
        if (!acceptBtn) return;
        const allowed = !!checkbox?.checked;
        acceptBtn.disabled = !allowed;
        acceptBtn.setAttribute("aria-disabled", String(!allowed));
        if (allowed) { acceptBtn.classList.remove("is-locked"); acceptBtn.style.pointerEvents = ""; }
        else { acceptBtn.classList.add("is-locked"); acceptBtn.style.pointerEvents = "none"; }
    }

    // ── Switch to login view ─────────────────────────────────────────────────
    function showLoginView() {
        isLoginMode = true;
        setIntroError("");

        // Cross-fade panels
        contentView?.classList.remove("is-active");
        contentView?.setAttribute("aria-hidden", "true");
        loginView?.classList.add("is-active");
        loginView?.removeAttribute("aria-hidden");

        // Fade out login hint, show Back button, swap accept label
        loginHint?.classList.add("is-hidden-hint");
        if (backBtn) { backBtn.hidden = false; backBtn.style.display = ""; }
        if (acceptLabel) acceptLabel.textContent = "Login";

        // Focus first field
        setTimeout(() => introEmail?.focus(), 320);
    }

    // ── Switch back to content view ──────────────────────────────────────────
    function showContentView() {
        isLoginMode = false;
        setIntroError("");

        // Cross-fade panels
        loginView?.classList.remove("is-active");
        loginView?.setAttribute("aria-hidden", "true");
        contentView?.classList.add("is-active");
        contentView?.removeAttribute("aria-hidden");

        // Restore login hint, hide Back button, restore accept label
        loginHint?.classList.remove("is-hidden-hint");
        if (backBtn) { backBtn.hidden = true; backBtn.style.display = "none"; }
        if (acceptLabel) acceptLabel.textContent = "Enter";

        // Clear fields on back
        if (introEmail) introEmail.value = "";
        if (introPassword) introPassword.value = "";
    }

    // ── Accept and Enter (content mode) ─────────────────────────────────────
    async function handleEnter() {
        if (!checkbox?.checked) return;
        try { localStorage.setItem("wz_intro_accepted", "1"); } catch { }
        if (introModal) {
            introModal.classList.remove("is-visible");
            introModal.hidden = true;
        }
        window.__warzoneShowRegionModal?.();
    }

    // ── Accept and Login (login mode) ────────────────────────────────────────
    async function handleLogin() {
        if (!checkbox?.checked) return;
        setIntroError("");

        const emailVal = String(introEmail?.value || "").trim();
        const passwordVal = String(introPassword?.value || "");
        const rememberVal = !!introRemember?.checked;

        if (!emailVal || !passwordVal) {
            setIntroError("Please enter your email and password.");
            return;
        }

        acceptBtn.disabled = true;
        acceptBtn.style.pointerEvents = "none";
        if (acceptLabel) acceptLabel.textContent = "Signing in…";

        try {
            const body = new URLSearchParams();
            body.append("email", emailVal);
            body.append("password", passwordVal);
            body.append("rememberMe", String(rememberVal));

            const data = await postAuthFormWithFallback("/login", body);
            if (!data?.success) {
                setIntroError(data?.message || "Invalid email or password.");
                return;
            }

            const confirmed = await confirmAuthSession(3);
            if (!confirmed) {
                setIntroError("Login succeeded but your BattleSpaceX session could not be confirmed yet. Please try again.");
                return;
            }

            document.dispatchEvent(new CustomEvent("wz:auth-success", { detail: { source: "intro-login" } }));

            try { localStorage.setItem("wz_intro_accepted", "1"); } catch { }

            if (introModal) {
                introModal.classList.remove("is-visible");
                introModal.hidden = true;
            }

            window.__warzoneShowRegionModal?.();
        } catch (err) {
            setIntroError(err?.message || "Unable to sign in right now. Please try again.");
        } finally {
            syncIntroBtn();
            if (acceptLabel && isLoginMode) acceptLabel.textContent = "Login";
        }
    }

    // ── Wire events ──────────────────────────────────────────────────────────
    checkbox?.addEventListener("change", syncIntroBtn);
    syncIntroBtn();

    openLoginBtn?.addEventListener("click", showLoginView);
    backBtn?.addEventListener("click", showContentView);

    acceptBtn?.addEventListener("click", async () => {
        if (!checkbox?.checked) return;
        if (isLoginMode) {
            await handleLogin();
        } else {
            await handleEnter();
        }
    });

    // Allow Enter key in login fields to submit
    [introEmail, introPassword].forEach(input => {
        input?.addEventListener("keydown", async (e) => {
            if (e.key === "Enter" && isLoginMode && checkbox?.checked) {
                e.preventDefault();
                await handleLogin();
            }
        });
    });
    introForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isLoginMode && checkbox?.checked) {
            await handleLogin();
        }
    });

    // ── Auth state check — hide sign-in hint if already logged in ────────────
    function applyAuthToIntro(isAuth) {
        if (!loginHint) return;
        if (isAuth) {
            loginHint.innerHTML = `<span class="static-icon bx-web-ico-checked-1-0 color-teal-glow"></span><span>Active session detected via BattlespaceX. Continue to StratOps.</span>`;
        }
    }

    if (window.__stratopsAuthState?.isAuthenticated) {
        applyAuthToIntro(true);
    } else {
        stratopsCheckAuth().then(applyAuthToIntro).catch(() => { });
    }

    // ── Show modal ───────────────────────────────────────────────────────────
    if (introModal) {
        introModal.hidden = false;
        introModal.classList.add("is-visible");
    }
}

export function initStratopsAuth() {
    const { loginBtn, email, password, remember, consent } = getAuthModalElements();
    const loginForm = document.getElementById("auth-login-form");
    if (!loginBtn || loginBtn.dataset.authBound === "true") return;

    document.getElementById("wz-login-close")?.addEventListener("click", hideLoginModal);
    document.getElementById("wz-login-modal")?.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) hideLoginModal();
    });

    const submit = async () => {
        const consentValue = !!consent?.checked;
        const isAuthenticated = loginBtn.dataset.mode === "authenticated";
        setAuthError("");
        if (!consentValue) { setAuthError("Please acknowledge the disclaimer before continuing."); syncAuthButtonState(); return; }
        if (isAuthenticated) { hideLoginModal(); return; }

        const emailValue = String(email?.value || "").trim();
        const passwordValue = String(password?.value || "");
        const rememberValue = !!remember?.checked;

        if (!emailValue || !passwordValue) { setAuthError("Enter your email and password."); return; }

        loginBtn.disabled = true;
        loginBtn.setAttribute("aria-disabled", "true");
        loginBtn.style.pointerEvents = "none";
        setAuthLoading(true);

        try {
            const body = new URLSearchParams();
            body.append("email", emailValue);
            body.append("password", passwordValue);
            body.append("rememberMe", String(rememberValue));
            const data = await postAuthFormWithFallback("/login", body);
            if (!data?.success) { setAuthError(data?.message || "Invalid email or password."); return; }

            const confirmed = await confirmAuthSession(3);
            if (!confirmed) {
                setAuthError("Login succeeded but your BattleSpaceX session could not be confirmed yet. Please try again.");
                return;
            }

            hideLoginModal();
            // Notify all gated features (military bases, layer locks, etc.)
            document.dispatchEvent(new CustomEvent("wz:auth-success", { detail: { source: "login" } }));
        } catch (err) {
            console.error("Login failed:", err);
            setAuthError(err?.message || "Unable to log in right now. Please try again.");
        } finally {
            setAuthLoading(false);
            syncAuthButtonState();
        }
    };

    loginBtn.dataset.authBound = "true";
    consent?.addEventListener("change", () => { setAuthError(""); syncAuthButtonState(); });
    loginBtn.addEventListener("click", submit);
    const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    email?.addEventListener("keydown", onEnter);
    password?.addEventListener("keydown", onEnter);
    loginForm?.addEventListener("submit", (e) => {
        e.preventDefault();
        submit();
    });
    syncAuthButtonState();
}

export async function stratopsCheckAuth() {
    try {
        return await confirmAuthSession(1);
    } catch (err) {
        console.error("[auth] Check failed:", err);
        return applyResolvedAuthState(false, null, null);
    }
}

async function postAuthForm(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
        credentials: "include",
        body: body.toString(),
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error(data?.message || "Authentication request failed.");
    return data;
}

async function postAuthFormWithFallback(path, body) {
    const bases = getAuthBases();
    let lastError = null;

    for (const baseUrl of bases) {
        try {
            const data = await postAuthForm(`${baseUrl}${path}`, body);
            window.__stratopsResolvedAuthBase = baseUrl;
            return data;
        } catch (err) {
            lastError = err;
            void err;
        }
    }

    throw lastError || new Error("Authentication request failed.");
}

function syncNavLoginButton() {
    const isAuthenticated = !!window.__stratopsAuthState?.isAuthenticated;
    document.querySelectorAll("#wz-nav-login-btn, .wz-nav-login-btn").forEach((btn) => {
        btn.hidden = isAuthenticated;
        btn.setAttribute("aria-hidden", String(isAuthenticated));
        btn.style.display = isAuthenticated ? "none" : "";
    });
}

function injectNavLoginButton() {
    let created = false;
    let btn = document.getElementById("wz-nav-login-btn");
    if (!btn) {
        const target = document.querySelector(".wz-header__right, .wz-nav__right, .warzone-header, [class*='header__right']");
        if (!target) return;
        btn = document.createElement("button");
        btn.id = "wz-nav-login-btn";
        btn.type = "button";
        btn.className = "wz-nav-login-btn";
        btn.textContent = "Sign In";
        target.appendChild(btn);
        created = true;
    }
    if (created && btn.dataset.authBound !== "true") {
        btn.dataset.authBound = "true";
        btn.addEventListener("click", () => {
            if (isLoginModalOpen()) return;
            const s = window.__stratopsAuthState;
            showLoginModal(s?.isAuthenticated ? "authenticated" : "guest", s?.user || null);
        });
    }
    syncNavLoginButton();
}

export function initGlobeRotation(viewer) {
    if (!viewer) return;
    const SPEED_DEG = 0.2;
    window.__globeRotation = { enabled: false, paused: false, speed: SPEED_DEG };
    let lastTime = null, interacting = false;
    const onStart = () => { interacting = true; lastTime = null; };
    const onEnd = () => { interacting = false; };
    viewer.scene.canvas.addEventListener("mousedown", onStart);
    viewer.scene.canvas.addEventListener("mouseup", onEnd);
    viewer.scene.canvas.addEventListener("touchstart", onStart, { passive: true });
    viewer.scene.canvas.addEventListener("touchend", onEnd, { passive: true });
    viewer.scene.postRender.addEventListener(() => {
        const cfg = window.__globeRotation;
        if (!cfg?.enabled || cfg.paused || interacting) { lastTime = null; return; }
        const now = Date.now();
        if (lastTime === null) { lastTime = now; return; }
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        const rad = (cfg.speed * Math.PI / 180) * dt;
        viewer.scene.camera.rotate({ x: 0, y: 0, z: 1 }, -rad);
        viewer.scene.requestRender();
    });
    // Inject pause/play button
    setTimeout(() => {
        if (document.getElementById("wz-globe-rotate-btn")) return;
        const t = document.querySelector(".wz-header__right, [class*='utc'], .warzone-header");
        if (!t) return;
        const b = document.createElement("button");
        b.id = "wz-globe-rotate-btn";
        b.type = "button";
        b.className = "wz-globe-rotate-btn";
        b.title = "Pause/Resume globe rotation";
        b.innerHTML = "<span id='wz-rotate-icon'>⏸</span>";
        b.addEventListener("click", () => {
            const cfg = window.__globeRotation;
            if (!cfg) return;
            cfg.paused = !cfg.paused;
            document.getElementById("wz-rotate-icon").textContent = cfg.paused ? "▶" : "⏸";
        });
        t.appendChild(b);
    }, 500);
}

function initDonatePopup() {
    const modal = document.getElementById("wz-donate-modal");
    if (!modal) return;
    try { if (sessionStorage.getItem("wz_donate_dismissed") === "1") return; } catch { }
    document.getElementById("wz-donate-close")?.addEventListener("click", () => {
        modal.classList.remove("is-visible");
        setTimeout(() => { modal.hidden = true; }, 300);
        try { sessionStorage.setItem("wz_donate_dismissed", "1"); } catch { }
    });
    setTimeout(() => {
        modal.hidden = false;
        requestAnimationFrame(() => modal.classList.add("is-visible"));
    }, 12000);
}

function scheduleDelayedLoginPopup() {
    setTimeout(async () => {
        if (window.__stratopsAuthState?.isAuthenticated) return;
        if (isLoginModalOpen()) return;
        try { if (sessionStorage.getItem("wz_login_dismissed") === "1") return; } catch { }
        const introModal = document.getElementById("wz-intro-modal");
        if (introModal && !introModal.hidden) return;
        const isAuth = await stratopsCheckAuth();
        if (isAuth) return;
        showLoginModal("guest");

        document.getElementById("wz-login-close")?.addEventListener("click", () => {
            try { sessionStorage.setItem("wz_login_dismissed", "1"); } catch { }
        }, { once: true });
    }, 15000);
}

export function schedulePostEntryActions(viewer) {
    stratopsCheckAuth().then((isAuth) => {
        if (!isAuth) {
            scheduleDelayedLoginPopup();
        } else {
            document.body.classList.add("is-authenticated");
            // Silent auth check confirmed — unlock all gated features
            document.dispatchEvent(new CustomEvent("wz:auth-success", { detail: { source: "silent-check" } }));
        }
        syncNavLoginButton();
    });
    injectNavLoginButton();
    initGlobeRotation(viewer);
    initDonatePopup();

    window.__openLoginModal = () => {
        if (isLoginModalOpen()) return;
        const s = window.__stratopsAuthState;
        showLoginModal(s?.isAuthenticated ? "authenticated" : "guest", s?.user || null);
    };
}
