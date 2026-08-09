// File Path: /assets/js/essential.js
import * as Cesium from "cesium";
import { initSmoothHomeAnchors } from "./home-anchors.js";
import { supabase, api } from "./supabase.js";
import { updateNewsTicker, updateDefcon } from "./warzone-ui.js";
import { createWarzoneHotspotLayer } from "./warzone-hotspots.js";
import { showSirenAlert, sirenAlertFromEvent, isSirenEvent } from "./warzone-siren-alert.js";
import { initMilitaryTracks, isMilitaryTrackEvent } from "./warzone-military-tracks.js";
import { onRegionChange, filterEventsByRegion, getActiveRegion, getActiveLens } from "./warzone-region-selector.js";
import { initLayerPanel, onLayerChange, isEventVisible, isLayerEnabled, getEventLayerId, LAYER_DEFS, hydrateLayerStateFromStorage } from "./warzone-layers.js";
import { renderRanges, clearRanges } from "./warzone-ranges.js";
import { renderSweepers, clearSweepers } from "./warzone-sweeper.js";
import { renderGnssInterferenceLayer, clearGnssInterferenceLayer } from "./warzone-gnss.js";
import { resolveEventTheater, getTheaterById } from "./warzone-theaters.js";
import { theaterMatchesRegion } from "./warzone-theaters.js";
import { updateTheaterPanel } from "./warzone-theater-panel.js";
import {
    getPlatformCategoryClass,
    getPlatformCategoryLabel,
    getPlatformSeverityClass,
    getPlatformSeverityLabel,
} from "./warzone-taxonomy.js";
import {
    MAP_EVENT_HISTORY_WINDOW_MS,
    isMapEventHistoricallyRelevant,
} from "../../../apps/shared/map-event-policy.js";
import {
    hasTrustedMapCoordinates,
    readEventLocation,
} from "../../../apps/shared/event-location-policy.js";
import { resolveDisplayCoordinates, eventMatchesBounds } from "./warzone-location-resolver.js";
import {
    upsertLiveTrack,
    clearLiveTrack,
    clearAllLiveTracks,
    startDevTrackSimulation,
    stopDevTrackSimulation,
    clearLiveTrackSelection,
    focusLiveTrack,
    getAllLiveTrackSnapshots,
    toggleLiveTrackSelection,
    getLiveTrackSelection,
    resumeLiveTrackMotionAfterVisibility,
    bindLiveTrackLifecycleRecovery,
} from "./warzone-live-airforce.js";
import {
    upsertNavalVessel,
    clearNavalVessel,
    renderNavalTrackerWidget,
    getAllNavalSnapshots,
} from "./warzone-live-naval.js";
import { startPublicAirIngestion, refreshPublicAirTracksNow, stopPublicAirIngestion } from "./warzone-air-ingestion.js";
import {
    applyStratOpsFeatureVisibility,
    isStratOpsFeatureEnabled,
} from "./stratops-feature-config.js";
import { initPreEntryShowcase } from "./pre-entry-showcase.js";
let __warzoneMilSatsModulePromise = null;
let __warzoneMilSatsInitialized = false;
function loadWarzoneMilSatsModule() {
    if (!__warzoneMilSatsModulePromise) {
        __warzoneMilSatsModulePromise = import("./warzone-mil-sats.js")
            .catch((error) => {
                console.warn("Mil-sat module failed to load:", error);
                return null;
            });
    }
    return __warzoneMilSatsModulePromise;
}
function setWarzoneMilSatsEnabledDeferred(enabled) {
    const shouldEnable = enabled !== false;
    if (!shouldEnable && !__warzoneMilSatsModulePromise) {
        return Promise.resolve();
    }
    return loadWarzoneMilSatsModule()
        .then((module) => {
            if (!module) return;
            if (!__warzoneMilSatsInitialized && window.__warzoneViewer) {
                module.initWarzoneMilSats?.(window.__warzoneViewer);
                __warzoneMilSatsInitialized = true;
            }
            module.setWarzoneMilSatsEnabled?.(shouldEnable);
        });
}
let __eventsCache = [];
let __allEventsCache = [];
let __visibleEventsCache = [];
let __viewportScoped = false;
let __liveRecentEvents = [];
let __statusEventsCache = [];
let __gnssInterferenceCellsCache = [];
let __gnssInterferenceMeta = {
    demoMode: false,
    updatedAt: null,
    sourceMode: "unavailable",
    liveAvailable: false,
    tableAvailable: false,
    message: "",
};
let __gnssInterferenceLoadingPromise = null;
let __gnssInterferenceLastLoadedAt = 0;
let __statusEventsLastLoadedAt = 0;
let __alertAudio = null;
let __scrollClassBound = false;
let __scrollToTargetBound = false;
let __lastSeenOccurredAt = null;
let __hotspotLayer = null;
let __militaryTracks = null;
let __eventPopupBound = false;
let __pollTimer = null;
let __pollInFlight = false;
let __pollInFlightSince = 0;
let __pollRequestSeq = 0;
let __pollEmptyStreak = 0;
let __focusModeLastEventPollAt = 0;
let __eventsApiRestrictedUntil = 0;
let __eventsApiLastErrorKey = "";
let __eventsApiLastErrorLoggedAt = 0;
let __viewportFetchTimer = null;
let __viewportFetchInFlight = false;
let __viewportFetchSeq = 0;
let __lastViewportKey = "";
let __lastGlobeSyncKey = "";
let __lastGlobeClusterBucket = "";
let __globeReclusterTimer = 0;
let __lastRangesSyncKey = "";
let __lastSweepersSyncKey = "";
let __lastOverlaySourceKey = "__empty__";
let __lastOverlayClusterRadiusBucket = "";
let __cachedOverlayClusters = [];
let __lastNavalSignalsSyncKey = "__empty__";
let __eventPopupDevInspectionFrozen = false;
let __foregroundRenderModeRestoreTimer = 0;
let __aircraftWidgetBound = false;
let __aircraftWidgetFilter = "active";
let __aircraftWidgetSubtypeFilter = "all";
let __aircraftWidgetScopeFilter = "region";
let __aircraftWidgetPage = 1;
let __aircraftWidgetCountryFilter = "all";
let __aircraftHistoryCache = [];

function getWarzoneAoiDataSnapshot() {
    const mapSourceEvents = __viewportScoped ? __visibleEventsCache : __eventsCache;
    return {
        events: [...(mapSourceEvents || [])],
        filteredEvents: [...(__eventsCache || [])],
        visibleEvents: [...(__visibleEventsCache || [])],
        allEvents: [...(__allEventsCache || [])],
        statusEvents: [...(__statusEventsCache || [])],
        aircraftHistory: [...(__aircraftHistoryCache || [])],
        viewportScoped: Boolean(__viewportScoped),
        generatedAt: Date.now(),
    };
}

if (typeof window !== "undefined") {
    window.__getWarzoneAoiDataSnapshot = getWarzoneAoiDataSnapshot;
}
let __aircraftHistoryLastLoadedAt = 0;
let __aircraftHistoryLoadingPromise = null;
let __aircraftWidgetRenderTimer = 0;
let __aircraftWidgetLastRenderedAt = 0;
let __aircraftHistoryRefreshTimer = 0;
let __aircraftLiveSyncTimer = 0;
let __tracksRealtimeChannel = null;
let __aircraftSubtypeOptionsKey = "";
let __widgetLoadingState = new Map();
let __navalWidgetRenderTimer = 0;
let __navalWidgetScopeFilter = "region";
let __navalWidgetSubtypeFilter = "all";
let __navalWidgetCountryFilter = "all";
let __navalWidgetPage = 1;
let __navalSubtypeOptionsKey = "";
let __navalCountryOptionsKey = "";
let __lastStatusWidgetSignature = null;
let __lastRawWidgetSignature = null;
let __lastFeedSignature = null;
let __lastHeavyWidgetSignature = null;
let __lastFeedDataSignature = null;
let __feedVisibleCount = 15;
let __feedControlsBound = false;
let __intelWireFilterControlsBound = false;
let __intelWireItemsCache = [];
let __intelWireCountryFilter = "all";
let __intelWireTimeFilter = "all";
let __intelWireMediaControlsBound = false;
let __intelWireRenderedItems = new Map();
let __intelWireMediaState = new Map();
let __intelWireNextRefreshAt = 0;
let __intelWireRefreshInterval = null;
let __intelWireRefreshInFlight = false;
let __intelWireEndpointBackoffUntil = 0;
let __intelWireRelativeTimeInterval = null;
let __intelWireDetailModalBound = false;
let __intelWireDetailModalLastFocusedElement = null;
let __layerDeferredRefreshTimer = 0;
let __hotspotDeferredSyncTimer = 0;
let __seededAircraftTrackKeys = new Set();
let __visibilityRecoveryBound = false;
let __foregroundRenderWakeRaf = 0;
let __warzoneLifecycleCallbacks = new Map();
let __warzoneLifecyclePaused = false;
let __warzoneLifecyclePausedAt = 0;
let __warzoneLifecycleZeroSizePaused = false;
let __warzoneLifecycleRenderBurstRaf = 0;
let __warzoneLifecycleRenderBurstUntil = 0;
let __warzoneLifecycleResizeObserver = null;
let __warzoneLifecycleObservedElement = null;
let __foregroundRecoveryLoaderTimer = 0;
let __foregroundRecoveryLoaderShownAt = 0;
let __foregroundRecoverySeq = 0;
let __lastBackgroundAt = 0;
let __lastForegroundRecoveryAt = 0;
let __foregroundAdaptiveRecoveryTimer = 0;
let __foregroundPipelineResumeTimer = 0;
let __visibilityPipelinesSuspended = false;
let __authModalRenderBudgetBackup = null;
let __regionReloadSeq = 0;
const FOREGROUND_RECOVERY_LOADER_MIN_MS = 320;
const FOREGROUND_RECOVERY_LOADER_MAX_MS = 4200;
const FOREGROUND_RECOVERY_LOADER_THRESHOLD_MS = 60 * 1000;
const FOREGROUND_RECOVERY_WORK_THRESHOLD_MS = 15 * 1000;
const FOREGROUND_RECOVERY_THROTTLE_MS = 3000;
const FOREGROUND_ADAPTIVE_RECOVERY_THRESHOLD_MS = 45 * 1000;
const FOREGROUND_ADAPTIVE_RECOVERY_DEEP_MS = 10 * 60 * 1000;
const LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = 8;
const LIVE_NAVAL_WIDGET_MAX_ITEMS = 8;
const LIVE_AIRCRAFT_WIDGET_TITLE_MAX_COUNT = 99;
const AIRCRAFT_HISTORY_WINDOW_MS = 72 * 60 * 60 * 1000;
const AIRCRAFT_RECENT_WINDOW_MS = 72 * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_REFRESH_MS = 3 * 60 * 1000;
const AIRCRAFT_HISTORY_ACTIVE_WINDOW_MS = 8 * 60 * 1000;
const AIRCRAFT_HISTORY_CACHE_MAX_ROWS = 1200;
const AIRCRAFT_LIVE_SYNC_DB_MS = 6 * 1000;
const AIRCRAFT_WIDGET_RENDER_THROTTLE_MS = 120;
const NAVAL_WIDGET_RENDER_THROTTLE_MS = 120;
const FEED_INITIAL_VISIBLE_COUNT = 15;
const FEED_LOAD_MORE_COUNT = 12;
const FEED_EXPAND_VIEWPORT_PAD = 16;
const FEED_EXPAND_MAX_WIDTH = 1120;
const INTEL_WIRE_REFRESH_MS = 5 * 60 * 1000;
const INTEL_WIRE_ENDPOINT_BACKOFF_MS = 30 * 60 * 1000;
const INTEL_WIRE_MAX_ITEMS = 120;
const INTEL_WIRE_RELATIVE_TIME_REFRESH_MS = 30 * 1000;
const INTEL_WIRE_COLLAPSED_MEDIA_PREVIEW_COUNT = 2;
const GNSS_LAYER_REFRESH_MS = 10 * 60 * 1000;
const FOCUS_MODE_STATUS_REFRESH_MS = 45 * 1000;
const FOCUS_MODE_GNSS_REFRESH_MS = 60 * 1000;
const FOCUS_MODE_EVENT_POLL_MS = 30 * 1000;
const HIGH_VALUE_ASSET_ALERT_THROTTLE_MS = 10 * 60 * 1000;
const HIGH_VALUE_ASSET_NOTIFICATION_COOLDOWN_MS = 45 * 1000;
const EVENT_POLL_INTERVAL_MS = 12 * 1000;
const EVENT_CACHE_MAX_ITEMS = 2600;
const EVENT_VISIBLE_CACHE_MAX_ITEMS = 1800;
const EVENT_CACHE_RETENTION_MS = MAP_EVENT_HISTORY_WINDOW_MS;
const POLL_SINCE_MAX_FUTURE_SKEW_MS = 60 * 1000;
const POLL_FULL_REFRESH_EMPTY_STREAK = 15;
const EVENTS_API_ERROR_LOG_THROTTLE_MS = 45 * 1000;
const EVENTS_API_RESTRICTED_BACKOFF_MS = 2 * 60 * 1000;
const WZ_PERF_ADVISORY_VERSION = "2026-04-adaptive-v1";
const WZ_PERF_ADVISORY_OPTOUT_KEY = `wz_perf_advisory_optout_${WZ_PERF_ADVISORY_VERSION}`;
const WZ_PERF_ADVISORY_SESSION_KEY = `wz_perf_advisory_session_${WZ_PERF_ADVISORY_VERSION}`;
const WZ_PERF_ADVISORY_LAST_PROFILE_KEY = `wz_perf_advisory_profile_${WZ_PERF_ADVISORY_VERSION}`;
const ADAPTIVE_PROFILE_ORDER = ["normal", "balanced", "conservative", "safe"];
const IDLE_SUSPEND_EXCLUDED_LAYER_IDS = new Set([
    // These toggles are visual/static-only and should not keep live polling active.
    "terrain",
    "gnss",
    "region-plate",
    "hotspots",
    "military-bases",
    "satellite-imagery",
    "country-borders",
]);
const IDLE_SUSPEND_LAYER_IDS = LAYER_DEFS
    .map((layer) => layer.id)
    .filter((id) => !IDLE_SUSPEND_EXCLUDED_LAYER_IDS.has(id));
const GLOBE_EVENT_RESYNC_EXEMPT_LAYER_IDS = new Set([
    "naval",
    "airspace",
    "gnss",
    "region-plate",
    "military-bases",
    "hotspots",
    "satellite-imagery",
]);
const GLOBE_EVENT_LAYER_IDS = [
    "strikes",
    "missiles",
    "drones",
    "airstrikes",
    "recon",
    "alerts",
    "thermal",
    "seismic",
    "cyber",
];
const NAVAL_EVENT_SUBTYPES = new Set([
    "carrier",
    "amphibious",
    "cruiser",
    "destroyer",
    "frigate",
    "corvette",
    "intelligence",
    "submarine",
    "ssbn",
    "ssn",
    "ssk",
    "aip_submarine",
    "missile_boat",
    "logistics",
    "patrol",
    "minesweeper",
    "naval",
]);
const HIGH_VALUE_AIRCRAFT_SUBTYPES = new Map([
    ["bomber", { level: "red", label: "Bomber" }],
    ["awacs", { level: "red", label: "AWACS" }],
]);
const HIGH_VALUE_NAVAL_SUBTYPES = new Map([
    ["carrier", { level: "red", label: "Aircraft Carrier" }],
    ["ssbn", { level: "red", label: "SSBN Submarine" }],
    ["intelligence", { level: "orange", label: "Intelligence Vessel" }],
]);
const __highValueAssetAlertedAt = new Map();
const __highValueAssetLastNotifiedAt = new Map();
function isHighValueAssetDetectionEnabled() {
    return typeof window !== "undefined" &&
        window.__stratopsConfig?.enableHighValueAssetDetection === true &&
        isStratOpsFeatureEnabled("tracking.highValueAssetDetection");
}
function isAircraftTrackingFeatureEnabled() {
    return isStratOpsFeatureEnabled("tracking.aircraft") && isStratOpsFeatureEnabled("mapLayers.aircraft");
}
function isNavalTrackingFeatureEnabled() {
    return isStratOpsFeatureEnabled("tracking.naval") && isStratOpsFeatureEnabled("mapLayers.naval");
}
const AIS_CIVILIAN_VESSEL_PATTERNS = [
    /\bMV\b/i,
    /\bM\/V\b/i,
    /\bMT\b/i,
    /\bFV\b/i,
    /\bSV\b/i,
    /\bMY\b/i,
    /\bRV\b/i,
    /\bGENERAL CARGO\b/i,
    /\bBULK CARRIER\b/i,
    /\bCAR CARRIER\b/i,
    /\bVEHICLE CARRIER\b/i,
    /\bCONTAINER\b/i,
    /\bCONTAINER SHIP\b/i,
    /\bTANKER\b/i,
    /\bCHEMICAL TANKER\b/i,
    /\bCRUDE OIL\b/i,
    /\bLNG\b/i,
    /\bLPG\b/i,
    /\bCARGO\b/i,
    /\bFERRY\b/i,
    /\bCRUISE\b/i,
    /\bPASSENGER\b/i,
    /\bYACHT\b/i,
    /\bDREDGER\b/i,
    /\bTUG\b/i,
    /\bTRAWLER\b/i,
    /\bFREIGHTER\b/i,
    /\bFEEDER\b/i,
    /\bCOASTER\b/i,
    /\bLIVESTOCK\b/i,
    /\bREEFER\b/i,
    /\bHOPPER\b/i,
    /\bRO-RO\b/i,
    /\bROLL ON ROLL OFF\b/i,
    /\bSUPPLY VESSEL\b/i,
    /\bOFFSHORE SUPPORT\b/i,
    /\bPLATFORM SUPPLY\b/i,
    /\bANCHOR HANDLING\b/i,
    /\bWORKBOAT\b/i,
    /\bRESEARCH VESSEL\b/i,
    /\bSURVEY VESSEL\b/i,
    /\bCABLE LAYER\b/i,
    /\bPILOT\b/i,
];
const AIS_MILITARY_VESSEL_PATTERNS = [
    /\bUSS\b/i,
    /\bUSNS\b/i,
    /\bHMS\b/i,
    /\bRFA\b/i,
    /\bHMAS\b/i,
    /\bHMCS\b/i,
    /\bHMNZS\b/i,
    /\bHNLMS\b/i,
    /\bORP\b/i,
    /\bNRP\b/i,
    /\bBRP\b/i,
    /\bBAP\b/i,
    /\bARA\b/i,
    /\bROKS\b/i,
    /\bKRI\b/i,
    /\bKDB\b/i,
    /\bRFS\b/i,
    /\bINS\b/i,
    /\bPNS\b/i,
    /\bTCG\b/i,
    /\bJDS\b/i,
    /\bJS\s+[A-Z0-9]/i,
    /\bFGS\b/i,
    /\bIRIS\b/i,
    /\bSLNS\b/i,
    /\bRBNS\b/i,
    /\bHSWMS\b/i,
    /\bITS\b/i,
    /\bSPS\b/i,
    /\bBNS\b/i,
    /\bFFG[-\s]?\d+\b/i,
    /\bDDG[-\s]?\d+\b/i,
    /\bCG[-\s]?\d+\b/i,
    /\bSSN[-\s]?\d+\b/i,
    /\bSSBN[-\s]?\d+\b/i,
    /\bSSK[-\s]?\d+\b/i,
    /\bAIP\b/i,
    /AIR INDEPENDENT PROPULSION/i,
    /\bCVN[-\s]?\d+\b/i,
    /\bCV[-\s]?\d+\b/i,
    /\bLHD[-\s]?\d+\b/i,
    /\bLHA[-\s]?\d+\b/i,
    /\bLPD[-\s]?\d+\b/i,
    /\bLPH[-\s]?\d+\b/i,
    /\bLSD[-\s]?\d+\b/i,
    /\bLST[-\s]?\d+\b/i,
    /\bAOR[-\s]?\d+\b/i,
    /\bAOE[-\s]?\d+\b/i,
    /\bT-AO[-\s]?\d+\b/i,
    /\bT-AKE[-\s]?\d+\b/i,
    /\bT-AKR[-\s]?\d+\b/i,
    /\bUS NAVY\b/i,
    /\bMILITARY SEALIFT COMMAND\b/i,
    /\bROYAL NAVY\b/i,
    /\bROYAL AUSTRALIAN NAVY\b/i,
    /\bROYAL CANADIAN NAVY\b/i,
    /\bROYAL NEW ZEALAND NAVY\b/i,
    /\bROYAL NETHERLANDS NAVY\b/i,
    /\bDUTCH NAVY\b/i,
    /\bGERMAN NAVY\b/i,
    /\bFRENCH NAVY\b/i,
    /\bITALIAN NAVY\b/i,
    /\bSPANISH NAVY\b/i,
    /\bPORTUGUESE NAVY\b/i,
    /\bPOLISH NAVY\b/i,
    /\bINDIAN NAVY\b/i,
    /\bPAKISTAN NAVY\b/i,
    /\bJMSDF\b/i,
    /\bJAPAN MARITIME SELF[- ]DEFENSE FORCE\b/i,
    /\bREPUBLIC OF KOREA NAVY\b/i,
    /\bROK NAVY\b/i,
    /\bPLA NAVY\b/i,
    /\bPLAN\b/i,
    /\bTURKISH NAVY\b/i,
    /\bRUSSIAN NAVY\b/i,
    /\bIRIN\b/i,
    /\bIRGCN\b/i,
    /\bSINGAPORE NAVY\b/i,
    /\bRSN\b/i,
    /\bROYAL SAUDI NAVAL FORCES\b/i,
    /\bEGYPTIAN NAVY\b/i,
    /\bBRAZILIAN NAVY\b/i,
    /\bARGENTINE NAVY\b/i,
    /\bPERUVIAN NAVY\b/i,
    /\bPHILIPPINE NAVY\b/i,
    /\bBANGLADESH NAVY\b/i,
    /\bBELGIAN NAVY\b/i,
    /\bROYAL BRUNEI NAVY\b/i,
    /\bINDONESIAN NAVY\b/i,
    /\bUKRAINIAN NAVY\b/i,
    /\bGUIDED MISSILE DESTROYER\b/i,
    /AIRCRAFT CARRIER/i,
    /HELICOPTER CARRIER/i,
    /LIGHT CARRIER/i,
    /DESTROYER/i,
    /GUIDED MISSILE CRUISER/i,
    /FRIGATE/i,
    /CORVETTE/i,
    /SUBMARINE/i,
    /AMPHIBIOUS ASSAULT/i,
    /LANDING HELICOPTER DOCK/i,
    /LANDING PLATFORM DOCK/i,
    /AMPHIBIOUS TRANSPORT DOCK/i,
    /MINE COUNTERMEASURE/i,
    /MINEHUNTER/i,
    /MINESWEEPER/i,
    /REPLENISHMENT/i,
    /FLEET OILER/i,
    /COMBAT SUPPORT SHIP/i,
    /OFFSHORE PATROL VESSEL/i,
    /MISSILE BOAT/i,
    /FAST ATTACK CRAFT/i,
];
const AIS_NON_OPERATIONAL_NAVAL_PATTERNS = [
    /\bCV[-\s]?0?9\b/i, // USS Essex (CV-9), decommissioned in 1969.
    /\b(?:DECOMMISSIONED|RETIRED|MUSEUM(?:\s+SHIP)?|PRESERVED|SCRAPPED|STRICKEN|DISPOSED)\b/i,
];
function isDocumentHidden() {
    return document.visibilityState === "hidden";
}
function clearForegroundRecoveryLoaderTimer() {
    if (__foregroundRecoveryLoaderTimer) {
        clearTimeout(__foregroundRecoveryLoaderTimer);
        __foregroundRecoveryLoaderTimer = 0;
    }
}
function endForegroundRecoveryLoader({ force = false } = {}) {
    void force;
    clearForegroundRecoveryLoaderTimer();
    window.__wzKeepSiteLoaderVisible = false;
    window.__wzKeepSiteLoaderVisibleUntil = 0;
    window.SiteLoader?.stop?.();
}
function beginForegroundRecoveryLoader() {
    // Foreground recovery loader intentionally disabled to avoid visible reload flashes
    // when the user returns from another tab/app.
    endForegroundRecoveryLoader({ force: true });
}
function startForegroundRenderWakeBurst(durationMs = 1200) {
    const viewer = window.__warzoneViewer;
    if (!viewer?.scene?.requestRender) return;
    if (__foregroundRenderWakeRaf) {
        cancelAnimationFrame(__foregroundRenderWakeRaf);
        __foregroundRenderWakeRaf = 0;
    }
    const start = performance.now();
    const step = () => {
        if (isDocumentHidden()) {
            __foregroundRenderWakeRaf = 0;
            return;
        }
        viewer.scene.requestRender?.();
        if (performance.now() - start >= durationMs) {
            __foregroundRenderWakeRaf = 0;
            return;
        }
        __foregroundRenderWakeRaf = requestAnimationFrame(step);
    };
    __foregroundRenderWakeRaf = requestAnimationFrame(step);
}
function getWarzoneLifecycleViewerElement(viewer = window.__warzoneViewer) {
    return viewer?.container || viewer?.canvas?.parentElement || document.getElementById("warzone-globe") || null;
}
function notifyWarzoneLifecycle(type, payload = {}) {
    __warzoneLifecycleCallbacks.forEach((callbacks, name) => {
        const handler = callbacks?.[type];
        if (typeof handler !== "function") return;
        try {
            handler(payload);
        } catch (error) {
            if (window.__STRATOPS_DEBUG_LIFECYCLE === true) {
                console.warn(`[stratops] lifecycle ${type} handler failed: ${name}`, error);
            }
        }
    });
}
function requestWarzoneLifecycleRenderBurst(reason = "lifecycle", durationMs = 900) {
    void reason;
    const viewer = window.__warzoneViewer;
    if (!viewer?.scene?.requestRender || isDocumentHidden()) return false;
    const now = performance.now();
    __warzoneLifecycleRenderBurstUntil = Math.max(
        __warzoneLifecycleRenderBurstUntil,
        now + Math.max(120, Number(durationMs) || 900)
    );
    if (__warzoneLifecycleRenderBurstRaf) return true;
    const step = () => {
        if (isDocumentHidden()) {
            __warzoneLifecycleRenderBurstRaf = 0;
            return;
        }
        try {
            viewer.resize?.();
        } catch { }
        viewer.scene.requestRender?.();
        if (performance.now() >= __warzoneLifecycleRenderBurstUntil) {
            __warzoneLifecycleRenderBurstRaf = 0;
            return;
        }
        __warzoneLifecycleRenderBurstRaf = requestAnimationFrame(step);
    };
    __warzoneLifecycleRenderBurstRaf = requestAnimationFrame(step);
    return true;
}
function forceForegroundViewerWake({ reason = "foreground", backgroundIdleMs = 0 } = {}) {
    const viewer = window.__warzoneViewer;
    const scene = viewer?.scene;
    if (!viewer || !scene || isDocumentHidden()) return;
    try {
        viewer.resize?.();
    } catch { }
    try {
        scene.requestRender?.();
    } catch { }
    const idleMs = Math.max(0, Number(backgroundIdleMs || 0));
    const longIdle = idleMs >= 5 * 60 * 1000;
    window.__warzoneLifecycle?.requestRenderBurst?.(reason, longIdle ? 2600 : 900);
    startForegroundRenderWakeBurst(longIdle ? 2200 : 900);
    if (!longIdle) return;
    clearTimeout(__foregroundRenderModeRestoreTimer);
    const previousRequestRenderMode = scene.requestRenderMode;
    try {
        scene.requestRenderMode = false;
    } catch { }
    __foregroundRenderModeRestoreTimer = window.setTimeout(() => {
        try {
            scene.requestRenderMode = previousRequestRenderMode !== false;
            scene.requestRender?.();
        } catch { }
    }, 2400);
}
function pauseWarzoneLifecycle(reason = "pause") {
    if (__warzoneLifecyclePaused) return false;
    __warzoneLifecyclePaused = true;
    __warzoneLifecyclePausedAt = Date.now();
    notifyWarzoneLifecycle("pause", { reason, pausedAt: __warzoneLifecyclePausedAt });
    return true;
}
function resumeWarzoneLifecycle(reason = "resume") {
    if (isDocumentHidden()) return false;
    const wasPaused = __warzoneLifecyclePaused;
    const pausedAt = __warzoneLifecyclePausedAt;
    __warzoneLifecyclePaused = false;
    __warzoneLifecyclePausedAt = 0;
    const suspendedMs = pausedAt > 0 ? Math.max(0, Date.now() - pausedAt) : 0;
    notifyWarzoneLifecycle("resume", { reason, suspendedMs, wasPaused });
    requestWarzoneLifecycleRenderBurst(reason, wasPaused ? 1200 : 520);
    return wasPaused;
}
function observeWarzoneLifecycleViewer(viewer = window.__warzoneViewer) {
    const target = getWarzoneLifecycleViewerElement(viewer);
    if (!target || typeof ResizeObserver === "undefined") return false;
    if (__warzoneLifecycleObservedElement === target && __warzoneLifecycleResizeObserver) return true;
    if (__warzoneLifecycleResizeObserver) {
        try {
            __warzoneLifecycleResizeObserver.disconnect();
        } catch { }
    }
    __warzoneLifecycleObservedElement = target;
    __warzoneLifecycleResizeObserver = new ResizeObserver((entries) => {
        const rect = entries?.[0]?.contentRect || target.getBoundingClientRect?.();
        const zeroSized = !rect || rect.width <= 1 || rect.height <= 1;
        if (zeroSized) {
            __warzoneLifecycleZeroSizePaused = true;
            pauseWarzoneLifecycle("viewer-zero-size");
            return;
        }
        if (__warzoneLifecycleZeroSizePaused) {
            __warzoneLifecycleZeroSizePaused = false;
            resumeWarzoneLifecycle("viewer-resized");
            return;
        }
        if (!isDocumentHidden()) {
            requestWarzoneLifecycleRenderBurst("viewer-resized", 240);
        }
    });
    __warzoneLifecycleResizeObserver.observe(target);
    return true;
}
function installWarzoneLifecycleApi() {
    if (window.__warzoneLifecycle?.__stratopsLifecycleApi) return;
    window.__warzoneLifecycle = {
        __stratopsLifecycleApi: true,
        register(name, callbacks = {}) {
            if (!name) return () => { };
            const key = String(name);
            __warzoneLifecycleCallbacks.set(key, callbacks);
            return () => __warzoneLifecycleCallbacks.delete(key);
        },
        pause: pauseWarzoneLifecycle,
        resume: resumeWarzoneLifecycle,
        requestRenderBurst: requestWarzoneLifecycleRenderBurst,
        observeViewer: observeWarzoneLifecycleViewer,
        getState() {
            return {
                paused: __warzoneLifecyclePaused,
                pausedAt: __warzoneLifecyclePausedAt,
                zeroSizePaused: __warzoneLifecycleZeroSizePaused,
                observerBound: Boolean(__warzoneLifecycleResizeObserver),
            };
        },
    };
}
function isStrictAisMilitaryNavalEvent(event = {}) {
    const metadata = getEventMetadata(event);
    const sourceName = String(event.source_name || "").toLowerCase();
    const dedupeKey = String(event.dedupe_key || event.source_key || "").toLowerCase();
    const hasNavalTelemetrySignature = Boolean(
        sourceName.includes("ais") ||
        dedupeKey.startsWith("ais-") ||
        metadata.mmsi ||
        metadata.ship_type != null ||
        metadata.shipType != null ||
        metadata.vessel_name ||
        metadata.vessel_class ||
        metadata.ship_class ||
        metadata.call_sign ||
        metadata.callSign
    );
    // Critical: this gate should only classify AIS-like naval telemetry.
    // Non-AIS events must pass through to normal relevance filters.
    if (!hasNavalTelemetrySignature) return true;
    const shipType = Number(metadata.ship_type ?? metadata.shipType ?? null);
    const vesselName = String(metadata.vessel_name || event.title || "");
    const callSign = String(metadata.call_sign || metadata.callSign || "");
    const haystack = [vesselName, callSign].filter(Boolean).join(" ");
    const statusHaystack = [
        haystack,
        event.operational_status,
        event.operationalStatus,
        event.service_status,
        event.serviceStatus,
        event.status,
        metadata.operational_status,
        metadata.operationalStatus,
        metadata.service_status,
        metadata.serviceStatus,
        metadata.status,
    ].filter(Boolean).join(" ");
    if (AIS_NON_OPERATIONAL_NAVAL_PATTERNS.some((pattern) => pattern.test(statusHaystack))) {
        return false;
    }
    const hasCivilianIdentity = AIS_CIVILIAN_VESSEL_PATTERNS.some((pattern) => pattern.test(haystack));
    const hasMilitaryIdentity = AIS_MILITARY_VESSEL_PATTERNS.some((pattern) => pattern.test(haystack));
    if (hasCivilianIdentity && !hasMilitaryIdentity) {
        return false;
    }
    if (hasMilitaryIdentity) return true;
    return shipType === 35 && !hasCivilianIdentity;
}
function isClearlyAircraftContact(event = {}) {
    const metadata = getEventMetadata(event);
    const trackType = String(event.track_type || metadata.track_type || "").toLowerCase();
    if (trackType === "aircraft") return true;
    const sourceName = String(event.source_name || "").toLowerCase();
    if (
        sourceName.includes("ads-b") ||
        sourceName.includes("airplanes.live") ||
        sourceName.includes("aircraft")
    ) {
        return true;
    }
    if (
        metadata.icao ||
        metadata.callsign ||
        metadata.registration ||
        metadata.type_code ||
        metadata.model_name ||
        metadata.on_ground != null
    ) {
        return true;
    }
    const haystack = [
        event.title,
        event.summary,
        event.description,
        event.subcategory,
        event.weapon_type,
        metadata.model_name,
        metadata.type_code,
        metadata.callsign,
        metadata.registration,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return /\bcessna\b|\bcitation\b|\blearjet\b|\bgulfstream\b|\bembraer\b|\bbombardier\b|\bboeing\b|\bairbus\b|\bhelicopter\b|\bfighter\b|\bawacs\b|\brecon\b|\btanker\b|\btransport\b|\buav\b|\bdrone\b/.test(haystack);
}
function isEventInLens(event, lens) {
    if (!event) return false;
    const category = String(event.category || "").toLowerCase();
    const severity = String(event.severity || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const place = eventPlaceText(event);
    const occurredAt = new Date(event.occurred_at || 0).getTime();
    const ageMs = Date.now() - occurredAt;
    const isRecent = Number.isFinite(ageMs) && ageMs <= MAP_EVENT_HISTORY_WINDOW_MS;
    const isHighSignal =
        category === "alert" ||
        category === "strike" ||
        category === "military" ||
        category === "air_activity" ||
        category === "naval_activity" ||
        category === "ground_activity" ||
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
                category === "air_activity" ||
                category === "naval_activity" ||
                category === "ground_activity" ||
                category === "airspace" ||
                category === "cyber" ||
                weapon.includes("naval") ||
                weapon.includes("fighter") ||
                weapon.includes("missile");
        case "all":
            return true;
        case "live":
            return isRecent || isHighSignal || category === "cyber" || category === "airspace" || category === "thermal" || category === "recon" || category === "recon_intel" || category === "military";
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
    "nypd", "police department", "public safety", "event security",
    "crowd control", "security training", "train officers", "law enforcement training",
    "sheriff", "law enforcement", "crime scene", "criminal investigation",
    "car accident", "traffic accident", "road accident", "train derailment",
    "gas leak", "house fire", "building fire", "chemical spill",
    "election", "vote", "ballot", "parliament", "sanctions",
    "world cup", "fifa", "america 250", "stadium", "sports", "sporting event",
    "festival", "concert", "wedding", "parade", "marathon",
    "ceasefire talks", "peace talks", "trade war", "stock market",
    "protest", "demonstration", "refugee", "migrant",
    "weather alert", "storm warning", "flood warning", "earthquake alert"
];

function hasHardMilitaryConflictSignal(text = "") {
    return (
        text.includes("missile") ||
        text.includes("rocket attack") ||
        text.includes("rocket barrage") ||
        text.includes("drone strike") ||
        text.includes("drone attack") ||
        text.includes("uav strike") ||
        text.includes("uav attack") ||
        text.includes("loitering munition") ||
        text.includes("airstrike") ||
        text.includes("air strike") ||
        text.includes("air raid") ||
        text.includes("bombardment") ||
        text.includes("artillery") ||
        text.includes("shelling") ||
        text.includes("fighter jet") ||
        text.includes("combat aircraft") ||
        text.includes("awacs") ||
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
    );
}

const INTEL_WIRE_ONLY_EVENT_RE = /\b(contract|contract award|procurement|acquisition|arms deal|arms sale|arms sales|foreign military sale|foreign military sales|fms|budget|funding|lawmakers|approved sale|purchase|order|program|prototype|production|manufacturing|shipbuilding|industry|startup)\b/i;
const OPERATIONAL_MAP_SIGNAL_RE = /\b(airstrike|air strike|missile strike|drone strike|strike|strikes|struck|attack|attacks|attacked|shelling|artillery|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|troop movement|deployed|deployment|convoy|patrol|sortie|scramble|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|spotted|detected|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;
const LIVE_HAPPENING_MAP_SIGNAL_RE = /\b(airstrike|air strike|missile strike|drone strike|strikes|struck|attacks|attacked|shelling|bombardment|explosion|explosions|exploded|explodes|blast|blasts|detonation|detonated|launched|launches|fired|fires|intercepted|interception|shot down|shoots down|downed|crash|crashed|hit|hits|impact|killed|wounded|casualties|clash|clashes|fighting|combat|offensive|incursion|raid|raids|air raid|siren|red alert|take shelter|notam|airspace closed|airspace restricted|closure|restriction|blockade|seized|cyberattack|cyber attack|outage|disrupted|disruption|ransomware|malware|power grid attack|infrastructure attack)\b/i;
const OPERATIONAL_MAP_REPORT_TYPES = new Set([
    "flight_tracking",
    "siren_alert",
    "notam",
    "airspace_status",
    "thermal_anomaly",
    "seismic",
    "cyber",
    "network",
    "internet_outage",
    "network_blocking",
    "conflict",
    "signal",
    "osint"
]);
function getOperationalMapText(event = {}) {
    return [
        event.title,
        event.summary,
        event.description,
        event.weapon_type,
        event.target_type,
        event.impact_type,
        event.report_type,
        event.source_name,
        Array.isArray(event.tags) ? event.tags.join(" ") : event.tags,
    ].filter(Boolean).join(" ");
}
function getEventMetadataValue(event = {}, key = "") {
    const metadata = getEventMetadata(event);
    return metadata && Object.prototype.hasOwnProperty.call(metadata, key)
        ? metadata[key]
        : undefined;
}
function isNewsLikeMapEvent(event = {}) {
    const reportType = String(event.report_type || "").toLowerCase();
    const sourceName = String(event.source_name || "").toLowerCase();
    const tags = getEventTags(event);
    return (
        ["news", "signal", "osint", "reddit"].includes(reportType) ||
        sourceName.includes("gdelt") ||
        tags.includes("rss") ||
        tags.includes("gdelt")
    );
}
function hasOperationalMapSignal(event = {}) {
    const reportType = String(event.report_type || "").toLowerCase();
    if (OPERATIONAL_MAP_REPORT_TYPES.has(reportType)) return true;
    return OPERATIONAL_MAP_SIGNAL_RE.test(getOperationalMapText(event));
}
function isIntelWireOnlyEvent(event = {}) {
    const tags = getEventTags(event);
    const displaySurface = String(
        event.display_surface ||
        event.displaySurface ||
        getEventMetadataValue(event, "display_surface") ||
        getEventMetadataValue(event, "displaySurface") ||
        ""
    ).toLowerCase();
    if (displaySurface === "intel_wire" || displaySurface === "intel-wire") return true;
    if (tags.includes("intel-wire-only") || tags.includes("intel_wire_only")) return true;
    const text = getOperationalMapText(event);
    return INTEL_WIRE_ONLY_EVENT_RE.test(text) && !LIVE_HAPPENING_MAP_SIGNAL_RE.test(text);
}
function isOperationalMapEvent(event = {}) {
    if (!event || !isMilitaryRelevant(event)) return false;
    if (!isMapEventHistoricallyRelevant(event)) return false;
    if (event.map_eligible === false || event.mapEligible === false) return false;
    if (!hasTrustedMapCoordinates(event)) return false;
    if (isLowInformationPublicSignal(event)) return false;
    if (isIntelWireOnlyEvent(event)) return false;
    const category = String(event.category || "").toLowerCase();
    if (["strike", "alert", "airspace", "cyber", "thermal", "signal", "seismic", "network"].includes(category)) {
        return hasOperationalMapSignal(event);
    }
    if (isNewsLikeMapEvent(event)) return hasOperationalMapSignal(event);
    if (["military", "recon", "recon_intel", "air_activity", "naval_activity", "ground_activity", "unknown_activity"].includes(category)) {
        return hasOperationalMapSignal(event);
    }
    return hasOperationalMapSignal(event);
}

function isMilitaryRelevant(event) {
    const category = String(event.category || "").toLowerCase();
    if (isTrainerAircraftSignalEvent(event)) return false;
    if (!isStrictAisMilitaryNavalEvent(event)) return false;
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

    // Hard reject civilian/public-safety/sports noise before trusting upstream categories.
    // Generic "drone threat" around events is not a StratOps strike unless combat context is explicit.
    if (
        FRONTEND_CIVILIAN_NOISE.some((term) => text.includes(term)) &&
        !hasHardMilitaryConflictSignal(text)
    ) {
        return false;
    }

    // Trusted military categories always pass
    if ([
        "strike", "military", "air_activity", "naval_activity", "ground_activity", "cyber", "airspace",
        "recon", "recon_intel", "thermal", "alert", "signal", "seismic", "network"
    ].includes(category)) return true;

    // Must contain at least one hard military signal
    if (hasHardMilitaryConflictSignal(text) || text.includes("naval")) {
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
    const scoped = applyOperationalScopeFilters(events);
    return scoped.filter((e) => isEventVisible(e));
}
function filterEventsToActiveRegion(events = [], region = getActiveRegion?.()) {
    const source = Array.isArray(events) ? events : [];
    if (!filterEventsByRegion || !region || region.id === "global") return source;
    return filterEventsByRegion(source, region);
}
function isEventInsideActiveRegion(event = {}, region = getActiveRegion?.()) {
    if (!event) return false;
    if (!filterEventsByRegion || !region || region.id === "global") return true;
    return filterEventsByRegion([event], region).length > 0;
}
function applyScopeFilters(events) {
    const lens = getActiveLens?.() || "live";
    const regionalRaw = filterEventsToActiveRegion(events);
    const regional = regionalRaw.filter(isMilitaryRelevant);
    return regional.filter((e) => isEventInLens(e, lens));
}
function applyOperationalScopeFilters(events) {
    return applyScopeFilters(events).filter(isOperationalMapEvent);
}
function applyHotspotFilters(events, { respectRegion = false } = {}) {
    const lens = getActiveLens?.() || "live";
    const region = getActiveRegion?.();
    const source = Array.isArray(events) ? events : [];
    let filtered = source
        .filter((event) => isMilitaryRelevant(event))
        .filter((event) => isOperationalMapEvent(event))
        .filter((event) => isEventInLens(event, lens));
    if (respectRegion && filterEventsByRegion) {
        filtered = filterEventsByRegion(filtered, region);
    }
    return getHotspotSourceEvents(filtered);
}
function isHotspotEventEligible(event, { respectRegion = false } = {}) {
    if (!event) return false;
    if (!isMilitaryRelevant(event)) return false;
    if (!isOperationalMapEvent(event)) return false;
    const lens = getActiveLens?.() || "live";
    if (!isEventInLens(event, lens)) return false;
    if (respectRegion) {
        const region = getActiveRegion?.();
        const inRegion =
            !filterEventsByRegion ||
            !region ||
            region.id === "global" ||
            eventMatchesBounds(event, region.bounds);
        if (!inRegion) return false;
    }
    if (isAircraftTelemetryEvent(event)) return false;
    if (isMilitaryTrackEvent(event)) return false;
    if (isNavalSignalEvent(event)) return false;
    return true;
}
function isPointInsideRegion(lat, lon, region = getActiveRegion?.()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (!region || region.id === "global") return true;
    const bounds = region.bounds || {};
    return (
        lat >= Number(bounds.minLat) &&
        lat <= Number(bounds.maxLat) &&
        lon >= Number(bounds.minLon) &&
        lon <= Number(bounds.maxLon)
    );
}
function isTrackerItemVisibleInScope(item = {}, scope = "region") {
    if (scope === "all") return true;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    return isPointInsideRegion(lat, lon, getActiveRegion?.());
}
function isDatabaseAircraftLiveSourceEnabled() {
    return window.__stratopsConfig?.enablePublicAirFallback !== true;
}
function getAircraftLiveSyncIntervalMs() {
    return isDatabaseAircraftLiveSourceEnabled()
        ? AIRCRAFT_LIVE_SYNC_DB_MS
        : AIRCRAFT_HISTORY_REFRESH_MS;
}
function getHotspotSourceEvents(events = []) {
    return (Array.isArray(events) ? events : []).filter((event) => {
        if (!event) return false;
        if (isCountryLevelHotspotFallback(event)) return false;
        if (!isOperationalMapEvent(event)) return false;
        if (isAircraftTelemetryEvent(event)) return false;
        if (isMilitaryTrackEvent(event)) return false;
        if (isNavalSignalEvent(event)) return false;
        return true;
    });
}
function getIntelWireTimestamp(item = {}) {
    return item.timestamp || item.published_at || item.publishedAt || item.fetched_at || item.fetchedAt || new Date().toISOString();
}
function getIntelWireVerificationState(item = {}) {
    const value = String(
        item.corroboration_state
        || item.verification_state
        || item.metadata?.corroboration_state
        || item.metadata?.verification_state
        || "REPORTED"
    ).trim().toUpperCase();
    return ["CONFIRMED", "CORROBORATED", "REPORTED", "UNVERIFIED", "DISPUTED"].includes(value)
        ? value
        : "REPORTED";
}
function getLongestIntelWireTextCandidate(values = []) {
    return (Array.isArray(values) ? values : [])
        .map((value) => sanitizeIntelWireStructuredText(value))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] || "";
}
function normalizeIntelWireItem(item = {}) {
    const occurredAt = getIntelWireTimestamp(item);
    const verificationState = getIntelWireVerificationState(item);
    const idSource = item.id || item.guid || item.publicUrl || item.public_url || item.url || `${item.title || "intel"}-${occurredAt}`;
    const title = sanitizeEventPopupText(item.title || item.display_title || item.displayTitle || "", "");
    const summary = sanitizeIntelWireSummary(
        item.summary
        || item.display_summary
        || item.displaySummary
        || item.description
        || item.content
        || item.content_text
        || ""
    );
    const fullContent = getLongestIntelWireTextCandidate([
        item.full_content,
        item.fullContent,
        item.content_text,
        item.contentText,
        item.content,
        item.description,
        item.body,
        item.article_text,
        item.articleText,
        item.raw?.stratops_full_content,
        item.raw?.full_content,
        item.raw?.contentEncoded,
        item.raw?.["content:encoded"],
        item.summary,
        item.display_summary,
        item.displaySummary,
    ]) || summary;
    const sourceName = sanitizeEventPopupText(
        item.sourceLabel
        || item.source_label
        || item.source_name
        || item.sourceName
        || "",
        ""
    );
    const rawLocationLabel = sanitizeEventPopupText(item.region || item.country || item.location_label || item.locationLabel || "", "");
    const locationLabel = isMeaningfulIntelWireText(rawLocationLabel) ? rawLocationLabel : "";
    const rawMedia = item.media && typeof item.media === "object"
        ? item.media
        : (item.metadata?.media && typeof item.metadata.media === "object"
            ? item.metadata.media
            : (item.raw?.stratops_media && typeof item.raw.stratops_media === "object"
                ? item.raw.stratops_media
                : (item.raw?.media && typeof item.raw.media === "object" ? item.raw.media : null)));
    const media = rawMedia
        ? {
            images: Array.isArray(rawMedia.images) ? rawMedia.images : [],
            videos: Array.isArray(rawMedia.videos) ? rawMedia.videos : [],
        }
        : null;
    const sourceUrl = String(
        item.publicUrl
        || item.public_url
        || item.source_url
        || item.sourceUrl
        || item.url
        || ""
    ).trim();
    return {
        id: `intel-${idSource}`,
        title,
        summary,
        description: fullContent,
        content: fullContent,
        full_content: fullContent,
        category: item.category || "intel",
        severity: isUnknownEventDisplayValue(item.severity) ? "medium" : (item.severity || "medium"),
        source_name: sourceName,
        source_type_label: item.sourceTypeLabel || item.source_type_label || null,
        source_attribution_level: item.sourceAttributionLevel || item.source_attribution_level || "grouped",
        source_url: sourceUrl,
        occurred_at: occurredAt,
        published_at: occurredAt,
        country: item.country || "",
        location_label: locationLabel,
        report_type: "intel_wire",
        display_surface: "intel_wire",
        corroboration_state: verificationState,
        verification_state: verificationState,
        raw_report_count: Number(item.raw_report_count || 1),
        independent_source_family_count: Number(item.independent_source_family_count || 1),
        official_confirmation: item.official_confirmation === true,
        direct_evidence: item.direct_evidence === true,
        disputed: item.disputed === true || verificationState === "DISPUTED",
        source_class: item.source_class || null,
        source_tier: item.source_tier || null,
        source_reliability: Number.isFinite(Number(item.source_reliability)) ? Number(item.source_reliability) : null,
        tags: ["intel-wire-only", "conflict-feed"],
        media,
        satellite_context: item.satellite_context || item.satelliteContext || null,
        metadata: {
            ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
            display_surface: "intel_wire",
            confidence_score: item.confidence_score ?? item.confidence ?? item.metadata?.confidence_score ?? null,
            corroboration_state: verificationState,
            raw_report_count: Number(item.raw_report_count || 1),
            independent_source_family_count: Number(item.independent_source_family_count || 1),
            source_attribution_level: item.sourceAttributionLevel || item.source_attribution_level || "grouped",
            source_type_label: item.sourceTypeLabel || item.source_type_label || null,
            full_content: fullContent,
            media,
            satellite_context: item.satellite_context || item.satelliteContext || null,
        }
    };
}
function sortIntelWireItems(items = []) {
    return sortEvents(items).slice(0, INTEL_WIRE_MAX_ITEMS);
}
async function refreshIntelWireItems({ force = false } = {}) {
    if (isDocumentHidden()) return;
    if (!force && shouldDeferBackgroundMapWork()) return __intelWireItemsCache;
    if (__intelWireRefreshInFlight) return;
    const now = Date.now();
    if (!force && __intelWireEndpointBackoffUntil && now < __intelWireEndpointBackoffUntil) return;
    if (!force && __intelWireNextRefreshAt && now < __intelWireNextRefreshAt) return;
    __intelWireRefreshInFlight = true;
    __intelWireNextRefreshAt = now + INTEL_WIRE_REFRESH_MS;
    const shouldShowLoader = force || !__intelWireItemsCache.length;
    if (shouldShowLoader) {
        setWidgetLoading("feed", true);
    }
    try {
        const { data, error } = await api.getIntelFeedItems();
        if (isDocumentHidden()) return;
        if (error) {
            console.warn("Intel Wire feed fetch error:", error);
            return;
        }
        const rows = Array.isArray(data)
            ? data.map((row) => normalizeIntelWireItem(row)).filter(Boolean)
            : [];
        __intelWireItemsCache = sortIntelWireItems(rows);
        debouncedRenderFeed(getFeedEvents());
    } catch (err) {
        console.warn("Intel Wire feed refresh failed:", err);
        const message = String(err?.message || "");
        if (/returned non-JSON response|warzone worker running/i.test(message)) {
            __intelWireEndpointBackoffUntil = Date.now() + INTEL_WIRE_ENDPOINT_BACKOFF_MS;
        }
    } finally {
        __intelWireRefreshInFlight = false;
        if (shouldShowLoader) {
            setWidgetLoading("feed", false);
        }
    }
}
function startIntelWireRefreshLoop(options = {}) {
    if (!isStratOpsFeatureEnabled("system.intelWireFeed") || !isStratOpsFeatureEnabled("widgets.intelWire")) return;
    if (__intelWireRefreshInterval) return;
    if (options?.forceInitial !== false) {
        refreshIntelWireItems({ force: true });
    }
    __intelWireRefreshInterval = window.setInterval(() => {
        if (isDocumentHidden()) return;
        refreshIntelWireItems();
    }, INTEL_WIRE_REFRESH_MS);
}
function stopIntelWireRefreshLoop() {
    if (!__intelWireRefreshInterval) return;
    window.clearInterval(__intelWireRefreshInterval);
    __intelWireRefreshInterval = null;
}
function isCountryLevelHotspotFallback(event = {}) {
    const precision = String(event.display_precision || "").toLowerCase();
    const source = String(event.display_source || "").toLowerCase();
    return (
        precision === "country" ||
        source === "country_fallback" ||
        source === "country_center" ||
        source === "subdivision_to_country_center"
    );
}
function getFeedSourceEvents({ includeAllEvents = false } = {}) {
    const seen = new Set();
    const merged = [];
    const pushUnique = (event) => {
        if (!event) return;
        const key = String(event.id || `${event.title}-${event.occurred_at}`);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(event);
    };
    __liveRecentEvents.forEach(pushUnique);
    __intelWireItemsCache.forEach(pushUnique);
    (includeAllEvents ? __allEventsCache : __eventsCache).forEach(pushUnique);
    return sortEvents(merged);
}
function getIntelWireBaseEvents() {
    const globalFeedEvents = selectFeedEventsFromSource(getFeedSourceEvents({ includeAllEvents: true }));
    if (globalFeedEvents.length) return globalFeedEvents;
    return selectFeedEventsFromSource(getFeedSourceEvents());
}
function normalizeIntelWireCountryFilterValue(country = "") {
    const normalized = normalizeCountryName(country || "").trim().toLowerCase();
    if (!normalized || normalized === "unknown / unassigned" || normalized === "unresolved location") return "unknown";
    return normalized;
}
function getIntelWireCountryLabel(event = {}) {
    const explicit = normalizeCountryName(getEventResolvedCountry(event));
    if (explicit) return explicit;
    const locationBits = String(event.location_label || "")
        .split(",")
        .map((bit) => normalizeCountryName(bit))
        .filter(Boolean);
    if (locationBits.length > 1) {
        const trailingCountry = locationBits[locationBits.length - 1];
        if (trailingCountry && trailingCountry.toLowerCase() !== "unknown location") {
            return trailingCountry;
        }
    }
    const inferred = normalizeCountryName(
        inferCountryFromStatusText(
            event.location_label,
            event.region,
            event.title,
            event.summary,
            event.location,
            event.country,
        )
    );
    return inferred || "Unresolved location";
}
function getIntelWireCountryFilterOptions(items = []) {
    const options = new Map();
    let hasUnknown = false;
    (Array.isArray(items) ? items : []).forEach((event) => {
        const label = getIntelWireCountryLabel(event);
        const value = normalizeIntelWireCountryFilterValue(label);
        if (value === "unknown") {
            hasUnknown = true;
            return;
        }
        if (!options.has(value)) {
            options.set(value, label);
        }
    });
    const rows = [...options.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    if (hasUnknown) {
        rows.push({ value: "unknown", label: "Unresolved location" });
    }
    return rows;
}
function getIntelWireTimeFilterCutoff(value = "all") {
    const normalized = String(value || "all").toLowerCase();
    if (normalized === "24h") return Date.now() - (24 * 60 * 60 * 1000);
    if (normalized === "72h") return Date.now() - (72 * 60 * 60 * 1000);
    if (normalized === "7d") return Date.now() - (7 * 24 * 60 * 60 * 1000);
    if (normalized === "30d") return Date.now() - (30 * 24 * 60 * 60 * 1000);
    return null;
}
function applyIntelWireFilters(items = []) {
    const countryFilter = String(__intelWireCountryFilter || "all").toLowerCase();
    const cutoff = getIntelWireTimeFilterCutoff(__intelWireTimeFilter);
    return (Array.isArray(items) ? items : []).filter((event) => {
        if (countryFilter !== "all") {
            const eventCountry = normalizeIntelWireCountryFilterValue(getIntelWireCountryLabel(event));
            if (eventCountry !== countryFilter) return false;
        }
        if (cutoff) {
            const occurredAt = Date.parse(getIntelWireTimestamp(event));
            if (!Number.isFinite(occurredAt) || occurredAt < cutoff) return false;
        }
        return true;
    });
}
function hasActiveIntelWireFilters() {
    return (
        String(__intelWireCountryFilter || "all").toLowerCase() !== "all" ||
        String(__intelWireTimeFilter || "all").toLowerCase() !== "all"
    );
}
function buildIntelWireViewModel() {
    const baseEvents = getIntelWireBaseEvents();
    const filteredEvents = applyIntelWireFilters(baseEvents);
    return {
        baseEvents,
        filteredEvents,
        countryOptions: getIntelWireCountryFilterOptions(baseEvents),
        total: baseEvents.length,
        filteredTotal: filteredEvents.length,
        hasActiveFilters: hasActiveIntelWireFilters(),
    };
}
function getEventTags(event = {}) {
    const raw = event.tags;
    if (Array.isArray(raw)) {
        return raw.map((tag) => String(tag || "").toLowerCase()).filter(Boolean);
    }
    if (typeof raw === "string") {
        return raw.split(",").map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
    }
    return [];
}
const BREAKING_NEWS_ALLOWED_REPORT_TYPES = new Set([
    "news",
    "osint",
    "reddit",
    "conflict",
    "intel_wire",
    "signal",
]);
const BREAKING_NEWS_BLOCKED_REPORT_TYPES = new Set([
    "flight_tracking",
    "airspace_status",
    "notam",
    "siren_alert",
    "thermal_anomaly",
    "seismic",
    "hazard",
    "internet_outage",
    "network",
    "network_blocking",
]);
function isBreakingNewsEvent(event = {}) {
    const sourceName = String(event.source_name || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const tags = getEventTags(event);
    if (
        sourceName.includes("ads-b") ||
        sourceName.includes("airplanes.live") ||
        sourceName.includes("aviation edge") ||
        sourceName.includes("opensky") ||
        sourceName.includes("ais")
    ) {
        return false;
    }
    if (BREAKING_NEWS_BLOCKED_REPORT_TYPES.has(reportType)) return false;
    if (tags.includes("adsb") || tags.includes("ais") || tags.includes("flight-tracking")) return false;
    if (BREAKING_NEWS_ALLOWED_REPORT_TYPES.has(reportType)) return true;
    if (tags.includes("rss")) return true;
    return (
        sourceName.includes("telegram") ||
        sourceName.includes("reddit") ||
        sourceName.includes("gdelt") ||
        sourceName.includes("acled") ||
        sourceName.includes("ucdp")
    );
}
function isAircraftTelemetryEvent(event = {}) {
    const sourceName = String(event.source_name || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const tags = getEventTags(event);
    return (
        reportType === "flight_tracking" ||
        tags.includes("adsb") ||
        tags.includes("flight-tracking") ||
        sourceName.includes("ads-b") ||
        sourceName.includes("airplanes.live") ||
        sourceName.includes("aviation edge") ||
        sourceName.includes("opensky")
    );
}
function selectFeedEventsFromSource(source = []) {
    const strict = source.filter((event) => (
        isIntelWireOnlyEvent(event) ||
        isMilitaryRelevant(event)
    ) && isBreakingNewsEvent(event));
    if (strict.length) return strict;
    // Fallback: if upstream metadata/report_type is sparse, still keep the
    // breaking-news panel populated with relevant conflict events.
    return source.filter((event) => {
        const intelWireOnly = isIntelWireOnlyEvent(event);
        if (!intelWireOnly && !isMilitaryRelevant(event)) return false;
        if (isAircraftTelemetryEvent(event)) return false;
        if (isNavalSignalEvent(event)) return false;
        const reportType = String(event.report_type || "").toLowerCase();
        if (BREAKING_NEWS_BLOCKED_REPORT_TYPES.has(reportType)) return false;
        if (intelWireOnly) return true;
        const category = String(event.category || "").toLowerCase();
        return ["alert", "strike", "military", "air_activity", "naval_activity", "ground_activity", "cyber", "airspace", "signal", "recon", "recon_intel"].includes(category);
    });
}
function getFeedEvents() {
    return buildIntelWireViewModel().filteredEvents;
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
function makeWidgetRenderSignature(events = []) {
    const scope = `${getActiveRegion?.()?.id || "global"}:${getActiveLens?.() || "live"}`;
    const data = events
        .map((event) => [
            event.id || "",
            event.occurred_at || "",
            event.updated_at || "",
            event.category || "",
            event.severity || "",
            event.title || "",
        ].join(":"))
        .join("|") || "__empty__";
    return `${scope}|${data}`;
}
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
// ── Region/Lens-scoped widgets (independent of map layer toggles) ─────────────
const debouncedRenderUI = debounce((events) => {
    const statusEvents = getWidgetStatusEvents(events);
    const signature = makeWidgetRenderSignature(statusEvents);
    if (signature === __lastStatusWidgetSignature) return;
    __lastStatusWidgetSignature = signature;
    renderCyberStatus(statusEvents);
    renderAirspaceStatus(statusEvents);
}, 800);

// ── Scope widgets — use current region/lens from full cache ────────────────────
// Theater Intelligence (strike counts) and Escalation Meter should reflect
// the currently selected theater scope, not camera zoom level.
// Stored as a closure so it always reads the live cache at call time.
const debouncedRenderRaw = debounce(() => {
    const scopedEvents = applyOperationalScopeFilters(__eventsCache || []);
    const signature = makeWidgetRenderSignature(scopedEvents);
    if (signature === __lastRawWidgetSignature) return;
    __lastRawWidgetSignature = signature;
    renderStrikeCounters(scopedEvents);
    renderEscalation(scopedEvents);
}, 800);
const debouncedRenderFeed = debounce(() => {
    const feedView = buildIntelWireViewModel();
    const signature = `${makeWidgetRenderSignature(feedView.baseEvents)}|country:${__intelWireCountryFilter}|time:${__intelWireTimeFilter}`;
    if (signature === __lastFeedSignature) return;
    __lastFeedSignature = signature;
    renderFeed(feedView);
}, 400);
const debouncedRenderHeavy = debounce((events) => {
    const signature = makeWidgetRenderSignature(events);
    if (signature === __lastHeavyWidgetSignature) return;
    __lastHeavyWidgetSignature = signature;
    renderSummary(events);
    renderTimeline(events);
    renderAnalytics(events);
    renderRecon(events);
    renderWeapons(events);
    renderKillChain(events);
}, 2000);
function scheduleViewportFetch(delay = 500) {
    clearTimeout(__viewportFetchTimer);
    if (shouldSuspendMapWork() || isDocumentHidden() || shouldDeferBackgroundMapWork()) {
        __viewportFetchTimer = null;
        return;
    }
    __viewportFetchTimer = setTimeout(() => {
        fetchViewportEvents();
    }, delay);
}
function getSafePollSinceIso() {
    const fallbackIso = new Date(Date.now() - 30000).toISOString();
    const raw = String(__lastSeenOccurredAt || "").trim();
    if (!raw) return fallbackIso;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return fallbackIso;
    const now = Date.now();
    if (parsed > (now + POLL_SINCE_MAX_FUTURE_SKEW_MS)) {
        return new Date(now - (5 * 60 * 1000)).toISOString();
    }
    return new Date(parsed).toISOString();
}
function describeEventsApiError(error) {
    if (!error) return "";
    if (typeof error === "string") return error;
    const message = String(error?.message || "").trim();
    if (message) return message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}
function isEventsApiRestrictedError(error) {
    const text = describeEventsApiError(error).toLowerCase();
    return text.includes("service for this project is restricted");
}
function isRequestAbortError(error) {
    return error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted");
}
function logEventsApiError(prefix, error) {
    if (isRequestAbortError(error)) return;
    const now = Date.now();
    const detail = describeEventsApiError(error) || "unknown_error";
    const key = `${prefix}:${detail}`;
    if (
        __eventsApiLastErrorKey === key &&
        (now - __eventsApiLastErrorLoggedAt) < EVENTS_API_ERROR_LOG_THROTTLE_MS
    ) {
        return;
    }
    __eventsApiLastErrorKey = key;
    __eventsApiLastErrorLoggedAt = now;
    console.error(prefix, error);
}
function setAuthModalRenderBudget(paused) {
    const viewer = window.__warzoneViewer;
    const scene = viewer?.scene;
    const globe = scene?.globe;
    if (!viewer || !scene || !globe) return;
    if (paused) {
        if (!__authModalRenderBudgetBackup) {
            __authModalRenderBudgetBackup = {
                resolutionScale: Number(viewer.resolutionScale || 1),
                maximumRenderTimeChange: scene.maximumRenderTimeChange,
                maximumScreenSpaceError: Number(globe.maximumScreenSpaceError || 1.6),
                msaaSamples: Number(scene.msaaSamples || 1),
                fxaaEnabled: !!scene.postProcessStages?.fxaa?.enabled,
            };
        }
        viewer.resolutionScale = Math.min(0.72, Math.max(0.5, Number(viewer.resolutionScale || 1)));
        scene.maximumRenderTimeChange = 1.6;
        globe.maximumScreenSpaceError = Math.max(3.2, Number(globe.maximumScreenSpaceError || 1.6));
        if (Number.isFinite(Number(scene.msaaSamples))) {
            scene.msaaSamples = 1;
        }
        if (scene.postProcessStages?.fxaa) {
            scene.postProcessStages.fxaa.enabled = false;
        }
        return;
    }
    if (__authModalRenderBudgetBackup) {
        viewer.resolutionScale = __authModalRenderBudgetBackup.resolutionScale;
        scene.maximumRenderTimeChange = __authModalRenderBudgetBackup.maximumRenderTimeChange;
        globe.maximumScreenSpaceError = __authModalRenderBudgetBackup.maximumScreenSpaceError;
        if (Number.isFinite(__authModalRenderBudgetBackup.msaaSamples)) {
            scene.msaaSamples = __authModalRenderBudgetBackup.msaaSamples;
        }
        if (scene.postProcessStages?.fxaa) {
            scene.postProcessStages.fxaa.enabled = __authModalRenderBudgetBackup.fxaaEnabled;
        }
        __authModalRenderBudgetBackup = null;
    }
    const visibleCount = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
    viewer.__warzone?.setPerformanceMode?.(visibleCount);
}
function shouldSuspendMapWork() {
    return (
        IDLE_SUSPEND_LAYER_IDS.every((id) => !isLayerEnabled(id)) ||
        isSupportModalVisible()
    );
}
function isAircraftFocusPerformanceMode() {
    if (window.__stratopsConfig?.optimizeBackgroundOnAircraftFocus === false) return false;
    const selection = getLiveTrackSelection?.() || window.__warzoneLiveTrackSelection || {};
    return String(selection?.mode || "") === "focus" && Boolean(selection?.trackKey || selection?.track_key);
}
function isAircraftFocusModeActive() {
    const selection = getLiveTrackSelection?.() || window.__warzoneLiveTrackSelection || {};
    return String(selection?.mode || "") === "focus" && Boolean(selection?.trackKey || selection?.track_key);
}
function shouldDeferBackgroundMapWork() {
    return isAircraftFocusPerformanceMode();
}
function shouldRunFocusModeTask(lastRunAt = 0, cooldownMs = 0) {
    if (!shouldDeferBackgroundMapWork()) return true;
    return (Date.now() - Number(lastRunAt || 0)) >= Math.max(0, Number(cooldownMs || 0));
}
function syncNewsTickerForCurrentMode() {
    if (shouldDeferBackgroundMapWork()) return;
    updateNewsTicker(applyOperationalScopeFilters(__eventsCache).slice(0, 20));
}
function syncFocusAwareBackgroundLoops() {
    if (shouldDeferBackgroundMapWork()) {
        stopIntelWireRefreshLoop();
        return;
    }
    startIntelWireRefreshLoop({ forceInitial: false });
    syncNewsTickerForCurrentMode();
    scheduleViewportFetch(180);
}
function shouldEnableMilSatsLayer() {
    return (
        window.__stratopsConfig?.enableMilSatsLayer !== false &&
        isStratOpsFeatureEnabled("tracking.strategicSatellites") &&
        isLayerEnabled("orbital-assets")
    );
}
function hasEnabledGlobeEventLayer() {
    return GLOBE_EVENT_LAYER_IDS.some((id) => isLayerEnabled(id));
}
function syncOrbitalWidgetVisibilityForLayer() {
    const enabled = shouldEnableMilSatsLayer();
    const widget = document.querySelector('[data-widget-id="orbital"]');
    if (!widget || enabled) return;
    widget.classList.add("wz-is-hidden");
    try {
        const saved = JSON.parse(localStorage.getItem("wz_widget_visibility") || "{}");
        saved.orbital = false;
        localStorage.setItem("wz_widget_visibility", JSON.stringify(saved));
    } catch { }
    window.__syncWarzoneDock?.();
}
function syncIdleSceneState() {
    syncOrbitalWidgetVisibilityForLayer();
    void setWarzoneMilSatsEnabledDeferred(shouldEnableMilSatsLayer());
}
function isAuthModalVisible() {
    const introModal = document.getElementById("wz-intro-modal");
    const loginModal = document.getElementById("wz-login-modal");
    return Boolean(
        (introModal && !introModal.hidden) ||
        (loginModal && !loginModal.hidden)
    );
}
function isSupportModalVisible() {
    const supportModal = document.getElementById("wz-donate-modal");
    return Boolean(supportModal && !supportModal.hidden);
}
function syncModalRenderBudget() {
    setAuthModalRenderBudget(isSupportModalVisible());
}
function onAuthModalVisibilityChanged() {
    const modalPaused = isSupportModalVisible();
    syncModalRenderBudget();
    const hotspotEnabled = isLayerEnabled("hotspots");
    syncHotspotRootVisibility(!modalPaused && hotspotEnabled);
    if (modalPaused) {
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }
    __lastViewportKey = "";
    scheduleViewportFetch(220);
    requestAircraftMovementsWidgetRender(0);
    requestNavalWidgetRender(0);
    window.__warzoneViewer?.scene?.requestRender?.();
}
function syncHotspotRootVisibility(enabled) {
    const hotspotRootEl = document.getElementById("warzone-hotspot-layer");
    if (!hotspotRootEl) return;
    const show = !!enabled;
    const active = document.activeElement;
    if (!show && active && hotspotRootEl.contains(active) && typeof active.blur === "function") {
        active.blur();
    }
    hotspotRootEl.style.display = show ? "" : "none";
    hotspotRootEl.setAttribute("aria-hidden", show ? "false" : "true");
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
function toUiLabel(value, fallback = "Unknown") {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    return raw
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function isUnknownEventDisplayValue(value = "") {
    const clean = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    return !clean || /^(unknown|unknown source|unknown location|unknown origin|reported location|untitled|untitled event|n\/a|null|undefined|-)+$/.test(clean);
}
const RAW_EVENT_TIMESTAMP_RE = /^\s*(?:\d{8}T\d{4,6}Z|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:?\d{2}(?::?\d{2})?(?:\.\d+)?Z?)?)\s*$/i;
const FRAGMENTARY_EVENT_SIGNAL_RE = /^\s*[:;|,\-]*\s*(?:drones?|uavs?|missiles?|rockets?|strikes?|attacks?|explosions?|blasts?|shelling|artillery|airstrikes?|air strikes?)(?:\s*[-:]\s*\d+)?\s*$/i;
function isRawEventTimestampText(value = "") {
    return RAW_EVENT_TIMESTAMP_RE.test(String(value || "").trim());
}
function isFragmentaryEventSignalText(value = "") {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean) return false;
    if (FRAGMENTARY_EVENT_SIGNAL_RE.test(clean)) return true;
    const withoutPrefix = clean.replace(/^[\s:;|,\-]+/, "").trim();
    return withoutPrefix !== clean && withoutPrefix.split(/\s+/).length <= 5;
}
function isLowInformationPublicSignal(event = {}) {
    const source = [
        event.display_source_name,
        event.source_name,
        Array.isArray(event.tags) ? event.tags.join(" ") : event.tags,
    ].filter(Boolean).join(" ").toLowerCase();
    if (!source.includes("gdelt")) return false;
    const title = event.display_title || event.displayTitle || event.title || "";
    const summary = event.display_summary || event.displaySummary || event.summary || "";
    return isFragmentaryEventSignalText(title) && (!summary || isRawEventTimestampText(summary));
}
function sanitizeEventPopupText(value = "", fallback = "") {
    const cleaned = sanitizeIntelWireSummary(value || fallback || "")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/t\.me\/\S+/gi, " ")
        .replace(/@[A-Za-z0-9_]+/g, " ")
        .replace(/\b(?:img|image)\s+width\s*=?\s*["']?\d+["']?\s+height\s*=?\s*["']?\d+["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:attachment|attachment-featured-img|size|featured|wp-post-image|fetchpriority|decoding|async|max-width|sizes|srcset|class|alt|loading|data-[a-z0-9_-]+)\b\s*=?\s*["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:float|left|right|high|medium|thumbnail|large|full)\s+sizes\s*=?\s*["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\(\s*max-width\s*:\s*\d+px\s*\)\s*\d+vw\s*,?\s*\d+px/gi, " ");
    const normalized = stripNonEnglishText(stripPresentationEmoji(cleaned), fallback)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/[^A-Za-z0-9\s.,:;!?()\-\/&%'""]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!isUnknownEventDisplayValue(normalized)) return normalized;
    const fallbackText = String(fallback || "").trim();
    return isUnknownEventDisplayValue(fallbackText) ? "" : fallbackText;
}
function comparableEventText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/\b\d{8}t\d{6}z\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(the|a|an|and|or|of|in|on|near|to|for|as|at|by|with|from)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function stripRepeatedEventTitle(summary = "", title = "") {
    let cleanSummary = sanitizeEventPopupText(summary || "");
    const cleanTitle = sanitizeEventPopupText(title || "");
    if (!cleanSummary) return "";
    if (isRawEventTimestampText(cleanSummary)) return "";
    cleanSummary = cleanSummary
        .replace(/^\d{8}T\d{6}Z\s+/i, "")
        .replace(/^top reports:\s*/i, "")
        .trim();
    if (!cleanTitle) return cleanSummary;
    const summaryKey = comparableEventText(cleanSummary);
    const titleKey = comparableEventText(cleanTitle);
    if (!summaryKey || !titleKey) return cleanSummary;
    if (summaryKey === titleKey) return "";
    if (summaryKey.startsWith(titleKey)) {
        return cleanSummary.slice(cleanTitle.length).replace(/^[\s.:;|\-]+/, "").trim();
    }
    return cleanSummary;
}
function buildEventPopupSummary(detail = {}, clusterCount = 1) {
    const displayTitle = detail.displayTitle || detail.display_title || detail.title || "";
    const baseSummary = stripRepeatedEventTitle(detail.display_summary || detail.summary || "", displayTitle);
    if (clusterCount <= 1) {
        return baseSummary;
    }
    if (baseSummary) return baseSummary;
    return `${clusterCount} related events are grouped in this operational area.`;
}
function normalizeSatelliteContextForPopup(value = null) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const status = String(value.status || "").toLowerCase();
    if (!["available", "pending", "searching", "processing", "retryable_error"].includes(status)) return null;
    const imageUrl = String(value.imageUrl || value.image_url || "").trim();
    if (status === "available" && !/^https?:\/\//i.test(imageUrl)) return null;
    return {
        status,
        provider: sanitizeEventPopupText(value.provider || "Copernicus", "Copernicus"),
        collection: sanitizeEventPopupText(value.collection || ""),
        observationType: sanitizeEventPopupText(value.observationType || value.observation_type || ""),
        acquisitionTime: value.acquisitionTime || value.acquisition_time || null,
        eventTimeRelation: sanitizeEventPopupText(value.eventTimeRelation || value.event_time_relation || "unknown", "unknown"),
        cloudCover: Number.isFinite(Number(value.cloudCover ?? value.cloud_cover)) ? Number(value.cloudCover ?? value.cloud_cover) : null,
        imageUrl,
        width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
        height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
        updatedAt: value.updatedAt || value.updated_at || null,
        imageryType: sanitizeEventPopupText(value.imageryType || value.imagery_type || ""),
        approximateResolution: sanitizeEventPopupText(value.approximateResolution || value.approximate_resolution || ""),
        disclaimer: sanitizeEventPopupText(value.disclaimer || "Latest available satellite observation for contextual reference. It is not live imagery and does not independently confirm the reported event or its cause."),
        radarDisclaimer: sanitizeEventPopupText(value.radarDisclaimer || value.radar_disclaimer || ""),
    };
}
function formatSatelliteRelation(value = "") {
    const relation = String(value || "").toLowerCase();
    if (relation === "after") return "After reported event";
    if (relation === "before") return "Before reported event";
    return "";
}
function formatSatelliteUtcTime(value = "") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return sanitizeEventPopupText(value || "");
    return parsed.toISOString().replace("T", " ").replace(".000Z", "Z");
}
function renderEventPopupSatelliteContext(host, contextValue) {
    if (!host) return;
    const context = normalizeSatelliteContextForPopup(contextValue);
    if (!context) {
        host.hidden = true;
        host.innerHTML = "";
        return;
    }
    const isAvailable = context.status === "available";
    const collectionLabel = context.collection === "sentinel-2-l2a"
        ? "Sentinel-2 L2A"
        : context.collection === "sentinel-1-grd"
            ? "Sentinel-1 GRD"
            : toUiLabel(context.collection, "Observation");
    const relationLabel = formatSatelliteRelation(context.eventTimeRelation);
    const metaRows = [
        `Provider: ${context.provider}`,
        `Satellite/collection: ${collectionLabel}`,
        context.acquisitionTime ? `Acquisition: ${formatSatelliteUtcTime(context.acquisitionTime)}` : "",
        relationLabel ? `Relation: ${relationLabel}` : "",
        context.cloudCover != null ? `Cloud cover: ${context.cloudCover.toFixed(0)}%` : "",
        context.imageryType ? `Imagery type: ${context.imageryType}` : "",
        context.approximateResolution ? `Approx. resolution: ${context.approximateResolution}` : "",
    ].filter(Boolean);
    host.hidden = false;
    host.innerHTML = `
        <h4 class="wz-event-popup-satellite__title">Satellite Context</h4>
        ${isAvailable ? `
            <img
                class="wz-event-popup-satellite__image"
                src="${escapeHtml(context.imageUrl)}"
                alt="Copernicus satellite context preview"
                loading="lazy"
                decoding="async">
        ` : `<div class="wz-event-popup-satellite__status">Satellite context is being prepared.</div>`}
        <div class="wz-event-popup-satellite__meta">
            ${metaRows.map((row) => `<span>${escapeHtml(row)}</span>`).join("")}
        </div>
        <p class="wz-event-popup-satellite__note">${escapeHtml(context.disclaimer)}</p>
        ${context.radarDisclaimer ? `<p class="wz-event-popup-satellite__note">${escapeHtml(context.radarDisclaimer)}</p>` : ""}
    `;
}
function debugSatelliteImagery(message, detail = null) {
    if (window.__stratopsDebugSatelliteImagery !== true) return;
    if (detail) {
        console.debug(`[satellite-imagery] ${message}`, detail);
    } else {
        console.debug(`[satellite-imagery] ${message}`);
    }
}
function getSatelliteCollectionLabel(collection = "") {
    if (collection === "sentinel-2-l2a") return "Sentinel-2 L2A";
    if (collection === "sentinel-1-grd") return "Sentinel-1 GRD";
    return toUiLabel(collection, "Observation");
}
function formatSatelliteViewerCoord(lat, lon) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return "";
    return `${latNum.toFixed(4)}°, ${lonNum.toFixed(4)}°`;
}
function ensureSatelliteImageryViewer() {
    let viewer = document.getElementById("wz-satellite-imagery-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("section");
    viewer.id = "wz-satellite-imagery-viewer";
    viewer.className = "wz-satellite-imagery-viewer";
    viewer.hidden = true;
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-labelledby", "wz-satellite-imagery-title");
    viewer.innerHTML = `
        <div class="wz-modal-inner wz-satellite-imagery-viewer__panel">
            <header class="panel-head wz-satellite-imagery-viewer__head">
                    <span class="wz-header-title">
                        <small>Satellite Observation</small>
                        <h3 id="wz-satellite-imagery-title">Observation</h3>
                    </span>
                    <span class="wz-close-modal">
                        <button type="button" class="wz-satellite-imagery-viewer__close static-icon stratops-ico-close-1"
                        data-satellite-imagery-close aria-label="Close satellite observation viewer">
                        </button>
                    </span>
                </header>
            <div class="wz-modal-body wz-satellite-imagery-viewer__body" data-satellite-imagery-body></div>
        </div>
    `;
    document.body.appendChild(viewer);
    viewer.addEventListener("click", (event) => {
        if (event.target === viewer || event.target?.closest?.("[data-satellite-imagery-close]")) {
            closeSatelliteImageryViewer();
        }
    });
    return viewer;
}
function closeSatelliteImageryViewer() {
    const viewer = document.getElementById("wz-satellite-imagery-viewer");
    if (!viewer) return;
    viewer.hidden = true;
    viewer.classList.remove("is-visible", "is-loading", "has-error");
}
export function openSatelliteImageryViewer(detail = {}) {
    const context = normalizeSatelliteContextForPopup(detail.satelliteContext || detail.satellite_context || null);
    if (!context || context.status !== "available" || !context.imageUrl) {
        debugSatelliteImagery("ignored unavailable observation", detail);
        return false;
    }
    const viewer = ensureSatelliteImageryViewer();
    const body = viewer.querySelector("[data-satellite-imagery-body]");
    const titleEl = viewer.querySelector("#wz-satellite-imagery-title");
    const title = sanitizeEventPopupText(detail.displayTitle || detail.title || "Satellite observation", "Satellite observation");
    const summary = sanitizeEventPopupText(detail.displaySummary || detail.summary || "", "");
    const location = sanitizeEventPopupText(detail.locationLabel || "", "");
    const coords = formatSatelliteViewerCoord(detail.lat, detail.lon);
    const collectionLabel = getSatelliteCollectionLabel(context.collection);
    const relationLabel = formatSatelliteRelation(context.eventTimeRelation);
    const sourceUrl = String(detail.sourceUrl || "").trim();
    const devPreview = detail.devInspectionPreview === true && isDevInspectionEnvironment();
    const metaRows = [
        ...(devPreview ? [
            ["Platform", context.observationType || "DEV Platform"],
            ["Status", String(detail.status || context.status || "available").toUpperCase()],
            ["Confidence", Number.isFinite(Number(detail.confidence)) ? `${Math.round(Number(detail.confidence))}%` : ""],
        ] : []),
        ["Provider", context.provider],
        ["Collection", collectionLabel],
        ["Acquisition", context.acquisitionTime ? formatSatelliteUtcTime(context.acquisitionTime) : ""],
        ["Relation", relationLabel],
        ["Cloud Cover", context.cloudCover != null ? `${context.cloudCover.toFixed(0)}%` : ""],
        ["Imagery Type", context.imageryType],
        ["Resolution", context.approximateResolution],
        ["Location", location],
        ["Coordinates", coords],
    ].filter((row) => row[1]);
    if (titleEl) titleEl.textContent = title;
    if (body) {
        body.innerHTML = `
            <div class="wz-satellite-imagery-viewer__image-wrap">
                <div class="wz-satellite-imagery-viewer__status" data-satellite-imagery-status>Loading observation image...</div>
                <img
                    class="wz-satellite-imagery-viewer__image"
                    src="${escapeHtml(context.imageUrl)}"
                    alt="Satellite observation for ${escapeHtml(title)}"
                    loading="eager"
                    decoding="async"
                    data-satellite-imagery-image>
            </div>
            <div class="wz-satellite-imagery-viewer__content">
                ${summary ? `<p class="wz-satellite-imagery-viewer__summary">${escapeHtml(summary)}</p>` : ""}
                <dl class="wz-satellite-imagery-viewer__meta">
                    ${metaRows.map(([label, value]) => `
                        <div>
                            <dt>${escapeHtml(label)}</dt>
                            <dd>${escapeHtml(value)}</dd>
                        </div>
                    `).join("")}
                </dl>
                <p class="wz-satellite-imagery-viewer__note">${escapeHtml(context.disclaimer)}</p>
                ${context.radarDisclaimer ? `<p class="wz-satellite-imagery-viewer__note">${escapeHtml(context.radarDisclaimer)}</p>` : ""}
                <div class="wz-satellite-imagery-viewer__actions">
                    <a href="${escapeHtml(context.imageUrl)}" download class="wz-satellite-imagery-viewer__action">Download Image</a>
                    <a href="${escapeHtml(context.imageUrl)}" target="_blank" rel="noopener noreferrer" class="wz-satellite-imagery-viewer__action">Open Full Image</a>
                    ${/^https?:\/\//i.test(sourceUrl) ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="wz-satellite-imagery-viewer__action">Event Source</a>` : ""}
                </div>
            </div>
        `;
        const image = body.querySelector("[data-satellite-imagery-image]");
        image?.addEventListener("load", () => {
            viewer.classList.remove("is-loading", "has-error");
            viewer.querySelector("[data-satellite-imagery-status]")?.setAttribute("hidden", "");
            debugSatelliteImagery("image loaded", { id: detail.id, imageUrl: context.imageUrl });
        }, { once: true });
        image?.addEventListener("error", () => {
            viewer.classList.remove("is-loading");
            viewer.classList.add("has-error");
            const status = viewer.querySelector("[data-satellite-imagery-status]");
            if (status) {
                status.hidden = false;
                status.textContent = "Satellite image could not be loaded.";
            }
            debugSatelliteImagery("image failed", { id: detail.id, imageUrl: context.imageUrl });
        }, { once: true });
    }
    viewer.hidden = false;
    viewer.classList.add("is-visible", "is-loading");
    debugSatelliteImagery("viewer opened", { id: detail.id, provider: context.provider, collection: context.collection });
    return true;
}
function getEventSatelliteContext(event = {}) {
    return normalizeSatelliteContextForPopup(
        event.satellite_context ||
        event.satelliteContext ||
        event.metadata?.satellite_context ||
        event.metadata?.satelliteContext ||
        null
    );
}
function buildIntelWireSatelliteMarkup(event = {}) {
    const context = getEventSatelliteContext(event);
    if (!context || context.status !== "available") return "";
    const collectionLabel = context.collection === "sentinel-2-l2a"
        ? "Sentinel-2 L2A"
        : context.collection === "sentinel-1-grd"
            ? "Sentinel-1 GRD"
            : toUiLabel(context.collection, "Observation");
    const relationLabel = formatSatelliteRelation(context.eventTimeRelation);
    const metaRows = [
        context.provider,
        collectionLabel,
        context.acquisitionTime ? formatSatelliteUtcTime(context.acquisitionTime) : "",
        relationLabel,
    ].filter(Boolean);
    return `
        <div class="wz-feed-satellite" data-satellite-context>
            <div class="wz-feed-satellite__head">
                <span class="wz-feed-satellite__label">Satellite Context</span>
                <span class="wz-feed-satellite__meta">${escapeHtml(metaRows.join(" | "))}</span>
            </div>
            <img
                class="wz-feed-satellite__image"
                src="${escapeHtml(context.imageUrl)}"
                alt="Copernicus satellite context preview"
                loading="lazy"
                decoding="async">
            <p class="wz-feed-satellite__note">${escapeHtml(context.disclaimer)}</p>
        </div>
    `;
}
function normalizeEventPopupImageEntry(entry = {}, fallbackTitle = "") {
    if (!entry || typeof entry !== "object") return null;
    const previewUrl = String(
        entry.preview_url
        || entry.previewUrl
        || entry.thumb_url
        || entry.thumbUrl
        || entry.full_url
        || entry.fullUrl
        || ""
    ).trim();
    const fullUrl = String(entry.full_url || entry.fullUrl || previewUrl || "").trim();
    if (!isPublicRenderableMediaUrl(previewUrl || fullUrl)) return null;
    return {
        previewUrl: isPublicRenderableMediaUrl(previewUrl) ? previewUrl : fullUrl,
        fullUrl: isPublicRenderableMediaUrl(fullUrl) ? fullUrl : previewUrl,
        alt: sanitizeEventPopupText(entry.alt || entry.title || fallbackTitle || "Event image", "Event image") || "Event image",
        width: Number.isFinite(Number(entry.width)) ? Number(entry.width) : null,
        height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : null,
    };
}
function getEventPopupMedia(detail = {}) {
    const images = [];
    const seen = new Set();
    const pushImage = (entry) => {
        const normalized = normalizeEventPopupImageEntry(entry, detail.displayTitle || detail.title || "");
        if (!normalized) return;
        const key = String(normalized.fullUrl || normalized.previewUrl || "").trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        images.push(normalized);
    };
    const satelliteContext = getAvailablePopupSatelliteContext(detail);
    if (satelliteContext?.imageUrl) {
        pushImage({
            preview_url: satelliteContext.imageUrl,
            full_url: satelliteContext.imageUrl,
            alt: `Copernicus satellite preview for ${detail.displayTitle || detail.title || "event"}`,
            width: satelliteContext.width,
            height: satelliteContext.height,
        });
    }
    pushImage(detail.primaryImage || detail.primary_image || null);
    const additional = Array.isArray(detail.additionalImages)
        ? detail.additionalImages
        : (Array.isArray(detail.additional_images) ? detail.additional_images : []);
    additional.forEach(pushImage);
    const mediaImages = Array.isArray(detail?.media?.images) ? detail.media.images : [];
    mediaImages.forEach(pushImage);
    return {
        images,
        imageSource: satelliteContext ? "Copernicus" : sanitizeEventPopupText(detail.imageSource || detail.image_source || "", ""),
        imageCaption: sanitizeEventPopupText(detail.imageCaption || detail.image_caption || detail.displayTitle || detail.title || "", ""),
        imageCredit: satelliteContext ? "Copernicus" : sanitizeEventPopupText(detail.imageCredit || detail.image_credit || "", ""),
        imageType: satelliteContext ? "Satellite Observation" : sanitizeEventPopupText(detail.imageType || detail.image_type || "", ""),
    };
}
function hasPopupSatelliteContext(detail = {}) {
    return !!getAvailablePopupSatelliteContext(detail);
}
function getAvailablePopupSatelliteContext(detail = {}) {
    const context = normalizeSatelliteContextForPopup(detail.satelliteContext || detail.satellite_context || null);
    if (!context || context.status !== "available") return null;
    const imageUrl = String(context.imageUrl || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    return context;
}
function buildPopupRelatedEventDetail(item = {}, parentDetail = {}) {
    const satelliteContext = item?.satellite_context || item?.satelliteContext || null;
    return {
        entityId: "",
        id: String(item?.id || ""),
        title: String(item?.display_title || item?.title || ""),
        displayTitle: String(item?.display_title || item?.title || ""),
        summary: String(item?.display_summary || item?.summary || ""),
        displaySummary: String(item?.display_summary || item?.summary || ""),
        sourceName: String(item?.display_source_name || item?.source_name || ""),
        category: String(item?.category || parentDetail.category || ""),
        severity: String(item?.severity || parentDetail.severity || ""),
        clusterCount: 1,
        lat: Number(item?.lat),
        lon: Number(item?.lon),
        locationLabel: String(item?.display_location_label || item?.location_label || parentDetail.locationLabel || ""),
        occurredAt: String(item?.occurred_at || ""),
        confidence: item?.confidence ?? null,
        weaponType: String(item?.weapon_type || ""),
        sourceUrl: String(item?.source_url || ""),
        satelliteContext,
        satelliteAvailable: !!getAvailablePopupSatelliteContext({ satelliteContext }),
        media: item?.media || null,
        primaryImage: item?.primary_image || null,
        additionalImages: Array.isArray(item?.additional_images) ? item.additional_images : [],
        imageSource: String(item?.image_source || ""),
        imageCaption: String(item?.image_caption || ""),
        imageCredit: String(item?.image_credit || ""),
        imageType: String(item?.image_type || ""),
        clusterEvents: [],
        anchorCartesian: null,
        screenPosition: parentDetail.screenPosition || null,
    };
}
function normalizeRelatedEventText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function getRelatedEventTokens(value = "") {
    const stopWords = new Set([
        "the", "and", "for", "with", "from", "that", "this", "into", "over", "near", "after",
        "says", "said", "will", "has", "have", "been", "they", "their", "his", "her", "its",
        "strike", "strikes", "attack", "attacks", "drone", "missile", "reported", "reports",
    ]);
    return new Set(normalizeRelatedEventText(value)
        .split(" ")
        .filter((token) => token.length >= 4 && !stopWords.has(token))
        .slice(0, 28));
}
function getRelatedTokenOverlapScore(parentTokens, itemTokens) {
    if (!(parentTokens instanceof Set) || !(itemTokens instanceof Set) || !parentTokens.size || !itemTokens.size) return 0;
    let overlap = 0;
    itemTokens.forEach((token) => {
        if (parentTokens.has(token)) overlap += 1;
    });
    return overlap;
}
function getPopupRelatedItems(detail = {}) {
    const currentId = String(detail.id || "").trim();
    const parentText = [
        detail.displayTitle || detail.title || "",
        detail.displaySummary || detail.summary || "",
        detail.locationLabel || "",
        detail.sourceName || "",
    ].join(" ");
    const parentTokens = getRelatedEventTokens(parentText);
    const parentLocation = normalizeRelatedEventText(detail.locationLabel || "");
    const parentSource = normalizeRelatedEventText(detail.sourceName || "");
    const parentCategory = normalizeRelatedEventText(detail.category || "");
    const rawItems = Array.isArray(detail.clusterEvents) ? detail.clusterEvents : [];
    return rawItems
        .filter((item) => item && String(item.id || "").trim() !== currentId)
        .map((item) => {
            const itemText = [
                item.display_title || item.title || "",
                item.display_summary || item.summary || "",
                item.display_location_label || item.location_label || "",
                item.display_source_name || item.source_name || "",
            ].join(" ");
            const itemTokens = getRelatedEventTokens(itemText);
            const overlap = getRelatedTokenOverlapScore(parentTokens, itemTokens);
            const itemLocation = normalizeRelatedEventText(item.display_location_label || item.location_label || "");
            const itemSource = normalizeRelatedEventText(item.display_source_name || item.source_name || "");
            const itemCategory = normalizeRelatedEventText(item.category || "");
            const sameLocation = parentLocation && itemLocation && (parentLocation === itemLocation || parentLocation.includes(itemLocation) || itemLocation.includes(parentLocation));
            const sameSource = parentSource && itemSource && parentSource === itemSource;
            const sameCategory = parentCategory && itemCategory && parentCategory === itemCategory;
            const score = overlap + (sameLocation ? 4 : 0) + (sameSource ? 2 : 0) + (sameCategory ? 1 : 0);
            return { item, score };
        })
        .filter((entry) => entry.score >= 3)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item)
        .slice(0, 6);
}
function renderEventPopupMedia(host, detail = {}, state = {}) {
    if (!host) return;
    const media = getEventPopupMedia(detail);
    if (!media.images.length) {
        host.hidden = true;
        host.innerHTML = "";
        return;
    }
    const imageCount = media.images.length;
    const activeIndex = Math.max(0, Math.min(imageCount - 1, Number(state.activeIndex) || 0));
    const activeImage = media.images[activeIndex];
    const metaBits = [
        imageCount > 1 ? `${activeIndex + 1} of ${imageCount}` : "",
        media.imageType || "",
        media.imageSource || "",
    ].filter(Boolean);
    host.hidden = false;
    host.innerHTML = `
        <div class="wz-event-popup-media__frame">
            <img
                class="wz-event-popup-media__image"
                src="${escapeHtml(activeImage.previewUrl || activeImage.fullUrl)}"
                ${activeImage.fullUrl ? `data-full-src="${escapeHtml(activeImage.fullUrl)}"` : ""}
                alt="${escapeHtml(activeImage.alt)}"
                loading="lazy"
                decoding="async">
        </div>
        <div class="wz-event-popup-media__bar">
            <div class="wz-event-popup-media__text">
                ${metaBits.length ? `<p class="wz-event-popup-media__eyebrow">${escapeHtml(metaBits.join(" | "))}</p>` : ""}
                ${media.imageCaption ? `<p class="wz-event-popup-media__caption">${escapeHtml(media.imageCaption)}</p>` : ""}
                ${media.imageCredit ? `<p class="wz-event-popup-media__credit">Credit: ${escapeHtml(media.imageCredit)}</p>` : ""}
            </div>
            ${imageCount > 1 ? `
                <div class="wz-event-popup-media__nav">
                    <button type="button" data-popup-media-nav="-1" aria-label="Previous image">‹</button>
                    <button type="button" data-popup-media-nav="1" aria-label="Next image">›</button>
                </div>
            ` : ""}
        </div>
    `;
}
function renderEventPopupRelatedEvents(host, detail = {}) {
    if (!host) return;
    const items = getPopupRelatedItems(detail);
    if (!items.length) {
        host.hidden = true;
        host.innerHTML = "";
        return;
    }
    host.hidden = false;
    host.innerHTML = `
        <h4 class="wz-event-popup-related__title">Related Activity</h4>
        <div class="wz-event-popup-related__list">
            ${items.map((item, index) => {
        const severityClass = getPlatformSeverityClass(item?.severity || "medium");
        const severityLabel = sanitizeEventPopupText(getPlatformSeverityLabel(item?.severity || "", "Medium"), "Medium");
        const title = sanitizeEventPopupText(item?.display_title || item?.title || item?.summary || "", "Activity report") || "Activity report";
        const location = sanitizeEventPopupText(item?.display_location_label || item?.location_label || "", "");
        const source = sanitizeEventPopupText(item?.display_source_name || item?.source_name || "", "");
        const time = String(item?.occurred_at || "").trim();
        const satellite = item?.satellite_available === true || normalizeSatelliteContextForPopup(item?.satellite_context || null);
        return `
                    <button type="button" class="wz-event-popup-related__item" data-popup-related-index="${index}">
                        <div class="wz-event-popup-related__row">
                            <span class="wz-event-popup-related__pill wz-event-popup-related__pill--${escapeHtml(severityClass)}">${escapeHtml(severityLabel)}</span>
                            ${satellite ? `<span class="wz-event-popup-related__sat">Satellite</span>` : ""}
                        </div>
                        <p class="wz-event-popup-related__headline">${escapeHtml(title)}</p>
                        <div class="wz-event-popup-related__meta-row">
                            ${location ? `<span class="wz-event-popup-related__meta">${escapeHtml(location)}</span>` : `<span></span>`}
                            ${time ? `<span class="wz-event-popup-related__meta">${escapeHtml(formatTime(time))}</span>` : ""}
                        </div>
                        ${source ? `<p class="wz-event-popup-related__meta">${escapeHtml(source)}</p>` : ""}
                    </button>
                `;
    }).join("")}
        </div>
    `;
}
function bindGlobeEventPopup() {
    if (__eventPopupBound) return;
    __eventPopupBound = true;
    const popup = document.getElementById("wz-event-popup");
    if (!popup) return;
    const catEl = document.getElementById("wz-event-popup-cat");
    const sevEl = document.getElementById("wz-event-popup-sev");
    const titleEl = document.getElementById("wz-event-popup-title");
    const summaryEl = document.getElementById("wz-event-popup-summary");
    const locationEl = document.getElementById("wz-event-popup-location");
    const timeEl = document.getElementById("wz-event-popup-time");
    const weaponEl = document.getElementById("wz-event-popup-weapon");
    const confidenceEl = document.getElementById("wz-event-popup-confidence");
    const actionsEl = document.getElementById("wz-event-popup-actions");
    const mediaEl = document.getElementById("wz-event-popup-media");
    const satelliteEl = document.getElementById("wz-event-popup-satellite");
    const relatedEl = document.getElementById("wz-event-popup-related");
    const sourceEl = document.getElementById("wz-event-popup-source");
    const satelliteToggleEl = document.getElementById("wz-event-popup-satellite-toggle");
    const closeBtn = document.getElementById("wz-event-popup-close");
    let activePopupAnchor = null;
    let activePopupDetail = null;
    let popupMediaIndex = 0;
    let popupSatelliteOpen = false;
    let popupTrackingViewer = null;
    const popupScreenScratch = new Cesium.Cartesian2();
    const hidePopup = (options = {}) => {
        if (__eventPopupDevInspectionFrozen && options?.force !== true) return;
        activePopupAnchor = null;
        activePopupDetail = null;
        popupMediaIndex = 0;
        popupSatelliteOpen = false;
        if (mediaEl) {
            mediaEl.hidden = true;
            mediaEl.innerHTML = "";
        }
        if (satelliteEl) {
            satelliteEl.hidden = true;
            satelliteEl.innerHTML = "";
        }
        if (relatedEl) {
            relatedEl.hidden = true;
            relatedEl.innerHTML = "";
        }
        popup.hidden = true;
        popup.classList.remove("is-visible");
    };
    const normalizePopupViewportPosition = (screenPosition = null) => {
        const x = Number(screenPosition?.x);
        const y = Number(screenPosition?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (screenPosition?.space === "viewport") return { x, y };
        const canvas = window.__warzoneViewer?.scene?.canvas;
        const rect = canvas?.getBoundingClientRect?.();
        if (rect) {
            return { x: rect.left + x, y: rect.top + y };
        }
        return { x, y };
    };
    const getPopupAnchorScreenPosition = () => {
        const viewer = window.__warzoneViewer;
        const scene = viewer?.scene;
        const canvas = scene?.canvas;
        const rect = canvas?.getBoundingClientRect?.();
        if (!viewer || !scene || !canvas || !rect || !activePopupAnchor) return null;
        const anchorEntityId = String(activePopupAnchor.entityId || activePopupAnchor.id || "");
        const entity = anchorEntityId ? viewer.entities?.getById?.(anchorEntityId) : null;
        if (entity && entity.show === false) return null;
        let position = null;
        if (!position) {
            const x = Number(activePopupAnchor.anchorCartesian?.x);
            const y = Number(activePopupAnchor.anchorCartesian?.y);
            const z = Number(activePopupAnchor.anchorCartesian?.z);
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                position = new Cesium.Cartesian3(x, y, z);
            }
        }
        try {
            position = position || entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
        } catch {
            position = position || null;
        }
        if (!position) {
            const lon = Number(activePopupAnchor.lon);
            const lat = Number(activePopupAnchor.lat);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        }
        let canvasPosition = null;
        try {
            canvasPosition = scene.cartesianToCanvasCoordinates(position, popupScreenScratch);
        } catch {
            canvasPosition = null;
        }
        const x = Number(canvasPosition?.x);
        const y = Number(canvasPosition?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const margin = 80;
        const canvasWidth = Number(canvas.clientWidth || rect.width || 0);
        const canvasHeight = Number(canvas.clientHeight || rect.height || 0);
        if (
            x < -margin ||
            y < -margin ||
            x > canvasWidth + margin ||
            y > canvasHeight + margin
        ) {
            return null;
        }
        return { x: rect.left + x, y: rect.top + y, space: "viewport" };
    };
    const positionPopupNearMarker = (screenPosition = null) => {
        const viewportPosition = normalizePopupViewportPosition(screenPosition);
        if (!viewportPosition) {
            popup.style.removeProperty("left");
            popup.style.removeProperty("top");
            popup.style.removeProperty("transform");
            return;
        }
        const x = viewportPosition.x;
        const y = viewportPosition.y;
        const gap = 14;
        const viewportPad = 16;
        const parentRect = popup.offsetParent?.getBoundingClientRect?.() || { left: 0, top: 0 };
        const popupSize = popup.__wzPopupSize || {
            width: popup.offsetWidth || 448,
            height: popup.offsetHeight || 260,
        };
        const width = Math.min(popupSize.width, window.innerWidth - (viewportPad * 2));
        const height = Math.min(popupSize.height, window.innerHeight - (viewportPad * 2));
        let left = x + gap;
        if (left + width > window.innerWidth - viewportPad) {
            left = x - width - gap;
        }
        left = Math.min(Math.max(viewportPad, left), window.innerWidth - width - viewportPad);
        const top = Math.min(
            Math.max(viewportPad, y - (height / 2)),
            window.innerHeight - height - viewportPad
        );
        popup.style.left = "0";
        popup.style.top = "0";
        popup.style.right = "auto";
        popup.style.bottom = "auto";
        popup.style.transform = `translate3d(${left - parentRect.left}px, ${top - parentRect.top}px, 0)`;
    };
    const syncAnchoredPopupPosition = () => {
        if (popup.hidden || !activePopupAnchor) return;
        if (__eventPopupDevInspectionFrozen) return;
        const screenPosition = getPopupAnchorScreenPosition();
        if (!screenPosition) {
            hidePopup();
            return;
        }
        positionPopupNearMarker(screenPosition);
    };
    const bindAnchoredPopupTracking = () => {
        const viewer = window.__warzoneViewer;
        if (!viewer?.scene?.postRender || popupTrackingViewer === viewer) return;
        if (popupTrackingViewer?.scene?.postRender) {
            try {
                popupTrackingViewer.scene.postRender.removeEventListener(syncAnchoredPopupPosition);
            } catch { }
        }
        popupTrackingViewer = viewer;
        viewer.scene.postRender.addEventListener(syncAnchoredPopupPosition);
    };
    const renderRichSections = () => {
        if (!activePopupDetail) return;
        renderEventPopupMedia(mediaEl, activePopupDetail, { activeIndex: popupMediaIndex });
        renderEventPopupRelatedEvents(relatedEl, activePopupDetail);
        const satelliteContext = getAvailablePopupSatelliteContext(activePopupDetail);
        const hasSatellite = !!satelliteContext;
        if (satelliteToggleEl) {
            satelliteToggleEl.hidden = !hasSatellite;
            satelliteToggleEl.classList.toggle("wz-event-popup__action--active", popupSatelliteOpen && hasSatellite);
            if (hasSatellite) {
                satelliteToggleEl.textContent = "Satellite";
            }
        }
        if (satelliteEl) {
            if (popupSatelliteOpen && hasSatellite) {
                renderEventPopupSatelliteContext(satelliteEl, satelliteContext);
            } else {
                satelliteEl.hidden = true;
                satelliteEl.innerHTML = "";
            }
        }
        if (actionsEl) {
            const hasSource = sourceEl && sourceEl.hidden === false;
            actionsEl.hidden = !(hasSource || (satelliteToggleEl && satelliteToggleEl.hidden === false));
        }
        requestAnimationFrame(() => {
            popup.__wzPopupSize = {
                width: popup.offsetWidth || 448,
                height: popup.offsetHeight || 260,
            };
            positionPopupNearMarker(getPopupAnchorScreenPosition());
        });
    };
    const showPopup = (detail = {}) => {
        if (__eventPopupDevInspectionFrozen && detail?.devInspectionPreview !== true) return;
        const clusterCount = Math.max(1, Number(detail.clusterCount || detail.cluster_count || 1));
        const categoryLabel = sanitizeEventPopupText(
            getPlatformCategoryLabel(detail, { surface: "popup", fallback: "Event" }),
            "Event"
        );
        const categoryClass = getPlatformCategoryClass(detail, { surface: "popup" });
        const severityLabel = sanitizeEventPopupText(getPlatformSeverityLabel(detail.severity, "Medium"), "Medium");
        const severityClass = getPlatformSeverityClass(detail.severity || "medium");
        const locationText = sanitizeEventPopupText(detail.locationLabel || "");
        const occurredAt = String(detail.occurredAt || "").trim();
        const weaponType = sanitizeEventPopupText(detail.weaponType || "");
        const sourceName = sanitizeEventPopupText(detail.sourceName || detail.display_source_name || "", "");
        const sourceUrl = String(detail.sourceUrl || "").trim();
        const confidenceValue = Number(detail.confidence);
        activePopupDetail = { ...detail, clusterCount };
        popup.dataset.devInspectionPreview = detail?.devInspectionPreview === true ? "1" : "0";
        popupMediaIndex = 0;
        popupSatelliteOpen = false;
        if (catEl) {
            catEl.textContent = clusterCount > 1
                ? `${categoryLabel} • ${clusterCount}`
                : categoryLabel;
            catEl.className = `wz-event-popup__cat wz-event-popup__cat--${categoryClass}`;
            catEl.dataset.category = categoryClass;
        }
        if (sevEl) {
            sevEl.textContent = severityLabel;
            sevEl.className = `wz-event-popup__sev wz-event-popup__sev--${severityClass}`;
            sevEl.dataset.severity = severityClass;
        }
        if (titleEl) {
            titleEl.textContent = sanitizeEventPopupText(detail.displayTitle || detail.display_title || detail.title || "")
                || (clusterCount > 1 ? `${clusterCount} ${categoryLabel} events` : `${categoryLabel} event`);
        }
        if (summaryEl) {
            summaryEl.textContent = buildEventPopupSummary(detail, clusterCount);
        }
        if (locationEl) {
            const text = locationText ? `Location: ${locationText}` : "";
            locationEl.textContent = text;
            locationEl.hidden = !text;
        }
        if (timeEl) {
            const text = occurredAt ? `Time: ${formatTime(occurredAt)}` : "";
            timeEl.textContent = text;
            timeEl.hidden = !text;
        }
        if (weaponEl) {
            const text = weaponType ? `Type: ${toUiLabel(weaponType, weaponType)}` : "";
            weaponEl.textContent = text;
            weaponEl.hidden = !text;
        }
        if (confidenceEl) {
            const text = Number.isFinite(confidenceValue) ? `Confidence: ${Math.round(confidenceValue)}%` : "";
            confidenceEl.textContent = text;
            confidenceEl.hidden = !text;
        }
        if (sourceEl) {
            const hasSource = /^https?:\/\//i.test(sourceUrl);
            sourceEl.hidden = !hasSource;
            if (hasSource) {
                sourceEl.href = sourceUrl;
                sourceEl.textContent = sourceName ? `${sourceName} source` : "View source";
            } else {
                sourceEl.removeAttribute("href");
                sourceEl.textContent = "";
            }
        }
        activePopupAnchor = {
            entityId: String(detail.entityId || "").trim(),
            id: String(detail.id || "").trim(),
            lat: Number(detail.lat),
            lon: Number(detail.lon),
            anchorCartesian: detail.anchorCartesian || null,
        };
        popup.hidden = false;
        popup.style.transition = "opacity 350ms cubic-bezier(0.4, 0, 0.2, 1)";
        popup.classList.add("is-visible");
        bindAnchoredPopupTracking();
        renderRichSections();
        popup.__wzPopupSize = {
            width: popup.offsetWidth || 448,
            height: popup.offsetHeight || 260,
        };
        positionPopupNearMarker(detail.screenPosition || getPopupAnchorScreenPosition());
        window.__warzoneViewer?.scene?.requestRender?.();
    };
    popup.addEventListener("click", (event) => {
        const mediaNav = event.target?.closest?.("[data-popup-media-nav]");
        if (mediaNav && activePopupDetail) {
            const imageCount = getEventPopupMedia(activePopupDetail).images.length;
            if (imageCount > 1) {
                const delta = Number(mediaNav.getAttribute("data-popup-media-nav")) || 0;
                popupMediaIndex = (popupMediaIndex + delta + imageCount) % imageCount;
                renderRichSections();
            }
            return;
        }
        const relatedButton = event.target?.closest?.("[data-popup-related-index]");
        if (relatedButton && activePopupDetail) {
            const index = Number(relatedButton.getAttribute("data-popup-related-index"));
            const relatedItems = getPopupRelatedItems(activePopupDetail);
            const item = relatedItems[index] || null;
            if (item) showPopup(buildPopupRelatedEventDetail(item, activePopupDetail));
            return;
        }
    });
    satelliteToggleEl?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!activePopupDetail) return;
        popupSatelliteOpen = !popupSatelliteOpen;
        renderRichSections();
    });
    closeBtn?.addEventListener("click", () => hidePopup());
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hidePopup();
            closeSatelliteImageryViewer();
        }
    });
    document.addEventListener("wz:event-marker-selected", (event) => {
        closeSatelliteImageryViewer();
        showPopup(event?.detail || {});
    });
    document.addEventListener("wz:event-marker-cleared", hidePopup);
    document.addEventListener("wz:satellite-imagery-selected", (event) => {
        hidePopup();
        openSatelliteImageryViewer(event?.detail || {});
    });
}

function isDevInspectionEnvironment() {
    if (import.meta.env?.DEV === true) return true;
    const hostname = String(window.location?.hostname || "").toLowerCase();
    return hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === ""
        || hostname.includes("staging");
}

export function setDevEventPopupInspectionFrozen(frozen = false) {
    if (!isDevInspectionEnvironment()) return false;
    __eventPopupDevInspectionFrozen = frozen === true;
    const popup = document.getElementById("wz-event-popup");
    if (popup) {
        popup.dataset.devInspectionFrozen = __eventPopupDevInspectionFrozen ? "1" : "0";
    }
    window.__warzoneViewer?.scene?.requestRender?.();
    return __eventPopupDevInspectionFrozen;
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
const NAVAL_SUBTYPE_ALIAS_MAP = new Map([
    ["aircraft_carrier", "carrier"],
    ["helicopter_carrier", "carrier"],
    ["amphibious_assault", "amphibious"],
    ["landing_platform_dock", "amphibious"],
    ["landing_helicopter_dock", "amphibious"],
    ["guided_missile_cruiser", "cruiser"],
    ["guided_missile_destroyer", "destroyer"],
    ["guided_missile_frigate", "frigate"],
    ["surveillance", "intelligence"],
    ["tracking_ship", "intelligence"],
    ["reconnaissance_ship", "intelligence"],
    ["special_mission", "intelligence"],
    ["sigint", "intelligence"],
    ["elint", "intelligence"],
    ["agi", "intelligence"],
    ["isr", "intelligence"],
    ["auxiliary", "logistics"],
    ["fleet_oiler", "logistics"],
    ["replenishment", "logistics"],
    ["support_ship", "logistics"],
    ["attack_submarine", "ssn"],
    ["ballistic_missile_submarine", "ssbn"],
    ["diesel_electric_submarine", "ssk"],
    ["aip_sub", "aip_submarine"],
    ["missile_boat", "missile_boat"],
    ["fast_attack_craft", "missile_boat"],
    ["sub", "submarine"],
]);
function normalizeNavalSubtype(value = "") {
    const normalized = String(value || "")
        .toLowerCase()
        .replace(/[/-]+/g, " ")
        .replace(/\s+/g, "_")
        .trim();
    if (!normalized) return "";
    if (NAVAL_EVENT_SUBTYPES.has(normalized)) return normalized;
    return NAVAL_SUBTYPE_ALIAS_MAP.get(normalized) || normalized;
}
function formatNavalSubtypeLabel(subtype = "") {
    const key = normalizeNavalSubtype(subtype);
    if (!key) return "Naval";
    if (key === "ssbn") return "SSBN";
    if (key === "ssn") return "SSN";
    if (key === "ssk") return "SSK";
    if (key === "aip_submarine") return "AIP Sub";
    if (key === "missile_boat") return "Missile Boat";
    if (key === "amphibious") return "Amphibious";
    return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}
function getHighValueAircraftMeta(track = {}) {
    const subtype = String(resolveAircraftSubtype(track) || "").toLowerCase();
    return HIGH_VALUE_AIRCRAFT_SUBTYPES.get(subtype) || null;
}
function getHighValueNavalMeta(vessel = {}) {
    const subtype = normalizeNavalSubtype(vessel.subcategory || vessel.subtype || "");
    return HIGH_VALUE_NAVAL_SUBTYPES.get(subtype) || null;
}
function updateHighValueDockPulse(kind = "", count = 0) {
    const widgetId = kind === "naval" ? "naval" : "aircraft";
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    const active = safeCount > 0;
    const label = widgetId === "naval" ? "Naval Tracker" : "Aircraft Tracker";
    document.querySelectorAll(
        `.wz-dock__btn[data-dock-widget="${widgetId}"], `
        + `.wz-dock__btn[data-dock-proxy="${widgetId}"], `
        + `.wz-mobile-dock-menu__item[data-dock-proxy="${widgetId}"]`
    ).forEach((btn) => {
        btn.classList.toggle("has-hva-alert", active);
        btn.dataset.hvaCount = active ? String(safeCount) : "";
        btn.title = active ? `${label}: ${safeCount} high-value asset${safeCount === 1 ? "" : "s"}` : label;
    });
}
function buildHighValueAssetName(item = {}, kind = "aircraft") {
    if (kind === "naval") {
        return String(item.vessel_name || item.title || item.name || "").trim() || formatNavalSubtypeLabel(item.subcategory);
    }
    return getAircraftDisplayTitle(item);
}
function notifyHighValueAssets(kind = "aircraft", items = []) {
    if (!isHighValueAssetDetectionEnabled()) {
        updateHighValueDockPulse(kind, 0);
        return;
    }
    const sourceItems = Array.isArray(items) ? items : [];
    const metas = sourceItems
        .map((item) => ({
            item,
            meta: kind === "naval" ? getHighValueNavalMeta(item) : getHighValueAircraftMeta(item),
        }))
        .filter((entry) => entry.meta);
    updateHighValueDockPulse(kind, metas.length);
    if (!metas.length) return;
    const now = Date.now();
    const lastNotificationAt = Number(__highValueAssetLastNotifiedAt.get("global") || 0);
    if (lastNotificationAt && now - lastNotificationAt < HIGH_VALUE_ASSET_NOTIFICATION_COOLDOWN_MS) return;
    for (const { item, meta } of metas) {
        const itemKey = String(item.track_key || item.icao24 || item.mmsi || item.id || buildHighValueAssetName(item, kind)).trim();
        if (!itemKey) continue;
        const alertKey = `${kind}:${itemKey}:${meta.label}`;
        const lastShownAt = Number(__highValueAssetAlertedAt.get(alertKey) || 0);
        if (lastShownAt && now - lastShownAt < HIGH_VALUE_ASSET_ALERT_THROTTLE_MS) continue;
        __highValueAssetAlertedAt.set(alertKey, now);
        __highValueAssetLastNotifiedAt.set("global", now);
        const trackerLabel = kind === "naval" ? "Naval Tracker" : "Aircraft Tracker";
        const name = buildHighValueAssetName(item, kind);
        const location = String(item.country || item.region || item.location_label || "").trim();
        const metaParts = [
            `${meta.label}${name && name !== meta.label ? ` - ${name}` : ""}`,
            location,
            trackerLabel,
        ].filter(Boolean);
        showSirenAlert({
            title: "HIGH-VALUE ASSET DETECTED",
            meta: metaParts.join(" | "),
            level: meta.level || "orange",
            sound: false,
            pulse: false,
        });
        break;
    }
}
document.addEventListener("wz:dev-high-value-aircraft-demo", (event) => {
    const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
    if (!items.length) return;
    if (event.detail?.force === true) {
        __highValueAssetLastNotifiedAt.delete("global");
        items.forEach((item) => {
            const meta = getHighValueAircraftMeta(item);
            if (!meta) return;
            const itemKey = String(item.track_key || item.icao24 || item.mmsi || item.id || buildHighValueAssetName(item, "aircraft")).trim();
            if (itemKey) {
                __highValueAssetAlertedAt.delete(`aircraft:${itemKey}:${meta.label}`);
            }
        });
    }
    notifyHighValueAssets("aircraft", items);
});
function getNavalSubtypeOptions(items = []) {
    return [...new Set(
        items
            .map((item) => normalizeNavalSubtype(item?.subcategory))
            .filter((value) => value && value !== "naval")
            .filter((value) => NAVAL_EVENT_SUBTYPES.has(value))
    )].sort((a, b) => formatNavalSubtypeLabel(a).localeCompare(formatNavalSubtypeLabel(b)));
}
function isNavalSignalEvent(event = {}) {
    const metadata = getEventMetadata(event);
    if (isClearlyAircraftContact(event)) return false;
    const category = String(event.category || "").toLowerCase();
    const subcategory = normalizeNavalSubtype(String(event.subcategory || metadata.vessel_class || ""));
    const sourceName = String(event.source_name || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    if (!isStrictAisMilitaryNavalEvent(event)) return false;
    if (NAVAL_EVENT_SUBTYPES.has(subcategory)) return true;
    if (metadata.mmsi || metadata.vessel_name) return true;
    if (sourceName.includes("ais") || sourceName.includes("vessel") || sourceName.includes("naval")) return true;
    return category === "military" && /warship|vessel|frigate|destroyer|carrier|submarine|ssbn|ssn|ssk|aip|cruiser|amphibious|missile boat|patrol ship|naval|intelligence|sigint|elint|tracking|surveillance|replenishment|oiler|auxiliary/.test(title);
}
function requestNavalWidgetRender(delay = NAVAL_WIDGET_RENDER_THROTTLE_MS) {
    if (__navalWidgetRenderTimer) {
        clearTimeout(__navalWidgetRenderTimer);
        __navalWidgetRenderTimer = 0;
    }
    __navalWidgetRenderTimer = window.setTimeout(() => {
        __navalWidgetRenderTimer = 0;
        const navalSubtypeSelect = document.getElementById("wz-naval-filter-subtype");
        __navalWidgetScopeFilter = "region";
        const allVessels = getAllNavalSnapshots();
        const scopedVessels = allVessels
            .filter((vessel) => isTrackerItemVisibleInScope(vessel, __navalWidgetScopeFilter));
        const highValueVessels = isHighValueAssetDetectionEnabled()
            ? scopedVessels.filter((vessel) => getHighValueNavalMeta(vessel))
            : [];
        if (navalSubtypeSelect) {
            const currentValue = navalSubtypeSelect.value || __navalWidgetSubtypeFilter;
            const subtypeOptions = getNavalSubtypeOptions(scopedVessels);
            const optionsKey = subtypeOptions.join("|");
            if (__navalSubtypeOptionsKey !== optionsKey) {
                navalSubtypeSelect.innerHTML = ['<option value="all">All Types</option>']
                    .concat(subtypeOptions.map((value) => `<option value="${value}">${formatNavalSubtypeLabel(value)}</option>`))
                    .join("");
                __navalSubtypeOptionsKey = optionsKey;
            }
            navalSubtypeSelect.value = subtypeOptions.includes(currentValue) || currentValue === "all"
                ? currentValue
                : "all";
            __navalWidgetSubtypeFilter = navalSubtypeSelect.value || "all";
        }
        let vessels = __navalWidgetSubtypeFilter && __navalWidgetSubtypeFilter !== "all"
            ? scopedVessels.filter((vessel) => normalizeNavalSubtype(vessel.subcategory) === __navalWidgetSubtypeFilter)
            : scopedVessels;
        syncNavalCountryFilterControls(vessels);
        const selectedCountryValue = normalizeAircraftCountryFilterValue(__navalWidgetCountryFilter || "all");
        if (selectedCountryValue !== "all") {
            vessels = vessels.filter(
                (vessel) => normalizeAircraftCountryFilterValue(getNavalCountryFilterLabel(vessel)) === selectedCountryValue
            );
        }
        updateNavalWidgetTitleCount(vessels.length, highValueVessels.length);
        notifyHighValueAssets("naval", highValueVessels);
        renderNavalTrackerWidget({
            vessels,
            visibleCount: LIVE_NAVAL_WIDGET_MAX_ITEMS * __navalWidgetPage,
            pageSize: LIVE_NAVAL_WIDGET_MAX_ITEMS,
            emptyMessage: "No naval contacts in selected region",
        });
    }, getLiveWidgetRenderDelay(delay));
}
function syncNavalSignals(events = []) {
    if (!isNavalTrackingFeatureEnabled() || !isLayerEnabled("naval")) {
        clearAllNavalSignals();
        return;
    }
    const navalEvents = events
        .filter((event) => isNavalSignalEvent(event) && isEventVisible(event));
    const signature = navalEvents
        .map((event) => {
            const key = String(getNavalTrackKey(event) || "").trim();
            if (!key) return "";
            const seenTs = Date.parse(event.updated_at || event.occurred_at || "") || 0;
            const lat = Number(event.lat);
            const lon = Number(event.lon);
            const latKey = Number.isFinite(lat) ? lat.toFixed(3) : "x";
            const lonKey = Number.isFinite(lon) ? lon.toFixed(3) : "x";
            return `${key}:${seenTs}:${latKey}:${lonKey}`;
        })
        .filter(Boolean)
        .sort()
        .join("|") || "__empty__";
    if (signature === __lastNavalSignalsSyncKey) {
        return;
    }
    __lastNavalSignalsSyncKey = signature;
    const activeKeys = new Set();
    navalEvents.forEach((event) => {
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
function clearAllNavalSignals() {
    const snapshots = getAllNavalSnapshots();
    snapshots.forEach((entry) => {
        const key = String(entry?.track_key || "");
        if (!key) return;
        clearNavalVessel(key);
    });
    __lastNavalSignalsSyncKey = "__empty__";
    __navalSubtypeOptionsKey = "";
    requestNavalWidgetRender(0);
}
function normalizeEvent(event = {}) {
    const eventLocation = readEventLocation(event);
    const sourceLat = event.source_lat ?? event.raw_lat ?? null;
    const sourceLon = event.source_lon ?? event.raw_lon ?? null;
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
        country: eventLocation.event_country || event.event_country || event.country || event.countryName || "",
        city: eventLocation.event_city || event.event_city || event.city || "",
        province: eventLocation.event_region || event.event_region || event.province || event.state || event.admin1 || "",
        location: eventLocation.event_place || event.event_place || event.location || "",
        location_label: event.location_label || event.impact_label || eventLocation.event_place || eventLocation.event_city || eventLocation.event_region || eventLocation.event_country || "",
        impact_label: event.impact_label || event.location_label || eventLocation.event_place || eventLocation.event_city || eventLocation.event_region || eventLocation.event_country || "",
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
    const impactFirstCategory = ["strike", "alert", "airspace", "thermal", "signal", "seismic", "cyber", "unknown_activity"].includes(
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
    if (shouldSuspendMapWork() || isDocumentHidden()) return;
    if (shouldDeferBackgroundMapWork()) return;
    if (__viewportFetchInFlight) return;
    __viewportFetchInFlight = true;
    const requestSeq = ++__viewportFetchSeq;
    const region = getActiveRegion?.();
    const regionId = region?.id || "global";
    const globe = window.__warzoneViewer?.__warzone;
    const bounds = globe?.getViewportBounds?.();
    const viewportKey = makeViewportKey(bounds, regionId);
    if (viewportKey === __lastViewportKey) {
        __viewportFetchInFlight = false;
        return;
    }
    __lastViewportKey = viewportKey;
    try {
        const merged = [];
        const seen = new Set();
        const pushUnique = (evt) => {
            if (!evt) return;
            const key = String(evt.id || `${evt.title}-${evt.occurred_at}`);
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(evt);
        };
        __eventsCache.forEach(pushUnique);
        __liveRecentEvents.forEach(pushUnique);
        const regionalMerged = filterEventsToActiveRegion(merged);
        const visible = regionalMerged.filter((evt) => {
            if (!bounds) return true;
            return eventMatchesBounds(evt, bounds);
        });
        const nextVisibleEvents = trimSortedEventList(sortEvents(visible), EVENT_VISIBLE_CACHE_MAX_ITEMS);
        __viewportScoped = true;
        __visibleEventsCache = nextVisibleEvents;
        if (requestSeq !== __viewportFetchSeq || isDocumentHidden()) return;
        // Keep widgets stable across camera zoom/pan by sourcing them from the
        // full cache (region/lens/layer filters still apply inside syncFilteredUi).
        syncFilteredUi(__eventsCache);
        requestAnimationFrame(() => {
            if (requestSeq !== __viewportFetchSeq || isDocumentHidden()) return;
            syncInitialEventsToGlobe(nextVisibleEvents, { animateTracks: false });
            window.__warzoneViewer?.scene?.requestRender?.();
        });
    } catch (err) {
        console.error("Viewport fetch failed:", err);
    } finally {
        __viewportFetchInFlight = false;
    }
}
function sortEvents(events) {
    return [...events].sort((a, b) => {
        const aa = new Date(a.occurred_at || 0).getTime();
        const bb = new Date(b.occurred_at || 0).getTime();
        return bb - aa;
    });
}
function trimSortedEventList(events = [], maxItems = EVENT_CACHE_MAX_ITEMS) {
    const list = Array.isArray(events) ? events : [];
    const max = Math.max(200, Number(maxItems || EVENT_CACHE_MAX_ITEMS));
    const cutoff = Date.now() - EVENT_CACHE_RETENTION_MS;
    const trimmed = [];
    const seen = new Set();
    for (const event of list) {
        if (!event) continue;
        const idKey = String(
            event.id ||
            `${event.title || ""}:${event.occurred_at || ""}:${event.lat || ""}:${event.lon || ""}`
        );
        if (!idKey || seen.has(idKey)) continue;
        seen.add(idKey);
        const occurredAtMs = Date.parse(event.occurred_at || "");
        if (Number.isFinite(occurredAtMs) && occurredAtMs < cutoff) continue;
        trimmed.push(event);
        if (trimmed.length >= max) break;
    }
    return trimmed;
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
    africa: ["Sudan", "South Sudan", "Ethiopia", "Somalia", "DR Congo", "Mali", "Niger", "Burkina Faso", "Libya"],
};
const COUNTRY_NAME_ALIASES = {
    "ae": "United Arab Emirates",
    "bh": "Bahrain",
    "eg": "Egypt",
    "il": "Israel",
    "iq": "Iraq",
    "ir": "Iran",
    "jo": "Jordan",
    "kw": "Kuwait",
    "lb": "Lebanon",
    "om": "Oman",
    "ps": "Palestine",
    "qa": "Qatar",
    "sa": "Saudi Arabia",
    "sy": "Syria",
    "tr": "Turkey",
    "ye": "Yemen",
    "ca": "Canada",
    "cn": "China",
    "gb": "United Kingdom",
    "mx": "Mexico",
    "ru": "Russia",
    "ua": "Ukraine",
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
    "dr congo": "DR Congo",
    "drc": "DR Congo",
    "congo kinshasa": "DR Congo",
    "democratic republic of the congo": "DR Congo",
    "russian federation": "Russia",
    "republic of korea": "South Korea",
    "korea republic of": "South Korea",
    "democratic people's republic of korea": "North Korea",
    "dprk": "North Korea",
    "czech republic": "Czechia",
    "ivory coast": "Côte d’Ivoire",
    "laos": "Laos",
    "lao people's democratic republic": "Laos",
    "syria": "Syria",
    "syrian arab republic": "Syria",
    "iran": "Iran",
    "moldova": "Moldova",
    "venezuela": "Venezuela",
    "venezuela, bolivarian republic of": "Venezuela",
    "bolivarian republic of venezuela": "Venezuela",
    "bolivia": "Bolivia",
    "bolivia, plurinational state of": "Bolivia",
    "plurinational state of bolivia": "Bolivia",
    "tanzania": "Tanzania",
    "tanzania, united republic of": "Tanzania",
    "united republic of tanzania": "Tanzania",
    "vietnam": "Vietnam",
    "viet nam": "Vietnam",
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
function countryNameFromCode(value) {
    const code = String(value || "").trim().toLowerCase();
    if (!code) return "";
    return COUNTRY_NAME_ALIASES[code] || "";
}
function inferCountryFromStatusText(...values) {
    const haystack = values
        .filter(Boolean)
        .join(" | ")
        .toLowerCase();
    if (!haystack) return "";
    const candidates = [...new Set([
        ...Object.values(REGION_COUNTRY_HINTS).flat(),
        "United States",
        "Canada",
        "Mexico",
        "China",
        "Russia",
        "Ukraine",
        "United Kingdom"
    ])]
        .map(normalizeCountryName)
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);
    return candidates.find((country) => haystack.includes(country.toLowerCase())) || "";
}
function statusSeverityToCyberStatus(value = "") {
    const severity = String(value || "").toLowerCase();
    if (severity === "critical") return "critical";
    if (severity === "high") return "high";
    if (severity === "low" || severity === "minor") return "normal";
    return "elevated";
}
function isCyberShutdownStatusText(text = "") {
    const haystack = String(text || "").toLowerCase();
    return (
        haystack.includes("internet outage") ||
        haystack.includes("network outage") ||
        haystack.includes("network blocking") ||
        haystack.includes("service blocking") ||
        haystack.includes("shutdown") ||
        haystack.includes("censorship") ||
        haystack.includes("communications blackout")
    );
}
function isCyberSecurityAlertText(text = "") {
    const haystack = String(text || "").toLowerCase();
    return (
        haystack.includes("cisa kev") ||
        haystack.includes("cve-") ||
        haystack.includes("known exploited vulnerab") ||
        haystack.includes("vulnerability") ||
        haystack.includes("privilege escalation") ||
        haystack.includes("remote code execution") ||
        haystack.includes("malware") ||
        haystack.includes("ransomware")
    );
}
function isCyberShutdownSignalEvent(event = {}) {
    const category = String(event.category || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const sourceName = String(event.source_name || "").toLowerCase();
    const tags = getEventTags(event);
    const text = [
        event.title,
        event.summary,
        event.location_label,
        event.report_type,
        tags.join(" ")
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (category === "network") return true;
    if (["internet_outage", "network_blocking", "network"].includes(reportType)) return true;
    if (
        sourceName.includes("cloudflare") ||
        sourceName.includes("ioda") ||
        sourceName.includes("ooni")
    ) {
        return true;
    }
    if (tags.some((tag) => ["network", "blocking", "censorship", "internet-outage"].includes(tag))) {
        return true;
    }
    return isCyberShutdownStatusText(text);
}
function isAirspaceRestrictionSignalEvent(event = {}) {
    const category = String(event.category || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const airspace = String(event.airspace_status || "").toLowerCase();
    const tags = getEventTags(event);
    return (
        (airspace && airspace !== "unknown") ||
        category === "airspace" ||
        reportType === "notam" ||
        reportType === "airspace_status" ||
        tags.includes("notam")
    );
}
function normalizeActiveAlertStatusEvent(alert = {}) {
    if (String(alert.status || "").toLowerCase() !== "active") return null;
    const category = String(alert.category || "").toLowerCase();
    const sourceName = String(alert.source_name || "").toLowerCase();
    const title = String(alert.title || "");
    const summary = String(alert.summary || "");
    const haystack = `${category} ${sourceName} ${title} ${summary}`.toLowerCase();
    const isCyber = (
        category === "cyber" ||
        category === "network" ||
        sourceName.includes("cisa") ||
        sourceName.includes("cloudflare") ||
        sourceName.includes("ioda") ||
        sourceName.includes("ooni") ||
        isCyberShutdownStatusText(haystack) ||
        isCyberSecurityAlertText(haystack)
    );
    const isAirspace = (
        category === "airspace" ||
        haystack.includes("airspace") ||
        haystack.includes("notam")
    );
    if (!isCyber && !isAirspace) return null;
    const region = alert.region || alert.location_label || "";
    const country = inferCountryFromStatusText(region, title, summary);
    const severity = String(alert.meta?.severity || alert.meta?.level || alert.category || "").toLowerCase();
    const airspaceStatus = isAirspace
        ? (severity === "critical" || severity === "red" ? "closed" : "restricted")
        : "unknown";
    const cyberStatus = isCyber ? statusSeverityToCyberStatus(alert.meta?.severity || alert.category) : "unknown";
    return normalizeEvent({
        id: `active-alert-${alert.alert_key || alert.id || title}`,
        category: isCyber ? "cyber" : "alert",
        title,
        summary,
        source_name: alert.source_name || "",
        source_url: alert.source_url || "",
        occurred_at: alert.updated_at || alert.started_at || new Date().toISOString(),
        location_label: region || country || null,
        country,
        confidence: 80,
        severity: isCyber ? cyberStatus : (airspaceStatus === "closed" ? "critical" : "high"),
        report_type: isCyber ? "network" : "airspace_status",
        airspace_status: airspaceStatus,
        cyber_status: cyberStatus,
        tags: [isCyber ? "network" : "airspace", "active-alert"].filter(Boolean)
    });
}
function normalizeAirspaceStatusEvent(row = {}) {
    const status = String(row.status || "").toLowerCase() || "unknown";
    if (!status || status === "unknown") return null;
    const expiresAt = Date.parse(row.expires_at || "");
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null;
    const country = countryNameFromCode(row.country_code) ||
        inferCountryFromStatusText(row.region, row.title, row.summary);
    return normalizeEvent({
        id: `airspace-status-${row.region || row.fir_code || row.id || row.title}`,
        category: "airspace",
        title: row.title || `${row.region || "Regional"} airspace ${status}`,
        summary: row.summary || "Airspace status update",
        source_name: row.source_name || "",
        source_url: row.source_url || "",
        occurred_at: row.updated_at || new Date().toISOString(),
        lat: row.lat,
        lon: row.lon,
        location_label: row.region || country || null,
        country,
        confidence: 85,
        severity: status === "closed" ? "critical" : status === "restricted" ? "high" : "low",
        report_type: "airspace_status",
        airspace_status: status,
        cyber_status: "unknown",
        fir_code: row.fir_code || "",
        tags: ["airspace", status].filter(Boolean)
    });
}
function dedupeStatusEvents(events = []) {
    const seen = new Set();
    const out = [];
    for (const event of events) {
        if (!event) continue;
        const key = [
            String(event.category || "").toLowerCase(),
            getEventResolvedCountry(event),
            String(event.title || "").toLowerCase(),
            String(event.airspace_status || "").toLowerCase(),
            String(event.cyber_status || "").toLowerCase()
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(event);
    }
    return out;
}
async function refreshStatusEvents() {
    const needsStatusEvents =
        isStratOpsFeatureEnabled("alerts.stickyAlerts") ||
        isStratOpsFeatureEnabled("alerts.airspaceStatus") ||
        isStratOpsFeatureEnabled("alerts.cyberStatus") ||
        isStratOpsFeatureEnabled("mapLayers.alerts") ||
        isStratOpsFeatureEnabled("mapLayers.airspace") ||
        isStratOpsFeatureEnabled("mapLayers.cyber");
    if (!needsStatusEvents) {
        __statusEventsCache = [];
        return __statusEventsCache;
    }
    const now = Date.now();
    if (
        shouldDeferBackgroundMapWork() &&
        __statusEventsCache.length &&
        !shouldRunFocusModeTask(__statusEventsLastLoadedAt, FOCUS_MODE_STATUS_REFRESH_MS)
    ) {
        return __statusEventsCache;
    }
    const results = await Promise.allSettled([
        api.getActiveAlerts(),
        api.getAirspaceStatuses ? api.getAirspaceStatuses() : Promise.resolve({ data: [], error: null })
    ]);
    const statusEvents = [];
    const alertsResult = results[0];
    if (alertsResult.status === "fulfilled" && !alertsResult.value?.error) {
        (alertsResult.value?.data || [])
            .map(normalizeActiveAlertStatusEvent)
            .filter(Boolean)
            .forEach((event) => statusEvents.push(event));
    }
    const airspaceResult = results[1];
    if (airspaceResult.status === "fulfilled" && !airspaceResult.value?.error) {
        (airspaceResult.value?.data || [])
            .map(normalizeAirspaceStatusEvent)
            .filter(Boolean)
            .forEach((event) => statusEvents.push(event));
    }
    __statusEventsCache = dedupeStatusEvents(statusEvents);
    __statusEventsLastLoadedAt = now;
    return __statusEventsCache;
}
function normalizeGnssCell(cell = {}) {
    const lat = Number(cell.lat);
    const lon = Number(cell.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
        id: String(cell.id || cell.cellId || cell.cell_id || `${lat}:${lon}`),
        cellId: String(cell.cellId || cell.cell_id || cell.id || `${lat}:${lon}`),
        lat,
        lon,
        polygon: Array.isArray(cell.polygon) ? cell.polygon : null,
        severity: String(cell.severity || "unknown").toLowerCase(),
        affectedPercent: Math.max(0, Math.min(100, Number(cell.affectedPercent ?? cell.affected_percent) || 0)),
        sampleCount: Math.max(0, Math.round(Number(cell.sampleCount ?? cell.sample_count) || 0)),
        confidence: String(cell.confidence || "low").toLowerCase(),
        country: cell.country || "Unresolved location",
        region: cell.region || "Global",
        sourceLabel: cell.sourceLabel || "GNSS Jamming Monitor",
        observedAt: cell.observedAt || cell.observed_at || cell.updatedAt || cell.updated_at || "",
        updatedAt: cell.updatedAt || cell.updated_at || cell.observedAt || cell.observed_at || "",
        isDemo: cell.isDemo === true || cell.is_demo === true,
    };
}
function getScopedGnssInterferenceCells(cells = __gnssInterferenceCellsCache) {
    return Array.isArray(cells) ? cells.slice() : [];
}
function syncGnssInterferenceLayer() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    if (!isLayerEnabled("gnss")) {
        clearGnssInterferenceLayer(viewer);
        return;
    }
    const scopedCells = getScopedGnssInterferenceCells();
    renderGnssInterferenceLayer(viewer, scopedCells, {
        visible: true,
        demoMode: __gnssInterferenceMeta.demoMode === true,
        updatedAt: __gnssInterferenceMeta.updatedAt || null,
        sourceMode: __gnssInterferenceMeta.sourceMode || "unavailable",
        liveAvailable: __gnssInterferenceMeta.liveAvailable === true,
        tableAvailable: __gnssInterferenceMeta.tableAvailable === true,
        message: __gnssInterferenceMeta.message || "",
    });
}
async function refreshGnssInterferenceCells({ force = false } = {}) {
    const now = Date.now();
    const refreshWindowMs = shouldDeferBackgroundMapWork()
        ? Math.max(GNSS_LAYER_REFRESH_MS, FOCUS_MODE_GNSS_REFRESH_MS)
        : GNSS_LAYER_REFRESH_MS;
    if (
        !force &&
        __gnssInterferenceLoadingPromise &&
        (now - __gnssInterferenceLastLoadedAt) < refreshWindowMs
    ) {
        return __gnssInterferenceLoadingPromise;
    }
    if (
        !force &&
        __gnssInterferenceCellsCache.length &&
        (now - __gnssInterferenceLastLoadedAt) < refreshWindowMs
    ) {
        syncGnssInterferenceLayer();
        return __gnssInterferenceCellsCache;
    }
    __gnssInterferenceLoadingPromise = api.getGnssInterferenceCells()
        .then(({ data, error, meta }) => {
            if (error) return __gnssInterferenceCellsCache;
            __gnssInterferenceCellsCache = Array.isArray(data)
                ? data.map((row) => normalizeGnssCell(row)).filter(Boolean)
                : [];
            __gnssInterferenceMeta = {
                demoMode: meta?.demoMode === true,
                updatedAt: meta?.updatedAt || null,
                sourceMode: meta?.sourceMode || "unavailable",
                liveAvailable: meta?.liveAvailable === true,
                tableAvailable: meta?.tableAvailable === true,
                message: meta?.message || "",
            };
            __gnssInterferenceLastLoadedAt = Date.now();
            syncGnssInterferenceLayer();
            return __gnssInterferenceCellsCache;
        })
        .catch((err) => {
            __gnssInterferenceMeta = {
                demoMode: false,
                updatedAt: null,
                sourceMode: "unavailable",
                liveAvailable: false,
                tableAvailable: true,
                message: err?.message || "GNSS Jamming endpoint is unavailable.",
            };
            __gnssInterferenceLastLoadedAt = Date.now();
            syncGnssInterferenceLayer();
            return __gnssInterferenceCellsCache;
        })
        .finally(() => {
            __gnssInterferenceLoadingPromise = null;
        });
    return __gnssInterferenceLoadingPromise;
}
function getWidgetStatusEvents(events = []) {
    const base = Array.isArray(events) ? events : [];
    const globalStatusSeed = (__allEventsCache.length ? __allEventsCache : __eventsCache)
        .filter((event) => isOperationalMapEvent(event))
        .filter((event) => isCyberShutdownSignalEvent(event) || isAirspaceRestrictionSignalEvent(event));
    return dedupeStatusEvents([
        ...base,
        ...globalStatusSeed,
        ...__statusEventsCache,
    ]);
}
function normalizePlace(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/[|]/g, ",")
        .trim();
}
function compactEventPlaceLabel(event = {}) {
    const raw =
        event.display_location_label ||
        event.location_label ||
        event.impact_label ||
        event.origin_label ||
        event.country ||
        event.region ||
        "";
    const clean = String(raw).trim();
    if (isUnknownEventDisplayValue(clean)) return "";
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
    const explicit = normalizeCountryName(event.country || event.countryName || "");
    if (explicit) return explicit;
    const coded = countryNameFromCode(event.country_code || event.countryCode || event.inferred_country_code || "");
    if (coded) return coded;
    const locationCode = countryNameFromCode(normalizePlace(event.location_label || event.locationLabel || ""));
    if (locationCode) return locationCode;
    const inferredCountry = normalizeCountryName(event.inferred_country_name || "");
    if (inferredCountry) {
        const inferredType = String(event.inferred_place_type || "").toLowerCase();
        if (["country", "capital", "subdivision", "city"].includes(inferredType)) {
            return inferredCountry;
        }
    }
    const placeType = String(event.inferred_place_type || "").toLowerCase();
    if (placeType === "country" || placeType === "capital" || placeType === "subdivision") {
        const inferred = normalizeCountryName(event.inferred_place_name || "");
        if (inferred) return inferred;
    }
    return normalizeCountryName(
        inferCountryFromStatusText(
            event.location_label,
            event.locationLabel,
            event.title,
            event.summary,
            event.source_name,
        )
    );
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
            if (category === "air_activity") points += 4;
            if (category === "naval_activity") points += 4;
            if (category === "ground_activity") points += 4;
            if (category === "recon_intel") points += 3;
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
function isStatusRelevantEvent(event = {}, type = "airspace") {
    if (type === "cyber") {
        return isCyberShutdownSignalEvent(event);
    }
    return isAirspaceRestrictionSignalEvent(event);
}
function isEventInsideRegionBounds(event = {}, region = getActiveRegion?.()) {
    if (!region || region.id === "global") return true;
    const bounds = region.bounds || {};
    const lat = Number(event.display_lat ?? event.lat ?? event.impact_lat);
    const lon = Number(event.display_lon ?? event.lon ?? event.impact_lon);
    return Number.isFinite(lat) && Number.isFinite(lon) &&
        lat >= Number(bounds.minLat) &&
        lat <= Number(bounds.maxLat) &&
        lon >= Number(bounds.minLon) &&
        lon <= Number(bounds.maxLon);
}
function getStatusScopedEvents(events = [], type = "airspace") {
    const base = (Array.isArray(events) ? events : [])
        .filter((event) => isMilitaryRelevant(event))
        .filter((event) => isStatusRelevantEvent(event, type));
    const region = getActiveRegion?.();
    if (!region || region.id === "global") return base;
    const whitelist = getRegionCountryWhitelist(region.id);
    return base.filter((event) => {
        if (isEventInsideRegionBounds(event, region)) return true;
        if (!whitelist.size) return false;
        const country = normalizeCountryName(getEventResolvedCountry(event));
        return !!country && whitelist.has(country);
    });
}
function deriveCountryStatus(events, country, type = "airspace") {
    const canonical = normalizeCountryName(country);
    const relevant = events.filter((event) =>
        getEventResolvedCountry(event) === canonical
    );
    if (!relevant.length) return "unknown";
    if (type === "cyber") {
        const cyberExplicit = relevant
            .map((e) => String(e.cyber_status || "").toLowerCase())
            .filter((s) => s && s !== "unknown");
        if (cyberExplicit.includes("critical")) return "critical";
        if (
            cyberExplicit.some((status) =>
                ["high", "degraded", "disrupted", "restricted", "warning"].includes(status)
            )
        ) {
            return "high";
        }
        if (cyberExplicit.some((status) => ["elevated", "medium"].includes(status))) {
            return "elevated";
        }
        if (cyberExplicit.some((status) => ["normal", "low", "minor"].includes(status))) {
            return "normal";
        }
        if (relevant.some((e) => ["critical", "high"].includes(String(e.severity || "").toLowerCase()))) {
            return "critical";
        }
        if (relevant.some((e) => String(e.severity || "").toLowerCase() === "medium")) {
            return "elevated";
        }
        if (
            relevant.some((e) =>
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
    return "unknown";
}
function deriveAggregateStatus(events, type = "airspace") {
    const relevant = getStatusScopedEvents(events, type);
    if (!relevant.length) return "unknown";
    if (type === "cyber") {
        const cyberExplicit = relevant
            .map((e) => String(e.cyber_status || "").toLowerCase())
            .filter((s) => s && s !== "unknown");
        if (cyberExplicit.includes("critical")) return "critical";
        if (
            cyberExplicit.some((status) =>
                ["high", "degraded", "disrupted", "restricted", "warning"].includes(status)
            )
        ) {
            return "high";
        }
        if (cyberExplicit.some((status) => ["elevated", "medium"].includes(status))) return "elevated";
        if (cyberExplicit.some((status) => ["normal", "low", "minor"].includes(status))) return "normal";
        if (relevant.some((e) => ["critical", "high"].includes(String(e.severity || "").toLowerCase()))) {
            return "critical";
        }
        if (relevant.some((e) => String(e.severity || "").toLowerCase() === "medium")) return "elevated";
        return "normal";
    }
    const airspaceExplicit = relevant
        .map((e) => String(e.airspace_status || "").toLowerCase())
        .filter((s) => s && s !== "unknown");
    if (airspaceExplicit.includes("closed")) return "closed";
    if (airspaceExplicit.includes("restricted")) return "restricted";
    if (airspaceExplicit.includes("elevated")) return "elevated";
    if (airspaceExplicit.includes("normal")) return "normal";
    return "unknown";
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
function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function stripPresentationEmoji(value = "") {
    return String(value ?? "")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function decodeBasicHtmlEntities(value = "") {
    let text = String(value ?? "");
    for (let index = 0; index < 3; index += 1) {
        const next = text
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;|&#x27;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");
        if (next === text) break;
        text = next;
    }
    return text;
}
function stripNonEnglishText(value = "", fallback = "") {
    const cleaned = String(value ?? "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
        .replace(/\b[01]{12,}\b/g, " ")
        .replace(/\b(?:0x[0-9a-f]{8,}|[a-f0-9]{24,})\b/gi, " ")
        .replace(/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{Number}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || String(fallback || "").trim();
}
function sanitizeIntelWireSummary(value = "") {
    const decoded = decodeBasicHtmlEntities(value);
    const stripped = decoded
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/\b(?:img|image)\s+width\s*["']?\d+["']?\s+height\s*["']?\d+["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:attachment|size|featured|wp-post-image|fetchpriority|decoding|async|max-width|sizes)\b[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=["'][^"']*["']/gi, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=\S+/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ");
    const leakedIndex = stripped.search(/\b(?:data-history-node-id|about=|href=|class=|src=|<article|<\/article|<p>|<\/p>)/i);
    return stripNonEnglishText((leakedIndex >= 0 ? stripped.slice(0, leakedIndex) : stripped)
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim());
}
function sanitizeIntelWireStructuredText(value = "") {
    const decoded = decodeBasicHtmlEntities(value)
        .replace(/\r\n?/g, "\n")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/?(?:p|div|article|section|header|footer|aside|blockquote|h[1-6]|figure|figcaption|table|tr)\b[^>]*>/gi, "\n\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=["'][^"']*["']/gi, " ")
        .replace(/\b(?:class|href|style|src|srcset|about|rel|target|data-[a-z0-9_-]+|aria-[a-z0-9_-]+|id)=\S+/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");

    const cleanedLines = decoded
        .split("\n")
        .map((line) => stripNonEnglishText(line, ""))
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const paragraphs = [];
    for (const line of cleanedLines) {
        if (/^-\s+/.test(line)) {
            paragraphs.push(line);
            continue;
        }
        const previous = paragraphs[paragraphs.length - 1] || "";
        if (previous && !/^-\s+/.test(previous) && previous.length < 120 && !/[.!?:;]$/.test(previous)) {
            paragraphs[paragraphs.length - 1] = `${previous} ${line}`.trim();
        } else {
            paragraphs.push(line);
        }
    }
    return paragraphs.join("\n\n").trim();
}
function isIntelWireMediaEnabled() {
    return window.__stratopsConfig?.enableIntelWireMedia !== false;
}
function isLocalNetworkMediaHost(hostname = "") {
    const host = String(hostname || "").trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "::1" || host === "[::1]") return true;
    if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}
function getIntelWireMediaBaseUrl() {
    const isLocalPage = typeof isLocalHostName === "function"
        ? isLocalHostName(window.location.hostname)
        : ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(window.location.hostname || "").toLowerCase());
    const configured = String(
        window.__stratopsConfig?.intelFeedMediaBase
        || window.__stratopsConfig?.intelFeedApiBase
        || window.__stratopsConfig?.apiBase
        || (isLocalPage ? "/api" : "https://api.battlespacex.com")
    ).trim();
    if (!configured) return window.location.origin;
    try {
        return new URL(configured, window.location.origin).href.replace(/\/+$/, "");
    } catch {
        return window.location.origin;
    }
}
function resolveIntelWireMediaUrl(value = "") {
    const raw = String(value || "").trim();
    if (!raw || /^(?:data|blob|javascript):/i.test(raw)) return "";
    try {
        if (/^\/\//.test(raw)) return `${window.location.protocol}${raw}`;
        if (/^https?:\/\//i.test(raw)) return new URL(raw).href;
        const base = `${getIntelWireMediaBaseUrl().replace(/\/+$/, "")}/`;
        return new URL(raw.replace(/^\/+/, ""), base).href;
    } catch {
        return "";
    }
}
function isPublicRenderableMediaUrl(value = "") {
    const resolved = resolveIntelWireMediaUrl(value);
    if (!resolved) return false;
    try {
        const url = new URL(resolved);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        const isLocalPage = typeof isLocalHostName === "function" && isLocalHostName(window.location.hostname);
        if (!isLocalPage && isLocalNetworkMediaHost(url.hostname)) return false;
        if (window.location.protocol === "https:" && url.protocol !== "https:" && !isLocalPage) return false;
        return true;
    } catch {
        return false;
    }
}
function normalizeIntelWireImageEntry(entry = {}, fallbackTitle = "") {
    const value = typeof entry === "string" ? { fullUrl: entry } : entry;
    if (!value || typeof value !== "object") return null;
    const thumbUrl = resolveIntelWireMediaUrl(
        value.thumbUrl
        || value.thumb_url
        || value.thumbnail
        || value.thumbnailUrl
        || value.thumbnail_url
        || value.previewUrl
        || value.preview_url
        || value.fullUrl
        || value.full_url
        || value.url
        || value.src
        || ""
    );
    const fullUrl = resolveIntelWireMediaUrl(
        value.fullUrl
        || value.full_url
        || value.url
        || value.src
        || thumbUrl
        || ""
    );
    const renderUrl = isPublicRenderableMediaUrl(thumbUrl) ? thumbUrl : fullUrl;
    if (!isPublicRenderableMediaUrl(renderUrl)) return null;
    return {
        thumbUrl: renderUrl,
        fullUrl: isPublicRenderableMediaUrl(fullUrl) ? fullUrl : renderUrl,
        alt: sanitizeEventPopupText(value.alt || value.title || fallbackTitle || "Intel Wire image", "Intel Wire image") || "Intel Wire image",
        width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
        height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
    };
}
function normalizeIntelWireVideoEntry(entry = {}, fallbackTitle = "") {
    const value = typeof entry === "string" ? { videoUrl: entry } : entry;
    if (!value || typeof value !== "object") return null;
    const videoUrl = resolveIntelWireMediaUrl(
        value.videoUrl
        || value.video_url
        || value.mediaUrl
        || value.media_url
        || value.src
        || value.url
        || ""
    );
    const embedUrl = resolveIntelWireMediaUrl(value.embedUrl || value.embed_url || "");
    const thumbUrl = resolveIntelWireMediaUrl(
        value.thumbUrl
        || value.thumb_url
        || value.thumbnail
        || value.thumbnailUrl
        || value.thumbnail_url
        || value.previewUrl
        || value.preview_url
        || value.poster
        || ""
    );
    const safeVideoUrl = isPublicRenderableMediaUrl(videoUrl) ? videoUrl : "";
    const safeEmbedUrl = isPublicRenderableMediaUrl(embedUrl) ? embedUrl : "";
    if (!safeVideoUrl && !safeEmbedUrl) return null;
    return {
        videoUrl: safeVideoUrl,
        embedUrl: safeEmbedUrl,
        thumbUrl: isPublicRenderableMediaUrl(thumbUrl) ? thumbUrl : "",
        title: sanitizeEventPopupText(value.title || fallbackTitle || "Intel Wire video", "Intel Wire video") || "Intel Wire video",
        duration: sanitizeEventPopupText(value.duration || "", ""),
    };
}
function dedupeIntelWireMediaEntries(entries = [], keyResolver = () => "") {
    const seen = new Set();
    return entries.filter((entry) => {
        const key = String(keyResolver(entry) || "").trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function getIntelWireItemMedia(event = {}) {
    if (!isIntelWireMediaEnabled()) return { images: [], videos: [] };
    const mediaCandidates = [
        event.media,
        event.metadata?.media,
        event.raw?.stratops_media,
        event.raw?.media,
        event.metadata?.raw?.stratops_media,
    ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
    const fallbackTitle = event.display_title || event.title || "";
    const rawImages = mediaCandidates.flatMap((media) => Array.isArray(media.images) ? media.images : []);
    const rawVideos = mediaCandidates.flatMap((media) => Array.isArray(media.videos) ? media.videos : []);
    const images = dedupeIntelWireMediaEntries(
        rawImages.map((entry) => normalizeIntelWireImageEntry(entry, fallbackTitle)).filter(Boolean),
        (entry) => entry.fullUrl || entry.thumbUrl
    );
    const videos = dedupeIntelWireMediaEntries(
        rawVideos.map((entry) => normalizeIntelWireVideoEntry(entry, fallbackTitle)).filter(Boolean),
        (entry) => entry.embedUrl || entry.videoUrl
    );
    return { images, videos };
}
function getIntelWireMediaState(itemId = "") {
    const key = String(itemId || "").trim();
    if (!key) {
        return {
            allOpen: false,
            imagesOpen: false,
            videosOpen: false,
            activeVideoIndex: -1,
        };
    }
    if (!__intelWireMediaState.has(key)) {
        __intelWireMediaState.set(key, {
            allOpen: false,
            imagesOpen: false,
            videosOpen: false,
            activeVideoIndex: -1,
        });
    }
    const state = __intelWireMediaState.get(key);
    if (typeof state.allOpen !== "boolean") state.allOpen = false;
    if (!Number.isInteger(state.activeVideoIndex)) state.activeVideoIndex = -1;
    return state;
}
function getIntelWireMediaPanelId(itemId = "", panel = "") {
    return `wz-feed-media-${panel}-${String(itemId || "").replace(/[^a-z0-9_-]+/gi, "-")}`;
}
function getIntelWireMediaGridClass(prefix = "", count = 0, layoutMode = "collapsed") {
    const clamped = Math.max(1, Math.min(4, Number(count) || 1));
    return `${prefix} ${prefix}--count-${clamped} ${prefix}--${layoutMode === "expanded" ? "expanded" : "collapsed"}`;
}
function isIntelWireCardExpanded(card) {
    return card?.closest?.(".warzone-widget--feed")?.classList?.contains?.("is-feed-expanded") === true;
}
function formatIntelWireMediaToggleLabel(hiddenCount = 0, isOpen = false) {
    if (isOpen) return "Show less";
    return `+${Math.max(1, Number(hiddenCount) || 1)} more`;
}
function buildIntelWireMediaIcon(kind = "image") {
    if (kind === "video") {
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 6.5C4 5.672 4.672 5 5.5 5h8C14.328 5 15 5.672 15 6.5v11c0 .828-.672 1.5-1.5 1.5h-8A1.5 1.5 0 0 1 4 17.5z"></path>
                <path d="M16 10.1l3.615-2.41A.9.9 0 0 1 21 8.439v7.122a.9.9 0 0 1-1.385.75L16 13.9z"></path>
            </svg>
        `;
    }
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5z"></path>
            <circle cx="8.25" cy="9" r="1.45"></circle>
            <path d="M6.2 17l3.7-4.2 2.75 2.85 1.95-2.25L17.8 17z"></path>
        </svg>
    `;
}
function buildIntelWireImagePanelMarkup(event = {}, images = [], options = {}) {
    const visibleImages = Array.isArray(images) ? images : [];
    if (!visibleImages.length) return "";
    const layoutMode = options.expanded === true ? "expanded" : "collapsed";
    const gridClass = getIntelWireMediaGridClass("wz-feed-media-grid", visibleImages.length, layoutMode);
    return `
        <div class="${gridClass}">
            ${visibleImages.map((entry, index) => `
                <figure class="wz-feed-media-card wz-feed-media-card--image" data-media-kind="image" data-media-index="${index}">
                    <img
                        class="wz-feed-media-thumb"
                        src="${escapeHtml(entry.thumbUrl || entry.fullUrl || "")}"
                        ${entry.fullUrl ? `data-fallback-src="${escapeHtml(entry.fullUrl)}"` : ""}
                        ${entry.width ? `width="${Math.max(1, Number(entry.width) || 0)}"` : ""}
                        ${entry.height ? `height="${Math.max(1, Number(entry.height) || 0)}"` : ""}
                        alt="${escapeHtml(stripPresentationEmoji(entry.alt || event.title || "Intel Wire image") || "Intel Wire image")}"
                        loading="lazy"
                        decoding="async">
                </figure>
            `).join("")}
        </div>
    `;
}
function buildIntelWireVideoPanelMarkup(event = {}, videos = [], state = {}, options = {}) {
    const visibleVideos = Array.isArray(videos) ? videos : [];
    if (!visibleVideos.length) return "";
    const layoutMode = options.expanded === true ? "expanded" : "collapsed";
    const gridClass = getIntelWireMediaGridClass("wz-feed-video-grid", visibleVideos.length, layoutMode);
    const activeVideoIndex = Number.isInteger(state.activeVideoIndex) ? state.activeVideoIndex : -1;
    const forcePlayers = options.expanded === true;
    return `
        <div class="${gridClass}">
            ${visibleVideos.map((entry, index) => {
        const isActive = forcePlayers || activeVideoIndex === index;
        const title = stripPresentationEmoji(entry.title || event.title || `Video ${index + 1}`) || `Video ${index + 1}`;
        if (isActive) {
            if (entry.embedUrl) {
                return `
                            <div class="wz-feed-video-card wz-feed-video-card--active" data-media-kind="video" data-media-index="${index}">
                                <iframe
                                    class="wz-feed-video-embed"
                                    src="${escapeHtml(entry.embedUrl)}"
                                    title="${escapeHtml(title)}"
                                    loading="lazy"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    referrerpolicy="strict-origin-when-cross-origin"
                                    allowfullscreen></iframe>
                            </div>
                        `;
            }
            return `
                        <div class="wz-feed-video-card wz-feed-video-card--active" data-media-kind="video" data-media-index="${index}">
                            <video
                                class="wz-feed-video-player"
                                src="${escapeHtml(entry.videoUrl || "")}"
                                ${entry.thumbUrl ? `poster="${escapeHtml(entry.thumbUrl)}"` : ""}
                                controls
                                playsinline
                                preload="metadata"></video>
                        </div>
                    `;
        }
        const thumbUrl = String(entry.thumbUrl || "").trim();
        const thumbMarkup = thumbUrl
            ? `<img class="wz-feed-video-thumb" src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async">`
            : `<div class="wz-feed-video-thumb wz-feed-video-thumb--placeholder" aria-hidden="true"></div>`;
        return `
                    <button
                        type="button"
                        class="wz-feed-video-card"
                        data-feed-video-play="${index}"
                        aria-label="Play ${escapeHtml(title)}"
                        title="Play ${escapeHtml(title)}">
                        ${thumbMarkup}
                        <span class="wz-feed-video-play" aria-hidden="true"></span>
                        <span class="wz-feed-video-meta">
                            <strong>${escapeHtml(title)}</strong>
                            ${entry.duration ? `<small>${escapeHtml(entry.duration)}</small>` : ""}
                        </span>
                    </button>
                `;
    }).join("")}
        </div>
    `;
}
function stopIntelWireCardMedia(card) {
    if (!card) return;
    card.querySelectorAll("video").forEach((video) => {
        try {
            video.pause();
        } catch { }
        try {
            video.removeAttribute("src");
            video.load();
        } catch { }
    });
    card.querySelectorAll("iframe.wz-feed-video-embed").forEach((frame) => {
        try {
            frame.src = "about:blank";
        } catch { }
    });
}
function normalizeIntelWireComparisonText(value = "") {
    return sanitizeIntelWireSummary(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(?:the|a|an|and|or|of|in|on|to|for|at|by|with|from)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isMeaningfulIntelWireText(value = "") {
    const clean = sanitizeIntelWireSummary(value);
    if (!clean || /^[\s.,:;|/\\_-]+$/.test(clean)) return false;
    const words = clean.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
    const letters = (clean.match(/[A-Za-z]/g) || []).length;
    return letters >= 8 && words.length >= 3;
}
function stripIntelWireMetadataEcho(value = "", metadataValues = []) {
    let clean = sanitizeIntelWireSummary(value);
    for (const metadataValue of metadataValues) {
        const meta = sanitizeIntelWireSummary(metadataValue);
        if (!meta) continue;
        const cleanKey = normalizeIntelWireComparisonText(clean);
        const metaKey = normalizeIntelWireComparisonText(meta);
        if (cleanKey && cleanKey === metaKey) return "";
        const escaped = meta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        clean = clean
            .replace(new RegExp(`^${escaped}[\\s:;|,.-]*`, "i"), "")
            .replace(new RegExp(`[\\s:;|,.-]*${escaped}$`, "i"), "")
            .trim();
    }
    return clean;
}
function hasMeaningfulIntelWireAdditionalText(fullText = "", summaryText = "") {
    if (!isMeaningfulIntelWireText(fullText)) return false;
    const fullKey = normalizeIntelWireComparisonText(fullText);
    const summaryKey = normalizeIntelWireComparisonText(summaryText);
    if (!summaryKey) return fullKey.length >= 80;
    if (!fullKey || fullKey === summaryKey) return false;
    if (summaryKey.includes(fullKey)) return false;
    const summaryWords = new Set(summaryKey.split(" ").filter(Boolean));
    const additionalWords = fullKey.split(" ").filter((word) => word && !summaryWords.has(word));
    return fullText.length >= summaryText.length + 80 && additionalWords.length >= 8;
}
function getMeaningfulIntelWireLocation(event = {}) {
    const location = sanitizeEventPopupText(compactEventPlaceLabel(event), "");
    return isMeaningfulIntelWireText(location) ? location : "";
}
function getIntelWireFullText(event = {}, title = "") {
    const sourceName = sanitizeEventPopupText(event.display_source_name || event.source_name || "", "");
    const location = getMeaningfulIntelWireLocation(event);
    const candidates = [
        event.full_content,
        event.fullContent,
        event.content,
        event.description,
        event.metadata?.full_content,
        event.metadata?.fullContent,
        event.raw?.stratops_full_content,
        event.raw?.full_content,
        event.raw?.contentEncoded,
        event.raw?.["content:encoded"],
        event.display_summary,
        event.summary,
    ]
        .map((value) => sanitizeIntelWireStructuredText(value))
        .filter(Boolean)
        .map((value) => stripRepeatedEventTitle(value, title))
        .map((value) => stripIntelWireMetadataEcho(value, [sourceName, location]))
        .filter(isMeaningfulIntelWireText)
        .sort((a, b) => b.length - a.length);
    return candidates[0] || "";
}
function formatIntelWireDisplayTime(value, now = Date.now()) {
    const timestamp = new Date(value || "").getTime();
    if (!Number.isFinite(timestamp)) return formatTime(value);
    const deltaMs = Math.max(0, Number(now) - timestamp);
    const maxRelativeMs = 24 * 60 * 60 * 1000;
    if (deltaMs <= maxRelativeMs) {
        const totalMinutes = Math.max(1, Math.floor(deltaMs / 60000));
        if (totalMinutes < 60) {
            return `${totalMinutes} ${totalMinutes === 1 ? "min" : "mins"} ago`;
        }
        const totalHours = Math.max(1, Math.min(24, Math.floor(deltaMs / 3600000)));
        return `${totalHours} ${totalHours === 1 ? "hr" : "hrs"} ago`;
    }
    return formatTime(value);
}
function refreshIntelWireRelativeTimes(root = document) {
    root?.querySelectorAll?.("[data-intel-wire-time]").forEach((timeEl) => {
        const value = String(timeEl.getAttribute("data-intel-wire-time") || timeEl.getAttribute("datetime") || "").trim();
        if (!value) return;
        const nextText = formatIntelWireDisplayTime(value);
        if (timeEl.textContent !== nextText) timeEl.textContent = nextText;
    });
}
function startIntelWireRelativeTimeLoop() {
    refreshIntelWireRelativeTimes(document);
    if (__intelWireRelativeTimeInterval) return;
    __intelWireRelativeTimeInterval = window.setInterval(() => {
        if (isDocumentHidden()) return;
        refreshIntelWireRelativeTimes(document);
    }, INTEL_WIRE_RELATIVE_TIME_REFRESH_MS);
}
function getIntelWireCardRenderSignature(event = {}) {
    const media = getIntelWireItemMedia(event);
    const satelliteContext = getEventSatelliteContext(event);
    return JSON.stringify([
        event.updated_at || "",
        event.occurred_at || "",
        event.category || "",
        event.severity || "",
        getIntelWireVerificationState(event),
        event.source_name || "",
        event.source_url || "",
        event.title || "",
        event.summary || "",
        event.full_content || event.content || event.description || "",
        compactEventPlaceLabel(event),
        media.images,
        media.videos,
        satelliteContext?.status || "",
        satelliteContext?.imageUrl || "",
        satelliteContext?.updatedAt || "",
    ]);
}
function getIntelWireEventDomKey(event = {}, index = 0) {
    return String(
        event.id
        || event.source_url
        || `${event.source_name || "intel"}:${event.occurred_at || "unknown"}:${event.title || index}`
    );
}
function splitIntelWireLongParagraph(value = "") {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= 760) return text ? [text] : [];
    const sentences = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [text];
    const paragraphs = [];
    let current = "";
    for (const sentenceValue of sentences) {
        const sentence = String(sentenceValue || "").trim();
        if (!sentence) continue;
        if (current && (current.length + sentence.length > 620 || (current.match(/[.!?]/g) || []).length >= 3)) {
            paragraphs.push(current.trim());
            current = sentence;
        } else {
            current = `${current} ${sentence}`.trim();
        }
    }
    if (current) paragraphs.push(current.trim());
    return paragraphs;
}
function buildIntelWireDetailContentMarkup(value = "") {
    const structured = sanitizeIntelWireStructuredText(value);
    if (!structured) return "";
    const blocks = structured
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
    const markup = [];
    let bulletItems = [];
    const flushBullets = () => {
        if (!bulletItems.length) return;
        markup.push(`<ul>${bulletItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
        bulletItems = [];
    };
    for (const block of blocks) {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
            if (/^-\s+/.test(line)) {
                bulletItems.push(line.replace(/^-\s+/, "").trim());
                continue;
            }
            flushBullets();
            const isHeading =
                line.length <= 92 &&
                !/[.!?]$/.test(line) &&
                (/^[A-Z0-9][A-Z0-9\s/&:–—-]{5,}$/.test(line) || /^(?:Background|Overview|Key points?|Capabilities|Assessment|Analysis|Impact|Details|Context|What this means)$/i.test(line));
            if (isHeading) {
                markup.push(`<h3>${escapeHtml(line)}</h3>`);
                continue;
            }
            splitIntelWireLongParagraph(line).forEach((paragraph) => {
                markup.push(`<p>${escapeHtml(paragraph)}</p>`);
            });
        }
    }
    flushBullets();
    return markup.join("");
}
function buildIntelWireDetailMediaMarkup(event = {}) {
    const media = getIntelWireItemMedia(event);
    const entries = [
        ...media.images.map((entry, index) => {
            const targetUrl = entry.fullUrl || entry.thumbUrl;
            return `
                <a
                    class="wz-intel-wire-detail__media-card wz-intel-wire-detail__media-card--image"
                    href="${escapeHtml(targetUrl)}"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open image ${index + 1} in a new tab">
                    <img
                        src="${escapeHtml(entry.thumbUrl || targetUrl)}"
                        ${entry.fullUrl ? `data-fallback-src="${escapeHtml(entry.fullUrl)}"` : ""}
                        alt="${escapeHtml(entry.alt || event.title || `Intel Wire image ${index + 1}`)}"
                        loading="lazy"
                        decoding="async">
                </a>
            `;
        }),
        ...media.videos.map((entry, index) => {
            const title = entry.title || event.title || `Intel Wire video ${index + 1}`;
            if (entry.embedUrl) {
                return `
                    <div class="wz-intel-wire-detail__media-card wz-intel-wire-detail__media-card--video">
                        <iframe
                            src="${escapeHtml(entry.embedUrl)}"
                            title="${escapeHtml(title)}"
                            loading="lazy"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            referrerpolicy="strict-origin-when-cross-origin"
                            allowfullscreen></iframe>
                    </div>
                `;
            }
            return `
                <div class="wz-intel-wire-detail__media-card wz-intel-wire-detail__media-card--video">
                    <video
                        src="${escapeHtml(entry.videoUrl || "")}"
                        ${entry.thumbUrl ? `poster="${escapeHtml(entry.thumbUrl)}"` : ""}
                        controls
                        playsinline
                        preload="metadata"></video>
                </div>
            `;
        }),
    ];
    if (!entries.length) return "";
    return `
        <section class="wz-intel-wire-detail__media" aria-labelledby="wz-intel-wire-detail-media-title">
            <h3 id="wz-intel-wire-detail-media-title">Media</h3>
            <div class="wz-intel-wire-detail__media-grid">
                ${entries.join("")}
            </div>
        </section>
    `;
}
function ensureIntelWireDetailModal() {
    let modal = document.getElementById("wz-intel-wire-detail-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "wz-intel-wire-detail-modal";
        modal.className = "wz-modal wz-intel-wire-detail-modal";
        modal.hidden = true;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-hidden", "true");
        modal.setAttribute("aria-labelledby", "wz-intel-wire-detail-title");
        modal.setAttribute("aria-describedby", "wz-intel-wire-detail-content");
        document.body.appendChild(modal);
    }
    if (!__intelWireDetailModalBound) {
        __intelWireDetailModalBound = true;
        modal.addEventListener("click", (event) => {
            const closeTarget = event.target?.closest?.("[data-intel-wire-modal-close]");
            if (!closeTarget) return;
            event.preventDefault();
            event.stopPropagation();
            closeIntelWireDetailModal();
        });
        modal.addEventListener("error", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement)) return;
            const fallbackSrc = String(target.dataset.fallbackSrc || "").trim();
            const currentSrc = String(target.currentSrc || target.src || "").trim();
            if (fallbackSrc && target.dataset.fallbackTried !== "1" && currentSrc !== fallbackSrc) {
                target.dataset.fallbackTried = "1";
                target.src = fallbackSrc;
                return;
            }
            target.closest(".wz-intel-wire-detail__media-card")?.classList.add("is-media-unavailable");
        }, true);
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            const activeModal = document.getElementById("wz-intel-wire-detail-modal");
            if (!activeModal || activeModal.hidden || !activeModal.classList.contains("is-visible")) return;
            event.preventDefault();
            closeIntelWireDetailModal();
        });
    }
    return modal;
}
function closeIntelWireDetailModal() {
    const modal = document.getElementById("wz-intel-wire-detail-modal");
    if (!modal || modal.hidden) return;
    modal.querySelectorAll("video").forEach((video) => {
        try {
            video.pause();
        } catch { }
    });
    modal.querySelectorAll("iframe").forEach((frame) => {
        try {
            frame.src = "about:blank";
        } catch { }
    });
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("wz-intel-wire-detail-open");
    const priorTimer = Number(modal.dataset.hideTimer || 0);
    if (priorTimer) window.clearTimeout(priorTimer);
    const timer = window.setTimeout(() => {
        modal.hidden = true;
        modal.innerHTML = "";
        modal.dataset.hideTimer = "";
    }, 220);
    modal.dataset.hideTimer = String(timer);
    const focusTarget = __intelWireDetailModalLastFocusedElement;
    __intelWireDetailModalLastFocusedElement = null;
    focusTarget?.focus?.({ preventScroll: true });
}
function openIntelWireDetailModal(event = {}, trigger = null) {
    const modal = ensureIntelWireDetailModal();
    const priorTimer = Number(modal.dataset.hideTimer || 0);
    if (priorTimer) {
        window.clearTimeout(priorTimer);
        modal.dataset.hideTimer = "";
    }
    const categoryLabel = getPlatformCategoryLabel(event, {
        surface: "intel-wire",
        uppercase: true,
        fallback: "INTEL",
    });
    const categoryClass = getPlatformCategoryClass(event, { surface: "intel-wire" });
    const severityClass = getPlatformSeverityClass(event.severity || "medium");
    const severityLabel = getPlatformSeverityLabel(event.severity || "", "Medium");
    const verificationState = getIntelWireVerificationState(event);
    const location = sanitizeEventPopupText(compactEventPlaceLabel(event), "");
    const fallbackTitle = location
        ? `${toUiLabel(categoryClass, "Activity")} report near ${location}`
        : `${toUiLabel(categoryClass, "Activity")} report`;
    const title = sanitizeEventPopupText(event.display_title || event.title || "", "") || fallbackTitle;
    const fullText = getIntelWireFullText(event, title);
    const sourceName = sanitizeEventPopupText(event.display_source_name || event.source_name || "", "");
    const sourceUrl = /^https?:\/\//i.test(String(event.source_url || "").trim())
        ? String(event.source_url || "").trim()
        : "";
    const occurredAt = String(event.occurred_at || event.published_at || "").trim();
    const confidenceValue = event.confidence_score ?? event.confidence ?? event.metadata?.confidence_score;
    const confidenceText = Number.isFinite(Number(confidenceValue))
        ? `Confidence ${Math.round(Number(confidenceValue))}`
        : "";
    const contentMarkup = buildIntelWireDetailContentMarkup(fullText);
    const mediaMarkup = buildIntelWireDetailMediaMarkup(event);
    const sourceMeta = sourceName
        ? `<span class="wz-intel-wire-detail__source">${escapeHtml(sourceName)}</span>`
        : "";
    modal.innerHTML = `
        <div class="wz-intel-wire-detail__backdrop" data-intel-wire-modal-close aria-hidden="true"></div>
        <div class="wz-modal-box wz-max-modal wz-intel-wire-detail__box" role="document">
            <div class="wz-modal-inner">
                <header class="wz-intel-wire-detail__header">
                    <div class="wz-intel-wire-detail__heading">
                        <p class="wz-intel-wire-detail__eyebrow">Intel Wire</p>
                        <h2 id="wz-intel-wire-detail-title">${escapeHtml(title)}</h2>
                        <div class="wz-intel-wire-detail__meta">
                            <span class="feed-pill feed-pill--${escapeHtml(categoryClass)}" data-category="${escapeHtml(categoryClass)}">${escapeHtml(categoryLabel)}</span>
                            <span class="feed-pill feed-pill--severity feed-pill--severity-${escapeHtml(severityClass)}" data-severity="${escapeHtml(severityClass)}">${escapeHtml(severityLabel)}</span>
                            <span class="feed-pill" data-verification-state="${escapeHtml(verificationState.toLowerCase())}">${escapeHtml(verificationState)}</span>
                            ${occurredAt ? `<time datetime="${escapeHtml(occurredAt)}" data-intel-wire-time="${escapeHtml(occurredAt)}">${escapeHtml(formatIntelWireDisplayTime(occurredAt))}</time>` : ""}
                            ${sourceMeta}
                            ${confidenceText ? `<span>${escapeHtml(confidenceText)}</span>` : ""}
                        </div>
                    </div>
                    <div class="wz-close-modal">
                        <button
                            type="button"
                            class="static-icon stratops-ico-close-1 "
                            data-intel-wire-modal-close
                            aria-label="Close full Intel Wire report"
                            title="Close">
                        </button>
                    </div>
                </header>
                <div class="wz-modal-body wz-intel-wire-detail__body">
                    <div id="wz-intel-wire-detail-content" class="wz-intel-wire-detail__content">${contentMarkup}</div>
                    ${location ? `<p class="wz-intel-wire-detail__location"><strong>Location:</strong> ${escapeHtml(location)}</p>` : ""}
                    ${mediaMarkup}
                </div>
                ${sourceUrl ? `
                    <footer class="wz-intel-wire-detail__footer">
                        <span>${sourceName ? `Source: ${escapeHtml(sourceName)}` : "Original source available"}</span>
                        <a class="btn-primary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">
                            <span>Open source</span>
                        </a>
                    </footer>
                ` : ""}
            </div>
        </div>
    `;
    __intelWireDetailModalLastFocusedElement = trigger instanceof HTMLElement ? trigger : document.activeElement;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("wz-intel-wire-detail-open");
    refreshIntelWireRelativeTimes(modal);
    requestAnimationFrame(() => {
        modal.classList.add("is-visible");
        modal.querySelector(".wz-intel-wire-detail__close")?.focus?.({ preventScroll: true });
    });
}
function syncIntelWireReadFullControl(card, event = {}) {
    if (!card) return;

    const summaryEl = card.querySelector(".wz-feed-summary");
    const button = card.querySelector("[data-intel-wire-read-full]");

    if (!summaryEl || !button) return;

    const title = sanitizeEventPopupText(
        event.display_title || event.title || "",
        ""
    );

    const summaryText = String(summaryEl.textContent || "").trim();
    const fullText = getIntelWireFullText(event, title);
    const isExpanded = isIntelWireCardExpanded(card);

    const hasLayout = summaryEl.clientHeight > 0;

    const visuallyTrimmed = hasLayout
        ? summaryEl.scrollHeight > summaryEl.clientHeight + 3
        : summaryText.length > 280;

    const hasAdditionalText =
        hasMeaningfulIntelWireAdditionalText(fullText, summaryText);

    const canReadFullText =
        isMeaningfulIntelWireText(fullText) &&
        (
            hasAdditionalText ||
            (!isExpanded && visuallyTrimmed)
        );

    button.hidden = !canReadFullText;
}
function syncVisibleIntelWireReadFullControls() {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;
    feed.querySelectorAll(".wz-feed-item").forEach((card) => {
        const itemId = String(card.dataset.eventId || "");
        const event = __intelWireRenderedItems.get(itemId);
        if (event) syncIntelWireReadFullControl(card, event);
    });
}
function createIntelWireFeedCard(event = {}, eventId = "") {
    const card = document.createElement("article");
    card.className = "timeline-item wz-feed-item";
    card.dataset.eventId = eventId;
    card.dataset.renderSignature = getIntelWireCardRenderSignature(event);
    const categoryLabel = getPlatformCategoryLabel(event, {
        surface: "intel-wire",
        uppercase: true,
        fallback: "INTEL",
    });
    const categoryClass = getPlatformCategoryClass(event, { surface: "intel-wire" });
    const severityClass = getPlatformSeverityClass(event.severity || "medium");
    const severityLabel = getPlatformSeverityLabel(event.severity || "", "Medium");
    const verificationState = getIntelWireVerificationState(event);
    card.dataset.category = categoryClass;
    card.dataset.severity = severityClass;
    const safeUrl = /^https?:\/\//i.test(event.source_url || "") ? event.source_url : "";
    const sourceName = sanitizeEventPopupText(event.display_source_name || event.source_name || "", "");
    const rawSummary = sanitizeIntelWireSummary(event.display_summary || event.summary || "");
    const locationCandidate = sanitizeEventPopupText(
        compactEventPlaceLabel(event),
        ""
    );

    const location = /[A-Za-z0-9]/.test(locationCandidate)
        ? locationCandidate
        : "";
    const fallbackTitle = location
        ? `${toUiLabel(categoryClass, "Activity")} report near ${location}`
        : `${toUiLabel(categoryClass, "Activity")} report`;
    const title = sanitizeEventPopupText(event.display_title || event.title || "", "") || fallbackTitle;
    const summary = stripRepeatedEventTitle(rawSummary, title);
    const sourceMarkup = safeUrl
        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceName)}</a>`
        : `${escapeHtml(sourceName)}`;
    const satelliteMarkup = buildIntelWireSatelliteMarkup(event);
    const occurredAt = String(event.occurred_at || event.published_at || "").trim();
    if (satelliteMarkup) card.dataset.satelliteContext = "available";
    card.innerHTML = `
        <div class="timeline-time wz-feed-time">
            <div class="wz-feed-capsule">
                <span class="feed-pill feed-pill--${escapeHtml(categoryClass)}" data-category="${escapeHtml(categoryClass)}">${escapeHtml(categoryLabel)}</span>
                <span class="feed-pill feed-pill--severity feed-pill--severity-${escapeHtml(severityClass)}" data-severity="${escapeHtml(severityClass)}">${escapeHtml(severityLabel)}</span>
                <span class="feed-pill" data-verification-state="${escapeHtml(verificationState.toLowerCase())}">${escapeHtml(verificationState)}</span>
            </div>
            ${occurredAt ? `<time datetime="${escapeHtml(occurredAt)}" data-intel-wire-time="${escapeHtml(occurredAt)}">${escapeHtml(formatIntelWireDisplayTime(occurredAt))}</time>` : ""}
            ${sourceName ? `<small class="wz-feed-source">${sourceMarkup}</small>` : ""}
        </div>
        <div class="timeline-body">
            <strong class="wz-feed-title">${escapeHtml(title)}</strong>
            ${summary ? `
                <p class="wz-feed-summary">${escapeHtml(summary)}</p>
                <button
                    type="button"
                    class="wz-feed-read-full btn-secondary white"
                    data-intel-wire-read-full
                    hidden
                    aria-label="Read the complete Intel Wire report">
                    <span aria-hidden="true"></span>
                    <span>Read full</span>
                </button>
            ` : ""}
            ${location ? `<small class="wz-feed-location">${escapeHtml(location)}</small>` : ""}
            ${satelliteMarkup}
            <div class="wz-feed-media-panel wz-feed-media-panel--images" data-feed-image-panel hidden></div>
            <div class="wz-feed-media-panel wz-feed-media-panel--videos" data-feed-video-panel hidden></div>
            <div class="wz-feed-actions" data-feed-media-actions hidden></div>
        </div>
    `;
    renderIntelWireMediaCard(card, event, eventId);
    return card;
}
function rerenderVisibleIntelWireMediaCards() {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;
    feed.querySelectorAll(".wz-feed-item").forEach((card) => {
        const itemId = String(card?.dataset?.eventId || "");
        const feedItem = __intelWireRenderedItems.get(itemId);
        if (!feedItem) return;
        renderIntelWireMediaCard(card, feedItem, itemId);
    });
}
function renderIntelWireMediaCard(card, event = {}, eventId = "") {
    if (!card) return;
    const actionHost = card.querySelector("[data-feed-media-actions]");
    const imageHost = card.querySelector("[data-feed-image-panel]");
    const videoHost = card.querySelector("[data-feed-video-panel]");
    if (!actionHost || !imageHost || !videoHost) return;
    const media = getIntelWireItemMedia(event);
    const imageCount = media.images.length;
    const videoCount = media.videos.length;
    const totalCount = imageCount + videoCount;
    const stableItemId = String(eventId || card.dataset.eventId || getIntelWireEventDomKey(event)).trim();
    const state = getIntelWireMediaState(stableItemId);
    const isExpanded = isIntelWireCardExpanded(card);
    if (!isIntelWireMediaEnabled() || totalCount <= 0) {
        stopIntelWireCardMedia(card);
        actionHost.hidden = true;
        actionHost.innerHTML = "";
        imageHost.hidden = true;
        imageHost.innerHTML = "";
        videoHost.hidden = true;
        videoHost.innerHTML = "";
        return;
    }

    const revealAll = isExpanded || state.allOpen;
    let renderImages = [];
    let renderVideos = [];
    if (revealAll) {
        renderImages = media.images;
        renderVideos = media.videos;
    } else {
        const imagePreviewCount = Math.min(imageCount, INTEL_WIRE_COLLAPSED_MEDIA_PREVIEW_COUNT);
        const remainingPreviewSlots = Math.max(0, INTEL_WIRE_COLLAPSED_MEDIA_PREVIEW_COUNT - imagePreviewCount);
        renderImages = media.images.slice(0, imagePreviewCount);
        renderVideos = media.videos.slice(0, remainingPreviewSlots);
    }

    const renderedCount = renderImages.length + renderVideos.length;
    const hiddenCount = Math.max(0, totalCount - renderedCount);
    const shouldShowToggle = !isExpanded && (hiddenCount > 0 || state.allOpen);
    actionHost.hidden = !shouldShowToggle;
    actionHost.innerHTML = shouldShowToggle
        ? `
            <button
                type="button"
                class="wz-feed-media-toggle btn-secondary white"
                data-feed-media-toggle="all"
                aria-expanded="${state.allOpen ? "true" : "false"}"
                aria-controls="${escapeHtml(getIntelWireMediaPanelId(stableItemId, "images"))} ${escapeHtml(getIntelWireMediaPanelId(stableItemId, "videos"))}"
                title="${escapeHtml(formatIntelWireMediaToggleLabel(hiddenCount, state.allOpen))}">
                <span>${escapeHtml(formatIntelWireMediaToggleLabel(hiddenCount, state.allOpen))}</span>
            </button>
        `
        : "";

    if (renderImages.length) {
        imageHost.hidden = false;
        imageHost.id = getIntelWireMediaPanelId(stableItemId, "images");
        imageHost.className = `wz-feed-media-panel wz-feed-media-panel--images${revealAll ? " is-open" : ""}`;
        imageHost.innerHTML = buildIntelWireImagePanelMarkup(event, renderImages, { expanded: isExpanded });
    } else {
        imageHost.hidden = true;
        imageHost.className = "wz-feed-media-panel wz-feed-media-panel--images";
        imageHost.innerHTML = "";
    }

    if (renderVideos.length) {
        videoHost.hidden = false;
        videoHost.id = getIntelWireMediaPanelId(stableItemId, "videos");
        videoHost.className = `wz-feed-media-panel wz-feed-media-panel--videos${revealAll ? " is-open" : ""}`;
        videoHost.innerHTML = buildIntelWireVideoPanelMarkup(event, renderVideos, state, { expanded: isExpanded });
    } else {
        stopIntelWireCardMedia(videoHost);
        videoHost.hidden = true;
        videoHost.className = "wz-feed-media-panel wz-feed-media-panel--videos";
        videoHost.innerHTML = "";
    }
}
function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function positionExpandedFeedPanel(feedPanel) {
    if (!feedPanel) return;
    if (!feedPanel.classList.contains("is-feed-expanded")) {
        feedPanel.style.removeProperty("width");
        return;
    }
    const parent = feedPanel.offsetParent || feedPanel.parentElement;
    const parentRect = parent?.getBoundingClientRect?.() || { left: 0, width: window.innerWidth || 0 };
    const parentWidth = parent?.clientWidth || parentRect.width || window.innerWidth || 0;
    const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || parentWidth;
    const viewportPad = Math.min(FEED_EXPAND_VIEWPORT_PAD, Math.max(8, viewportWidth * 0.03));
    const availableWidth = Math.max(280, Math.min(parentWidth, viewportWidth) - (viewportPad * 2));
    const preferredWidth = Math.min(
        availableWidth,
        Math.max(feedPanel.offsetWidth || 0, Math.min(viewportWidth * 0.7, FEED_EXPAND_MAX_WIDTH))
    );
    const rect = feedPanel.getBoundingClientRect();
    const leftInParent = rect.left - parentRect.left;
    const rightInParent = rect.right - parentRect.left;
    const centerX = rect.left + (rect.width / 2);
    const minLeft = viewportPad;
    const maxLeft = Math.max(minLeft, parentWidth - preferredWidth - viewportPad);
    const preferredLeft = centerX > viewportWidth / 2
        ? rightInParent - preferredWidth
        : leftInParent;
    const nextLeft = clampNumber(preferredLeft, minLeft, maxLeft);
    feedPanel.style.left = `${nextLeft}px`;
    feedPanel.style.right = "auto";
    feedPanel.style.width = `${preferredWidth}px`;
}
function runFeedPanelAction(action, minDelayMs = 180) {
    setWidgetLoading("feed", true);
    const startedAt = performance.now();
    requestAnimationFrame(() => {
        try {
            action?.();
        } finally {
            const elapsed = performance.now() - startedAt;
            const remaining = Math.max(0, minDelayMs - elapsed);
            window.setTimeout(() => setWidgetLoading("feed", false), remaining);
        }
    });
}
function syncIntelWireFilterControls(viewModel = buildIntelWireViewModel()) {
    const countrySelect = document.getElementById("wz-feed-filter-country");
    const timeSelect = document.getElementById("wz-feed-filter-time");
    if (countrySelect) {
        const options = Array.isArray(viewModel.countryOptions) ? viewModel.countryOptions : [];
        const optionKey = options.map((option) => `${option.value}:${option.label}`).join("|");
        if (countrySelect.dataset.optionKey !== optionKey) {
            countrySelect.innerHTML = "";
            const allOption = document.createElement("option");
            allOption.value = "all";
            allOption.textContent = "All Countries";
            countrySelect.appendChild(allOption);
            options.forEach((option) => {
                const node = document.createElement("option");
                node.value = option.value;
                node.textContent = option.label;
                countrySelect.appendChild(node);
            });
            countrySelect.dataset.optionKey = optionKey;
        }
        const allowedValues = new Set(["all", ...options.map((option) => option.value)]);
        if (!allowedValues.has(__intelWireCountryFilter)) {
            __intelWireCountryFilter = "all";
        }
        countrySelect.value = __intelWireCountryFilter;
    }
    if (timeSelect) {
        timeSelect.value = __intelWireTimeFilter || "all";
    }
}
function bindFeedControls() {
    if (__feedControlsBound) return;
    __feedControlsBound = true;
    startIntelWireRelativeTimeLoop();
    const loadMoreBtn = document.getElementById("live-feed-load-more");
    const expandBtn = document.getElementById("wz-feed-expand");
    const feedPanel = document.querySelector('[data-widget-id="feed"]');
    const feedList = document.getElementById("live-feed-list");
    loadMoreBtn?.addEventListener("click", () => {
        runFeedPanelAction(() => {
            __feedVisibleCount += FEED_LOAD_MORE_COUNT;
            renderFeed(buildIntelWireViewModel());
        }, 120);
    });
    expandBtn?.addEventListener("click", () => {
        const expanded = !feedPanel?.classList.contains("is-feed-expanded");
        feedPanel?.classList.toggle("is-feed-expanded", expanded);
        positionExpandedFeedPanel(feedPanel);
        expandBtn.setAttribute("aria-pressed", String(expanded));
        expandBtn.setAttribute("aria-label", expanded ? "Shrink intel wire widget" : "Expand intel wire widget");
        expandBtn.title = expanded ? "Shrink widget" : "Expand widget";
        requestAnimationFrame(() => {
            rerenderVisibleIntelWireMediaCards();
            syncVisibleIntelWireReadFullControls();
        });
    });
    window.addEventListener("resize", () => {
        if (feedPanel?.classList.contains("is-feed-expanded")) {
            requestAnimationFrame(() => positionExpandedFeedPanel(feedPanel));
        }
        requestAnimationFrame(() => syncVisibleIntelWireReadFullControls());
    }, { passive: true });
    if (!__intelWireFilterControlsBound) {
        __intelWireFilterControlsBound = true;
        const countrySelect = document.getElementById("wz-feed-filter-country");
        const timeSelect = document.getElementById("wz-feed-filter-time");
        countrySelect?.addEventListener("change", (event) => {
            const nextValue = String(event.target?.value || "all").toLowerCase();
            if (nextValue === __intelWireCountryFilter) return;
            runFeedPanelAction(() => {
                __intelWireCountryFilter = nextValue;
                __lastFeedSignature = null;
                __feedVisibleCount = FEED_INITIAL_VISIBLE_COUNT;
                renderFeed(buildIntelWireViewModel());
            });
        });
        timeSelect?.addEventListener("change", (event) => {
            const nextValue = String(event.target?.value || "all").toLowerCase();
            if (nextValue === __intelWireTimeFilter) return;
            runFeedPanelAction(() => {
                __intelWireTimeFilter = nextValue;
                __lastFeedSignature = null;
                __feedVisibleCount = FEED_INITIAL_VISIBLE_COUNT;
                renderFeed(buildIntelWireViewModel());
            });
        });
    }
    if (!__intelWireMediaControlsBound && feedList) {
        __intelWireMediaControlsBound = true;
        feedList.addEventListener("click", (event) => {
            const readFullBtn = event.target?.closest?.("[data-intel-wire-read-full]");
            if (readFullBtn) {
                event.preventDefault();
                event.stopPropagation();
                const card = readFullBtn.closest(".wz-feed-item");
                const itemId = String(card?.dataset?.eventId || "");
                const feedItem = __intelWireRenderedItems.get(itemId);
                if (!card || !feedItem) return;
                openIntelWireDetailModal(feedItem, readFullBtn);
                return;
            }
            const toggleBtn = event.target?.closest?.("[data-feed-media-toggle]");
            if (toggleBtn) {
                event.preventDefault();
                event.stopPropagation();
                const card = toggleBtn.closest(".wz-feed-item");
                const itemId = String(card?.dataset?.eventId || "");
                const feedItem = __intelWireRenderedItems.get(itemId);
                if (!card || !feedItem) return;
                const state = getIntelWireMediaState(itemId);
                state.allOpen = !state.allOpen;
                state.imagesOpen = state.allOpen;
                state.videosOpen = state.allOpen;
                if (!state.allOpen) state.activeVideoIndex = -1;
                renderIntelWireMediaCard(card, feedItem, itemId);
                return;
            }
            const playBtn = event.target?.closest?.("[data-feed-video-play]");
            if (playBtn) {
                event.preventDefault();
                event.stopPropagation();
                const card = playBtn.closest(".wz-feed-item");
                const itemId = String(card?.dataset?.eventId || "");
                const feedItem = __intelWireRenderedItems.get(itemId);
                if (!card || !feedItem) return;
                const state = getIntelWireMediaState(itemId);
                state.activeVideoIndex = Math.max(0, Number(playBtn.getAttribute("data-feed-video-play")) || 0);
                renderIntelWireMediaCard(card, feedItem, itemId);
                const player = card.querySelector(".wz-feed-video-player");
                if (player) {
                    player.play?.().catch?.(() => { });
                }
                return;
            }
        });
        feedList.addEventListener("error", (event) => {
            const target = event.target;
            if (target instanceof HTMLImageElement) {
                const fallbackSrc = String(target.dataset.fallbackSrc || "").trim();
                const currentSrc = String(target.currentSrc || target.src || "").trim();
                if (fallbackSrc && target.dataset.fallbackTried !== "1" && currentSrc !== fallbackSrc) {
                    target.dataset.fallbackTried = "1";
                    target.src = fallbackSrc;
                    return;
                }
                const card = target.closest(".wz-feed-media-card, .wz-feed-video-card");
                if (card) card.classList.add("is-media-unavailable");
            }
            if (target instanceof HTMLVideoElement) {
                const card = target.closest(".wz-feed-video-card");
                if (card) card.classList.add("is-media-unavailable");
            }
        }, true);
    }
}
function renderFeed(viewModelOrEvents) {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;
    bindFeedControls();
    const viewModel = Array.isArray(viewModelOrEvents)
        ? {
            baseEvents: viewModelOrEvents,
            filteredEvents: viewModelOrEvents,
            countryOptions: getIntelWireCountryFilterOptions(viewModelOrEvents),
            total: viewModelOrEvents.length,
            filteredTotal: viewModelOrEvents.length,
            hasActiveFilters: hasActiveIntelWireFilters(),
        }
        : (viewModelOrEvents || buildIntelWireViewModel());
    syncIntelWireFilterControls(viewModel);
    const allRows = Array.isArray(viewModel.filteredEvents) ? viewModel.filteredEvents : [];
    const totalRows = Math.max(0, Number(viewModel.total) || 0);
    const filteredTotal = Math.max(0, Number(viewModel.filteredTotal) || allRows.length);
    const dataSignature = `${makeEventSignature(allRows)}|country:${__intelWireCountryFilter}|time:${__intelWireTimeFilter}`;
    if (dataSignature !== __lastFeedDataSignature) {
        __lastFeedDataSignature = dataSignature;
        __feedVisibleCount = FEED_INITIAL_VISIBLE_COUNT;
    }
    __intelWireRenderedItems = new Map();
    const rows = allRows.slice(0, __feedVisibleCount);
    const countEl = document.getElementById("live-feed-count");
    const loadMoreBtn = document.getElementById("live-feed-load-more");
    if (!allRows.length) {
        feed.querySelectorAll(".wz-feed-item").forEach((card) => {
            stopIntelWireCardMedia(card);
            card.remove();
        });
        let emptyState = feed.querySelector(".feed-empty");
        if (!emptyState) {
            emptyState = document.createElement("div");
            emptyState.className = "feed-empty";
            feed.appendChild(emptyState);
        }
        emptyState.textContent = viewModel.hasActiveFilters
            ? "No intel items match current filters."
            : "No news feed items available yet.";
        if (countEl) {
            countEl.textContent = viewModel.hasActiveFilters
                ? `0 / ${filteredTotal} filtered / ${totalRows} intel items`
                : "0 intel items";
        }
        if (loadMoreBtn) loadMoreBtn.hidden = true;
        return;
    }
    feed.querySelector(".feed-empty")?.remove();
    const existingCards = [...feed.querySelectorAll(":scope > .wz-feed-item")];
    const existingCardMap = new Map(existingCards.map((card) => [String(card.dataset.eventId || ""), card]));
    const visibleIds = new Set();
    const cardsInOrder = [];
    rows.forEach((event, index) => {
        const eventId = getIntelWireEventDomKey(event, index);
        const nextSignature = getIntelWireCardRenderSignature(event);
        visibleIds.add(eventId);
        __intelWireRenderedItems.set(eventId, event);
        let card = existingCardMap.get(eventId) || null;
        if (!card || card.dataset.renderSignature !== nextSignature) {
            const replacement = createIntelWireFeedCard(event, eventId);
            if (card) {
                stopIntelWireCardMedia(card);
                card.replaceWith(replacement);
            }
            card = replacement;
        }
        cardsInOrder.push(card);
    });
    existingCards.forEach((card) => {
        const eventId = String(card.dataset.eventId || "");
        if (visibleIds.has(eventId)) return;
        stopIntelWireCardMedia(card);
        card.remove();
    });
    let previousCard = null;
    cardsInOrder.forEach((card) => {
        const expectedNode = previousCard
            ? previousCard.nextElementSibling
            : feed.querySelector(":scope > .wz-feed-item");
        if (card !== expectedNode) {
            feed.insertBefore(card, expectedNode || null);
        }
        previousCard = card;
    });
    const shown = rows.length;
    const remaining = Math.max(0, filteredTotal - shown);
    if (countEl) {
        countEl.textContent = viewModel.hasActiveFilters
            ? `${shown} / ${filteredTotal} filtered / ${totalRows} intel items`
            : `${shown} / ${filteredTotal} intel items`;
    }
    if (loadMoreBtn) {
        loadMoreBtn.hidden = remaining <= 0;
        let icon = loadMoreBtn.querySelector(":scope > span");
        if (!icon) {
            icon = document.createElement("span");
            loadMoreBtn.prepend(icon);
        }
        let labelNode = icon.nextSibling;
        if (!labelNode || labelNode.nodeType !== Node.TEXT_NODE || labelNode !== loadMoreBtn.lastChild) {
            while (icon.nextSibling) icon.nextSibling.remove();
            labelNode = document.createTextNode("");
            icon.after(labelNode);
        }
        labelNode.textContent = remaining > 0
            ? `Load ${Math.min(FEED_LOAD_MORE_COUNT, remaining)} more`
            : "All loaded";
    }
    requestAnimationFrame(() => {
        refreshIntelWireRelativeTimes(feed);
        cardsInOrder.forEach((card) => {
            const itemId = String(card.dataset.eventId || "");
            const event = __intelWireRenderedItems.get(itemId);
            if (event) syncIntelWireReadFullControl(card, event);
        });
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
    const scopedEvents = Array.isArray(events) ? events : [];
    const statusEvents = getStatusScopedEvents(scopedEvents, type);
    const countryCandidates = [...new Set([
        ...deriveFocusCountries(scopedEvents, Math.max(max, 24)),
        ...statusEvents.map((event) => getEventResolvedCountry(event)),
    ].map(normalizeCountryName).filter(Boolean))];
    const rows = countryCandidates
        .map((country) => {
            const canonical = normalizeCountryName(country);
            const status = deriveCountryStatus(statusEvents, canonical, type);
            const relatedCount = getCountryMatchCount(statusEvents, canonical);
            return {
                label: canonical,
                status,
                relatedCount,
                priority: statusPriority(status),
            };
        })
        .filter((row) => row.priority > 0 || row.relatedCount > 0)
        .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            if (b.relatedCount !== a.relatedCount) return b.relatedCount - a.relatedCount;
            return a.label.localeCompare(b.label);
        });
    return rows.slice(0, max);
}
function renderCyberStatus(events) {
    const container = document.getElementById("cyber-status-list");
    if (!container) return;
    const rows = rankCountryRows(events, "cyber", 8);
    if (!rows.length) {
        const aggregate = deriveAggregateStatus(events, "cyber");
        if (aggregate !== "unknown") {
            const label = aggregate.charAt(0).toUpperCase() + aggregate.slice(1);
            const regionLabel = getActiveRegion?.()?.id === "global" ? "Global" : "Current Region";
            container.innerHTML = `<div class="status-row"><span>${regionLabel}</span><strong class="status-pill status-pill--${aggregate}">${label}</strong></div>`;
            return;
        }
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
        const aggregate = deriveAggregateStatus(events, "airspace");
        if (aggregate !== "unknown") {
            const label = aggregate.charAt(0).toUpperCase() + aggregate.slice(1);
            const regionLabel = getActiveRegion?.()?.id === "global" ? "Global" : "Current Region";
            container.innerHTML = `<div class="status-row"><span>${regionLabel}</span><strong class="status-pill status-pill--${aggregate}">${label}</strong></div>`;
            return;
        }
        container.innerHTML = '<div class="status-row"><span>No airspace signals</span><strong class="status-pill status-pill--unknown">Unknown</strong></div>';
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
    const items = events.slice(0, 15).map((event) => {
        const summary = sanitizeEventPopupText(event.summary || "");
        const place = compactEventPlaceLabel(event);
        return `
        <div class="timeline-item">
            <div class="timeline-time">${formatTime(event.occurred_at)}</div>
            <div class="timeline-body">
                <strong>${escapeHtml(sanitizeEventPopupText(event.title || "", "Activity report") || "Activity report")}</strong>
                ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
                ${place ? `<small>[${escapeHtml(place)}]</small>` : ""}
            </div>
        </div>
    `;
    }).join("");
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
                    <strong>${escapeHtml([e.fir_code || "FIR", e.location_label || e.impact_label || e.country || "Regional airspace"].filter(Boolean).join(" | "))}</strong>
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
        "vip",
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
const FRONTEND_CIVILIAN_AIRLINER_CODES = new Set([
    "A220", "A318", "A319", "A320", "A20N", "A21N", "A321", "A330", "A332", "A333", "A338",
    "A339", "A340", "A342", "A343", "A345", "A346", "A350", "A359", "A35K", "A380", "A388",
    "B712", "B717", "B721", "B722", "B731", "B732", "B733", "B734", "B735", "B736", "B737",
    "B738", "B739", "B37M", "B38M", "B39M", "B3XM", "B741", "B742", "B743", "B744", "B748",
    "B752", "B753", "B762", "B763", "B764", "B772", "B77L", "B77W", "B778", "B779", "B787",
    "B788", "B789", "B78X", "E170", "E175", "E190", "E195", "CRJ2", "CRJ7", "CRJ9", "CRJX",
    "AT72", "AT75", "DH8A", "DH8B", "DH8C", "DH8D", "BCS1", "BCS3",
]);
const FRONTEND_CIVILIAN_UTILITY_PATTERNS = [
    /\bAIR TRACTOR\b/i,
    /\bAT-?802\b/i,
    /\bAT8T\b/i,
    /\bCROP DUSTER\b/i,
    /\bAGRICULT(URAL|URE)\b/i,
    /\bAERIAL APPLICAT(ION|OR)\b/i,
    /\bFIRE ?BOMBER\b/i,
    /\bWATER ?BOMBER\b/i,
    /\bFIREFIGHT(ING|ER)\b/i,
    /\bAIR SPRAY\b/i,
    /\bTHRUSH\b/i,
    /\bDROMADER\b/i,
];
const FRONTEND_TRAINING_ACTIVITY_PATTERNS = [
    /\btrainer\b/i,
    /\bbasic trainer\b/i,
    /\bprimary trainer\b/i,
    /\badvanced trainer\b/i,
    /\bjet trainer\b/i,
    /\bflight training\b/i,
    /\bpilot training\b/i,
    /\btraining aircraft\b/i,
    /\btraining (flight|activity|mission|sortie)\b/i,
    /\bmilitary training aircraft\b/i,
];
const FRONTEND_TRAINER_SPECIAL_OPERATIONAL_PATTERNS = [
    /\bFA-?50\b/i,
    /\bYAK(?:OVLEV)?[-\s]?130\b/i,
    /\bM-?346FA\b/i,
    /\bA-?29\b/i,
    /\bSUPER TUCANO\b/i,
    /\bAT-?6\b/i,
    /\bWOLVERINE\b/i,
    /\bBLACK ?HAWK\b/i,
    /\bSEAHAWK\b/i,
    /\bHAWKEYE\b/i,
];
const FRONTEND_TRAINER_PLATFORM_PATTERNS = [
    /\b(?:AERO\s+)?L-?(?:29|39|59)\b/i,
    /\bDELFIN\b/i,
    /\bALBATROS\b/i,
    /\bSUPER ALBATROS\b/i,
    /\bALPHA JET\b/i,
    /\b(?:BAE\s+)?HAWK(?:\s+(?:T[12]|100|200))?\b/i,
    /(^|[^A-Z0-9])T-?6[ABC]?\b/i,
    /\bTEXAN II\b/i,
    /\bBEECHCRAFT\s+T-?6\b/i,
    /\bCT-?156\b/i,
    /\bHARVARD II\b/i,
    /\b(?:PILATUS\s+)?PC-?(?:7|9|21)(?:\s*(?:MKII|M))?\b/i,
    /\bGROB\s+G-?(?:115|120A?|120TP)\b/i,
    /\bG-?(?:115|120A?|120TP)\b/i,
    /(^|[^A-Z0-9])T-?38[AC]?\b/i,
    /\bTALON\b/i,
    /\b(?:BOEING\s+)?T-?7A?\b/i,
    /\bRED HAWK\b/i,
    /\b(?:KAI\s+)?KT-?1\b/i,
    /\bWOONGBI\b/i,
    /\b(?:HONGDU\s+|NANCHANG\s+)?CJ-?6\b/i,
    /\bYAK(?:OVLEV)?[-\s]?(?:52|152)\b/i,
    /\bPZL-?130\b/i,
    /\bORLIK\b/i,
    /\bSF-?260(?:EA)?\b/i,
    /\bDIAMOND\s+DA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bDA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bEMB-?312\b/i,
    /\bTUCANO\b/i,
    /\bK-?8\b/i,
    /\bJL-?8\b/i,
    /\bKARAKORUM\b/i,
    /\bM-?311\b/i,
    /\bM-?345\b/i,
    /\bM-?346(?!FA)\b/i,
    /\bMB-?(?:326|339)\b/i,
    /\bJET PROVOST\b/i,
    /\bSCOTTISH AVIATION BULLDOG\b/i,
    /\bBULLDOG\b/i,
    /\bCT-?114\b/i,
    /\bTUTOR\b/i,
    /\bJL-?10\b/i,
    /\bL-?15\b/i,
];
const FRONTEND_MILITARY_AIRCRAFT_OVERRIDE_PATTERNS = [
    /AIR FORCE/i,
    /\bUSAF\b/i,
    /\bRAF\b/i,
    /\bRCAF\b/i,
    /\bIAF\b/i,
    /\bPAF\b/i,
    /NAVY/i,
    /NAVAL/i,
    /ARMY/i,
    /MARINES/i,
    /COAST GUARD/i,
    /MRTT/i,
    /VOYAGER/i,
    /STRATOTANKER/i,
    /EXTENDER/i,
    /PEGASUS/i,
    /AWACS/i,
    /\bAEW\b/i,
    /WEDGETAIL/i,
    /SENTRY/i,
    /PHALCON/i,
    /ERIEYE/i,
    /POSEIDON/i,
    /ORION/i,
    /RIVET JOINT/i,
    /COBRA BALL/i,
    /GLOBAL HAWK/i,
    /TRITON/i,
    /SPECIAL MISSION/i,
    /HERCULES/i,
    /GLOBEMASTER/i,
    /BLACK HAWK/i,
    /BLACKHAWK/i,
    /APACHE/i,
    /CHINOOK/i,
    /SEAHAWK/i,
    /OSPREY/i,
    /HAWKEYE/i,
    /STALLION/i,
    /\bC-17\b/i,
    /\bC17\b/i,
    /\bC-130\b/i,
    /\bC130\b/i,
    /\bKC-135\b/i,
    /\bKC135\b/i,
    /\bKC-46\b/i,
    /\bKC46\b/i,
    /\bKC-10\b/i,
    /\bKC10\b/i,
    /\bP-8\b/i,
    /\bP8\b/i,
    /\bE-3\b/i,
    /\bE3\b/i,
    /\bE-7\b/i,
    /\bE7\b/i,
    /\bRC-135\b/i,
    /\bRC135\b/i,
    /\bF-35[A-Z]?\b/i,
    /\bF35[A-Z]?\b/i,
    /\bF-16[A-Z]?\b/i,
    /\bF16[A-Z]?\b/i,
    /\bF-15[A-Z]?\b/i,
    /\bF15[A-Z]?\b/i,
    /\bF-18[A-Z]?\b/i,
    /\bF18[A-Z]?\b/i,
    /\bF\/A-18[A-Z]?\b/i,
    /\bFA-18[A-Z]?\b/i,
    /\bFA18[A-Z]?\b/i,
    /\bF-22[A-Z]?\b/i,
    /\bF22[A-Z]?\b/i,
    /\bA-10[A-Z]?\b/i,
    /\bA10[A-Z]?\b/i,
    /\bSU-27[A-Z]*\b/i,
    /\bSU27[A-Z]*\b/i,
    /\bSU-30[A-Z]*\b/i,
    /\bSU30[A-Z]*\b/i,
    /\bSU-35[A-Z]*\b/i,
    /\bSU35[A-Z]*\b/i,
    /\bMIG-29[A-Z]*\b/i,
    /\bMIG29[A-Z]*\b/i,
    /\bMIG-31[A-Z]*\b/i,
    /\bMIG31[A-Z]*\b/i,
    /\bRAFALE\b/i,
    /\bEUROFIGHTER\b/i,
    /\bTYPHOON\b/i,
    /\bGRIPEN\b/i,
    /\bMIRAGE\b/i,
];
const FRONTEND_SPECIAL_ISR_COMMAND_PATTERNS = [
    /DOOMSDAY/i,
    /NIGHTWATCH/i,
    /LOOKING GLASS/i,
    /TACAMO/i,
    /MERCURY/i,
    /\bE-?4B?\b/i,
    /\bE-?6B?\b/i,
    /\bIL-?80\b/i,
    /\bIL-?82\b/i,
];
const FRONTEND_SPECIAL_VIP_GOV_PATTERNS = [
    /AIR FORCE ONE/i,
    /AIR FORCE TWO/i,
    /AIR INDIA ONE/i,
    /\bSAM\d{2,6}\b/i,
    /\bVENUS\d+\b/i,
    /\bEXEC1[FVP]\b/i,
    /\bVC-?25A?\b/i,
    /\bVC-?32A?\b/i,
    /\bC-?32A?\b/i,
    /\bC-?40B?\b/i,
    /\bA319CJ\b/i,
    /\bA320CJ\b/i,
    /\bBBJ\b/i,
    /\bACJ\b/i,
    /\bVVIP\b/i,
    /VIP TRANSPORT/i,
    /PRESIDENTIAL/i,
    /HEAD OF STATE/i,
    /PRIME MINISTER/i,
    /STATE FLIGHT/i,
    /\bCOTAM\d+\b/i,
    /SLO ROSSIYA/i,
    /\bIL-?96-?300PU\b/i,
    /\bIL-?96PU\b/i,
    /\bTU-?214PU\b/i,
    /KONRAD ADENAUER/i,
];
const FRONTEND_CASA_HC144_PATROL_PATTERNS = [
    /\b(hc ?144b?|c ?144b?|casa 144b?|ocean sentry)\b/i,
    /\b(uscg|u s coast guard|united states coast guard|coast guard)\b.*\b(cn ?235|c ?295|casa)\b/i,
    /\b(cn ?235|c ?295|casa)\b.*\b(uscg|u s coast guard|united states coast guard|coast guard)\b/i,
];
const FRONTEND_FALCON_7X_PATTERNS = [
    /\b(dassault falcon 7x|falcon 7x|fa7x|f7x)\b/i,
];
function hasMilitaryAircraftOverride(track = {}) {
    const metadata = getAircraftMetadata(track);
    const rawSubtype = String(track.subtype || track.subcategory || metadata.role || "")
        .trim()
        .toLowerCase();
    if (["vip", "fighter", "bomber", "awacs", "isr", "recon", "tanker", "refueler", "transport", "logistics", "helicopter", "uav", "drone"].includes(rawSubtype)) {
        return true;
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
        track.operator,
        metadata.operator,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
    ]
        .filter(Boolean)
        .join(" ");
    return (
        FRONTEND_MILITARY_AIRCRAFT_OVERRIDE_PATTERNS.some((pattern) => pattern.test(haystack)) ||
        FRONTEND_SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(haystack)) ||
        FRONTEND_SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(haystack)) ||
        FRONTEND_FALCON_7X_PATTERNS.some((pattern) => pattern.test(haystack))
    );
}
function isCoastGuardCasaPatrolAircraftTrack(track = {}) {
    const metadata = getAircraftMetadata(track);
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
        track.operator,
        metadata.operator,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
    ]
        .filter(Boolean)
        .join(" ");
    return FRONTEND_CASA_HC144_PATROL_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isLikelyCivilianPassengerAircraftTrack(track = {}) {
    const metadata = getAircraftMetadata(track);
    const typeCode = String(track.type_code || track.icao_type || metadata.type_code || "")
        .trim()
        .toUpperCase();
    const haystack = [
        track.model_name,
        track.model,
        track.variant,
        track.aircraft_type,
        track.description,
        metadata.model_name,
        track.title,
        track.operator,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();
    if (hasMilitaryAircraftOverride(track)) return false;
    if (FRONTEND_CIVILIAN_AIRLINER_CODES.has(typeCode)) return true;
    return /(AIRBUS\s+A-?(220|318|319|320|321|330|340|350|380)\b|BOEING\s+7(17|27|37|47|57|67|77|87)\b|EMBRAER\s+E-?(170|175|190|195)\b|CRJ[- ]?(200|700|900|1000)\b|ATR[- ]?7(2|5)\b|DASH ?8\b)/.test(haystack);
}
function isLikelyCivilianUtilityAircraftTrack(track = {}) {
    const metadata = getAircraftMetadata(track);
    const typeCode = String(track.type_code || track.icao_type || metadata.type_code || "")
        .trim()
        .toUpperCase();
    const haystack = [
        track.model_name,
        track.model,
        track.variant,
        track.aircraft_type,
        track.description,
        metadata.model_name,
        track.title,
        track.operator,
        metadata.operator,
        track.callsign,
        track.flight,
        metadata.callsign,
    ]
        .filter(Boolean)
        .join(" ");
    if (hasMilitaryAircraftOverride(track)) return false;
    if (typeCode === "AT8T" || typeCode === "AT82") return true;
    return FRONTEND_CIVILIAN_UTILITY_PATTERNS.some((pattern) => pattern.test(haystack));
}
function shouldExcludeFromMilitaryAircraftTracker(track = {}) {
    return (
        isCoastGuardCasaPatrolAircraftTrack(track) ||
        isLikelyCivilianPassengerAircraftTrack(track) ||
        isLikelyCivilianUtilityAircraftTrack(track) ||
        isLikelyTrainerAircraftTrack(track)
    );
}
function buildTrainerAircraftHaystack(source = {}, metadata = getAircraftMetadata(source)) {
    return [
        source.track_type,
        source.category,
        source.subcategory,
        source.subtype,
        source.role,
        source.aircraft_role,
        source.aircraft_type,
        source.type_code,
        source.icao_type,
        source.model_name,
        source.model,
        source.variant,
        source.description,
        source.title,
        source.summary,
        source.weapon_type,
        source.report_type,
        source.callsign,
        source.flight,
        source.operator,
        source.owner,
        metadata.role,
        metadata.subtype,
        metadata.aircraft_role,
        metadata.type_code,
        metadata.model_name,
        metadata.model,
        metadata.variant,
        metadata.callsign,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ");
}
function isExcludedTrainerAircraftText(text = "") {
    const haystack = String(text || "");
    if (!haystack) return false;
    const hasTrainingActivity = FRONTEND_TRAINING_ACTIVITY_PATTERNS.some((pattern) => pattern.test(haystack));
    if (
        !hasTrainingActivity &&
        FRONTEND_TRAINER_SPECIAL_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(haystack))
    ) {
        return false;
    }
    return hasTrainingActivity || FRONTEND_TRAINER_PLATFORM_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isLikelyTrainerAircraftTrack(track = {}) {
    const metadata = getAircraftMetadata(track);
    const rawSubtype = String(track.subcategory || track.subtype || metadata.role || "").trim().toLowerCase();
    if (rawSubtype === "trainer") return true;
    return isExcludedTrainerAircraftText(buildTrainerAircraftHaystack(track, metadata));
}
function isTrainerAircraftSignalEvent(event = {}) {
    const category = String(event.category || "").toLowerCase();
    const maybeAircraft =
        isAircraftTelemetryEvent(event) ||
        isClearlyAircraftContact(event) ||
        ["air_activity", "military"].includes(category);
    if (!maybeAircraft) return false;
    return isExcludedTrainerAircraftText(buildTrainerAircraftHaystack(event, getEventMetadata(event)));
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
    if (key === "vip") return "VIP/GOV";
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
    if (shouldExcludeFromMilitaryAircraftTracker(track)) {
        return "civilian";
    }
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
        track.operator,
        track.owner,
        metadata.callsign,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (FRONTEND_SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(haystack))) return "isr";
    if (FRONTEND_FALCON_7X_PATTERNS.some((pattern) => pattern.test(haystack))) return "vip";
    if (FRONTEND_CASA_HC144_PATROL_PATTERNS.some((pattern) => pattern.test(haystack))) return "recon";
    if (FRONTEND_SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(haystack))) return "vip";
    if (/(awacs|aew|wedgetail|hawkeye|sentry|e-3\b|e3\b|e-7\b|e7\b|a-50\b|a50\b|phalcon|erieye|kj-200\b|kj200\b|kj-500\b|kj500\b|kj-2000\b|kj2000\b)/.test(haystack)) return "awacs";
    if (/(uav\b|drone\b|ucav\b|uas\b|reaper\b|predator\b|general atomic(?:s)?\b|ga-?asi\b|mq-9[ab]?\b|mq9[ab]?\b|skyguardian\b|sky guardian\b|seaguardian\b|sea guardian\b|protector(?:\s+rg-?1)?\b|rq-4\b|rq4\b|global hawk\b|mq-4c\b|mq4c\b|triton\b|tb2\b|bayraktar\b|heron\b|hermes\b)/.test(haystack)) return "uav";
    if (/(rivet joint|cobra ball|combat sent|recon|reconnaissance|surveillance|poseidon|orion|rc-135\b|rc135\b|ep-3\b|ep3\b|p-8\b|p8\b|p-3\b|p3\b)/.test(haystack)) return "recon";
    if (/(isr\b|global hawk|triton|jstars|e-8\b|e8\b|rq-4\b|rq4\b|special mission)/.test(haystack)) return "isr";
    if (/(tanker|refuel|refueller|pegasus|extender|stratotanker|kc-135\b|kc135\b|kc-46\b|kc46\b|kc-10\b|kc10\b|a330 mrtt\b|mrtt\b|voyager\b|il-78\b|il78\b|yy-20\b|yy20\b)/.test(haystack)) return "tanker";
    if (/(transport|airlift|cargo|logistics|globemaster|hercules|atlas\b|a-?400m\b|c-17\b|c17\b|c-5\b|c5\b|c-130\b|hc-130\b|mc-130\b|c130\b|c-40\b|c40\b|an-124\b|an124\b|an-12\b|an12\b|il-76\b|il76\b|y-20\b|y20\b|cn-235\b|cn235\b|c295\b)/.test(haystack)) return "transport";
    if (/(helicopter|rotary|rotorcraft|black hawk|blackhawk|apache|chinook|osprey|seahawk|super stallion|king stallion|lakota|agusta|sikorsky|leonardo|aw-139\b|aw139\b|aw-119\b|aw119\b|th-73\b|th73\b|uh-72\b|uh72\b|uh-60\b|uh60\b|hh-60\b|hh60\b|mh-60\b|mh60\b|h-60\b|h60\b|ch-47\b|ch47\b|ch-53\b|ch53\b|v-22\b|v22\b|mi-8\b|mi8\b|mi-17\b|mi17\b|mi-24\b|mi24\b|mi-28(?:nm|n)?\b|mi28(?:nm|n)?\b|mi-35\b|mi35\b|ka-27\b|ka27\b|ka-50\b|ka50\b|hokum\b|ka-52\b|ka52\b)/.test(haystack)) return "helicopter";
    if (/(bomber|b-1\b|b1\b|b-2\b|b2\b|b-52\b|b52\b|tu-95\b|tu95\b|tu-160\b|tu160\b|h-6\b|h6\b|ac-130\b|ac130\b|spectre|spooky)/.test(haystack)) return "bomber";
    if (/(uav\b|drone\b|ucav\b|reaper\b|predator\b|general atomic(?:s)?\b|ga-?asi\b|mq-9[ab]?\b|mq9[ab]?\b|rq-4\b|rq4\b|tb2\b|bayraktar\b|heron\b|hermes\b)/.test(haystack)) return "uav";
    if (isExcludedTrainerAircraftText(haystack)) return "trainer";
    if (/(fighter\b|interceptor\b|multirole\b|hornet\b|super hornet\b|strike eagle\b|raptor\b|lightning ii\b|warthog\b|typhoon\b|eurofighter\b|rafale\b|gripen\b|mirage\b|tomcat\b|f-15[a-z]?\b|f15[a-z]?\b|f-16[a-z]?\b|f16[a-z]?\b|f-18[a-z]?\b|f18[a-z]?\b|fa-18[a-z]?\b|fa18[a-z]?\b|f\/a-18[a-z]?\b|f-22[a-z]?\b|f22[a-z]?\b|f-35[a-z]?\b|f35[a-z]?\b|a-10[a-z]?\b|a10[a-z]?\b|su-27[a-z]*\b|su27[a-z]*\b|su-30[a-z]*\b|su30[a-z]*\b|su-35[a-z]*\b|su35[a-z]*\b|mig-29[a-z]*\b|mig29[a-z]*\b|mig-31[a-z]*\b|mig31[a-z]*\b|j-10[a-z]?\b|j10[a-z]?\b|j-16[a-z]?\b|j16[a-z]?\b|j-20[a-z]?\b|j20[a-z]?\b|tejas\b|jf-17[a-z]?\b|jf17[a-z]?\b)/.test(haystack)) return "fighter";
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
function isUnknownAircraftCountryLabel(value = "") {
    const normalized = sanitizeAircraftText(value).toLowerCase();
    return !normalized || ["unknown", "n a", "na", "n/a", "none", "nil"].includes(normalized);
}
function inferAircraftCountryFromText(text = "") {
    const clean = sanitizeAircraftText(text);
    if (!isAircraftDisplayTextUsable(clean)) return "";
    const lowerPadded = ` ${clean.toLowerCase()} `;
    const explicitServiceHints = [
        { pattern: /\b(united states air force|us air force|u s air force|usaf|united states navy|us navy|u s navy|usn|us marine corps|u s marine corps|usmc)\b/i, country: "United States" },
        { pattern: /\b(royal air force|raf|royal navy)\b/i, country: "United Kingdom" },
        { pattern: /\b(pakistan air force|pakistan navy)\b/i, country: "Pakistan" },
        { pattern: /\b(indian air force|indian navy)\b/i, country: "India" },
        { pattern: /\b(israeli air force|israeli navy|israel air force)\b/i, country: "Israel" },
        { pattern: /\b(russian aerospace forces|russian air force|russian navy)\b/i, country: "Russia" },
        { pattern: /\b(pla air force|people s liberation army air force|plaf|pla navy)\b/i, country: "China" },
        { pattern: /\b(turkish air force|turkish navy)\b/i, country: "Turkey" },
        { pattern: /\b(france air force|french air force|french navy)\b/i, country: "France" },
        { pattern: /\b(german air force|german navy)\b/i, country: "Germany" },
    ];
    for (const hint of explicitServiceHints) {
        if (hint.pattern.test(clean)) return normalizeCountryName(hint.country);
    }
    const serviceMatch = clean.match(
        /\b([a-z][a-z\s.'-]{2,})\s+(air force|airforce|air arm|navy|marine corps|armed forces|defence force|defense force)\b/i
    );
    if (serviceMatch) {
        const candidate = normalizeCountryName(sanitizeAircraftText(serviceMatch[1]));
        if (candidate && !isUnknownAircraftCountryLabel(candidate)) {
            return candidate;
        }
    }
    for (const [alias, canonical] of Object.entries(COUNTRY_NAME_ALIASES)) {
        const aliasToken = sanitizeAircraftText(alias).toLowerCase();
        if (!aliasToken) continue;
        if (lowerPadded.includes(` ${aliasToken} `)) {
            return normalizeCountryName(canonical || alias);
        }
    }
    const regionCountries = Object.values(REGION_COUNTRY_HINTS).flat();
    for (const countryName of regionCountries) {
        const token = sanitizeAircraftText(countryName).toLowerCase();
        if (!token) continue;
        if (lowerPadded.includes(` ${token} `)) {
            return normalizeCountryName(countryName);
        }
    }
    return "";
}
function getAircraftCountryLabel(track = {}) {
    const metadata = getAircraftMetadata(track);
    const explicit = normalizeCountryName(
        sanitizeAircraftText(track.country || metadata.country || "")
    );
    if (explicit && !isUnknownAircraftCountryLabel(explicit)) {
        return explicit;
    }
    const inferred = [
        track.operator,
        track.owner,
        metadata.operator,
        track.title,
        track.description,
        track.model_name,
        track.aircraft_type,
        track.callsign,
        track.flight,
        track.region,
        metadata.region,
    ]
        .map((value) => inferAircraftCountryFromText(value))
        .find((value) => value && !isUnknownAircraftCountryLabel(value));
    if (inferred) return inferred;
    const fallbackRegion = normalizeCountryName(sanitizeAircraftText(track.region || metadata.region || ""));
    if (fallbackRegion && !isUnknownAircraftCountryLabel(fallbackRegion)) {
        return fallbackRegion;
    }
    return "Unknown";
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
function getAircraftWidgetDetailLabel(track = {}) {
    const subtype = formatAircraftSubtypeLabel(resolveAircraftSubtype(track));
    const detail = getAircraftDetailLabel(track);
    if (!detail) return subtype;
    if (detail.toLowerCase().includes(subtype.toLowerCase())) return detail;
    return `${subtype} • ${detail}`;
}
function getAircraftWidgetForceLabel(track = {}) {
    const operator = getAircraftOperatorLabel(track);
    if (operator) return operator;
    const country = getAircraftCountryLabel(track);
    if (!country || isUnknownAircraftCountryLabel(country)) return "Unknown Air Force";
    return `${country} Air Force`;
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
function getLiveWidgetRenderDelay(delay = 0) {
    const baseDelay = Math.max(0, Number(delay || 0));
    if (baseDelay === 0) return 0;
    const viewer = window.__warzoneViewer;
    const aircraftSelection = getLiveTrackSelection?.();
    const focusActive = String(aircraftSelection?.mode || "") === "focus";
    const cameraMoving = viewer?.__warzoneCameraMoving === true;
    return (focusActive || cameraMoving) ? Math.max(baseDelay, 320) : baseDelay;
}
function requestAircraftMovementsWidgetRender(delay = AIRCRAFT_WIDGET_RENDER_THROTTLE_MS) {
    const requestedDelay = getLiveWidgetRenderDelay(delay);
    if (requestedDelay === 0) {
        if (__aircraftWidgetRenderTimer) {
            clearTimeout(__aircraftWidgetRenderTimer);
            __aircraftWidgetRenderTimer = 0;
        }
        __aircraftWidgetLastRenderedAt = performance.now();
        renderAircraftMovementsWidget();
        return;
    }
    if (__aircraftWidgetRenderTimer) return;
    const elapsed = Math.max(0, performance.now() - __aircraftWidgetLastRenderedAt);
    const wait = Math.max(0, requestedDelay - elapsed);
    __aircraftWidgetRenderTimer = window.setTimeout(() => {
        __aircraftWidgetRenderTimer = 0;
        __aircraftWidgetLastRenderedAt = performance.now();
        renderAircraftMovementsWidget();
    }, wait);
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
function syncLiveAircraftFromHistoryRows(rows = __aircraftHistoryCache) {
    if (!isLayerEnabled("aircraft")) {
        __seededAircraftTrackKeys.forEach((trackKey) => {
            if (trackKey) clearLiveTrack(trackKey);
        });
        __seededAircraftTrackKeys = new Set();
        return;
    }
    const nextSeededTrackKeys = new Set();
    const historyRows = Array.isArray(rows) ? rows : [];
    if (isDatabaseAircraftLiveSourceEnabled()) {
        historyRows
            .filter((row) => row?.track_key && row.active)
            .filter((row) => isPointInsideRegion(Number(row.lat), Number(row.lon), getActiveRegion?.()))
            .forEach((row) => {
                upsertLiveTrack({
                    ...row,
                    updated_at: row.updated_at || row.occurred_at || new Date(Number(row.last_seen_at || Date.now())).toISOString(),
                });
                nextSeededTrackKeys.add(String(row.track_key || ""));
            });
    }
    __seededAircraftTrackKeys.forEach((trackKey) => {
        if (trackKey && !nextSeededTrackKeys.has(trackKey)) {
            clearLiveTrack(trackKey);
        }
    });
    __seededAircraftTrackKeys = nextSeededTrackKeys;
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
    if (isDocumentHidden()) return __aircraftHistoryCache;
    const now = Date.now();
    if (__aircraftHistoryLoadingPromise) return __aircraftHistoryLoadingPromise;
    if (!force && __aircraftHistoryLastLoadedAt && (now - __aircraftHistoryLastLoadedAt) < AIRCRAFT_HISTORY_REFRESH_MS) {
        return __aircraftHistoryCache;
    }
    __aircraftHistoryLoadingPromise = api.getAircraftTracks()
        .then(({ data, error }) => {
            if (isDocumentHidden()) return __aircraftHistoryCache;
            if (error) {
                console.error("Aircraft history fetch error:", error);
                return __aircraftHistoryCache;
            }
            __aircraftHistoryCache = Array.isArray(data)
                ? data
                    .map(normalizeAircraftHistoryRow)
                    .filter((row) => row.track_key && isAircraftTrackSubtype(row.subcategory))
                    .filter((row) => !shouldExcludeFromMilitaryAircraftTracker(row))
                    .sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0))
                    .slice(0, AIRCRAFT_HISTORY_CACHE_MAX_ROWS)
                : [];
            __aircraftHistoryLastLoadedAt = Date.now();
            syncLiveAircraftFromHistoryRows(__aircraftHistoryCache);
            return __aircraftHistoryCache;
        })
        .finally(() => {
            __aircraftHistoryLoadingPromise = null;
        });
    return __aircraftHistoryLoadingPromise;
}
function startAircraftLiveSync() {
    if (isDocumentHidden()) return;
    if (__aircraftLiveSyncTimer) return;
    const useDatabaseAsLiveSource = isDatabaseAircraftLiveSourceEnabled();
    if (isLayerEnabled("aircraft") && isAircraftTrackingFeatureEnabled()) {
        refreshAircraftHistoryCache(useDatabaseAsLiveSource).catch(() => { });
    }
    __aircraftLiveSyncTimer = window.setInterval(() => {
        if (isDocumentHidden()) return;
        if (!isLayerEnabled("aircraft") || !isAircraftTrackingFeatureEnabled()) return;
        refreshAircraftHistoryCache(isDatabaseAircraftLiveSourceEnabled()).catch(() => { });
    }, getAircraftLiveSyncIntervalMs());
}
function stopAircraftLiveSync() {
    if (!__aircraftLiveSyncTimer) return;
    window.clearInterval(__aircraftLiveSyncTimer);
    __aircraftLiveSyncTimer = 0;
}
function syncAircraftLivePipelines({ forceRefresh = false } = {}) {
    const aircraftEnabled = isLayerEnabled("aircraft") && isAircraftTrackingFeatureEnabled();
    if (!aircraftEnabled) {
        stopPublicAirIngestion();
        stopAircraftLiveSync();
        stopTracksRealtimeChannel();
        clearAllLiveTracks();
        __seededAircraftTrackKeys = new Set();
        return;
    }
    if (isDocumentHidden()) {
        stopPublicAirIngestion();
        stopAircraftLiveSync();
        stopTracksRealtimeChannel();
        return;
    }
    if (isStratOpsFeatureEnabled("tracking.publicAircraftFallback")) {
        startPublicAirIngestion();
    }
    startAircraftLiveSync();
    if (isStratOpsFeatureEnabled("tracking.aircraftRealtime")) {
        startTracksRealtimeChannel();
    }
    if (forceRefresh) {
        refreshAircraftHistoryCache(isDatabaseAircraftLiveSourceEnabled()).catch(() => { });
        if (isStratOpsFeatureEnabled("tracking.publicAircraftFallback")) {
            refreshPublicAirTracksNow({ force: true }).catch(() => { });
        }
    }
}
function requestFastForegroundAircraftRecovery({
    forceRefresh = false,
    forcePublicRefresh = false,
} = {}) {
    if (isDocumentHidden()) return false;
    if (!isLayerEnabled("aircraft") || !isAircraftTrackingFeatureEnabled()) return false;
    if (__foregroundPipelineResumeTimer) {
        window.clearTimeout(__foregroundPipelineResumeTimer);
        __foregroundPipelineResumeTimer = 0;
    }
    const shouldForceRefresh = forceRefresh === true;
    const shouldForcePublicRefresh = shouldForceRefresh || forcePublicRefresh === true;
    startAircraftLiveSync();
    if (isStratOpsFeatureEnabled("tracking.aircraftRealtime")) {
        startTracksRealtimeChannel();
    }
    syncLiveAircraftFromHistoryRows(__aircraftHistoryCache);
    if (shouldForceRefresh) {
        refreshAircraftHistoryCache(true).catch(() => { });
    }
    if (shouldForcePublicRefresh) {
        if (isStratOpsFeatureEnabled("tracking.publicAircraftFallback")) {
            refreshPublicAirTracksNow({ force: true }).catch(() => { });
        }
    }
    if (isStratOpsFeatureEnabled("tracking.publicAircraftFallback")) {
        startPublicAirIngestion();
    }
    requestAircraftMovementsWidgetRender(0);
    startForegroundRenderWakeBurst(550);
    window.__warzoneViewer?.scene?.requestRender?.();
    return true;
}
function handleTracksRealtimePayload(payload) {
    const eventType = String(payload?.eventType || payload?.event || "").toUpperCase();
    const track = payload?.new || payload?.old;
    if (!track) return;
    // If the aircraft layer is disabled, ignore high-frequency realtime packets.
    // Clearing/updating tracks while hidden adds avoidable main-thread pressure.
    if (!isLayerEnabled("aircraft") || !isAircraftTrackingFeatureEnabled()) return;
    if (isDocumentHidden()) return;
    const useDatabaseAsLiveSource = isDatabaseAircraftLiveSourceEnabled();
    if (!useDatabaseAsLiveSource) {
        refreshAircraftHistoryCache(false).catch(() => { });
        requestAircraftMovementsWidgetRender();
        return;
    }
    if (eventType === "DELETE") {
        if (track.track_key) clearLiveTrack(track.track_key);
        return;
    }
    if (shouldExcludeFromMilitaryAircraftTracker(track)) {
        if (track.track_key) clearLiveTrack(track.track_key);
        return;
    }
    if (!isPointInsideRegion(Number(track.lat), Number(track.lon), getActiveRegion?.())) {
        if (track.track_key) clearLiveTrack(track.track_key);
        return;
    }
    upsertLiveTrack(track);
}
function stopTracksRealtimeChannel() {
    const channel = __tracksRealtimeChannel;
    if (!channel) return;
    __tracksRealtimeChannel = null;
    try {
        channel.unsubscribe?.();
    } catch {
        // ignore
    }
    try {
        supabase.removeChannel?.(channel);
    } catch {
        // ignore
    }
}
function startTracksRealtimeChannel() {
    if (__tracksRealtimeChannel) return;
    if (!isLayerEnabled("aircraft")) return;
    if (isDocumentHidden()) return;
    const channel = supabase
        .channel("tracks-live")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "tracks" },
            handleTracksRealtimePayload
        )
        .subscribe((status, err) => {
            if (status === "CHANNEL_ERROR" && err) console.error("TRACK ERROR:", err);
        });
    __tracksRealtimeChannel = channel;
}
function syncTracksRealtimeChannel() {
    if (isLayerEnabled("aircraft") && isAircraftTrackingFeatureEnabled() && isStratOpsFeatureEnabled("tracking.aircraftRealtime")) {
        startTracksRealtimeChannel();
    } else {
        stopTracksRealtimeChannel();
    }
}
function suspendBackgroundLivePipelines() {
    __visibilityPipelinesSuspended = true;
    if (__foregroundPipelineResumeTimer) {
        window.clearTimeout(__foregroundPipelineResumeTimer);
        __foregroundPipelineResumeTimer = 0;
    }
    if (__foregroundRenderWakeRaf) {
        cancelAnimationFrame(__foregroundRenderWakeRaf);
        __foregroundRenderWakeRaf = 0;
    }
    if (__foregroundAdaptiveRecoveryTimer) {
        clearTimeout(__foregroundAdaptiveRecoveryTimer);
        __foregroundAdaptiveRecoveryTimer = 0;
    }
    clearTimeout(__viewportFetchTimer);
    __viewportFetchTimer = null;
    __viewportFetchSeq += 1;
    __viewportFetchInFlight = false;
    clearTimeout(__aircraftHistoryRefreshTimer);
    __aircraftHistoryRefreshTimer = 0;
    clearTimeout(__aircraftWidgetRenderTimer);
    __aircraftWidgetRenderTimer = 0;
    clearTimeout(__navalWidgetRenderTimer);
    __navalWidgetRenderTimer = 0;
    __pollRequestSeq += 1;
    __pollInFlight = false;
    __pollInFlightSince = 0;
    api.abortPendingRequests?.("events:");
    stopPublicAirIngestion();
    stopAircraftLiveSync();
    stopTracksRealtimeChannel();
    stopEventPollingFallback();
    stopIntelWireRefreshLoop();
}
function resumeForegroundLivePipelines({ backgroundIdleMs = 0 } = {}) {
    const wasSuspended = __visibilityPipelinesSuspended;
    __visibilityPipelinesSuspended = false;
    startEventPollingFallback();
    startIntelWireRefreshLoop({ forceInitial: false });
    if (isLayerEnabled("aircraft")) {
        requestFastForegroundAircraftRecovery({
            forceRefresh: wasSuspended || backgroundIdleMs > FOREGROUND_RECOVERY_WORK_THRESHOLD_MS,
            forcePublicRefresh: wasSuspended,
        });
    }
    if (__foregroundPipelineResumeTimer) {
        window.clearTimeout(__foregroundPipelineResumeTimer);
        __foregroundPipelineResumeTimer = 0;
    }
    __foregroundPipelineResumeTimer = window.setTimeout(() => {
        __foregroundPipelineResumeTimer = 0;
        if (isDocumentHidden()) return;
        if (isLayerEnabled("aircraft")) {
            requestFastForegroundAircraftRecovery({
                forceRefresh: wasSuspended || backgroundIdleMs > FOREGROUND_RECOVERY_WORK_THRESHOLD_MS,
                forcePublicRefresh: wasSuspended,
            });
        }
        if (wasSuspended || backgroundIdleMs > FOREGROUND_RECOVERY_WORK_THRESHOLD_MS) {
            void refreshIntelWireItems({ force: false });
        }
    }, 700);
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
    if (!filterButtons.length) {
        __aircraftWidgetFilter = "active";
        return;
    }
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
function normalizeAircraftCountryFilterValue(country = "") {
    return sanitizeAircraftText(country || "Unknown").trim().toLowerCase() || "unknown";
}
function getAircraftCountryFilterOptions(items = []) {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((track) => {
        const label = getAircraftCountryLabel(track);
        const value = normalizeAircraftCountryFilterValue(label);
        if (value === "unknown") return;
        if (!map.has(value)) {
            map.set(value, label || "Unknown");
        }
    });
    return [...map.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
function updateAircraftWidgetTitleCount(total = 0) {
    const titleEl = document.getElementById("widget-aircraft-title");
    if (!titleEl) return;
    const count = Math.max(0, Math.floor(Number(total) || 0));
    const capped = Math.min(LIVE_AIRCRAFT_WIDGET_TITLE_MAX_COUNT, count);
    const highValueCount = Math.max(0, Math.floor(Number(titleEl.dataset.hvaCount || 0) || 0));
    titleEl.textContent = `Aircraft Tracker (${capped})${highValueCount ? ` • ${highValueCount} HVA` : ""}`;
}
function updateAircraftWidgetHighValueCount(count = 0) {
    const titleEl = document.getElementById("widget-aircraft-title");
    if (!titleEl) return;
    titleEl.dataset.hvaCount = String(Math.max(0, Math.floor(Number(count) || 0)));
}
function updateNavalWidgetTitleCount(total = 0, highValueTotal = 0) {
    const titleEl = document.getElementById("widget-naval-title");
    if (!titleEl) return;
    const count = Math.max(0, Math.floor(Number(total) || 0));
    const highValueCount = Math.max(0, Math.floor(Number(highValueTotal) || 0));
    titleEl.textContent = `Naval Tracker (${count})${highValueCount ? ` • ${highValueCount} HVA` : ""}`;
}
function syncAircraftCountryFilterControls(countrySourceItems = []) {
    const countrySelect = document.getElementById("wz-aircraft-filter-country");
    if (!countrySelect) return;
    const options = getAircraftCountryFilterOptions(countrySourceItems);
    const optionKey = options
        .map((option) => `${option.value}:${option.label}`)
        .join("|");
    if (countrySelect.dataset.optionKey !== optionKey) {
        countrySelect.innerHTML = "";
        const allOption = document.createElement("option");
        allOption.value = "all";
        allOption.textContent = "All Countries";
        countrySelect.appendChild(allOption);
        options.forEach((option) => {
            const nextOption = document.createElement("option");
            nextOption.value = option.value;
            nextOption.textContent = option.label;
            countrySelect.appendChild(nextOption);
        });
        countrySelect.dataset.optionKey = optionKey;
    }
    const allowedValues = new Set(["all", ...options.map((option) => option.value)]);
    const selectedValue = normalizeAircraftCountryFilterValue(__aircraftWidgetCountryFilter || "all");
    if (!allowedValues.has(selectedValue)) {
        __aircraftWidgetCountryFilter = "all";
    }
    countrySelect.value = __aircraftWidgetCountryFilter || "all";
}
function getNavalCountryFilterLabel(vessel = {}) {
    const metadata = getAircraftMetadata(vessel);
    const explicit = normalizeCountryName(
        sanitizeAircraftText(
            vessel.country ||
            vessel.flag_country ||
            vessel.operator_country ||
            metadata.country ||
            metadata.flag_country ||
            metadata.operator_country ||
            ""
        )
    );
    if (explicit && !isUnknownAircraftCountryLabel(explicit)) {
        return explicit;
    }
    const inferred = [
        vessel.operator,
        vessel.vessel_name,
        vessel.platform_name,
        vessel.title,
        vessel.designation,
        metadata.operator,
        metadata.vessel_name,
        metadata.title,
    ]
        .map((value) => inferAircraftCountryFromText(value))
        .find((value) => value && !isUnknownAircraftCountryLabel(value));
    return inferred || "Unknown";
}
function getNavalCountryFilterOptions(items = []) {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((vessel) => {
        const label = getNavalCountryFilterLabel(vessel);
        const value = normalizeAircraftCountryFilterValue(label);
        if (value === "unknown") return;
        if (!map.has(value)) {
            map.set(value, label || "Unknown");
        }
    });
    return [...map.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}
function syncNavalCountryFilterControls(countrySourceItems = []) {
    const countrySelect = document.getElementById("wz-naval-filter-country");
    if (!countrySelect) return;
    const options = getNavalCountryFilterOptions(countrySourceItems);
    const optionKey = options
        .map((option) => `${option.value}:${option.label}`)
        .join("|");
    if (__navalCountryOptionsKey !== optionKey) {
        countrySelect.innerHTML = "";
        const allOption = document.createElement("option");
        allOption.value = "all";
        allOption.textContent = "All Countries";
        countrySelect.appendChild(allOption);
        options.forEach((option) => {
            const nextOption = document.createElement("option");
            nextOption.value = option.value;
            nextOption.textContent = option.label;
            countrySelect.appendChild(nextOption);
        });
        __navalCountryOptionsKey = optionKey;
    }
    const allowedValues = new Set(["all", ...options.map((option) => option.value)]);
    const selectedValue = normalizeAircraftCountryFilterValue(__navalWidgetCountryFilter || "all");
    if (!allowedValues.has(selectedValue)) {
        __navalWidgetCountryFilter = "all";
    }
    countrySelect.value = __navalWidgetCountryFilter || "all";
}
function prioritizeSelectedAircraftWidgetItem(items = [], trackKey = "") {
    const selectedTrackKey = String(trackKey || "").trim();
    if (!selectedTrackKey || !Array.isArray(items) || !items.length) {
        return Array.isArray(items) ? items : [];
    }
    const selectedIndex = items.findIndex(
        (track) => String(track?.track_key || "").trim() === selectedTrackKey
    );
    if (selectedIndex <= 0) {
        return items;
    }
    const prioritizedItems = [...items];
    const [selectedTrack] = prioritizedItems.splice(selectedIndex, 1);
    prioritizedItems.unshift(selectedTrack);
    return prioritizedItems;
}
function getAircraftWidgetItems() {
    __aircraftWidgetScopeFilter = "region";
    if (!isLayerEnabled("aircraft")) {
        return {
            allItems: [],
            baseItems: [],
            items: [],
            highValueItems: [],
            filteredCount: 0,
            emptyMessage: "Aircraft layer is off",
        };
    }
    const liveItems = getAllLiveTrackSnapshots({ includePathHistory: false })
        .map((track) => ({ ...track, subcategory: resolveAircraftSubtype(track) }))
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => !shouldExcludeFromMilitaryAircraftTracker(track))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer")
        .filter((track) => isTrackerItemVisibleInScope(track, __aircraftWidgetScopeFilter));
    const historyItems = (__aircraftHistoryCache || [])
        .map((track) => ({ ...track, subcategory: resolveAircraftSubtype(track) }))
        .filter((track) => isAircraftTrackSubtype(track.subcategory))
        .filter((track) => !shouldExcludeFromMilitaryAircraftTracker(track))
        .filter((track) => String(track.subcategory || "").toLowerCase() !== "trainer")
        .filter((track) => isTrackerItemVisibleInScope(track, __aircraftWidgetScopeFilter));
    const allItems = mergeAircraftWidgetSources(liveItems, historyItems);
    const liveKeys = new Set(liveItems.map((track) => getAircraftMergeKey(track)));
    let baseItems = [];
    if (__aircraftWidgetFilter === "recent") {
        const recentCutoff = Date.now() - AIRCRAFT_RECENT_WINDOW_MS;
        baseItems = allItems.filter((track) =>
            Number(track.last_seen_at || 0) >= recentCutoff
        );
    } else if (__aircraftWidgetFilter === "ended") {
        baseItems = allItems.filter((track) => !track.active);
    } else {
        baseItems = isDatabaseAircraftLiveSourceEnabled()
            ? allItems.filter((track) => track.active)
            : allItems.filter((track) => track.active && liveKeys.has(getAircraftMergeKey(track)));
    }
    let items = baseItems;
    if (__aircraftWidgetSubtypeFilter && __aircraftWidgetSubtypeFilter !== "all") {
        items = items.filter(
            (track) => String(track.subcategory || "").toLowerCase() === __aircraftWidgetSubtypeFilter
        );
    }
    let activeCountryItems = isDatabaseAircraftLiveSourceEnabled()
        ? allItems.filter((track) => track.active)
        : allItems.filter((track) => track.active && liveKeys.has(getAircraftMergeKey(track)));
    if (__aircraftWidgetSubtypeFilter && __aircraftWidgetSubtypeFilter !== "all") {
        activeCountryItems = activeCountryItems.filter(
            (track) => String(track.subcategory || "").toLowerCase() === __aircraftWidgetSubtypeFilter
        );
    }
    const countryOptions = getAircraftCountryFilterOptions(activeCountryItems);
    const allowedCountryValues = new Set(countryOptions.map((option) => option.value));
    const selectedCountryValue = normalizeAircraftCountryFilterValue(__aircraftWidgetCountryFilter || "all");
    if (selectedCountryValue !== "all" && !allowedCountryValues.has(selectedCountryValue)) {
        __aircraftWidgetCountryFilter = "all";
    }
    if (selectedCountryValue !== "all" && allowedCountryValues.has(selectedCountryValue)) {
        items = items.filter(
            (track) => normalizeAircraftCountryFilterValue(getAircraftCountryLabel(track)) === selectedCountryValue
        );
    }
    const highValueItems = isHighValueAssetDetectionEnabled()
        ? allItems
            .filter((track) => track.active)
            .filter((track) => getHighValueAircraftMeta(track))
        : [];
    const filteredCount = items.length;
    const selection = getLiveTrackSelection();
    items = prioritizeSelectedAircraftWidgetItem(
        [...items].sort((a, b) => Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0)),
        selection.track_key
    ).slice(0, LIVE_AIRCRAFT_WIDGET_MAX_ITEMS * __aircraftWidgetPage);
    return {
        allItems,
        baseItems,
        activeCountryItems,
        items,
        highValueItems,
        filteredCount,
        emptyMessage: "No aircraft logs in selected region",
    };
}
function ensureAircraftWidgetEmptyState(container, hasItems, message = "No aircraft logs in the current filter") {
    let emptyEl = container.querySelector(".wz-aircraft-empty");
    if (!hasItems) {
        if (!emptyEl) {
            emptyEl = document.createElement("div");
            emptyEl.className = "wz-aircraft-empty";
            container.appendChild(emptyEl);
        }
        emptyEl.textContent = message;
        return;
    }
    if (emptyEl) {
        emptyEl.remove();
    }
}
function getAircraftWidgetActionLabel(track, selection) {
    const isSelected = selection.track_key === track.track_key;
    return track.active
        ? (isSelected ? "Unlock" : "Focus")
        : (isSelected ? "Hide" : "Replay");
}
function getAircraftWidgetTimeLabel(track) {
    return track.active
        ? formatAircraftLastSeen(track.last_seen_at)
        : formatAircraftEndedAt(track.ended_at || track.last_seen_at);
}
function updateAircraftWidgetCard(card, track, selection) {
    if (!card || !track) return;
    const detailLabel = getAircraftWidgetDetailLabel(track);
    const affiliationLabel = getAircraftWidgetForceLabel(track);
    const title = getAircraftDisplayTitle(track);
    const isSelected = selection.track_key === track.track_key;
    const isAircraftFocusLocked = Boolean(selection.track_key && selection.mode === "focus");
    const isFocusDisabled = isAircraftFocusLocked && !isSelected;
    const statusLabel = getAircraftWidgetStatusLabel(track);
    const timeLabel = getAircraftWidgetTimeLabel(track);
    const actionLabel = getAircraftWidgetActionLabel(track, selection);
    const altitudeLabel = formatAircraftAltitude(track.altitude_ft);
    const speedLabel = formatAircraftSpeed(track.speed_kts);
    const headingLabel = `HDG ${Math.round(Number(track.heading_deg || 0))}°`;
    const action = track.active
        ? (isSelected ? "unlock" : "focus")
        : (isSelected ? "hide" : "replay");
    const renderSignature = [
        track.active ? "1" : "0",
        isSelected ? "1" : "0",
        isFocusDisabled ? "1" : "0",
        statusLabel,
        title,
        timeLabel,
        detailLabel,
        affiliationLabel,
        altitudeLabel,
        speedLabel,
        headingLabel,
        action,
        actionLabel,
    ].join("\u001f");
    if (
        card.dataset.renderSignature === renderSignature &&
        card.querySelector(".wz-aircraft-item__top") &&
        card.querySelector(".wz-aircraft-item__meta") &&
        card.querySelector(".wz-aircraft-item__stats") &&
        card.querySelector(".wz-aircraft-item__foot")
    ) {
        return;
    }
    card.className = `wz-aircraft-item ${track.active ? "is-active" : "is-ended"} ${isSelected ? "is-selected" : ""} ${isFocusDisabled ? "is-focus-disabled" : ""}`;
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
        actionBtn.appendChild(document.createElement("span"));
        actionBtn.appendChild(document.createTextNode(""));
        foot.appendChild(actionBtn);
        card.appendChild(foot);
    }
    titleEl = card.querySelector(".wz-aircraft-item__title");
    timeEl = card.querySelector(".wz-aircraft-item__time");
    actionBtn = card.querySelector(".wz-aircraft-action");
    let statusWrap = titleEl.querySelector(".wz-aircraft-title__status");
    let statusIcon = statusWrap?.querySelector(".stratops-ico-assets-signal-thermal-1") || null;
    let titleText = titleEl.querySelector(".wz-aircraft-title__text");
    if (!statusWrap) {
        statusWrap = document.createElement("span");
        statusWrap.className = "wz-aircraft-title__status";
        statusIcon = document.createElement("span");
        statusIcon.className = "stratops-ico-assets-signal-thermal-1";
        statusIcon.setAttribute("aria-hidden", "true");
        statusWrap.appendChild(statusIcon);
        titleEl.appendChild(statusWrap);
    }
    if (!titleText) {
        titleText = document.createElement("span");
        titleText.className = "wz-aircraft-title__text";
        titleEl.appendChild(titleText);
    }
    statusWrap.className = `wz-aircraft-title__status ${track.active ? "is-active" : "is-ended"}`;
    statusWrap.setAttribute("aria-label", statusLabel);
    titleText.textContent = String(title || "").toUpperCase();
    timeEl.textContent = String(timeLabel || "").toUpperCase();
    const metaSpans = meta.querySelectorAll("span");
    if (metaSpans[0]) {
        metaSpans[0].dataset.label = "TYPE";
        metaSpans[0].textContent = String(detailLabel || "").toUpperCase();
    }
    if (metaSpans[1]) {
        metaSpans[1].dataset.label = "FORCE";
        metaSpans[1].textContent = String(affiliationLabel || "").toUpperCase();
    }
    const statSpans = stats.querySelectorAll("span");
    if (statSpans[0]) {
        statSpans[0].dataset.label = "ALT";
        statSpans[0].textContent = String(altitudeLabel || "").toUpperCase();
    }
    if (statSpans[1]) {
        statSpans[1].dataset.label = "SPEED";
        statSpans[1].textContent = String(speedLabel || "").toUpperCase();
    }
    if (statSpans[2]) {
        statSpans[2].dataset.label = "HEADING";
        statSpans[2].textContent = String(headingLabel || "").toUpperCase();
    }
    actionBtn.dataset.trackAction = action;
    actionBtn.dataset.trackToggle = String(track.track_key || "");
    actionBtn.disabled = isFocusDisabled;
    actionBtn.setAttribute("aria-disabled", isFocusDisabled ? "true" : "false");
    actionBtn.classList.toggle("is-focus-disabled", isFocusDisabled);
    const actionIcon = actionBtn.querySelector("span") || document.createElement("span");
    if (!actionIcon.parentNode) {
        actionBtn.appendChild(actionIcon);
        actionBtn.appendChild(document.createTextNode(""));
    }
    actionIcon.setAttribute("aria-hidden", "true");
    if (!actionIcon.nextSibling) {
        actionBtn.appendChild(document.createTextNode(actionLabel));
    } else {
        actionIcon.nextSibling.textContent = actionLabel;
    }
    card.dataset.renderSignature = renderSignature;
}

function renderAircraftMovementsWidget() {
    const container = document.getElementById("wz-aircraft-panel");
    const subtypeSelect = document.getElementById("wz-aircraft-filter-subtype");
    if (!container) return;
    __aircraftWidgetScopeFilter = "region";
    syncAircraftWidgetFilterControls();
    const { items, baseItems, activeCountryItems, highValueItems, filteredCount, emptyMessage } = getAircraftWidgetItems();
    updateAircraftWidgetHighValueCount(highValueItems.length);
    updateAircraftWidgetTitleCount(filteredCount);
    notifyHighValueAssets("aircraft", highValueItems);
    const selection = getLiveTrackSelection();
    if (subtypeSelect) {
        const currentValue = subtypeSelect.value || __aircraftWidgetSubtypeFilter;
        const options = getAircraftSubtypeOptions(baseItems);
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
    syncAircraftCountryFilterControls(activeCountryItems);
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
    ensureAircraftWidgetEmptyState(container, items.length > 0, emptyMessage);
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
    let previousCard = null;
    cardsInOrder.forEach((card) => {
        const expectedNode = previousCard
            ? previousCard.nextElementSibling
            : container.querySelector(".wz-aircraft-item");
        if (card !== expectedNode) {
            container.insertBefore(card, expectedNode || null);
        }
        previousCard = card;
    });

    // Load More button
    let nextLoadMoreBtn = container.querySelector(".wz-aircraft-load-more");
    const allForCount = Math.max(0, Number(filteredCount || 0));
    const shownCount = items.length;
    const hasMore = allForCount > shownCount;
    if (hasMore) {
        if (!nextLoadMoreBtn) {
            nextLoadMoreBtn = document.createElement("button");
            nextLoadMoreBtn.type = "button";
            nextLoadMoreBtn.className = "wz-aircraft-load-more btn-secondary white";
            nextLoadMoreBtn.dataset.aircraftLoadMore = "1";
            nextLoadMoreBtn.appendChild(document.createElement("span"));
            nextLoadMoreBtn.appendChild(document.createTextNode(""));
        }
        const remaining = Math.min(LIVE_AIRCRAFT_WIDGET_MAX_ITEMS, Math.max(0, allForCount - shownCount));
        const labelNode = nextLoadMoreBtn.querySelector("span")?.nextSibling;
        if (labelNode) {
            labelNode.textContent = `Load More (${remaining} more)`;
        }
        if (nextLoadMoreBtn.parentNode !== container || nextLoadMoreBtn !== container.lastElementChild) {
            container.appendChild(nextLoadMoreBtn);
        }
    } else {
        nextLoadMoreBtn?.remove();
    }
}
function bindAircraftMovementsWidget() {
    const aircraftWidgetEnabled = isStratOpsFeatureEnabled("widgets.aircraftTracker");
    const navalWidgetEnabled = isStratOpsFeatureEnabled("widgets.navalTracker");
    if (!aircraftWidgetEnabled && !navalWidgetEnabled) return;
    if (__aircraftWidgetBound) return;
    __aircraftWidgetBound = true;
    document.addEventListener("click", (event) => {
        const loadMoreBtn = event.target.closest("[data-aircraft-load-more]");
        if (loadMoreBtn && aircraftWidgetEnabled) {
            event.preventDefault();
            event.stopPropagation();
            __aircraftWidgetPage += 1;
            requestAircraftMovementsWidgetRender(0);
            return;
        }
        const navalLoadMoreBtn = event.target.closest("[data-naval-load-more]");
        if (navalLoadMoreBtn && navalWidgetEnabled) {
            event.preventDefault();
            event.stopPropagation();
            __navalWidgetPage += 1;
            requestNavalWidgetRender(0);
            return;
        }
        const actionBtn = event.target.closest("[data-track-action]");
        if (actionBtn && aircraftWidgetEnabled) {
            if (actionBtn.disabled || actionBtn.getAttribute("aria-disabled") === "true") return;
            const trackKey = String(actionBtn.dataset.trackToggle || "").trim();
            if (!trackKey) return;
            const action = String(actionBtn.dataset.trackAction || "").trim().toLowerCase();
            if (action === "focus") {
                focusLiveTrack(trackKey);
            } else if (action === "unlock") {
                clearLiveTrackSelection();
            } else {
                toggleLiveTrackSelection(trackKey);
            }
            requestAircraftMovementsWidgetRender(0);
            return;
        }
        const filterBtn = event.target.closest("[data-aircraft-filter]");
        if (filterBtn && aircraftWidgetEnabled) {
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
        if (subtypeSelect && aircraftWidgetEnabled) {
            __aircraftWidgetSubtypeFilter = String(subtypeSelect.value || "all");
            __aircraftWidgetPage = 1;
            if (__aircraftWidgetFilter !== "active") {
                scheduleAircraftHistoryRefresh(true);
                return;
            }
            requestAircraftMovementsWidgetRender(0);
            return;
        }
        const countrySelect = event.target.closest("#wz-aircraft-filter-country");
        if (countrySelect && aircraftWidgetEnabled) {
            __aircraftWidgetCountryFilter = String(countrySelect.value || "all").trim().toLowerCase() || "all";
            __aircraftWidgetPage = 1;
            if (__aircraftWidgetFilter !== "active") {
                scheduleAircraftHistoryRefresh(true);
                return;
            }
            requestAircraftMovementsWidgetRender(0);
            return;
        }
        const navalSubtypeSelect = event.target.closest("#wz-naval-filter-subtype");
        if (navalSubtypeSelect && navalWidgetEnabled) {
            __navalWidgetSubtypeFilter = normalizeNavalSubtype(String(navalSubtypeSelect.value || "all")) || "all";
            __navalWidgetPage = 1;
            requestNavalWidgetRender(0);
            return;
        }
        const navalCountrySelect = event.target.closest("#wz-naval-filter-country");
        if (!navalCountrySelect || !navalWidgetEnabled) return;
        __navalWidgetCountryFilter = String(navalCountrySelect.value || "all").trim().toLowerCase() || "all";
        __navalWidgetPage = 1;
        requestNavalWidgetRender(0);
    });
    document.addEventListener("wz:aircraft-log-updated", () => {
        if (!aircraftWidgetEnabled) return;
        requestAircraftMovementsWidgetRender();
    });
    document.addEventListener("wz:aircraft-focus-lock-changed", () => {
        syncFocusAwareBackgroundLoops();
        if (aircraftWidgetEnabled) requestAircraftMovementsWidgetRender(0);
        if (navalWidgetEnabled) requestNavalWidgetRender(0);
    });
    document.addEventListener("wz:aircraft-track-selected", () => {
        syncFocusAwareBackgroundLoops();
        if (isAircraftFocusModeActive()) {
            window.__warzoneViewer?.__warzone?.clearAlertHighlight?.();
        }
        if (aircraftWidgetEnabled) requestAircraftMovementsWidgetRender(0);
        if (navalWidgetEnabled) requestNavalWidgetRender(0);
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
function renderAll(events, { replaceCache = true, replaceAllCache = replaceCache } = {}) {
    const normalizedEvents = trimSortedEventList(sortEvents(
        events.map((event) => {
            const normalized = normalizeEvent(event);
            return {
                ...normalized,
                theater: resolveEventTheater(normalized)
            };
        })
            .filter((event) => !isTrainerAircraftSignalEvent(event))
    ), EVENT_CACHE_MAX_ITEMS);
    if (replaceAllCache) {
        __allEventsCache = normalizedEvents;
    }
    const regionScopedEvents = trimSortedEventList(
        sortEvents(filterEventsToActiveRegion(normalizedEvents)),
        EVENT_CACHE_MAX_ITEMS
    );
    if (replaceCache) {
        __eventsCache = regionScopedEvents;
    }
    __visibleEventsCache = trimSortedEventList(regionScopedEvents, EVENT_VISIBLE_CACHE_MAX_ITEMS);
    const scoped = applyOperationalScopeFilters(regionScopedEvents);
    const filtered = applyAllFilters(regionScopedEvents);
    updateTheaterPanel(scoped);
    debouncedRenderFeed(filtered);
    debouncedRenderUI(scoped);
    debouncedRenderHeavy(filtered);
    debouncedRenderRaw();
}
function syncFilteredUi(events) {
    const scoped = applyOperationalScopeFilters(events);
    const filtered = applyAllFilters(events);
    debouncedRenderFeed(filtered);
    updateTheaterPanel(scoped);
    debouncedRenderUI(scoped);
    debouncedRenderHeavy(filtered);
    debouncedRenderRaw();
    return filtered;
}
function syncHotspotLayerEvents(events = []) {
    if (!__hotspotLayer) return;
    if (!isLayerEnabled("hotspots") || !hasEnabledGlobeEventLayer()) {
        __hotspotLayer.setEvents([]);
        return;
    }
    const primary = getHotspotSourceEvents(events);
    if (primary.length) {
        __hotspotLayer.setEvents(primary);
        return;
    }
    // Fallback: viewport-scoped sources can occasionally be empty due bounds
    // edge cases while theater counters still have valid conflict events.
    const fallback = applyHotspotFilters(__eventsCache, { respectRegion: true }).filter((event) => isEventVisible(event));
    __hotspotLayer.setEvents(getHotspotSourceEvents(fallback));
}
function ensureHotspotLayer(viewer, hotspotRoot) {
    if (!viewer || !hotspotRoot || __hotspotLayer) return __hotspotLayer;
    __hotspotLayer = createWarzoneHotspotLayer(viewer, hotspotRoot, {
        maxCards: 92,
        maxEvents: 1800,
        clusterDistanceLat: 0.9,
        clusterDistanceLon: 1.1,
        stackDistancePx: 76,
        maxVisiblePerHotspot: 6,
        minItemsForCluster: 1,
        throttleMove: 90,
    });
    window.__hotspotLayer = __hotspotLayer;
    return __hotspotLayer;
}
const GLOBE_CLUSTER_RADIUS_DEG = 0.5;
const GLOBE_CLUSTER_THRESHOLD = 240;
function getGlobeClusterRadiusDeg() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    if (height > 7000000) return 0.5;
    if (height > 4500000) return 0.34;
    if (height > 2800000) return 0.24;
    if (height > 1600000) return 0.16;
    return 0.11;
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
function isOverlayCircleEvent(event = {}) {
    const category = String(event.category || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const metadata = getEventMetadata(event);
    const trackType = String(event.track_type || metadata.track_type || "").toLowerCase();
    const sub = String(
        event.subcategory ||
        event.subtype ||
        event.type ||
        ""
    ).toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const text = `${sub} ${weapon} ${title}`;
    const radarCapablePlatform = (
        text.includes("awacs") ||
        text.includes("fighter") ||
        text.includes("carrier") ||
        text.includes("destroyer") ||
        text.includes("frigate") ||
        text.includes("submarine") ||
        text.includes("sam") ||
        text.includes("air defense")
    );
    const airspaceControlSignal = (
        text.includes("airspace") ||
        text.includes("notam")
    );
    if (trackType === "aircraft" && radarCapablePlatform) return true;
    if (airspaceControlSignal || category === "airspace" || reportType === "airspace_status" || reportType === "notam") {
        return true;
    }
    if (["air_activity", "naval_activity"].includes(category) && radarCapablePlatform) {
        return true;
    }
    if (["military", "recon", "recon_intel"].includes(category) && radarCapablePlatform) {
        return true;
    }
    return false;
}
function getOverlayClusterRadiusDeg() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    if (height > 7000000) return 2.2;
    if (height > 4500000) return 1.6;
    if (height > 2800000) return 1.15;
    if (height > 1600000) return 0.85;
    return 0.65;
}
function getOverlayClusterRadiusBucket() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    if (height > 7000000) return "h4";
    if (height > 4500000) return "h3";
    if (height > 2800000) return "h2";
    if (height > 1600000) return "h1";
    return "h0";
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
        cluster_count: c.count,
        _clusterCount: c.count,
        _clusterEvents: c.events,
    }));
}
function clusterEventsForOverlays(events) {
    if (!Array.isArray(events) || !events.length) return [];
    const clusterRadiusDeg = getOverlayClusterRadiusDeg();
    const clusters = [];
    for (const event of events) {
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
        cluster_count: c.count,
        _clusterCount: c.count,
        _clusterEvents: c.events,
    }));
}
function makeOverlaySignature(events) {
    if (!Array.isArray(events) || !events.length) return "__empty__";
    return events
        .map((event) => {
            const lat = Number(event.lat || 0);
            const lon = Number(event.lon || 0);
            const id = String(event.id || event.track_key || event.title || event.weapon_type || "overlay");
            return `${id}:${Number(event._clusterCount || 1)}:${lat.toFixed(2)}:${lon.toFixed(2)}`;
        })
        .join("|");
}
function syncInitialEventsToGlobe(events, {
    animateTracks = false,
    updatePerformance = true,
    syncHotspots = true,
    syncNaval = true,
} = {}) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;
    const hotspotsEnabled = isLayerEnabled("hotspots");
    const globeEventLayersEnabled = hasEnabledGlobeEventLayer();
    globe.setEventMarkersSuppressed?.(!globeEventLayersEnabled);
    if (!globeEventLayersEnabled) {
        if (syncHotspots) {
            syncHotspotLayerEvents([]);
        }
        globe.clearEventEntities?.();
        __militaryTracks?.setTracks([]);
        if (window.__warzoneViewer) {
            clearRanges(window.__warzoneViewer);
            clearSweepers(window.__warzoneViewer);
        }
        __lastGlobeSyncKey = "__empty__";
        __lastGlobeClusterBucket = "";
        __lastRangesSyncKey = "__off__";
        __lastSweepersSyncKey = "__off__";
        __lastOverlaySourceKey = "__empty__";
        __lastOverlayClusterRadiusBucket = "";
        __cachedOverlayClusters = [];
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }
    const visible = applyAllFilters(events);
    const hotspotStableSource = hotspotsEnabled
        && syncHotspots
        ? applyHotspotFilters(events, { respectRegion: true }).filter((event) => isEventVisible(event))
        : [];
    // Naval tracker panel should follow selected region/lens, not camera bounds.
    if (syncNaval && isNavalTrackingFeatureEnabled() && isLayerEnabled("naval")) {
        const scopedCacheVisible = applyAllFilters(__eventsCache);
        syncNavalSignals(scopedCacheVisible.filter(isNavalSignalEvent));
    }
    const globeVisible = visible.filter(
        (event) => !isNavalSignalEvent(event) && !isAircraftTelemetryEvent(event)
    );
    const hotspotGlobeVisible = hotspotsEnabled
        && syncHotspots
        ? hotspotStableSource.filter(
            (event) => !isNavalSignalEvent(event) && !isAircraftTelemetryEvent(event)
        )
        : [];
    const renderVisible = globeVisible.length ? globeVisible : hotspotGlobeVisible;
    const globeClusterBucket = String(globe.getEventClusterBucket?.() || "default");
    const visibleSignature = `${makeEventSignature(renderVisible)}|cluster:${globeClusterBucket}`;
    const rangesEnabled = isLayerEnabled("ranges");
    const sweepersEnabled = isLayerEnabled("sweepers");
    const overlaysEnabled = rangesEnabled || sweepersEnabled;
    let overlaySource = [];
    let overlayVisible = [];
    let overlaySignature = "__off__";
    let sweeperSignature = "__off__";
    if (overlaysEnabled) {
        overlaySource = globeVisible.filter(isOverlayCircleEvent);
        const overlaySourceKey = makeOverlaySignature(overlaySource);
        if (sweepersEnabled) {
            sweeperSignature = overlaySourceKey;
        }
        if (rangesEnabled) {
            const clusterRadiusBucket = getOverlayClusterRadiusBucket();
            const canReuseClusters =
                overlaySourceKey === __lastOverlaySourceKey &&
                clusterRadiusBucket === __lastOverlayClusterRadiusBucket;
            if (canReuseClusters) {
                overlayVisible = __cachedOverlayClusters;
            } else {
                overlayVisible = clusterEventsForOverlays(overlaySource);
                __cachedOverlayClusters = overlayVisible;
                __lastOverlaySourceKey = overlaySourceKey;
                __lastOverlayClusterRadiusBucket = clusterRadiusBucket;
            }
            overlaySignature = makeOverlaySignature(overlayVisible);
        }
    }
    if (updatePerformance) {
        globe.setPerformanceMode?.(renderVisible.length);
    }
    if (!renderVisible.length) {
        if (syncHotspots) {
            syncHotspotLayerEvents(hotspotsEnabled ? hotspotStableSource : []);
        }
        if (__lastGlobeSyncKey !== "__empty__") {
            globe.clearEventEntities?.();
            __militaryTracks?.setTracks([]);
            if (window.__warzoneViewer) {
                clearRanges(window.__warzoneViewer);
                clearSweepers(window.__warzoneViewer);
            }
            __lastGlobeSyncKey = "__empty__";
            __lastGlobeClusterBucket = "";
            __lastRangesSyncKey = "__off__";
            __lastSweepersSyncKey = "__off__";
            __lastOverlaySourceKey = "__empty__";
            __lastOverlayClusterRadiusBucket = "";
            __cachedOverlayClusters = [];
        }
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }
    if (visibleSignature !== __lastGlobeSyncKey) {
        globe.addEvents?.(
            renderVisible.map((event) => ({
                ...event,
                _layerId: getEventLayerId(event),
            }))
        );
        if (__militaryTracks) {
            __militaryTracks.setTracks(
                globeVisible.filter((event) => isMilitaryTrackEvent(event) && isEventVisible(event))
            );
        }
        __lastGlobeSyncKey = visibleSignature;
        __lastGlobeClusterBucket = globeClusterBucket;
    }
    if (__hotspotLayer) {
        if (syncHotspots) {
            syncHotspotLayerEvents(hotspotsEnabled ? hotspotStableSource : []);
        }
    }
    if (window.__warzoneViewer) {
        const nextRangesKey = rangesEnabled ? overlaySignature : "__off__";
        if (nextRangesKey !== __lastRangesSyncKey) {
            clearRanges(window.__warzoneViewer);
            if (rangesEnabled) {
                renderRanges(window.__warzoneViewer, overlayVisible);
            }
            __lastRangesSyncKey = nextRangesKey;
        }
        const nextSweepersKey = sweepersEnabled ? sweeperSignature : "__off__";
        if (nextSweepersKey !== __lastSweepersSyncKey) {
            clearSweepers(window.__warzoneViewer);
            if (sweepersEnabled) {
                renderSweepers(window.__warzoneViewer, overlaySource);
            }
            __lastSweepersSyncKey = nextSweepersKey;
        }
    }
    if (animateTracks) {
        const recentTracks = renderVisible
            .filter((event) => isTrackLikeEvent(event))
            .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))
            .slice(0, 3);
        for (const event of recentTracks) {
            globe.animateMissileTrack?.(event);
        }
    }
    window.__warzoneViewer?.scene?.requestRender?.();
}
function getCurrentMapSourceEvents() {
    return __viewportScoped ? __visibleEventsCache : __eventsCache;
}
function scheduleGlobeEventRecluster(delay = 120) {
    clearTimeout(__globeReclusterTimer);
    __globeReclusterTimer = window.setTimeout(() => {
        __globeReclusterTimer = 0;
        const globe = window.__warzoneViewer?.__warzone;
        if (!globe?.getEventClusterBucket) return;
        const nextBucket = String(globe.getEventClusterBucket() || "default");
        if (nextBucket === __lastGlobeClusterBucket) return;
        syncInitialEventsToGlobe(getCurrentMapSourceEvents(), {
            animateTracks: false,
            updatePerformance: false,
            syncHotspots: true,
            syncNaval: false,
        });
    }, Math.max(0, Number(delay || 0)));
}
function scheduleHotspotLayerRefresh(delay = 80) {
    clearTimeout(__hotspotDeferredSyncTimer);
    __hotspotDeferredSyncTimer = window.setTimeout(() => {
        __hotspotDeferredSyncTimer = 0;
        const hotspotEnabled = isLayerEnabled("hotspots");
        if (hotspotEnabled) {
            ensureHotspotLayer(window.__warzoneViewer, document.getElementById("warzone-hotspot-layer"));
        }
        syncHotspotRootVisibility(hotspotEnabled);
        if (!__hotspotLayer) return;
        syncHotspotLayerEvents(
            hotspotEnabled
                ? applyHotspotFilters(getCurrentMapSourceEvents(), { respectRegion: true })
                : []
        );
    }, Math.max(0, Number(delay || 0)));
}
function scheduleLayerDeferredRefresh(delay = 90) {
    clearTimeout(__layerDeferredRefreshTimer);
    __layerDeferredRefreshTimer = window.setTimeout(() => {
        __layerDeferredRefreshTimer = 0;
        const globe = window.__warzoneViewer?.__warzone;
        const mapSourceEvents = getCurrentMapSourceEvents();
        scheduleHotspotLayerRefresh(0);
        syncFilteredUi(__eventsCache);
        const perfVisibleCount = applyAllFilters(mapSourceEvents).filter(
            (event) => !isNavalSignalEvent(event) && !isAircraftTelemetryEvent(event)
        ).length;
        globe?.setPerformanceMode?.(perfVisibleCount);
        const widgetScoped = applyOperationalScopeFilters(__eventsCache);
        const widgetStatusEvents = getWidgetStatusEvents(widgetScoped);
        renderAirspaceStatus(widgetStatusEvents);
        renderCyberStatus(widgetStatusEvents);
    }, Math.max(0, Number(delay || 0)));
}
function syncImmediateEventLayerVisibility(globe, id = "") {
    if (!globe?.setEventLayerVisible) return;
    const syncOne = (layer) => {
        if (!layer || layer.uiOnly) return;
        globe.setEventLayerVisible(layer.id, isLayerEnabled(layer.id));
    };
    if (id === "*") {
        LAYER_DEFS.forEach(syncOne);
        return;
    }
    syncOne(LAYER_DEFS.find((layer) => layer.id === id));
}
export async function initWarzoneApp() {
    applyStratOpsFeatureVisibility();
    bindGlobeEventPopup();
    hydrateLayerStateFromStorage();
    if (isStratOpsFeatureEnabled("widgets.layers") && isStratOpsFeatureEnabled("dock.layers")) {
        initLayerPanel();
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for events

    try {
        let events = [];
        try {
            const { data, error } = await api.getEvents({ signal: controller.signal });
            if (error) {
                logEventsApiError("Supabase events error:", error);
                if (isEventsApiRestrictedError(error)) {
                    __eventsApiRestrictedUntil = Date.now() + EVENTS_API_RESTRICTED_BACKOFF_MS;
                }
            } else {
                events = Array.isArray(data) ? data.map((row) => normalizeEvent(row)).filter(Boolean) : [];
                __eventsApiRestrictedUntil = 0;
            }
        } catch (err) {
            if (!isRequestAbortError(err)) {
                logEventsApiError("Initial events fetch failed:", err);
                __eventsApiRestrictedUntil = Date.now() + EVENTS_API_RESTRICTED_BACKOFF_MS;
            }
        }
        await refreshStatusEvents();
        if (isLayerEnabled("gnss")) {
            await refreshGnssInterferenceCells({ force: true });
        }
        __viewportScoped = false;
        renderAll(events);
        if (isStratOpsFeatureEnabled("system.intelWireFeed") && isStratOpsFeatureEnabled("widgets.intelWire")) {
            startIntelWireRefreshLoop();
        }
        syncFocusAwareBackgroundLoops();
        syncNewsTickerForCurrentMode();
        const supportModalOpen = isSupportModalVisible();
        setAuthModalRenderBudget(supportModalOpen);
        if (!supportModalOpen) {
            syncInitialEventsToGlobe(__eventsCache, { animateTracks: true });
        } else {
            window.__warzoneViewer?.__warzone?.clearEventEntities?.();
            window.__warzoneViewer?.scene?.requestRender?.();
        }
        const hotspotRoot = document.getElementById("warzone-hotspot-layer");
        const viewer = window.__warzoneViewer;
        if (hotspotRoot && viewer && isLayerEnabled("hotspots")) {
            ensureHotspotLayer(viewer, hotspotRoot);
        }
        const hotspotEnabled = !supportModalOpen && isLayerEnabled("hotspots");
        syncHotspotRootVisibility(hotspotEnabled);
        syncHotspotLayerEvents(
            hotspotEnabled
                ? applyHotspotFilters(__eventsCache, { respectRegion: true })
                : []
        );
        syncGnssInterferenceLayer();
        if (viewer && !__militaryTracks && isStratOpsFeatureEnabled("tracking.militaryTracks")) {
            __militaryTracks = initMilitaryTracks(viewer);
            window.__militaryTracks = __militaryTracks;
        }
        if (viewer) {
            onRegionChange(() => {
                window.__warzoneViewer?.__warzone?.setRaisedRegionVisible?.(
                    isLayerEnabled("region-plate"),
                    getActiveRegion?.()
                );
                __lastViewportKey = "";
                __viewportScoped = false;
                __eventsCache = trimSortedEventList(
                    sortEvents(filterEventsToActiveRegion(__eventsCache)),
                    EVENT_CACHE_MAX_ITEMS
                );
                __liveRecentEvents = trimSortedEventList(
                    sortEvents(filterEventsToActiveRegion(__liveRecentEvents)),
                    300
                );
                __visibleEventsCache = trimSortedEventList(__eventsCache, EVENT_VISIBLE_CACHE_MAX_ITEMS);
                clearAllLiveTracks();
                clearLiveTrackSelection();
                clearAllNavalSignals();
                __aircraftHistoryCache = [];
                __aircraftHistoryLastLoadedAt = 0;
                __aircraftSubtypeOptionsKey = "";
                __seededAircraftTrackKeys = new Set();
                stopPublicAirIngestion();
                window.__warzoneViewer?.__warzone?.clearEventEntities?.();
                __militaryTracks?.setTracks([]);
                if (window.__warzoneViewer) {
                    clearRanges(window.__warzoneViewer);
                    clearSweepers(window.__warzoneViewer);
                }
                if (isLayerEnabled("aircraft")) {
                    syncAircraftLivePipelines({ forceRefresh: true });
                    scheduleAircraftHistoryRefresh(true);
                }
                syncFilteredUi(__eventsCache);
                syncNewsTickerForCurrentMode();
                syncInitialEventsToGlobe(__eventsCache, { animateTracks: false, updatePerformance: false });
                syncHotspotLayerEvents(
                    isLayerEnabled("hotspots")
                        ? applyHotspotFilters(__eventsCache, { respectRegion: true })
                        : []
                );
                syncGnssInterferenceLayer();
                syncFocusAwareBackgroundLoops();
                scheduleViewportFetch(60);
                requestAircraftMovementsWidgetRender(0);
                requestNavalWidgetRender(0);
                const reloadSeq = ++__regionReloadSeq;
                api.getEvents()
                    .then(async ({ data, error }) => {
                        if (reloadSeq !== __regionReloadSeq) return;
                        if (error) {
                            logEventsApiError("Region refresh events error:", error);
                            return;
                        }
                        const freshEvents = Array.isArray(data)
                            ? data.map((row) => normalizeEvent(row)).filter(Boolean)
                            : [];
                        await refreshStatusEvents();
                        if (isLayerEnabled("gnss")) {
                            await refreshGnssInterferenceCells({ force: true });
                        }
                        renderAll(freshEvents);
                        syncNewsTickerForCurrentMode();
                        syncInitialEventsToGlobe(__eventsCache, { animateTracks: false, updatePerformance: false });
                        syncHotspotLayerEvents(
                            isLayerEnabled("hotspots")
                                ? applyHotspotFilters(__eventsCache, { respectRegion: true })
                                : []
                        );
                        if (__eventsCache[0]?.occurred_at) {
                            __lastSeenOccurredAt = __eventsCache[0].occurred_at;
                        }
                        __lastViewportKey = "";
                        scheduleViewportFetch(60);
                        requestAircraftMovementsWidgetRender(0);
                        requestNavalWidgetRender(0);
                        syncGnssInterferenceLayer();
                    })
                    .catch((err) => {
                        if (reloadSeq !== __regionReloadSeq) return;
                        if (isRequestAbortError(err)) return;
                        console.error("Region refresh events failed:", err);
                    });
            });
            if (viewer.camera?.moveEnd) {
                viewer.camera.moveEnd.addEventListener(() => {
                    scheduleViewportFetch(500);
                    scheduleGlobeEventRecluster(80);
                });
            }
            document.addEventListener("wz:scene-mode-changed", () => {
                scheduleGlobeEventRecluster(80);
            });
        }
        syncIdleSceneState();
        syncAircraftLivePipelines();
        window.__warzoneRequestFastForegroundAircraftRecovery = requestFastForegroundAircraftRecovery;
        installWarzoneLifecycleApi();
        bindLiveTrackLifecycleRecovery();
        observeWarzoneLifecycleViewer(window.__warzoneViewer);
        if (!__visibilityRecoveryBound) {
            __visibilityRecoveryBound = true;
            const onForeground = () => {
                if (isDocumentHidden()) return;
                window.__warzoneLifecycle?.observeViewer?.(window.__warzoneViewer);
                const now = Date.now();
                const backgroundIdleMs = __lastBackgroundAt > 0
                    ? Math.max(0, now - __lastBackgroundAt)
                    : 0;
                const wasVisibilitySuspended = __visibilityPipelinesSuspended;
                const lifecycleResumed = window.__warzoneLifecycle?.resume?.("document-foreground") === true;
                resumeForegroundLivePipelines({ backgroundIdleMs });
                if ((now - __lastForegroundRecoveryAt) < FOREGROUND_RECOVERY_THROTTLE_MS) {
                    forceForegroundViewerWake({ reason: "foreground-throttle", backgroundIdleMs });
                    return;
                }
                __lastForegroundRecoveryAt = now;
                __lastBackgroundAt = now;
                ++__foregroundRecoverySeq;
                if (wasVisibilitySuspended && !lifecycleResumed) {
                    resumeLiveTrackMotionAfterVisibility({ reason: "foreground-fallback", backgroundIdleMs });
                }
                // Keep foreground resume smooth: no forced loader, no heavy forced refresh burst.
                endForegroundRecoveryLoader({ force: true });
                const pollLooksStale =
                    __pollInFlight &&
                    __pollInFlightSince > 0 &&
                    (Date.now() - __pollInFlightSince) > 12000;
                if (pollLooksStale) {
                    __pollInFlight = false;
                    __pollInFlightSince = 0;
                }
                syncFocusAwareBackgroundLoops();
                __lastViewportKey = "";
                scheduleViewportFetch(320);
                requestAircraftMovementsWidgetRender(0);
                requestNavalWidgetRender(0);
                if (isLayerEnabled("hotspots")) {
                    const hotspotSource = __viewportScoped ? __visibleEventsCache : __eventsCache;
                    syncHotspotLayerEvents(applyHotspotFilters(hotspotSource, { respectRegion: true }));
                } else {
                    syncHotspotLayerEvents([]);
                }
                if (isLayerEnabled("gnss")) {
                    void refreshGnssInterferenceCells();
                }
                forceForegroundViewerWake({ reason: "document-foreground", backgroundIdleMs });
                scheduleForegroundAdaptiveRecovery(window.__warzoneViewer, backgroundIdleMs);
                window.__warzoneViewer?.scene?.requestRender?.();
            };
            document.addEventListener("visibilitychange", () => {
                if (isDocumentHidden()) {
                    __lastBackgroundAt = Date.now();
                    __foregroundRecoverySeq += 1;
                    endForegroundRecoveryLoader({ force: true });
                    window.__warzoneLifecycle?.pause?.("document-hidden");
                    suspendBackgroundLivePipelines();
                    return;
                }
                onForeground();
            }, { passive: true });
            window.addEventListener("focus", onForeground, { passive: true });
            window.addEventListener("pageshow", onForeground, { passive: true });
            window.addEventListener("pagehide", () => {
                __lastBackgroundAt = Date.now();
                window.__warzoneLifecycle?.pause?.("pagehide");
                suspendBackgroundLivePipelines();
            }, { passive: true });
            window.addEventListener("resize", () => {
                window.__warzoneLifecycle?.observeViewer?.(window.__warzoneViewer);
                if (!isDocumentHidden()) {
                    window.__warzoneLifecycle?.requestRenderBurst?.("window-resize", 360);
                }
            }, { passive: true });
        }
        if (isLayerEnabled("aircraft") && isStratOpsFeatureEnabled("tracking.aircraft") && isStratOpsFeatureEnabled("widgets.aircraftTracker")) {
            setWidgetLoading("aircraft", true);
            refreshAircraftHistoryCache(true)
                .catch((err) => {
                    console.error("Initial aircraft history load failed:", err);
                })
                .finally(() => {
                    setWidgetLoading("aircraft", false);
                    requestAircraftMovementsWidgetRender(0);
                });
        } else {
            clearAllLiveTracks();
            setWidgetLoading("aircraft", false);
            requestAircraftMovementsWidgetRender(0);
        }
        onLayerChange((id) => {
            syncIdleSceneState();
            syncFocusAwareBackgroundLoops();
            const globe = window.__warzoneViewer?.__warzone;
            const mapSourceEvents = getCurrentMapSourceEvents();
            globe?.setEventMarkersSuppressed?.(!hasEnabledGlobeEventLayer());
            if (id === "terrain") {
                globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "map-labels") {
                globe?.setMapLabelsLayerVisible?.(isLayerEnabled("map-labels"));
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "satellite-imagery") {
                const satelliteImageryEnabled = isLayerEnabled("satellite-imagery");
                globe?.setSatelliteImageryLayerVisible?.(satelliteImageryEnabled);
                if (!satelliteImageryEnabled) closeSatelliteImageryViewer();
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "orbital-assets") {
                syncOrbitalWidgetVisibilityForLayer();
                void setWarzoneMilSatsEnabledDeferred(shouldEnableMilSatsLayer());
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "region-plate") {
                globe?.setRaisedRegionVisible?.(isLayerEnabled("region-plate"), getActiveRegion?.());
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "country-borders") {
                globe?.setBorderLayersVisible?.(isLayerEnabled("country-borders"), { duration: 180 });
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "gnss") {
                if (isLayerEnabled("gnss")) {
                    void refreshGnssInterferenceCells();
                } else {
                    syncGnssInterferenceLayer();
                }
                window.__warzoneViewer?.scene?.requestRender?.();
                return;
            }
            if (id === "hotspots" || id === "*") {
                const hotspotEnabled = isLayerEnabled("hotspots");
                if (hotspotEnabled) {
                    ensureHotspotLayer(window.__warzoneViewer, document.getElementById("warzone-hotspot-layer"));
                }
                syncHotspotRootVisibility(hotspotEnabled);
                if (!hotspotEnabled) {
                    __hotspotLayer?.setEvents([]);
                } else {
                    scheduleHotspotLayerRefresh(20);
                }
                if (id === "hotspots") {
                    scheduleLayerDeferredRefresh(60);
                    window.__warzoneViewer?.scene?.requestRender?.();
                    return;
                }
            }
            if (id === "military-bases" || id === "*") {
                window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
            }
            if (id === "aircraft" || id === "*") {
                const aircraftEnabled = isLayerEnabled("aircraft");
                if (!aircraftEnabled) {
                    clearAllLiveTracks();
                    __seededAircraftTrackKeys = new Set();
                } else {
                    syncLiveAircraftFromHistoryRows(__aircraftHistoryCache);
                }
                syncAircraftLivePipelines({ forceRefresh: aircraftEnabled });
                syncTracksRealtimeChannel();
                requestAircraftMovementsWidgetRender(0);
            }
            if (id === "naval" || id === "*") {
                if (!isLayerEnabled("naval") || !isNavalTrackingFeatureEnabled()) {
                    clearAllNavalSignals();
                } else {
                    syncNavalSignals(applyAllFilters(__eventsCache).filter(isNavalSignalEvent));
                }
            }
            if (id === "*") {
                globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
                globe?.setSatelliteImageryLayerVisible?.(isLayerEnabled("satellite-imagery"));
                globe?.setMapLabelsLayerVisible?.(isLayerEnabled("map-labels"));
                globe?.setRaisedRegionVisible?.(isLayerEnabled("region-plate"), getActiveRegion?.());
                globe?.setBorderLayersVisible?.(isLayerEnabled("country-borders"), { duration: 180 });
                syncGnssInterferenceLayer();
            }
            syncImmediateEventLayerVisibility(globe, id);
            const shouldResyncGlobeEvents =
                id === "*" || !GLOBE_EVENT_RESYNC_EXEMPT_LAYER_IDS.has(id);
            if (shouldResyncGlobeEvents) {
                syncInitialEventsToGlobe(mapSourceEvents, {
                    animateTracks: false,
                    updatePerformance: false,
                    syncHotspots: false,
                    syncNaval: false,
                });
            }
            scheduleLayerDeferredRefresh(90);
        });
        {
            const globe = window.__warzoneViewer?.__warzone;
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
            globe?.setSatelliteImageryLayerVisible?.(isLayerEnabled("satellite-imagery"));
            globe?.setMapLabelsLayerVisible?.(isLayerEnabled("map-labels"));
            globe?.setRaisedRegionVisible?.(isLayerEnabled("region-plate"), getActiveRegion?.());
            globe?.setBorderLayersVisible?.(isLayerEnabled("country-borders"), { animate: false });
            window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
            syncGnssInterferenceLayer();
            syncFilteredUi(__eventsCache);
        }
        window.addEventListener("wz:recluster", () => {
            const sourceEvents = __viewportScoped ? __visibleEventsCache : __eventsCache;
            syncInitialEventsToGlobe(sourceEvents, { animateTracks: false });
        });
        if (__militaryTracks) {
            __militaryTracks.setTracks(applyAllFilters(__eventsCache).filter(isMilitaryTrackEvent));
        }
        if (events[0]?.occurred_at) {
            __lastSeenOccurredAt = events[0].occurred_at;
        }
        __lastViewportKey = "";
        __viewportScoped = false;
        scheduleViewportFetch(150);
        syncTracksRealtimeChannel();
        return events;
    } catch (err) {
        console.error("initWarzoneApp failed:", err);
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
}
async function pollLatestEvents(options = {}) {
    const force = options?.force === true;
    if (shouldSuspendMapWork() && !force) return;
    if (isDocumentHidden() && !force) return;
    if (!force && shouldDeferBackgroundMapWork()) {
        if (!shouldRunFocusModeTask(__focusModeLastEventPollAt, FOCUS_MODE_EVENT_POLL_MS)) return;
        __focusModeLastEventPollAt = Date.now();
    }
    if (!force && __eventsApiRestrictedUntil > Date.now()) return;
    if (__pollInFlight && !force) return;
    if (__pollInFlight && force) {
        const staleInFlight =
            __pollInFlightSince > 0 &&
            (Date.now() - __pollInFlightSince) > 12000;
        if (!staleInFlight) return;
        __pollInFlight = false;
        __pollInFlightSince = 0;
    }
    const requestSeq = ++__pollRequestSeq;
    __pollInFlight = true;
    __pollInFlightSince = Date.now();
    try {
        const since = getSafePollSinceIso();
        __lastSeenOccurredAt = since;
        const { data, error } = await api.getEventsSince(since);
        if (requestSeq !== __pollRequestSeq || isDocumentHidden()) return;
        if (error) {
            logEventsApiError("Polling latest events error:", error);
            if (isEventsApiRestrictedError(error)) {
                __eventsApiRestrictedUntil = Date.now() + EVENTS_API_RESTRICTED_BACKOFF_MS;
            }
            return;
        }
        __eventsApiRestrictedUntil = 0;
        const rows = Array.isArray(data) ? data.map((row) => normalizeEvent(row)).filter(Boolean) : [];
        if (!rows.length) {
            __pollEmptyStreak += 1;
            if (__pollEmptyStreak >= POLL_FULL_REFRESH_EMPTY_STREAK) {
                __pollEmptyStreak = 0;
                const { data: fullData, error: fullError } = await api.getEvents();
                if (requestSeq !== __pollRequestSeq || isDocumentHidden()) return;
                if (!fullError) {
                    const fullEvents = Array.isArray(fullData)
                        ? fullData.map((row) => normalizeEvent(row)).filter(Boolean)
                        : [];
                    if (fullEvents.length) {
                        await refreshStatusEvents();
                        renderAll(fullEvents);
                        syncInitialEventsToGlobe(__eventsCache, { animateTracks: false });
                        const hotspotSource = __viewportScoped ? __visibleEventsCache : __eventsCache;
                        syncHotspotLayerEvents(applyHotspotFilters(hotspotSource, { respectRegion: true }));
                        const newestTs = Date.parse(fullEvents[0]?.occurred_at || "");
                        if (Number.isFinite(newestTs)) {
                            __lastSeenOccurredAt = new Date(
                                Math.min(newestTs, Date.now())
                            ).toISOString();
                        }
                    }
                } else {
                    logEventsApiError("Polling full refresh error:", fullError);
                    if (isEventsApiRestrictedError(fullError)) {
                        __eventsApiRestrictedUntil = Date.now() + EVENTS_API_RESTRICTED_BACKOFF_MS;
                    }
                }
            }
            return;
        }
        __pollEmptyStreak = 0;
        const regionRows = filterEventsToActiveRegion(rows);
        if (!regionRows.length) {
            const newestAny = rows[rows.length - 1];
            if (newestAny?.occurred_at) {
                __lastSeenOccurredAt = newestAny.occurred_at;
            }
            return;
        }
        regionRows
            .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
            .forEach(handleIncomingEvent);
        const newest = regionRows[regionRows.length - 1];
        if (newest?.occurred_at) {
            __lastSeenOccurredAt = newest.occurred_at;
        }
    } catch (err) {
        if (isRequestAbortError(err)) return;
        logEventsApiError("Polling latest events failed:", err);
        __eventsApiRestrictedUntil = Date.now() + EVENTS_API_RESTRICTED_BACKOFF_MS;
    } finally {
        if (__pollRequestSeq === requestSeq) {
            __pollInFlight = false;
            __pollInFlightSince = 0;
        }
    }
}
export function startEventPollingFallback() {
    if (__pollTimer) return;
    __pollTimer = setInterval(() => {
        if (isDocumentHidden()) return;
        if (shouldSuspendMapWork()) return;
        pollLatestEvents();
    }, EVENT_POLL_INTERVAL_MS);
}
function stopEventPollingFallback() {
    if (!__pollTimer) return;
    clearInterval(__pollTimer);
    __pollTimer = null;
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
    if (isAircraftTelemetryEvent(normalized)) return;
    if (isTrainerAircraftSignalEvent(normalized)) return;
    if (!isMilitaryRelevant(normalized)) return;
    const allEventsMatch = __allEventsCache.findIndex((e) => String(e.id) === String(normalized.id));
    if (allEventsMatch >= 0) {
        __allEventsCache.splice(allEventsMatch, 1);
    }
    __allEventsCache.unshift(normalized);
    __allEventsCache = trimSortedEventList(__allEventsCache, EVENT_CACHE_MAX_ITEMS);
    const inRegion = isEventInsideActiveRegion(normalized);
    if (!inRegion) {
        debouncedRenderFeed();
        return;
    }
    __liveRecentEvents.unshift(normalized);
    if (__liveRecentEvents.length > 300) {
        __liveRecentEvents.length = 300;
    }
    const exists = __eventsCache.findIndex((e) => String(e.id) === String(normalized.id));
    if (exists >= 0) {
        __eventsCache.splice(exists, 1);
        __eventsCache.unshift(normalized);
    } else {
        __eventsCache.unshift(normalized);
    }
    __eventsCache = trimSortedEventList(__eventsCache, EVENT_CACHE_MAX_ITEMS);
    if (__viewportScoped) {
        __visibleEventsCache = trimSortedEventList(__visibleEventsCache, EVENT_VISIBLE_CACHE_MAX_ITEMS);
    }
    if (shouldSuspendMapWork()) {
        return;
    }
    renderAll(__eventsCache, { replaceAllCache: false });
    flashFeedCard(normalized.id);
    syncNewsTickerForCurrentMode();
    if (__viewportScoped) {
        __lastViewportKey = "";
        scheduleViewportFetch(180);
    }
    const globe = window.__warzoneViewer?.__warzone;
    const layerOk = isOperationalMapEvent(normalized) && isEventVisible(normalized);
    if (isNavalSignalEvent(normalized)) {
        const trackKey = getNavalTrackKey(normalized);
        if (inRegion && layerOk && isNavalTrackingFeatureEnabled()) {
            upsertNavalVessel(normalized);
        } else if (trackKey) {
            clearNavalVessel(trackKey);
        }
        requestNavalWidgetRender(0);
    } else if (isMilitaryTrackEvent(normalized) && __militaryTracks) {
        if (inRegion && layerOk) __militaryTracks.addTrack(normalized);
    } else if (inRegion && layerOk && !isAircraftTelemetryEvent(normalized)) {
        globe?.addEvent?.({ ...normalized, _layerId: getEventLayerId(normalized) });
    }
    if (isTrackLikeEvent(normalized) && inRegion && layerOk) {
        globe?.animateMissileTrack?.(normalized);
    }
    if (isLayerEnabled("hotspots") && isHotspotEventEligible(normalized, { respectRegion: true })) {
        __hotspotLayer?.addEvent?.(normalized);
    }
    if (isSirenEvent(normalized)) {
        sirenAlertFromEvent(normalized);
        if (inRegion && layerOk && !isAircraftFocusModeActive()) {
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
        let dragParentRect = null;
        let dragMaxLeft = 0;
        let dragMaxTop = 0;
        let pendingLeft = 0;
        let pendingTop = 0;
        let dragFrame = 0;
        function applyPanelPosition() {
            dragFrame = 0;
            panel.style.left = `${pendingLeft}px`;
            panel.style.top = `${pendingTop}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        }
        function queuePanelPosition(left, top) {
            pendingLeft = left;
            pendingTop = top;
            if (dragFrame) return;
            dragFrame = requestAnimationFrame(applyPanelPosition);
        }
        function stopDrag() {
            dragging = false;
            if (dragFrame) {
                cancelAnimationFrame(dragFrame);
                dragFrame = 0;
                applyPanelPosition();
            }
            if (activePointerId !== null) {
                try { head.releasePointerCapture(activePointerId); } catch { }
            }
            activePointerId = null;
            dragParentRect = null;
            panel.classList.remove("is-dragging");
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("blur", stopDrag);
            if (panel.matches('[data-widget-id="feed"].is-feed-expanded')) {
                requestAnimationFrame(() => positionExpandedFeedPanel(panel));
            }
        }
        function onPointerMove(e) {
            if (!dragging) return;
            if (activePointerId !== null && e.pointerId !== activePointerId) return;
            if (!dragParentRect) return;
            let nextLeft = e.clientX - dragParentRect.left - dragOffsetX;
            let nextTop = e.clientY - dragParentRect.top - dragOffsetY;
            nextLeft = Math.max(0, Math.min(nextLeft, dragMaxLeft));
            nextTop = Math.max(0, Math.min(nextTop, dragMaxTop));
            queuePanelPosition(nextLeft, nextTop);
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
            dragParentRect = parentRect;
            dragMaxLeft = Math.max(0, parent.clientWidth - panel.offsetWidth);
            dragMaxTop = Math.max(0, parent.clientHeight - panel.offsetHeight);
            pendingLeft = currentLeft;
            pendingTop = currentTop;
            applyPanelPosition();
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
    applyStratOpsFeatureVisibility();
    bindScrollClassToggles();
    bindScrollToTargets();
    initSmoothHomeAnchors();
    initNav();
    initFloatingPanels();
    if (isStratOpsFeatureEnabled("widgets.aircraftTracker") || isStratOpsFeatureEnabled("widgets.navalTracker")) {
        bindAircraftMovementsWidget();
        renderAircraftMovementsWidget();
    }
}
export function initBoot() {
    document.addEventListener("DOMContentLoaded", () => {
        initGlobal();

        document.addEventListener("keydown", (event) => {
            if (event.key === "Tab") {
                document.body.classList.add("using-keyboard");
            }
        });

        document.addEventListener("pointerdown", () => {
            document.body.classList.remove("using-keyboard");
        });

        if (isStratOpsFeatureEnabled("system.audio")) {
            initAudio();
        }

        window.SiteLoader?.forceHide?.();
    });
}
export function initAudio() {
    const audio = document.getElementById("bg-audio");
    const toggle = document.getElementById("audio-toggle");
    const playIcon = toggle?.querySelector(".stratops-ico-next-1");
    const pauseIcon = toggle?.querySelector(".stratops-ico-pause-1");

    if (!audio || !toggle || !playIcon || !pauseIcon) return;

    if (window.__stratopsAudioLocked === true) {
        stopStratOpsAudio({
            lock: false,
            duration: 0
        });
        return;
    }

    if (toggle.dataset.audioBound === "true") return;
    toggle.dataset.audioBound = "true";

    audio.loop = true;
    audio.volume = 0.95;
    audio.src =
        audio.getAttribute("src") ||
        "/assets/audio/stratops-radio-soundtrack.mp3";

    let isPlaying = false;

    function syncUi(playing) {
        isPlaying = playing;

        toggle.classList.toggle("is-on", playing);
        toggle.setAttribute("aria-pressed", String(playing));
        toggle.setAttribute(
            "aria-label",
            playing
                ? "Pause background soundtrack"
                : "Play background soundtrack"
        );

        playIcon.classList.toggle("is-active", !playing);
        pauseIcon.classList.toggle("is-active", playing);
    }

    async function playAudio() {
        if (window.__stratopsAudioLocked === true) return;

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
        if (window.__stratopsAudioLocked === true) return;

        if (isPlaying) {
            pauseAudio();
        } else {
            await playAudio();
        }
    });

    syncUi(false);
    playAudio();

    const unlock = async () => {
        if (window.__stratopsAudioLocked === true) {
            document.removeEventListener("click", unlock);
            document.removeEventListener("keydown", unlock);
            return;
        }

        if (!isPlaying) {
            await playAudio();
        }

        document.removeEventListener("click", unlock);
        document.removeEventListener("keydown", unlock);
    };

    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
}

export function stopStratOpsAudio({
    lock = true,
    duration = 700
} = {}) {
    if (lock) {
        window.__stratopsAudioLocked = true;
    }

    const audio = document.getElementById("bg-audio");
    const toggle = document.getElementById("audio-toggle");
    const playIcon = toggle?.querySelector(".stratops-ico-next-1");
    const pauseIcon = toggle?.querySelector(".stratops-ico-pause-1");

    const fadeDuration = Math.max(
        0,
        Number(duration) || 0
    );

    if (toggle) {
        toggle.classList.remove("is-on");
        toggle.classList.add("is-audio-exiting");

        toggle.setAttribute("aria-pressed", "false");
        toggle.setAttribute(
            "aria-label",
            "Background soundtrack disabled"
        );
        toggle.setAttribute("aria-hidden", "true");

        toggle.style.pointerEvents = "none";
    }

    playIcon?.classList.add("is-active");
    pauseIcon?.classList.remove("is-active");

    const hideToggle = () => {
        if (!toggle) return;

        toggle.hidden = true;
        toggle.style.display = "none";
    };

    if (!audio) {
        window.setTimeout(
            hideToggle,
            fadeDuration
        );
        return;
    }

    const startingVolume = Math.max(
        0,
        Math.min(
            1,
            Number(audio.volume) || 0
        )
    );

    const startedAt = performance.now();

    function finishAudioStop() {
        try {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = startingVolume || 0.95;
        } catch { }

        hideToggle();
    }

    if (fadeDuration === 0 || audio.paused) {
        audio.volume = 0;
        finishAudioStop();
        return;
    }

    function fadeAudio(now) {
        const elapsed = now - startedAt;
        const progress = Math.min(
            1,
            elapsed / fadeDuration
        );

        const easedProgress =
            1 - Math.pow(1 - progress, 2);

        audio.volume =
            startingVolume * (1 - easedProgress);

        if (progress < 1) {
            requestAnimationFrame(fadeAudio);
            return;
        }

        finishAudioStop();
    }

    requestAnimationFrame(fadeAudio);
}

window.stopStratOpsAudio = stopStratOpsAudio;

const LOCAL_AUTH_BASES = [
    "http://localhost:55147/api/auth",
];

const PROD_AUTH_BASES = [
    "https://www.battlespacex.com/api/auth",
];

const AUTH_BASE_STORAGE_KEY = "wz_auth_base";

function isLocalHostName(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isLocalAuthBypassEnabled() {
    return isLocalHostName(window.location.hostname);
}

const STAGING_AUTH_BYPASS_HOSTS = new Set([
    "stratops-staging.battlespacex.com",
    "staging-battlespacex.battlespacex.com",
    "stagging-battlespacex.battlespacex.com",
]);

function isStagingAuthBypassEnabled() {
    const host = String(window.location.hostname || "").toLowerCase();
    return STAGING_AUTH_BYPASS_HOSTS.has(host)
        || (
            host.endsWith(".battlespacex.com")
            && /\bstag(?:e|ing|ging)\b|(?:^|[-.])stag(?:e|ing|ging)(?:[-.]|$)/i.test(host)
        );
}

function getLocalDevAuthUser() {
    return {
        username: "Local Developer",
        email: "local@stratops.dev",
        role: "developer",
        localDevBypass: true,
    };
}

function getStagingAuthBypassUser() {
    return {
        username: "Staging Reviewer",
        email: "staging-reviewer@battlespacex.com",
        role: "staging-reviewer",
        stagingBypass: true,
    };
}

function getAuthBypassState() {
    if (isLocalAuthBypassEnabled()) {
        return { user: getLocalDevAuthUser(), base: "local-dev" };
    }
    if (isStagingAuthBypassEnabled()) {
        return { user: getStagingAuthBypassUser(), base: "staging-bypass" };
    }
    return null;
}

function getStoredAuthBase() {
    try {
        const stored = String(localStorage.getItem(AUTH_BASE_STORAGE_KEY) || "").trim();
        return [...LOCAL_AUTH_BASES, ...PROD_AUTH_BASES].includes(stored) ? stored : "";
    } catch {
        return "";
    }
}

function rememberResolvedAuthBase(baseUrl = "") {
    if (!baseUrl) return;
    try {
        localStorage.setItem(AUTH_BASE_STORAGE_KEY, baseUrl);
    } catch { }
}

function uniqueAuthBases(bases = []) {
    return [...new Set(
        bases
            .map((base) => String(base || "").trim())
            .filter(Boolean)
    )];
}

function getAuthBases() {
    return uniqueAuthBases(isLocalHostName(window.location.hostname)
        ? [...LOCAL_AUTH_BASES, ...PROD_AUTH_BASES]
        : [...PROD_AUTH_BASES]);
}

function getBackgroundAuthBases() {
    const resolvedBase = window.__stratopsResolvedAuthBase;
    const storedBase = getStoredAuthBase();
    const preferredBases = [resolvedBase, storedBase];
    if (isLocalHostName(window.location.hostname)) {
        return uniqueAuthBases([
            ...preferredBases,
            ...(window.__stratopsEnableLocalAuthProbe === true ? LOCAL_AUTH_BASES : []),
            ...PROD_AUTH_BASES,
        ]);
    }
    return uniqueAuthBases([...preferredBases, ...PROD_AUTH_BASES]);
}

function applyResolvedAuthState(isAuthenticated, user = null, resolvedBase = null) {
    window.__stratopsResolvedAuthBase = resolvedBase || null;
    window.__stratopsAuthState = {
        isAuthenticated: !!isAuthenticated,
        user: !!isAuthenticated ? (user || null) : null,
    };

    document.body.classList.toggle("is-authenticated", !!isAuthenticated);
    if (isAuthenticated && resolvedBase) {
        rememberResolvedAuthBase(resolvedBase);
    }

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

async function confirmAuthSession(maxPasses = 2, options = {}) {
    const bypassState = getAuthBypassState();
    if (bypassState) {
        return applyResolvedAuthState(true, bypassState.user, bypassState.base);
    }

    const bases = options.background === true
        ? getBackgroundAuthBases()
        : getAuthBases();

    if (!bases.length) {
        return applyResolvedAuthState(false, null, null);
    }

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
    const allowed = consent ? !!consent.checked : true;
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
    const { modal, email, consent, loginBtn } = getAuthModalElements();
    const isAuthenticated = mode === "authenticated";
    setAuthError("");
    setAuthMode(isAuthenticated, user);
    syncAuthButtonState();
    if (!modal) return;
    const afterOpen = () => {
        onAuthModalVisibilityChanged();
        requestAnimationFrame(() => {
            if (isAuthenticated) (consent || loginBtn)?.focus();
            else email?.focus();
        });
    };
    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(modal, afterOpen);
        return;
    }
    modal.hidden = false;
    requestAnimationFrame(() => {
        modal.classList.add("is-visible");
        afterOpen();
    });
}

export function hideLoginModal() {
    const { modal, password } = getAuthModalElements();
    if (!modal) return;
    const afterClose = () => {
        if (password) password.value = "";
        setAuthError("");
        onAuthModalVisibilityChanged();
    };
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal, afterClose);
        return;
    }
    modal.classList.remove("is-visible");
    setTimeout(() => {
        modal.hidden = true;
        afterClose();
    }, 220);
}

function isLoginModalOpen() {
    const m = document.getElementById("wz-login-modal");
    return m && !m.hidden;
}

function getSupportReturnStateFromUrl() {
    const url = new URL(window.location.href);
    const supportState = String(url.searchParams.get("support") || "").trim().toLowerCase();
    if (!supportState) return null;
    if (supportState !== "success" && supportState !== "cancel" && supportState !== "error") {
        return null;
    }
    return {
        status: supportState,
        sessionId: String(url.searchParams.get("session_id") || "").trim(),
    };
}

function clearSupportReturnUrlState() {
    const url = new URL(window.location.href);
    ["support", "session_id", "success", "canceled", "cancelled", "error"].forEach((key) => {
        url.searchParams.delete(key);
    });
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
}

function setButtonTextOutsideSpan(button, label = "") {
    if (!button) return;
    const iconSpan = button.querySelector("span[aria-hidden='true']") || button.querySelector("span");
    if (!iconSpan) {
        button.textContent = label;
        return;
    }
    Array.from(button.childNodes).forEach((node) => {
        if (node !== iconSpan) {
            button.removeChild(node);
        }
    });
    button.append(document.createTextNode(` ${label}`));
}

export function initStratopsIntro(options = {}) {
    const skipPreEntryShowcase = options?.skipPreEntryShowcase === true;
    const openImmediately = options?.openImmediately !== false;
    // ── Elements ────────────────────────────────────────────────────────────
    const introModal = document.getElementById("wz-intro-modal");
    const acceptBtn = document.getElementById("wz-intro-accept");
    const acceptLabel = document.getElementById("wz-intro-accept-label");
    const checkbox = document.getElementById("intro-disclaimer-check");
    const termsLink = document.getElementById("wz-intro-terms-link");
    const openLoginBtn = document.getElementById("wz-intro-open-login");
    const backBtn = document.getElementById("wz-intro-back");
    const loginHint = document.getElementById("wz-hint");
    const contentView = document.getElementById("wz-intro-capabilities");
    const loginView = document.getElementById("wz-intro-login-view");
    const termsView = document.getElementById("wz-intro-terms");
    const termsTab = document.getElementById("wz-intro-tab-terms");
    const introTabs = introModal ? [...introModal.querySelectorAll(".wz-modal__tab")] : [];
    const introBox = introModal?.querySelector(".wz-modal-box");
    const INTRO_VIEW_FADE_MS = 220;
    const supportReturnModal = document.getElementById("wz-support-return-modal");
    const supportReturnEyebrow = document.getElementById("wz-support-return-eyebrow");
    const supportReturnTitle = document.getElementById("wz-support-return-title");
    const supportReturnSummary = document.getElementById("wz-support-return-summary");
    const supportReturnNote = document.getElementById("wz-support-return-note");
    const supportReturnPrimary = document.getElementById("wz-support-return-primary");
    const supportReturnSecondary = document.getElementById("wz-support-return-secondary");
    const mobileWarningModal = document.getElementById("wz-mobile-warning-modal");
    const mobileWarningContinue = document.getElementById("wz-mobile-warning-continue");

    // Inline login fields (live inside the intro modal — separate from #wz-login-modal)
    const introEmail = document.getElementById("intro-auth-email");
    const introPassword = document.getElementById("intro-auth-password");
    const introRemember = document.getElementById("intro-auth-remember");
    const introError = document.getElementById("intro-auth-error");
    const introForm = document.getElementById("intro-auth-form");

    let isLoginMode = false;
    let isTermsMode = false;
    let introHeightFrame = 0;
    let introHeightCommitFrame = 0;
    let mobileWarningShown = false;
    const introViewAnimations = new WeakMap();
    const introViewFrames = new WeakMap();

    function openIntroModal() {
        if (!introModal) return;
        introModal.hidden = false;
        introModal.classList.add("is-visible");
        onAuthModalVisibilityChanged();
    }

    function isMobileStratopsViewport() {
        const ua = String(window.navigator?.userAgent || "");
        const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches === true;
        const narrowViewport = window.matchMedia?.("(max-width: 900px)")?.matches === true;
        return uaMobile || (coarsePointer && narrowViewport);
    }

    function closeMobileWarningModal(afterClose) {
        if (!mobileWarningModal) {
            if (typeof afterClose === "function") afterClose();
            return;
        }
        if (typeof window.__warzoneCloseSharedModal === "function") {
            window.__warzoneCloseSharedModal(mobileWarningModal, afterClose);
            return;
        }
        mobileWarningModal.classList.remove("is-visible");
        window.setTimeout(() => {
            mobileWarningModal.hidden = true;
            mobileWarningModal.setAttribute("aria-hidden", "true");
            if (typeof afterClose === "function") afterClose();
        }, 220);
    }

    function openMobileWarningModal() {
        if (!mobileWarningModal) return false;
        mobileWarningModal.hidden = false;
        mobileWarningModal.setAttribute("aria-hidden", "false");
        if (typeof window.__warzoneOpenSharedModal === "function") {
            window.__warzoneOpenSharedModal(mobileWarningModal);
        } else {
            requestAnimationFrame(() => {
                mobileWarningModal.classList.add("is-visible");
            });
        }
        onAuthModalVisibilityChanged();

        if (mobileWarningContinue) {
            mobileWarningContinue.hidden = true;
            mobileWarningContinue.disabled = true;
            mobileWarningContinue.setAttribute("aria-hidden", "true");
        }
        return true;
    }

    function openEntryIntroModal() {
        if (isMobileStratopsViewport()) {
            mobileWarningShown = true;
            openMobileWarningModal();
            return;
        }

        openIntroModal();
    }
    window.__warzoneOpenEntryIntroModal = openEntryIntroModal;

    function closeSupportReturnModal(afterClose) {
        if (!supportReturnModal) {
            if (typeof afterClose === "function") afterClose();
            return;
        }
        if (typeof window.__warzoneCloseSharedModal === "function") {
            window.__warzoneCloseSharedModal(supportReturnModal, afterClose);
            return;
        }
        supportReturnModal.classList.remove("is-visible");
        window.setTimeout(() => {
            supportReturnModal.hidden = true;
            supportReturnModal.setAttribute("aria-hidden", "true");
            if (typeof afterClose === "function") afterClose();
        }, 220);
    }

    function showSupportReturnModal(state) {
        if (!supportReturnModal || !state) return false;
        const config = state.status === "success"
            ? {
                eyebrow: "Support Confirmed",
                title: "Payment Successful",
                summary: "Thank you for supporting StratOps. Your contribution helps fund continued development, infrastructure, and platform improvements.",
                note: "Continue into StratOps or return to the startup flow.",
                primaryLabel: "Continue",
                primaryAction: "continue",
                secondaryLabel: "Back",
                secondaryAction: "continue",
            }
            : {
                eyebrow: "Checkout Canceled",
                title: "Payment Not Completed",
                summary: "Your payment was not completed. You can return to StratOps or reopen the support checkout at any time.",
                note: "Return to the startup flow or reopen the support popup.",
                primaryLabel: "Try Again",
                primaryAction: "retry",
                secondaryLabel: "Back",
                secondaryAction: "continue",
            };

        if (supportReturnEyebrow) supportReturnEyebrow.textContent = config.eyebrow;
        if (supportReturnTitle) supportReturnTitle.textContent = config.title;
        if (supportReturnSummary) supportReturnSummary.textContent = config.summary;
        if (supportReturnNote) {
            const noteLabel = supportReturnNote.querySelector("span:last-child");
            if (noteLabel) noteLabel.textContent = config.note;
        }
        if (supportReturnPrimary) {
            supportReturnPrimary.dataset.returnAction = config.primaryAction;
            setButtonTextOutsideSpan(supportReturnPrimary, config.primaryLabel);
        }
        if (supportReturnSecondary) {
            supportReturnSecondary.dataset.returnAction = config.secondaryAction;
            setButtonTextOutsideSpan(supportReturnSecondary, config.secondaryLabel);
        }

        const handleAction = (action = "continue") => {
            clearSupportReturnUrlState();
            closeSupportReturnModal(() => {
                if (action === "retry") {
                    openEntryIntroModal();
                    window.setTimeout(() => {
                        showSupportModal();
                    }, 120);
                    return;
                }
                openEntryIntroModal();
            });
        };

        [supportReturnPrimary, supportReturnSecondary].forEach((button) => {
            if (!button || button.dataset.supportReturnBound === "true") return;
            button.dataset.supportReturnBound = "true";
            button.addEventListener("click", () => {
                handleAction(button.dataset.returnAction || "continue");
            });
        });

        supportReturnModal.hidden = false;
        supportReturnModal.setAttribute("aria-hidden", "false");
        if (typeof window.__warzoneOpenSharedModal === "function") {
            window.__warzoneOpenSharedModal(supportReturnModal);
        } else {
            requestAnimationFrame(() => {
                supportReturnModal.classList.add("is-visible");
            });
        }
        onAuthModalVisibilityChanged();
        return true;
    }

    const supportReturnState = getSupportReturnStateFromUrl();
    if (supportReturnState) {
        showSupportReturnModal(supportReturnState);
        return;
    }

    const authBypassState = getAuthBypassState();
    if (authBypassState) {
        applyResolvedAuthState(true, authBypassState.user, authBypassState.base);
        requestAnimationFrame(() => {
            document.dispatchEvent(new CustomEvent("wz:auth-success", { detail: { source: authBypassState.base } }));
        });
    }

    // ── Helper: show/hide inline error ──────────────────────────────────────
    function setIntroError(msg) {
        if (!introError) return;
        introError.hidden = !msg;
        introError.textContent = msg || "";
    }

    // ── Helper: enable/disable accept button ────────────────────────────────
    function hasIntroConsent() {
        return !!checkbox?.checked;
    }
    function syncIntroBtn() {
        if (!acceptBtn) return;
        const allowed = hasIntroConsent();
        acceptBtn.disabled = !allowed;
        acceptBtn.setAttribute("aria-disabled", String(!allowed));
        if (allowed) { acceptBtn.classList.remove("is-locked"); acceptBtn.style.pointerEvents = ""; }
        else { acceptBtn.classList.add("is-locked"); acceptBtn.style.pointerEvents = "none"; }
    }

    function clearIntroViewAnimation(view) {
        if (!view) return;
        const activeAnimation = introViewAnimations.get(view);
        if (activeAnimation) {
            activeAnimation.cancel();
            introViewAnimations.delete(view);
        }
        const activeFrame = introViewFrames.get(view);
        if (activeFrame) {
            cancelAnimationFrame(activeFrame);
            introViewFrames.delete(view);
        }
        view.style.opacity = "";
        view.classList.remove("is-leaving");
    }
    function fadeInIntroView(view) {
        if (!view) return;
        clearIntroViewAnimation(view);
        view.classList.add("is-active");
        view.removeAttribute("aria-hidden");
        view.style.opacity = "0";
        const frame = requestAnimationFrame(() => {
            introViewFrames.delete(view);
            const animation = view.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: INTRO_VIEW_FADE_MS, easing: "ease", fill: "both" },
            );
            introViewAnimations.set(view, animation);
            animation.onfinish = animation.oncancel = () => {
                if (introViewAnimations.get(view) === animation) {
                    introViewAnimations.delete(view);
                }
                view.style.opacity = "";
            };
        });
        introViewFrames.set(view, frame);
    }
    function fadeOutIntroView(view) {
        if (!view) return;
        clearIntroViewAnimation(view);
        view.classList.remove("is-active");
        view.classList.add("is-leaving");
        view.setAttribute("aria-hidden", "true");
        view.style.opacity = "1";
        const animation = view.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: INTRO_VIEW_FADE_MS, easing: "ease", fill: "both" },
        );
        introViewAnimations.set(view, animation);
        animation.onfinish = animation.oncancel = () => {
            if (introViewAnimations.get(view) === animation) {
                introViewAnimations.delete(view);
            }
            view.classList.remove("is-leaving");
            view.style.opacity = "";
        };
    }
    function crossfadeIntroViews(hideView, showView) {
        if (!hideView || !showView || hideView === showView) return;
        fadeInIntroView(showView);
        fadeOutIntroView(hideView);
    }
    function getActiveIntroView() {
        if (isLoginMode) return loginView;
        if (isTermsMode) return termsView;
        return introModal?.querySelector(".wz-content.is-active") || contentView;
    }
    function resetIntroInlineMode() {
        isLoginMode = false;
        isTermsMode = false;
        setIntroError("");
        loginHint?.classList.remove("is-hidden-hint");
        if (backBtn) { backBtn.hidden = true; backBtn.style.display = "none"; }
        if (acceptLabel) acceptLabel.textContent = "Enter";
    }
    function setIntroTabSelection(activeTab = "") {
        introTabs.forEach((tab) => {
            const active = !!activeTab && String(tab.dataset.tab || "") === activeTab;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
    }
    function lockIntroModalHeight() {
        window.__warzoneLockModalBoxHeight?.(introBox);
    }
    function animateIntroModalHeight() {
        if (!introBox) return;
        if (introHeightFrame) cancelAnimationFrame(introHeightFrame);
        if (introHeightCommitFrame) cancelAnimationFrame(introHeightCommitFrame);
        introHeightFrame = requestAnimationFrame(() => {
            introHeightFrame = 0;
            introHeightCommitFrame = requestAnimationFrame(() => {
                introHeightCommitFrame = 0;
                window.__warzoneScheduleModalBoxHeight?.(introBox);
            });
        });
    }

    // ── Switch to login view ─────────────────────────────────────────────────
    function showLoginView() {
        if (isLoginMode) return;
        const previousView = getActiveIntroView();
        isLoginMode = true;
        isTermsMode = false;
        setIntroError("");
        lockIntroModalHeight();

        // Fade out login hint, show Back button, swap accept label
        loginHint?.classList.add("is-hidden-hint");
        if (backBtn) { backBtn.hidden = false; backBtn.style.display = ""; }
        if (acceptLabel) acceptLabel.textContent = "Login";
        setIntroTabSelection("");

        // Cross-fade panels after footer state is settled
        crossfadeIntroViews(previousView, loginView);
        animateIntroModalHeight();

        // Focus first field
        setTimeout(() => introEmail?.focus(), 320);
    }

    // ── Switch to terms view ─────────────────────────────────────────────────
    function showTermsView() {
        if (isTermsMode) return;
        const previousView = getActiveIntroView();
        isLoginMode = false;
        isTermsMode = true;
        setIntroError("");
        lockIntroModalHeight();

        loginHint?.classList.add("is-hidden-hint");
        if (backBtn) { backBtn.hidden = false; backBtn.style.display = ""; }
        if (acceptLabel) acceptLabel.textContent = "Enter";

        crossfadeIntroViews(previousView, termsView);
        animateIntroModalHeight();
    }

    // ── Switch back to content view ──────────────────────────────────────────
    function showContentView() {
        if (!isLoginMode && !isTermsMode) return;
        const previousView = getActiveIntroView();
        const wasLoginMode = isLoginMode;
        isLoginMode = false;
        isTermsMode = false;
        setIntroError("");
        lockIntroModalHeight();

        // Restore login hint, hide Back button, restore accept label
        loginHint?.classList.remove("is-hidden-hint");
        if (backBtn) { backBtn.hidden = true; backBtn.style.display = "none"; }
        if (acceptLabel) acceptLabel.textContent = "Enter";
        setIntroTabSelection("capabilities");

        // Cross-fade panels after footer state is settled
        crossfadeIntroViews(previousView, contentView);
        animateIntroModalHeight();

        // Clear fields on back
        if (wasLoginMode) {
            if (introEmail) introEmail.value = "";
            if (introPassword) introPassword.value = "";
        }
    }

    // ── Accept and Enter (content mode) ─────────────────────────────────────
    async function handleEnter() {
        if (!hasIntroConsent()) return;
        try { localStorage.setItem("wz_intro_accepted", "1"); } catch { }
        if (introModal) {
            introModal.classList.remove("is-visible");
            introModal.hidden = true;
            onAuthModalVisibilityChanged();
        }
        window.__warzoneShowRegionModal?.();
    }

    // ── Accept and Login (login mode) ────────────────────────────────────────
    async function handleLogin() {
        if (!hasIntroConsent()) return;
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
                onAuthModalVisibilityChanged();
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
    termsLink?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (termsTab) {
            termsTab.click();
            termsTab.focus();
            return;
        }
        showTermsView();
    });
    introModal?.addEventListener("wz:modal-tab-activated", (event) => {
        const tab = String(event.detail?.tab || "");
        if (tab === "capabilities" || tab === "terms") {
            resetIntroInlineMode();
        }
    });
    backBtn?.addEventListener("click", showContentView);
    mobileWarningContinue?.addEventListener("click", () => {
        closeMobileWarningModal(openIntroModal);
    });

    acceptBtn?.addEventListener("click", async () => {
        if (!hasIntroConsent()) return;
        if (isLoginMode) {
            await handleLogin();
        } else {
            await handleEnter();
        }
    });

    // Allow Enter key in login fields to submit
    [introEmail, introPassword].forEach(input => {
        input?.addEventListener("keydown", async (e) => {
            if (e.key === "Enter" && isLoginMode && hasIntroConsent()) {
                e.preventDefault();
                await handleLogin();
            }
        });
    });
    introForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isLoginMode && hasIntroConsent()) {
            await handleLogin();
        }
    });

    // ── Auth state check — hide sign-in hint if already logged in ────────────
    function applyAuthToIntro(isAuth) {
        if (!loginHint) return;
        if (isAuth) {
            loginHint.innerHTML = `<span class="static-icon stratops-ico-checked-1 color-teal-glow"></span><span>Active session detected via BattlespaceX. Continue to StratOps.</span>`;
        }
    }

    if (window.__stratopsAuthState?.isAuthenticated) {
        applyAuthToIntro(true);
    } else {
        stratopsCheckAuth().then(applyAuthToIntro).catch(() => { });
    }

    // ── Show modal ───────────────────────────────────────────────────────────
    if (!skipPreEntryShowcase && isStratOpsFeatureEnabled("system.preEntryShowcase")) {
        initPreEntryShowcase({ onEnter: openEntryIntroModal });
    } else if (openImmediately) {
        openEntryIntroModal();
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
        const isAuthenticated = loginBtn.dataset.mode === "authenticated";
        setAuthError("");
        if (consent && !consent.checked) { setAuthError("Please acknowledge the disclaimer before continuing."); syncAuthButtonState(); return; }
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
    const bypassState = getAuthBypassState();
    if (bypassState) {
        return applyResolvedAuthState(true, bypassState.user, bypassState.base);
    }

    try {
        return await confirmAuthSession(1, { background: true });
    } catch (err) {
        console.error("[auth] Check failed:", err);
        return applyResolvedAuthState(false, null, null);
    }
}

async function postAuthForm(url, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
            body: body.toString(),
            signal: controller.signal,
        });
        let data = null;
        try { data = await res.json(); } catch { data = null; }
        if (!res.ok) throw new Error(data?.message || "Authentication request failed.");
        return data;
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error("Login request timed out. Please check your connection and try again.");
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
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
    document.querySelectorAll("#wz-nav-login-btn, .wz-nav-login-btn, [data-mobile-action=\"login\"]").forEach((btn) => {
        btn.hidden = isAuthenticated;
        btn.setAttribute("aria-hidden", String(isAuthenticated));
        btn.toggleAttribute("disabled", isAuthenticated);
        btn.setAttribute("aria-disabled", String(isAuthenticated));
        btn.tabIndex = isAuthenticated ? -1 : 0;
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
        btn.className = "btn-primary wz-nav-login-btn";
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
    window.__globeRotation = { enabled: true, paused: true, speed: SPEED_DEG };
    let lastTime = null, interacting = false;
    const onStart = () => { interacting = true; lastTime = null; };
    const onEnd = () => { interacting = false; };
    const syncRotationButtonUi = () => {
        const cfg = window.__globeRotation;
        const icon = document.getElementById("wz-rotate-icon");
        const button = document.getElementById("wz-globe-rotate-btn");
        if (!cfg || !icon || !button) return;
        const isPaused = cfg.paused !== false;
        icon.innerHTML = isPaused ? "<span class='stratops-ico-next-1'></span>" : "<span class='stratops-ico-close-1'></span>";
        const label = isPaused ? "Start globe rotation" : "Pause globe rotation";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", String(!isPaused));
    };
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
        b.className = "static-icon";
        b.innerHTML = "<span id='wz-rotate-icon'><span class='stratops-ico-next-1'></span></span>";
        b.addEventListener("click", () => {
            const cfg = window.__globeRotation;
            if (!cfg) return;
            cfg.paused = !cfg.paused;
            syncRotationButtonUi();
            viewer.scene.requestRender?.();
        });
        t.appendChild(b);
        syncRotationButtonUi();
    }, 500);
}

const DELAYED_LOGIN_PROMPT_MS = 15000;
const DONATE_POPUP_DELAY_MS = 75000;
const SUPPORT_CHECKOUT_PATH = "/stratops/create-checkout-session";
const SUPPORT_PORTAL_SESSION_PATH = "/stratops/create-portal-session";
const SUPPORT_CHECKOUT_ERROR = "Unable to open Stripe Checkout. Please try again.";
const SUPPORT_PORTAL_ERROR = "Unable to open the billing portal. Please try again.";

function isAnyAutoPromptBlockingModalOpen() {
    return Boolean(document.querySelector(
        ".wz-modal.is-visible:not([hidden]), .wz-donate-modal.is-visible:not([hidden])"
    ));
}

function initDonatePopup() {
    const modal = document.getElementById("wz-donate-modal");
    if (!modal) return;
    document.getElementById("wz-donate-close")?.addEventListener("click", () => {
        closeSupportModal({ rememberDismissed: true });
    });
    bindSupportCheckoutButtons(modal);
    const supportOpenBtn = document.getElementById("wz-support-open");
    if (supportOpenBtn && supportOpenBtn.dataset.supportBound !== "true") {
        supportOpenBtn.dataset.supportBound = "true";
        supportOpenBtn.addEventListener("click", showSupportModal);
    }
    setTimeout(() => {
        try { if (sessionStorage.getItem("wz_donate_dismissed") === "1") return; } catch { }
        if (isAnyAutoPromptBlockingModalOpen()) return;
        openSupportModal({ resetDismissal: false });
    }, DONATE_POPUP_DELAY_MS);
}

let __supportModalCloseTimer = 0;

function setSupportCheckoutStatus(message = "") {
    const status = document.getElementById("wz-donate-checkout-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
}

function getSupportCheckoutLabel(button) {
    return button?.querySelector("span:last-child") || button;
}

function isSupportCheckoutLocalHost() {
    const host = String(window.location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function joinSupportCheckoutUrl(base = "", path = "") {
    const resolvedBase = String(base || "").replace(/\/+$/, "");
    const resolvedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
    return `${resolvedBase}${resolvedPath}`;
}

function getSupportCheckoutEndpoint() {
    const configuredBase =
        window.__stratopsConfig?.supportApiBase ||
        window.__stratopsConfig?.apiBase ||
        (isSupportCheckoutLocalHost() ? "/api" : "https://api.battlespacex.com");
    return joinSupportCheckoutUrl(configuredBase, SUPPORT_CHECKOUT_PATH);
}

function getSupportPortalEndpoint() {
    const configuredBase =
        window.__stratopsConfig?.supportApiBase ||
        window.__stratopsConfig?.apiBase ||
        (isSupportCheckoutLocalHost() ? "/api" : "https://api.battlespacex.com");
    return joinSupportCheckoutUrl(configuredBase, SUPPORT_PORTAL_SESSION_PATH);
}

function getSupportCheckoutErrorMessage(response, payload) {
    if (response?.status === 404) {
        return isSupportCheckoutLocalHost()
            ? "Checkout endpoint not found. Restart the local API service."
            : "Checkout endpoint not found. Update the production API service.";
    }
    if (payload?.needsConfig) {
        return "Stripe Checkout is not configured yet.";
    }
    const message = String(payload?.error || "").trim();
    return message || SUPPORT_CHECKOUT_ERROR;
}

function getSupportPortalErrorMessage(response, payload) {
    const message = String(payload?.error || "").trim();
    if (message) return message;
    if (response?.status === 404) {
        return isSupportCheckoutLocalHost()
            ? "Billing portal endpoint not found. Restart the local API service."
            : "Billing portal endpoint not found. Update the production API service.";
    }
    return SUPPORT_PORTAL_ERROR;
}

function getSupportPortalModalElements(modal = document) {
    return {
        panel: modal.querySelector("#wz-donate-portal-panel"),
        form: modal.querySelector("#wz-donate-portal-form"),
        emailInput: modal.querySelector("#wz-donate-portal-email"),
        submitButton: modal.querySelector("[data-support-portal-submit]"),
    };
}

function showSupportPortalPanel(modal) {
    const { panel } = getSupportPortalModalElements(modal);
    if (panel) {
        panel.hidden = false;
    }
}

function resetSupportPortalPanel(modal) {
    const { emailInput, submitButton } = getSupportPortalModalElements(modal);
    showSupportPortalPanel(modal);
    if (emailInput) emailInput.value = "";
    if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
        const label = getSupportCheckoutLabel(submitButton);
        if (label) label.textContent = "Open Billing Portal";
    }
}

async function startSupportPortal(modal, button) {
    const { emailInput } = getSupportPortalModalElements(modal);
    const email = String(emailInput?.value || "").trim();
    if (!email) {
        setSupportCheckoutStatus("Please enter your email address.");
        emailInput?.focus();
        return;
    }

    const label = getSupportCheckoutLabel(button);
    const originalLabel = label?.textContent || "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setSupportCheckoutStatus("");
    if (label) {
        label.textContent = "Opening portal...";
    }

    try {
        const response = await fetch(getSupportPortalEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({ email }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.url) {
            throw new Error(getSupportPortalErrorMessage(response, payload));
        }
        window.open(String(payload.url), "_blank", "noopener,noreferrer");
    } catch (error) {
        console.warn("[support] Portal launch failed:", error);
        setSupportCheckoutStatus(String(error?.message || SUPPORT_PORTAL_ERROR));
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (label) {
            label.textContent = originalLabel;
        }
    }
}

async function startSupportCheckout(button) {
    const supportType = button?.dataset?.supportType || "";
    if (!supportType) return;

    const label = getSupportCheckoutLabel(button);
    const originalLabel = label?.textContent || "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setSupportCheckoutStatus("");
    if (label) {
        label.textContent = "Opening Stripe...";
    }

    try {
        const response = await fetch(getSupportCheckoutEndpoint(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({ supportType }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.url) {
            throw new Error(getSupportCheckoutErrorMessage(response, payload));
        }
        window.open(String(payload.url), "_blank", "noopener,noreferrer");
    } catch (error) {
        console.warn("[support] Checkout launch failed:", error);
        setSupportCheckoutStatus(String(error?.message || SUPPORT_CHECKOUT_ERROR));
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (label) {
            label.textContent = originalLabel;
        }
    }
}

function bindSupportCheckoutButtons(modal) {
    if (!modal || modal.dataset.supportCheckoutBound === "true") return;
    modal.dataset.supportCheckoutBound = "true";
    modal.querySelectorAll("[data-support-checkout]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            startSupportCheckout(button);
        });
    });
    const { form, submitButton } = getSupportPortalModalElements(modal);
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!submitButton) return;
        startSupportPortal(modal, submitButton);
    });
}

function openSupportModal({ resetDismissal = true } = {}) {
    const modal = document.getElementById("wz-donate-modal");
    if (!modal) return;
    clearTimeout(__supportModalCloseTimer);
    if (resetDismissal) {
        try { sessionStorage.removeItem("wz_donate_dismissed"); } catch { }
    }
    setSupportCheckoutStatus("");
    resetSupportPortalPanel(modal);
    modal.scrollTop = 0;
    clearTimeout(__viewportFetchTimer);
    __viewportFetchTimer = null;
    syncHotspotRootVisibility(false);
    setAuthModalRenderBudget(true);
    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(modal);
        return;
    }
    modal.style.setProperty("display", "flex", "important");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.remove("is-visible");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
}

function closeSupportModal({ rememberDismissed = false } = {}) {
    const modal = document.getElementById("wz-donate-modal");
    if (!modal) return;
    clearTimeout(__supportModalCloseTimer);
    modal.classList.remove("is-visible");
    setAuthModalRenderBudget(true);
    resetSupportPortalPanel(modal);
    if (rememberDismissed) {
        try { sessionStorage.setItem("wz_donate_dismissed", "1"); } catch { }
    }
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal, () => {
            modal.style.removeProperty("display");
            syncModalRenderBudget();
            syncHotspotRootVisibility(!isAuthModalVisible() && isLayerEnabled("hotspots"));
            if (!shouldSuspendMapWork()) {
                scheduleViewportFetch(320);
            }
        });
        return;
    }
    __supportModalCloseTimer = setTimeout(() => {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        modal.style.removeProperty("display");
        syncModalRenderBudget();
        syncHotspotRootVisibility(!isAuthModalVisible() && isLayerEnabled("hotspots"));
        if (!shouldSuspendMapWork()) {
            scheduleViewportFetch(320);
        }
    }, 300);
}

function showSupportModal() {
    openSupportModal({ resetDismissal: true });
}

let __reportsModalBound = false;
let __reportsModalCloseTimer = 0;
let __latestOperationalReport = null;

function getYesterdayUtcDateKey() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function formatReportDate(value = "") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatReportPeriod(report = {}) {
    const start = formatReportDate(report.period_start);
    const end = formatReportDate(report.period_end);
    return [start, end].filter(Boolean).join(" to ");
}

function getReportTitle(report = {}) {
    const type = String(report.report_type || "daily").toUpperCase();
    const scope = String(report.scope_label || report.scope_value || "Global");
    return `${type} - ${scope}`;
}

function setReportsStatus(message = "", isError = false) {
    const status = document.getElementById("wz-operational-reports-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", Boolean(isError));
}

function resetOperationalReportViewer() {
    const viewer = document.getElementById("wz-operational-report-viewer");
    const frame = document.getElementById("wz-operational-report-viewer-frame");
    const title = document.getElementById("wz-operational-report-viewer-title");
    const link = document.getElementById("wz-operational-report-viewer-link");
    const fallback = document.getElementById("wz-operational-report-viewer-fallback");
    if (frame) frame.setAttribute("data", "");
    if (title) title.textContent = "Report Viewer";
    if (link) {
        link.setAttribute("href", "#");
        link.hidden = true;
    }
    if (fallback) fallback.textContent = "PDF viewing is unavailable in this browser.";
    if (viewer) viewer.hidden = true;
}

function openOperationalReportViewer(report = {}) {
    if (!isStratOpsFeatureEnabled("reports.reportViewer")) return;
    const viewer = document.getElementById("wz-operational-report-viewer");
    const frame = document.getElementById("wz-operational-report-viewer-frame");
    const title = document.getElementById("wz-operational-report-viewer-title");
    const link = document.getElementById("wz-operational-report-viewer-link");
    const fallback = document.getElementById("wz-operational-report-viewer-fallback");
    const viewerUrl = api.getOperationalReportViewerUrl(report);
    if (!viewer || !frame || !viewerUrl) {
        setReportsStatus("This report is missing a PDF download link.", true);
        return;
    }
    if (title) title.textContent = getReportTitle(report);
    if (link) {
        link.setAttribute("href", viewerUrl);
        link.hidden = false;
    }
    if (fallback) {
        fallback.textContent = "Embedded PDF viewing is unavailable in this browser or extension set.";
    }
    viewer.hidden = false;
    frame.setAttribute("data", viewerUrl);
    viewer.scrollIntoView({ block: "start", behavior: "smooth" });
    setReportsStatus("");
}

function setLatestReportDownloadState(report = null, isReady = false) {
    const button = document.getElementById("wz-operational-reports-download");
    const label = button?.querySelector("span:last-child") || button;
    const hasUrl = Boolean(report && api.getOperationalReportViewerUrl(report));
    if (button) {
        button.disabled = !isReady || !hasUrl;
        button.setAttribute("aria-busy", isReady ? "false" : "true");
    }
    if (label) label.textContent = isReady && hasUrl ? "Download PDF" : "Report Preparing";
}

function renderLatestOperationalReportState(payload = {}) {
    const status = String(payload.status || "missing").toLowerCase();
    const report = payload.report || null;
    const title = document.getElementById("wz-operational-reports-latest-title");
    const badge = document.getElementById("wz-operational-reports-latest-badge");
    const meta = document.getElementById("wz-operational-reports-latest-meta");
    const summary = document.getElementById("wz-operational-reports-latest-summary");
    const isReady = status === "available" && report;

    __latestOperationalReport = isReady ? report : null;
    if (title) title.textContent = report ? getReportTitle(report) : "Latest Daily Report";
    if (badge) badge.textContent = isReady ? "Ready" : (status === "preparing" ? "Preparing" : "Pending");
    if (meta) {
        meta.textContent = isReady
            ? [
                formatReportPeriod(report),
                report.expires_at ? `Available until ${formatReportDate(report.expires_at)}` : "",
            ].filter(Boolean).join(" | ")
            : "The scheduled reporting worker has not published a downloadable PDF yet.";
    }
    if (summary) {
        summary.textContent = isReady
            ? String(report.generated_summary || "Latest cached operational report is ready for download.")
            : String(payload.message || "The latest cached report is being prepared. Please check again shortly.");
    }
    setLatestReportDownloadState(report, isReady);
    setReportsStatus(isReady ? "Latest cached report is ready." : (payload.message || "Report is being prepared."), !isReady && status === "unavailable");
}

async function loadLatestOperationalReport() {
    setReportsStatus("Checking latest cached report...");
    setLatestReportDownloadState(null, false);
    try {
        const { data } = await api.getLatestOperationalReport("daily", "global");
        renderLatestOperationalReportState(data || {});
    } catch (error) {
        console.warn("[reports] latest report lookup failed:", error);
        __latestOperationalReport = null;
        renderLatestOperationalReportState({
            status: "unavailable",
            message: String(error?.message || "Unable to check the latest cached report."),
        });
    }
}

function openLatestOperationalReport() {
    const readyUrl = __latestOperationalReport ? api.getOperationalReportViewerUrl(__latestOperationalReport) : "";
    if (!readyUrl) {
        setReportsStatus("The latest report is still being prepared. Please check again shortly.", true);
        return;
    }

    // Use a real link activation from the user's click. Browsers may return null
    // from window.open when noopener is used even though the tab opened successfully.
    const reportLink = document.createElement("a");
    reportLink.href = readyUrl;
    reportLink.target = "_blank";
    reportLink.rel = "noopener noreferrer";
    reportLink.hidden = true;
    document.body.appendChild(reportLink);
    reportLink.click();
    reportLink.remove();
    setReportsStatus("Latest cached report opened.");
}

function closeMobileDockMenuAfterReportsOpen() {
    const menu = document.getElementById("wz-mobile-dock-menu");
    const backdrop = document.getElementById("wz-mobile-dock-backdrop");
    const opener = document.getElementById("wz-mobile-dock-menu-open");
    menu?.classList.remove("is-open", "is-visible");
    menu?.setAttribute("aria-hidden", "true");
    backdrop?.classList.remove("is-open", "is-visible");
    backdrop?.setAttribute("aria-hidden", "true");
    opener?.setAttribute("aria-expanded", "false");
}

function openOperationalReportsModal() {
    const modal = document.getElementById("wz-operational-reports-modal");
    if (!modal) return;
    clearTimeout(__reportsModalCloseTimer);
    setReportsStatus("");
    modal.scrollTop = 0;
    openSharedModal(modal);
    void loadLatestOperationalReport();
}

function closeOperationalReportsModal() {
    const modal = document.getElementById("wz-operational-reports-modal");
    if (!modal) return;
    clearTimeout(__reportsModalCloseTimer);
    closeSharedModal(modal, () => {
        resetOperationalReportViewer();
        setReportsStatus("");
    });
}

function initOperationalReportsModal() {
    const modal = document.getElementById("wz-operational-reports-modal");
    if (!modal || __reportsModalBound) return;
    __reportsModalBound = true;
    applyStratOpsFeatureVisibility();
    document.getElementById("wz-operational-reports-close")?.addEventListener("click", closeOperationalReportsModal);
    document.getElementById("wz-operational-reports-download")?.addEventListener("click", openLatestOperationalReport);
    document.getElementById("dock-reports")?.addEventListener("click", openOperationalReportsModal);
    document.getElementById("wz-mobile-reports")?.addEventListener("click", () => {
        closeMobileDockMenuAfterReportsOpen();
        openOperationalReportsModal();
    });
}

function scheduleDelayedLoginPopup() {
    setTimeout(async () => {
        if (window.__stratopsAuthState?.isAuthenticated) return;
        try { if (sessionStorage.getItem("wz_login_dismissed") === "1") return; } catch { }
        if (isLoginModalOpen() || isAnyAutoPromptBlockingModalOpen()) return;
        const isAuth = await stratopsCheckAuth();
        if (isAuth) return;
        try { if (sessionStorage.getItem("wz_login_dismissed") === "1") return; } catch { }
        if (isLoginModalOpen() || isAnyAutoPromptBlockingModalOpen()) return;
        showLoginModal("guest");

        document.getElementById("wz-login-close")?.addEventListener("click", () => {
            try { sessionStorage.setItem("wz_login_dismissed", "1"); } catch { }
        }, { once: true });
    }, DELAYED_LOGIN_PROMPT_MS);
}

function normalizeAdaptiveProfile(profile = "normal") {
    const value = String(profile || "").toLowerCase();
    return ADAPTIVE_PROFILE_ORDER.includes(value) ? value : "normal";
}

function increaseAdaptiveProfileSafety(profile = "normal", steps = 1) {
    const current = ADAPTIVE_PROFILE_ORDER.indexOf(normalizeAdaptiveProfile(profile));
    const nextIndex = Math.min(
        ADAPTIVE_PROFILE_ORDER.length - 1,
        Math.max(0, current) + Math.max(0, Math.round(Number(steps) || 0))
    );
    return ADAPTIVE_PROFILE_ORDER[nextIndex];
}

function readAdaptiveEnvironmentSnapshot() {
    const nav = window.navigator || {};
    const perfMemory = window.performance?.memory || null;
    const deviceMemoryGbRaw = Number(nav.deviceMemory);
    const hardwareThreadsRaw = Number(nav.hardwareConcurrency);
    const usedHeapMbRaw = Number(perfMemory?.usedJSHeapSize) / (1024 * 1024);
    const heapLimitMbRaw = Number(perfMemory?.jsHeapSizeLimit) / (1024 * 1024);
    const deviceMemoryGb = Number.isFinite(deviceMemoryGbRaw) && deviceMemoryGbRaw > 0
        ? deviceMemoryGbRaw
        : null;
    const hardwareThreads = Number.isFinite(hardwareThreadsRaw) && hardwareThreadsRaw > 0
        ? Math.round(hardwareThreadsRaw)
        : null;
    const usedHeapMb = Number.isFinite(usedHeapMbRaw) && usedHeapMbRaw > 0
        ? usedHeapMbRaw
        : null;
    const heapLimitMb = Number.isFinite(heapLimitMbRaw) && heapLimitMbRaw > 0
        ? heapLimitMbRaw
        : null;
    const heapUsageRatio = usedHeapMb && heapLimitMb
        ? usedHeapMb / heapLimitMb
        : null;
    return {
        deviceMemoryGb,
        hardwareThreads,
        usedHeapMb,
        heapLimitMb,
        heapUsageRatio,
        hasHeapTelemetry: !!perfMemory,
    };
}

async function sampleAdaptiveFramePressure(durationMs = 2400) {
    if (typeof requestAnimationFrame !== "function" || durationMs <= 0) {
        return {
            sampleCount: 0,
            avgFrameMs: null,
            maxFrameMs: null,
            longFrameRatio: 0,
            severeFrameRatio: 0,
        };
    }
    return new Promise((resolve) => {
        const deltas = [];
        const start = performance.now();
        const warmupMs = 500;
        let last = start;
        const tick = (now) => {
            const delta = now - last;
            last = now;
            if ((now - start) >= warmupMs && delta > 0 && Number.isFinite(delta)) {
                deltas.push(delta);
            }
            const elapsed = now - start;
            if (elapsed >= durationMs || document.visibilityState === "hidden") {
                const sampleCount = deltas.length;
                const avgFrameMs = sampleCount
                    ? deltas.reduce((sum, value) => sum + value, 0) / sampleCount
                    : null;
                const maxFrameMs = sampleCount
                    ? deltas.reduce((max, value) => Math.max(max, value), 0)
                    : null;
                const longFrames = deltas.filter((value) => value >= 28).length;
                const severeFrames = deltas.filter((value) => value >= 48).length;
                resolve({
                    sampleCount,
                    avgFrameMs,
                    maxFrameMs,
                    longFrameRatio: sampleCount ? longFrames / sampleCount : 0,
                    severeFrameRatio: sampleCount ? severeFrames / sampleCount : 0,
                });
                return;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

function decideAdaptiveQualityProfile(snapshot, framePressure) {
    let profile = "normal";
    const reasons = [];
    const memoryGb = Number(snapshot?.deviceMemoryGb);
    const threads = Number(snapshot?.hardwareThreads);
    const heapRatio = Number(snapshot?.heapUsageRatio);
    const usedHeapMb = Number(snapshot?.usedHeapMb);
    const longFrameRatio = Number(framePressure?.longFrameRatio || 0);
    const severeFrameRatio = Number(framePressure?.severeFrameRatio || 0);
    const maxFrameMs = Number(framePressure?.maxFrameMs || 0);
    const hasHighMemoryHeadroom = Number.isFinite(memoryGb) && memoryGb >= 8;
    const hasGoodCpuHeadroom = Number.isFinite(threads) && threads >= 8;
    const hasLowSystemHeadroom =
        (Number.isFinite(memoryGb) && memoryGb <= 4) ||
        (Number.isFinite(threads) && threads <= 4) ||
        (Number.isFinite(heapRatio) && heapRatio >= 0.72) ||
        (Number.isFinite(usedHeapMb) && usedHeapMb >= 420);

    if (Number.isFinite(memoryGb)) {
        if (memoryGb <= 2) {
            profile = increaseAdaptiveProfileSafety(profile, 2);
            reasons.push("low system memory capacity detected");
        } else if (memoryGb <= 4) {
            profile = increaseAdaptiveProfileSafety(profile, 1);
            reasons.push("limited device memory headroom");
        }
    }

    if (Number.isFinite(threads)) {
        if (threads <= 2) {
            profile = increaseAdaptiveProfileSafety(profile, 2);
            reasons.push("low CPU thread availability");
        } else if (threads <= 4) {
            profile = increaseAdaptiveProfileSafety(profile, 1);
            reasons.push("moderate CPU thread availability");
        }
    }

    if (Number.isFinite(heapRatio) && Number.isFinite(usedHeapMb)) {
        if (heapRatio >= 0.84 || usedHeapMb >= 650) {
            profile = increaseAdaptiveProfileSafety(profile, 2);
            reasons.push("high JavaScript heap pressure");
        } else if (heapRatio >= 0.72 || usedHeapMb >= 420) {
            profile = increaseAdaptiveProfileSafety(profile, 1);
            reasons.push("elevated JavaScript heap usage");
        }
    }

    const severeFramePressure =
        (longFrameRatio >= 0.2 && maxFrameMs >= 180) ||
        (severeFrameRatio >= 0.12 && maxFrameMs >= 160);
    const moderateFramePressure =
        (longFrameRatio >= 0.3 && maxFrameMs >= 120) ||
        (severeFrameRatio >= 0.08 && maxFrameMs >= 120);

    if (severeFramePressure) {
        profile = increaseAdaptiveProfileSafety(profile, hasLowSystemHeadroom ? 2 : 1);
        reasons.push("sustained long-frame rendering pressure");
    } else if (moderateFramePressure) {
        profile = increaseAdaptiveProfileSafety(profile, 1);
        reasons.push("moderate frame-time pressure");
    }

    // High-end systems with low heap usage should not be pushed into
    // conservative/safe from transient startup spikes.
    if (
        hasHighMemoryHeadroom &&
        hasGoodCpuHeadroom &&
        Number.isFinite(heapRatio) &&
        heapRatio < 0.6 &&
        (profile === "conservative" || profile === "safe")
    ) {
        profile = "balanced";
    }

    return {
        profile: normalizeAdaptiveProfile(profile),
        reasons: reasons.slice(0, 3),
    };
}

function openSharedModal(modal) {
    if (!modal) return;
    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(modal);
        return;
    }
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-visible"));
}

function closeSharedModal(modal, callback) {
    if (!modal) {
        callback?.();
        return;
    }
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal, callback);
        return;
    }
    modal.classList.remove("is-visible");
    setTimeout(() => {
        modal.hidden = true;
        callback?.();
    }, 220);
}

function isAnyOtherModalVisible(ignoreModalId = "") {
    const visibleModal = document.querySelector(".wz-modal.is-visible:not([hidden])");
    if (!visibleModal) return false;
    if (ignoreModalId && visibleModal.id === ignoreModalId) return false;
    return true;
}

function shouldShowAdaptiveAdvisory(profile = "normal", framePressure = {}) {
    // Emergency safety default: never block the UI with an auto advisory modal
    // unless explicitly re-enabled by config.
    if (window.__stratopsConfig?.enableAdaptivePerfModal !== true) return false;
    const normalized = normalizeAdaptiveProfile(profile);
    if (normalized === "normal" || normalized === "balanced") return false;
    if (normalized === "conservative") {
        const longFrameRatio = Number(framePressure?.longFrameRatio || 0);
        const severeFrameRatio = Number(framePressure?.severeFrameRatio || 0);
        const maxFrameMs = Number(framePressure?.maxFrameMs || 0);
        const sustainedConservativePressure =
            (longFrameRatio >= 0.2 && maxFrameMs >= 180) ||
            (severeFrameRatio >= 0.12 && maxFrameMs >= 160);
        if (!sustainedConservativePressure) return false;
    }
    try {
        if (localStorage.getItem(WZ_PERF_ADVISORY_OPTOUT_KEY) === "1") return false;
    } catch {
        // ignore storage errors
    }
    try {
        if (sessionStorage.getItem(WZ_PERF_ADVISORY_SESSION_KEY) === "1") return false;
    } catch {
        // ignore storage errors
    }
    return true;
}

function formatAdaptiveEnvRows(snapshot, framePressure) {
    const rows = [];
    if (Number.isFinite(snapshot?.deviceMemoryGb)) {
        rows.push(`Device memory: ${Number(snapshot.deviceMemoryGb).toFixed(1)} GB`);
    } else {
        rows.push("Device memory: unavailable (browser does not expose this metric)");
    }
    if (Number.isFinite(snapshot?.hardwareThreads)) {
        rows.push(`CPU threads: ${Math.round(Number(snapshot.hardwareThreads))}`);
    } else {
        rows.push("CPU threads: unavailable");
    }
    if (Number.isFinite(snapshot?.usedHeapMb) && Number.isFinite(snapshot?.heapLimitMb)) {
        const used = Number(snapshot.usedHeapMb).toFixed(0);
        const limit = Number(snapshot.heapLimitMb).toFixed(0);
        const ratio = Number(snapshot.heapUsageRatio || 0) * 100;
        rows.push(`JS heap: ${used} MB / ${limit} MB (${ratio.toFixed(0)}%)`);
    } else {
        rows.push("JS heap: unavailable (non-Chromium browsers may hide heap telemetry)");
    }
    if (Number(framePressure?.sampleCount || 0) > 0) {
        const avg = Number(framePressure?.avgFrameMs || 0).toFixed(1);
        const max = Number(framePressure?.maxFrameMs || 0).toFixed(1);
        const longRatio = (Number(framePressure?.longFrameRatio || 0) * 100).toFixed(0);
        rows.push(`Frame timing: avg ${avg} ms, peak ${max} ms, long-frame ${longRatio}%`);
    } else {
        rows.push("Frame timing: unavailable (sampling skipped)");
    }
    return rows;
}

function profileHeading(profile = "normal") {
    const normalized = normalizeAdaptiveProfile(profile);
    if (normalized === "balanced") return "Balanced Quality Mode Enabled";
    if (normalized === "conservative") return "Conservative Quality Mode Enabled";
    if (normalized === "safe") return "Safe Quality Mode Enabled";
    return "Adaptive Quality Mode Enabled";
}

function profileSummary(profile = "normal") {
    const normalized = normalizeAdaptiveProfile(profile);
    if (normalized === "balanced") {
        return "We detected moderate resource limits and reduced a few render budgets to keep map movement smooth.";
    }
    if (normalized === "conservative") {
        return "We detected elevated device/browser load and reduced render budgets to avoid freezing during interaction.";
    }
    if (normalized === "safe") {
        return "We detected high runtime pressure and applied a safety quality profile to prioritize responsiveness over visual fidelity.";
    }
    return "Runtime quality is adapting based on your browser and system telemetry.";
}

function showAdaptivePerformanceAdvisory({ profile = "normal", reasons = [], snapshot = {}, framePressure = {} } = {}) {
    const modal = document.getElementById("wz-performance-warning-modal");
    if (!modal) return;
    const titleEl = document.getElementById("wz-performance-warning-title");
    const summaryEl = document.getElementById("wz-performance-warning-summary");
    const detailEl = document.getElementById("wz-performance-warning-detail");
    const envEl = document.getElementById("wz-performance-warning-env");
    const closeBtn = document.getElementById("wz-performance-warning-close");
    const backBtn = document.getElementById("wz-performance-warning-back");
    const confirmBtn = document.getElementById("wz-performance-warning-confirm");
    const optoutEl = document.getElementById("wz-performance-warning-optout");
    if (titleEl) titleEl.textContent = profileHeading(profile);
    if (summaryEl) summaryEl.textContent = profileSummary(profile);
    if (detailEl) {
        detailEl.textContent = reasons.length
            ? `Signal check: ${reasons.join(", ")}.`
            : "Signal check: browser and device telemetry reported constrained runtime headroom.";
    }
    if (envEl) {
        envEl.innerHTML = "";
        formatAdaptiveEnvRows(snapshot, framePressure).forEach((row) => {
            const li = document.createElement("li");
            li.textContent = row;
            envEl.appendChild(li);
        });
    }
    if (optoutEl) {
        optoutEl.checked = false;
    }
    const finish = () => {
        try {
            sessionStorage.setItem(WZ_PERF_ADVISORY_SESSION_KEY, "1");
            localStorage.setItem(WZ_PERF_ADVISORY_LAST_PROFILE_KEY, normalizeAdaptiveProfile(profile));
            if (optoutEl?.checked) {
                localStorage.setItem(WZ_PERF_ADVISORY_OPTOUT_KEY, "1");
            }
        } catch {
            // ignore storage errors
        }
    };
    const handleClose = () => {
        closeBtn?.removeEventListener("click", handleClose);
        backBtn?.removeEventListener("click", handleClose);
        confirmBtn?.removeEventListener("click", handleClose);
        closeSharedModal(modal, finish);
    };
    closeBtn?.addEventListener("click", handleClose);
    backBtn?.addEventListener("click", handleClose);
    confirmBtn?.addEventListener("click", handleClose);
    openSharedModal(modal);
}

function scheduleAdaptivePerformanceAdvisory(payload, attempt = 0) {
    const maxAttempts = 8;
    const modalId = "wz-performance-warning-modal";
    if (attempt > maxAttempts) return;
    if (isAnyOtherModalVisible(modalId)) {
        setTimeout(() => {
            scheduleAdaptivePerformanceAdvisory(payload, attempt + 1);
        }, 1200);
        return;
    }
    showAdaptivePerformanceAdvisory(payload);
}

async function runAdaptivePerformanceGuard(viewer) {
    const globe = viewer?.__warzone;
    if (!viewer || !globe?.setAdaptiveQualityProfile) return;
    const snapshot = readAdaptiveEnvironmentSnapshot();
    const framePressure = await sampleAdaptiveFramePressure(1900);
    const decision = decideAdaptiveQualityProfile(snapshot, framePressure);
    const profile = normalizeAdaptiveProfile(decision.profile);
    globe.setAdaptiveQualityProfile(profile);
    const visibleCount = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
    globe.setPerformanceMode?.(visibleCount);
    if (shouldShowAdaptiveAdvisory(profile, framePressure)) {
        scheduleAdaptivePerformanceAdvisory({
            profile,
            reasons: decision.reasons,
            snapshot,
            framePressure,
        });
    }
}

function scheduleForegroundAdaptiveRecovery(viewer, idleMs = 0) {
    const globe = viewer?.__warzone;
    if (!viewer || !globe?.setAdaptiveQualityProfile) return;
    const elapsed = Math.max(0, Number(idleMs || 0));
    if (elapsed < FOREGROUND_ADAPTIVE_RECOVERY_THRESHOLD_MS) return;
    if (__foregroundAdaptiveRecoveryTimer) {
        clearTimeout(__foregroundAdaptiveRecoveryTimer);
        __foregroundAdaptiveRecoveryTimer = 0;
    }

    const currentProfile = globe.getAdaptiveQualityProfile?.() || "normal";
    const recoverySteps = elapsed >= FOREGROUND_ADAPTIVE_RECOVERY_DEEP_MS ? 2 : 1;
    const recoveryProfile = increaseAdaptiveProfileSafety(currentProfile, recoverySteps);
    globe.setAdaptiveQualityProfile(recoveryProfile);
    globe.setPerformanceMode?.(Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0)));
    viewer.scene?.requestRender?.();

    __foregroundAdaptiveRecoveryTimer = window.setTimeout(() => {
        __foregroundAdaptiveRecoveryTimer = 0;
        void runAdaptivePerformanceGuard(viewer);
    }, 900);
}

function scheduleAdaptivePerformanceGuard(viewer) {
    if (!viewer || viewer.__wzAdaptiveGuardScheduled) return;
    viewer.__wzAdaptiveGuardScheduled = true;
    setTimeout(() => {
        void runAdaptivePerformanceGuard(viewer);
    }, 6200);
}

export function schedulePostEntryActions(viewer) {
    applyStratOpsFeatureVisibility();

    if (isDevInspectionEnvironment()) {
        import("./pre-entry-dev-panel.js")
            .then((module) => {
                module.initLocalDevPanelOnly?.();
            })
            .catch((error) => {
                console.warn("Local dev panel failed to initialize:", error);
            });
    }
    if (isStratOpsFeatureEnabled("system.authentication") || isStratOpsFeatureEnabled("header.login")) {
        stratopsCheckAuth().then((isAuth) => {
            if (!isAuth) {
                if (isStratOpsFeatureEnabled("header.login")) scheduleDelayedLoginPopup();
            } else {
                document.body.classList.add("is-authenticated");
                // Silent auth check confirmed — unlock all gated features
                document.dispatchEvent(new CustomEvent("wz:auth-success", { detail: { source: "silent-check" } }));
            }
            syncNavLoginButton();
        });
        injectNavLoginButton();
    }
    if (isStratOpsFeatureEnabled("header.sceneModeToggle")) {
        initGlobeRotation(viewer);
    }
    if (isStratOpsFeatureEnabled("header.support")) {
        initDonatePopup();
    }
    if (isStratOpsFeatureEnabled("reports.operationalReports") && isStratOpsFeatureEnabled("dock.reports")) {
        initOperationalReportsModal();
    }
    if (isStratOpsFeatureEnabled("system.adaptivePerformanceGuard") && isStratOpsFeatureEnabled("alerts.performanceWarning")) {
        scheduleAdaptivePerformanceGuard(viewer);
    }

    window.__openLoginModal = () => {
        if (!isStratOpsFeatureEnabled("header.login")) return;
        if (isLoginModalOpen()) return;
        const s = window.__stratopsAuthState;
        showLoginModal(s?.isAuthenticated ? "authenticated" : "guest", s?.user || null);
    };
    window.__openSupportModal = () => {
        if (isStratOpsFeatureEnabled("header.support")) showSupportModal();
    };
    window.__openOperationalReportsModal = () => {
        if (isStratOpsFeatureEnabled("reports.operationalReports") && isStratOpsFeatureEnabled("dock.reports")) {
            openOperationalReportsModal();
        }
    };
}
