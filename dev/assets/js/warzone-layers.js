// File Path: /assets/js/warzone-layers.js
import {
    getStratOpsLayerFeaturePath,
    isStratOpsFeatureEnabled,
} from "./stratops-feature-config.js";

const ALL_LAYER_DEFS = [
    { id: "strikes", label: "Shelling / Ground Strikes", description: "Artillery, shelling, and uncategorized impact reports", icon: "STK", color: "#ff2a2a" },
    { id: "missiles", label: "Missiles & Rockets", description: "Missile and rocket activity on the map", icon: "MSL", color: "#ff5500" },
    { id: "drones", label: "Drone / UAV Activity", description: "Drone sightings and drone-delivered strike reports", icon: "UAV", color: "#ffcc00" },
    { id: "airstrikes", label: "Air-Delivered Strikes", description: "Aircraft-delivered strike and bombing reports", icon: "AIR", color: "#ff7820" },
    { id: "aircraft", label: "Aircraft Tracker", description: "Live military aircraft telemetry and movement", icon: "TRK", color: "#33d90a", premium: true },
    // airspace is uiOnly — it controls the Airspace Status widget visibility.
    // It is intentionally decoupled from the "aircraft" layer so toggling
    // live flight tracks on the globe does NOT affect the airspace panel.
    { id: "airspace", label: "Airspace Status", description: "Regional closure and restriction status widget", icon: "GLO", color: "#33d9ff", uiOnly: true, premium: true },
    { id: "naval", label: "Naval Activity", description: "Military naval contacts and vessel-linked signals", icon: "NAV", color: "#9b7bff", premium: true },
    { id: "military-bases", label: "Military Bases", description: "Known military base and installation locations", icon: "BASE", color: "#3a8eff", uiOnly: true, premium: true },
    { id: "gnss", label: "GNSS Jamming", description: "Sanitized GNSS/GPS Jamming zones and navigation anomaly cells", icon: "GNSS", color: "#ffd24d", premium: true },
    { id: "ranges", label: "Radar / Threat Ranges", description: "Estimated fighter, AWACS, naval-defense, and SAM coverage envelopes", icon: "RNG", color: "#33d9ff", premium: true },
    { id: "sweepers", label: "Radar Sweepers", description: "Animated sweep sectors for active radar and air-defense envelopes", icon: "SWP", color: "#18e2db", uiOnly: true, premium: true },
    { id: "alerts", label: "Alerts & Sirens", description: "Warning banners, sirens, and alert signals", icon: "ALT", color: "#ff2a2a" },
    { id: "cyber", label: "Cyber Operations", description: "Cyber threat and network disruption signals", icon: "CYB", color: "#9b7bff", premium: true },
    { id: "thermal", label: "Thermal / Fires", description: "Thermal anomalies, fires, and heat events", icon: "THM", color: "#ff6600" },
    { id: "recon", label: "Recon / Intelligence", description: "Reconnaissance and intelligence-linked events", icon: "REC", color: "#00d9b2" },
    { id: "seismic", label: "Seismic / Explosions", description: "Seismic signals and blast-related detections", icon: "SEIS", color: "#ffdd00" },
    // { id: "news", label: "News / Reports", icon: "NEWS", color: "#888" },
    { id: "hotspots", label: "Activity Areas", description: "Passive density circles behind clickable event markers", icon: "AREA", color: "#00d8b2", uiOnly: true },
    { id: "orbital-assets", label: "Orbital Satellite Intelligence", description: "Public orbital estimates for military-associated and dual-use satellites", icon: "ORB", color: "#9fd7ff", premium: true },
    { id: "satellite-imagery", label: "Satellite Observations", description: "Available Sentinel image observations tied to events", icon: "IMG", color: "#18e2db", uiOnly: true, premium: true },
    { id: "terrain", label: "Satellite Basemap", description: "Satellite basemap imagery on the globe", icon: "SAT", color: "#4a9eff", uiOnly: true },
    { id: "map-labels", label: "Map Labels", description: "Country, province, city and place names on the map", icon: "LBL", color: "#9fd7ff", uiOnly: true },
    { id: "region-plate", label: "Raised Region", description: "Elevated selected-region focus plate", icon: "REG", color: "#18e2db", uiOnly: true },
    { id: "country-borders", label: "Country Borders", description: "Country boundary line overlay on the globe", icon: "BRD", color: "#33e1ff", uiOnly: true },
];

const LAYER_DEFS = ALL_LAYER_DEFS.filter((layer) => {
    const featurePath = getStratOpsLayerFeaturePath(layer.id);
    return !featurePath || isStratOpsFeatureEnabled(featurePath);
});

const STORAGE_KEY = "wz_layer_state";
const WZ_WIDGET_KEY = "wz_widget_visibility";
const WZ_LAYER_LAYOUT_VERSION_KEY = "wz_layer_layout_version";
const WZ_LAYER_LAYOUT_VERSION = "2026-07-map-layers-pane";
const DEFAULT_LAYER_STATE = {
    strikes: true,
    missiles: true,
    drones: true,
    airstrikes: true,
    aircraft: false,
    airspace: false,
    gnss: false,
    naval: false,
    "military-bases": false,
    ranges: false,
    sweepers: false,
    alerts: true,
    cyber: false,
    thermal: false,
    recon: true,
    seismic: false,
    hotspots: true,
    "orbital-assets": false,
    "satellite-imagery": false,
    terrain: true,
    "map-labels": false,
    "region-plate": false,
    "country-borders": false,
};
const LAYER_SECTIONS = [
    {
        id: "core-intelligence",
        title: "Core Intelligence",
        layers: ["strikes", "missiles", "drones", "airstrikes", "recon", "alerts", "thermal", "seismic", "hotspots"],
    },
    {
        id: "live-operations",
        title: "Live Operations",
        layers: ["aircraft", "airspace", "naval"],
    },
    {
        id: "infrastructure-disruptions",
        title: "Infrastructure Disruptions",
        layers: ["cyber", "gnss"],
    },
    {
        id: "strategic-overlays",
        title: "Strategic Overlays",
        layers: ["military-bases", "ranges", "sweepers", "orbital-assets", "satellite-imagery", "terrain", "map-labels", "region-plate", "country-borders"],
    },
];
const LAYER_ICON_CLASS_BY_ID = {
    strikes: "stratops-ico-assets-alert-1",
    missiles: "stratops-ico-assets-alert-1",
    drones: "stratops-ico-assets-alert-1",
    airstrikes: "stratops-ico-assets-alert-1",
    alerts: "stratops-ico-assets-alert-1",
    thermal: "stratops-ico-assets-alert-1",
    seismic: "stratops-ico-assets-alert-1",
    aircraft: "stratops-ico-circle-1",
    airspace: "stratops-ico-circle-1",
    naval: "stratops-ico-circle-1",
    cyber: "stratops-ico-circle-1",
    gnss: "stratops-ico-circle-1",
    recon: "stratops-ico-focus-1",
    hotspots: "stratops-ico-focus-1",
    "military-bases": "stratops-ico-focus-1",
    ranges: "stratops-ico-focus-1",
    sweepers: "stratops-ico-focus-1",
    "region-plate": "stratops-ico-focus-1",
    "orbital-assets": "stratops-ico-hexa-1",
    "satellite-imagery": "stratops-ico-hexa-1",
    terrain: "stratops-ico-hexa-1",
    "map-labels": "stratops-ico-hexa-1",
    "country-borders": "stratops-ico-hexa-1",
};

let __layerState = {};
let __callbacks = [];
let __layerStateLoaded = false;
const PERFORMANCE_WARNING_LIMIT = 3;
const PERFORMANCE_WARNING_EXCLUDED = new Set(["terrain", "map-labels", "region-plate", "satellite-imagery"]);
const DEV_INSPECTION_LAYER_IDS = new Set(["sweepers", "satellite-imagery"]);
const NAVAL_LAYER_SUBTYPES = new Set([
    "carrier",
    "amphibious",
    "cruiser",
    "destroyer",
    "frigate",
    "corvette",
    "submarine",
    "ssbn",
    "ssn",
    "ssk",
    "aip_submarine",
    "missile_boat",
    "naval",
    "logistics",
    "patrol",
    "minesweeper",
]);
const AIRCRAFT_LAYER_SUBTYPES = new Set([
    "aircraft",
    "fighter",
    "awacs",
    "recon",
    "isr",
    "tanker",
    "refueler",
    "transport",
    "logistics",
    "logistic",
    "patrol",
    "bomber",
    "vip",
    "helicopter",
]);

LAYER_DEFS.forEach((l) => {
    __layerState[l.id] = DEFAULT_LAYER_STATE[l.id] !== false;
});

function getLayerDef(id) {
    return LAYER_DEFS.find((l) => l.id === id) || null;
}

function hasPremiumAccess() {
    const isAuthenticated = !!window.__stratopsAuthState?.isAuthenticated;
    if (!isAuthenticated) return false;
    const body = document.body;
    if (!body?.classList?.contains("is-billing-enabled")) return true;
    return body.classList.contains("is-advanced-tier") || body.classList.contains("is-expert-tier");
}

function isPremiumLayer(id) {
    return !!getLayerDef(id)?.premium;
}

function isDevInspectionEnvironment() {
    if (import.meta.env?.DEV === true) return true;
    if (typeof window === "undefined") return false;
    const hostname = String(window.location?.hostname || "").toLowerCase();
    return hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === ""
        || hostname.includes("staging");
}

function canUseLayer(id) {
    if (!isPremiumLayer(id)) return true;
    if (DEV_INSPECTION_LAYER_IDS.has(id) && isDevInspectionEnvironment()) return true;
    return hasPremiumAccess();
}

function openPremiumAccessFlow() {
    try {
        if (window.__stratopsAuthState?.isAuthenticated) {
            window.__stratopsBilling?.openUpgradeForFeature?.("premiumLayers");
            return;
        }
        window.__openLoginModal?.();
    } catch {
        // ignore
    }
}

function getEffectiveLayerState(id) {
    if (!getLayerDef(id)) return false;
    if (!canUseLayer(id)) return false;
    return __layerState[id] !== false;
}

function loadState() {
    if (__layerStateLoaded) return;
    LAYER_DEFS.forEach((l) => {
        __layerState[l.id] = DEFAULT_LAYER_STATE[l.id] !== false;
    });
    __layerStateLoaded = true;
}

export function hydrateLayerStateFromStorage() {
    loadState();
}

export function resetLayerStateForFreshLoad() {
    __layerStateLoaded = false;
    loadState();
    saveState();
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(__layerState));
        localStorage.setItem(WZ_LAYER_LAYOUT_VERSION_KEY, WZ_LAYER_LAYOUT_VERSION);
    } catch {
        // ignore storage failures
    }
}

// ── Event classifier ───────────────────────────────────────────────────────────
function getEventMetadata(event = {}) {
    const raw = event.metadata;
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function isAircraftTelemetryLayerEvent(event = {}, subcat = "") {
    const metadata = getEventMetadata(event);
    const sourceName = String(event.source_name || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const trackType = String(event.track_type || metadata.track_type || "").toLowerCase();
    const tags = Array.isArray(event.tags)
        ? event.tags.map((tag) => String(tag || "").toLowerCase())
        : String(event.tags || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
    return (
        trackType === "aircraft" ||
        reportType === "flight_tracking" ||
        sourceName.includes("ads-b") ||
        sourceName.includes("airplanes.live") ||
        sourceName.includes("opensky") ||
        tags.includes("adsb") ||
        tags.includes("flight-tracking") ||
        !!metadata.icao ||
        !!metadata.callsign ||
        !!metadata.registration ||
        !!metadata.type_code ||
        !!metadata.model_name ||
        AIRCRAFT_LAYER_SUBTYPES.has(subcat)
    );
}

export function getEventLayerId(event) {
    if (!event) return "strikes";

    const cat = String(event.category || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const subcat = String(event.subcategory || "").toLowerCase();
    const src = String(event.source_name || "").toLowerCase();

    if (cat === "alert") return "alerts";
    if (cat === "cyber") return "cyber";
    if (cat === "thermal") return "thermal";
    if (cat === "air_activity") return "aircraft";
    if (cat === "naval_activity") return "naval";
    if (cat === "ground_activity") return "recon";
    if (cat === "recon_intel") return "recon";
    if (cat === "unknown_activity") return "strikes";
    if (cat === "recon") return "recon";
    if (cat === "seismic" || cat === "signal") return "seismic";

    if (cat === "military") {
        if (NAVAL_LAYER_SUBTYPES.has(subcat)) return "naval";
        if (isAircraftTelemetryLayerEvent(event, subcat)) return "aircraft";
        if (["drone", "uav", "shahed"].includes(subcat)) return "drones";
        return "recon";
    }

    if (cat === "strike") {
        if (/drone|uav|shahed|kamikaze/.test(weapon)) return "drones";
        if (/air.?strike|bomb|f-\d+|jas/.test(weapon)) return "airstrikes";
        if (/missile|rocket|ballistic|cruise/.test(weapon)) return "missiles";
        return "strikes";
    }

    if (src.includes("telegram") || src.includes("reddit") || src.includes("gdelt") || src.includes("twitter")) {
        // "news" is not an active layer toggle in the current UI, so keep
        // these events on the default combat layer instead of hiding them.
        return "strikes";
    }

    return "strikes";
}

export function isEventVisible(event) {
    const layerId = getEventLayerId(event);
    if (!getLayerDef(layerId)) {
        return getEffectiveLayerState("strikes");
    }
    return getEffectiveLayerState(layerId);
}

export function isLayerEnabled(id) {
    return getEffectiveLayerState(id);
}

function countWarnableEnabledLayers(state = __layerState) {
    return LAYER_DEFS.reduce((count, layer) => {
        if (PERFORMANCE_WARNING_EXCLUDED.has(layer.id)) return count;
        if (!canUseLayer(layer.id)) return count;
        return count + (state[layer.id] ? 1 : 0);
    }, 0);
}

function buildSingleToggleState(id, enabled) {
    return {
        ...__layerState,
        [id]: !!enabled,
    };
}

function buildAllEnabledState() {
    const nextState = { ...__layerState };
    LAYER_DEFS.forEach((layer) => {
        if (!canUseLayer(layer.id)) return;
        nextState[layer.id] = true;
    });
    return nextState;
}

function shouldWarnForLayerTransition(nextState) {
    const currentCount = countWarnableEnabledLayers(__layerState);
    const nextCount = countWarnableEnabledLayers(nextState);
    return nextCount > PERFORMANCE_WARNING_LIMIT && nextCount > currentCount;
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
        if (typeof callback === "function") callback();
        return;
    }
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal, callback);
        return;
    }
    modal.classList.remove("is-visible");
    window.setTimeout(() => {
        modal.hidden = true;
        if (typeof callback === "function") callback();
    }, 220);
}

function requestPerformanceApproval({ mode = "toggle", pendingId = "", nextCount = 0 } = {}) {
    const modal = document.getElementById("wz-layer-warning-modal");
    if (!modal) return Promise.resolve(true);

    const titleEl = document.getElementById("wz-layer-warning-title");
    const summaryEl = document.getElementById("wz-layer-warning-summary");
    const detailEl = document.getElementById("wz-layer-warning-detail");
    const closeBtn = document.getElementById("wz-layer-warning-close");
    const backBtn = document.getElementById("wz-layer-warning-back");
    const confirmBtn = document.getElementById("wz-layer-warning-confirm");
    const pendingDef = getLayerDef(pendingId);
    const nextLabel = pendingDef?.label || "additional layer";

    if (titleEl) {
        titleEl.textContent = mode === "all"
            ? "Maximum Sensor Loadout"
            : "High-Load Layer Activation";
    }
    if (summaryEl) {
        summaryEl.textContent = mode === "all"
            ? "Activating the full multi-domain stack will increase render load and can slow battlespace responsiveness across the globe."
            : `Enabling ${nextLabel} will raise the live stack to ${nextCount} active layers and can slow tactical map performance.`;
    }
    if (detailEl) {
        detailEl.textContent = "Heavy radar envelopes, sweeper sectors, hotspot labels, and dense event overlays increase processing load. Proceed only if you want the expanded operational picture despite the slower response time.";
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (approved) => {
            if (settled) return;
            settled = true;
            closeBtn?.removeEventListener("click", handleCancel);
            backBtn?.removeEventListener("click", handleCancel);
            confirmBtn?.removeEventListener("click", handleApprove);
            closeSharedModal(modal, () => resolve(approved));
        };
        const handleCancel = () => finish(false);
        const handleApprove = () => finish(true);
        closeBtn?.addEventListener("click", handleCancel);
        backBtn?.addEventListener("click", handleCancel);
        confirmBtn?.addEventListener("click", handleApprove);
        openSharedModal(modal);
    });
}

export function setLayer(id, enabled) {
    if (!getLayerDef(id)) return false;

    if (!canUseLayer(id)) {
        notifyChange(id, false);
        return false;
    }

    __layerState[id] = !!enabled;
    saveState();
    notifyChange(id, __layerState[id]);
    return __layerState[id];
}

export function toggleLayer(id) {
    if (!getLayerDef(id)) return false;

    if (!canUseLayer(id)) {
        openPremiumAccessFlow();
        notifyChange(id, false);
        return false;
    }

    __layerState[id] = !__layerState[id];
    saveState();
    notifyChange(id, __layerState[id]);
    return __layerState[id];
}

function syncUiOnlyLayerToWidget(layerId, enabled) {
    try {
        const widget = document.querySelector(`[data-widget-id="${layerId}"]`);
        // Respect user-close state when a uiOnly layer is enabled.
        // Only force-hide the widget when the layer itself is disabled.
        if (widget && !enabled) widget.classList.add("wz-is-hidden");

        const saved = JSON.parse(localStorage.getItem(WZ_WIDGET_KEY) || "{}");
        if (widget) {
            saved[layerId] = !widget.classList.contains("wz-is-hidden");
        } else if (!enabled) {
            saved[layerId] = false;
        }
        localStorage.setItem(WZ_WIDGET_KEY, JSON.stringify(saved));

        window.__syncWarzoneDock?.();
    } catch {
        // Non-fatal
    }
}

export function onLayerChange(cb) {
    __callbacks.push(cb);
}

function notifyChange(id, val) {
    if (id === "*") {
        LAYER_DEFS.filter((l) => l.uiOnly).forEach((l) => {
            syncUiOnlyLayerToWidget(l.id, getEffectiveLayerState(l.id));
        });
    } else {
        const layerDef = getLayerDef(id);
        if (layerDef?.uiOnly) {
            syncUiOnlyLayerToWidget(id, getEffectiveLayerState(id));
        }
    }

    __callbacks.forEach((cb) => {
        try {
            cb(id, id === "*" ? val : getEffectiveLayerState(id), { ...__layerState });
        } catch {
            // ignore callback errors
        }
    });
}

function syncLayerItemState(item, id) {
    const def = getLayerDef(id);
    const enabled = getEffectiveLayerState(id);
    const locked = !!def?.premium && !hasPremiumAccess();

    item.classList.toggle("is-on", enabled);
    item.classList.toggle("is-locked", locked);
    item.classList.toggle("is-premium", !!def?.premium);
    item.setAttribute("aria-disabled", locked ? "true" : "false");
    item.setAttribute("data-locked", locked ? "true" : "false");

    const toggle = item.querySelector(".wz-layer-toggle");
    if (toggle) {
        toggle.classList.toggle("is-locked", locked);
    }
}

function syncAllLayerItemStates(container) {
    container.querySelectorAll(".wz-layer-item").forEach((item) => {
        syncLayerItemState(item, item.dataset.layer);
    });
    syncAllSectionToggleStates(container);
}

function updateBulkToggleState(container) {
    if (!container) return;

    const allOnBtn = container.querySelector("#wz-layers-all-on");
    const allOffBtn = container.querySelector("#wz-layers-all-off");

    if (!allOnBtn || !allOffBtn) return;

    const actionableItems = Array.from(container.querySelectorAll(".wz-layer-item"))
        .filter((item) => item.getAttribute("aria-disabled") !== "true");

    const allOn = actionableItems.length > 0
        && actionableItems.every((item) => item.classList.contains("is-on"));
    const allOff = actionableItems.length > 0
        && actionableItems.every((item) => !item.classList.contains("is-on"));

    allOnBtn.classList.toggle("is-active", allOn);
    allOffBtn.classList.toggle("is-active", allOff);
    updateLayerSummary(container);
    syncAllSectionToggleStates(container);
}

function updateLayerSummary(container) {
    const summary = container?.querySelector(".wz-layers__summary");
    if (!summary) return;
    const enabledCount = LAYER_DEFS.reduce((count, layer) => count + (getEffectiveLayerState(layer.id) ? 1 : 0), 0);
    summary.textContent = `${enabledCount} active layer${enabledCount === 1 ? "" : "s"} across the current operational view.`;
}

function setAllLayers(enabled, container) {
    LAYER_DEFS.forEach((l) => {
        if (!canUseLayer(l.id)) return;
        __layerState[l.id] = !!enabled;
    });

    saveState();
    syncAllLayerItemStates(container);
    notifyChange("*", !!enabled);
    updateBulkToggleState(container);
}

function getSectionLayerIds(sectionId = "") {
    const section = getRenderedSections().find((item) => item.id === sectionId);
    return (section?.layers || []).map((layer) => layer.id);
}

function syncSectionToggleState(button, sectionId) {
    if (!button) return;
    const layerIds = getSectionLayerIds(sectionId).filter(canUseLayer);
    const enabledCount = layerIds.filter(getEffectiveLayerState).length;
    const allOn = layerIds.length > 0 && enabledCount === layerIds.length;
    const someOn = enabledCount > 0 && !allOn;
    button.classList.toggle("is-on", allOn);
    button.classList.toggle("is-partial", someOn);
    button.setAttribute("aria-pressed", allOn ? "true" : "false");
    button.setAttribute("title", allOn ? "Turn category off" : "Turn category on");
}

function syncAllSectionToggleStates(container) {
    container?.querySelectorAll("[data-layer-section-toggle]").forEach((button) => {
        syncSectionToggleState(button, button.getAttribute("data-layer-section-toggle") || "");
    });
}

function setSectionLayers(sectionId, enabled, container) {
    getSectionLayerIds(sectionId).forEach((id) => {
        if (!canUseLayer(id)) return;
        __layerState[id] = !!enabled;
    });
    saveState();
    syncAllLayerItemStates(container);
    notifyChange("*", !!enabled);
    updateBulkToggleState(container);
}

export function refreshLayerAccessUi() {
    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    syncAllLayerItemStates(container);
    notifyChange("*", true);
    updateBulkToggleState(container);
}

function renderLayerBadge(layer) {
    if (!layer.premium) return "";
    return `<span class="wz-layer-badge" aria-hidden="true">Premium</span>`;
}

function getLayerIconClass(layer) {
    return LAYER_ICON_CLASS_BY_ID[layer?.id] || "stratops-ico-circle-1";
}

function escapeLayerHtml(value = "") {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderTextStack(value = "") {
    const words = String(value || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!words.length) return "";
    return `${escapeLayerHtml(words.join("\n"))}`;
}

function renderLayerRow(layer) {
    const locked = layer.premium && !hasPremiumAccess();
    return `
        <div class="wz-layer-item${getEffectiveLayerState(layer.id) ? " is-on" : ""}${layer.premium ? " is-premium" : ""}${locked ? " is-locked" : ""}"
             data-layer="${layer.id}"
             aria-disabled="${locked ? "true" : "false"}"
             data-locked="${locked ? "true" : "false"}"
             role="button"
             tabindex="0"
             title="${layer.description || layer.label}">
            <span class="wz-layer-icon static-icon ${getLayerIconClass(layer)}" style="color:${layer.color}" aria-hidden="true"></span>
            <span class="wz-layer-copy">
                <span class="wz-layer-label">${layer.label}${renderLayerBadge(layer)}</span>
                <span class="wz-layer-desc">${layer.description || ""}</span>
            </span>
            <span class="wz-layer-toggle${locked ? " is-locked" : ""}"></span>
        </div>
    `;
}

function getRenderedSections() {
    const defsById = new Map(LAYER_DEFS.map((layer) => [layer.id, layer]));
    const consumed = new Set();
    const sections = [];

    LAYER_SECTIONS.forEach((section) => {
        const layers = section.layers
            .map((id) => defsById.get(id))
            .filter(Boolean);
        if (!layers.length) return;
        layers.forEach((layer) => consumed.add(layer.id));
        sections.push({
            ...section,
            layers,
        });
    });

    const uncategorized = LAYER_DEFS.filter((layer) => !consumed.has(layer.id));
    if (uncategorized.length) {
        sections.push({
            id: "additional-overlays",
            title: "Additional Overlays",
            layers: uncategorized,
        });
    }

    return sections;
}

function bindLayerItem(container, item) {
    const handleToggle = async () => {
        const id = item.dataset.layer;
        const currentlyEnabled = getEffectiveLayerState(id);
        let newVal = currentlyEnabled;

        if (currentlyEnabled) {
            newVal = setLayer(id, false);
        } else {
            const nextState = buildSingleToggleState(id, true);
            if (shouldWarnForLayerTransition(nextState)) {
                const approved = await requestPerformanceApproval({
                    mode: "toggle",
                    pendingId: id,
                    nextCount: countWarnableEnabledLayers(nextState),
                });
                if (!approved) {
                    syncLayerItemState(item, id);
                    updateBulkToggleState(container);
                    return;
                }
            }
            newVal = setLayer(id, true);
        }

        syncLayerItemState(item, id);
        updateBulkToggleState(container);

        if (!newVal && isPremiumLayer(id) && !hasPremiumAccess()) {
            openPremiumAccessFlow();
        }
    };

    item.addEventListener("click", handleToggle);
    item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void handleToggle();
    });
}

// ── Layer panel UI ─────────────────────────────────────────────────────────────
export function initLayerPanel() {
    loadState();

    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    const sections = getRenderedSections();

    container.innerHTML = `
        <div class="wz-layers__toolbar">
            <button class="btn-secondary white" id="wz-layers-all-on">All On<span aria-hidden="true"></span></button>
            <button class="btn-secondary white" id="wz-layers-all-off">All Off<span aria-hidden="true"></span></button>
        </div>
        <div class="wz-layers__list">
            ${sections.map((section) => `
                <section class="wz-layer-section" aria-labelledby="wz-layer-section-${section.id}">
                    <div class="wz-layer-section__head">
                        <h3 id="wz-layer-section-${section.id}" class="wz-layer-section__title text-stack">${renderTextStack(section.title)}</h3>
                        <span class="wz-layer-section__meta">
                            <button type="button" class="wz-layer-section-toggle" data-layer-section-toggle="${section.id}" aria-label="Toggle ${escapeLayerHtml(section.title)} category" aria-pressed="false"></button>
                            <span class="wz-layer-section__count sr-only">${section.layers.length}</span>
                        </span>
                    </div>
                    <div class="wz-layer-section__list">
                        ${section.layers.map(renderLayerRow).join("")}
                    </div>
                </section>
            `).join("")}
        </div>
    `;

    syncAllLayerItemStates(container);
    updateBulkToggleState(container);

    container.querySelectorAll(".wz-layer-item").forEach((item) => {
        bindLayerItem(container, item);
    });

    container.querySelectorAll("[data-layer-section-toggle]").forEach((button) => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const sectionId = button.getAttribute("data-layer-section-toggle") || "";
            const layerIds = getSectionLayerIds(sectionId).filter(canUseLayer);
            const allOn = layerIds.length > 0 && layerIds.every(getEffectiveLayerState);
            setSectionLayers(sectionId, !allOn, container);
        });
    });

    document.getElementById("wz-layers-all-on")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nextState = buildAllEnabledState();
        if (shouldWarnForLayerTransition(nextState)) {
            const approved = await requestPerformanceApproval({
                mode: "all",
                nextCount: countWarnableEnabledLayers(nextState),
            });
            if (!approved) {
                syncAllLayerItemStates(container);
                updateBulkToggleState(container);
                return;
            }
        }
        setAllLayers(true, container);
    });

    document.getElementById("wz-layers-all-off")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setAllLayers(false, container);
    });

    setTimeout(() => {
        LAYER_DEFS.forEach((l) => {
            if (!getEffectiveLayerState(l.id)) {
                notifyChange(l.id, false);
            }
        });

        updateBulkToggleState(container);
    }, 200);

    const handleAuthRefresh = () => {
        refreshLayerAccessUi();
    };

    window.addEventListener("stratops-auth-changed", handleAuthRefresh);
    document.addEventListener("wz:auth-success", handleAuthRefresh);
}

export { LAYER_DEFS };
