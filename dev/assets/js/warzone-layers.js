// File Path: /assets/js/warzone-layers.js
const LAYER_DEFS = [
    { id: "strikes", label: "Strikes & Artillery", description: "Mapped strike, shelling, and impact events", icon: "💥", color: "#ff2a2a" },
    { id: "missiles", label: "Missiles & Rockets", description: "Missile and rocket activity on the map", icon: "🚀", color: "#ff5500" },
    { id: "drones", label: "Drones / UAVs", description: "Drone, UAV, and loitering munition events", icon: "🛸", color: "#ffcc00" },
    { id: "airstrikes", label: "Air Strikes", description: "Air-delivered strike and bombing activity", icon: "✈️", color: "#ff7820" },
    { id: "aircraft", label: "Aircraft Tracker", description: "Live military aircraft telemetry and movement", icon: "🛩️", color: "#33d90a", premium: true },
    // airspace is uiOnly — it controls the Airspace Status widget visibility.
    // It is intentionally decoupled from the "aircraft" layer so toggling
    // live flight tracks on the globe does NOT affect the airspace panel.
    { id: "airspace", label: "Airspace Status", description: "Regional closure and restriction status widget", icon: "🌐", color: "#33d9ff", uiOnly: true, premium: true },
    { id: "naval", label: "Naval Activity", description: "Military naval contacts and vessel-linked signals", icon: "⚓", color: "#9b7bff" },
    { id: "military-bases", label: "Military Bases", description: "Known military base and installation locations", icon: "🏛️", color: "#3a8eff", uiOnly: true, premium: true },
    { id: "ranges", label: "Radar / Threat Ranges", description: "Estimated fighter, AWACS, naval-defense, and SAM coverage envelopes", icon: "📡", color: "#33d9ff" },
    { id: "sweepers", label: "Radar Sweepers", description: "Animated sweep sectors for active radar and air-defense envelopes", icon: "🌀", color: "#18e2db", uiOnly: true },
    { id: "alerts", label: "Alerts & Sirens", description: "Warning banners, sirens, and alert signals", icon: "🔔", color: "#ff2a2a" },
    { id: "cyber", label: "Cyber Operations", description: "Cyber threat and network disruption signals", icon: "💻", color: "#9b7bff", premium: true },
    { id: "thermal", label: "Thermal / Fires", description: "Thermal anomalies, fires, and heat events", icon: "🔥", color: "#ff6600" },
    { id: "recon", label: "Recon / Intelligence", description: "Reconnaissance and intelligence-linked events", icon: "👁️", color: "#00d9b2" },
    { id: "seismic", label: "Seismic / Explosions", description: "Seismic signals and blast-related detections", icon: "📡", color: "#ffdd00" },
    // { id: "news", label: "News / Reports", icon: "📰", color: "#888" },
    { id: "hotspots", label: "Hotspot Labels", description: "Cluster labels for active event concentrations", icon: "📍", color: "#00d8b2", uiOnly: true },
    { id: "terrain", label: "Satellite Imagery", description: "Satellite basemap imagery on the globe", icon: "🛰️", color: "#4a9eff", uiOnly: true },
];

const STORAGE_KEY = "wz_layer_state";
const WZ_WIDGET_KEY = "wz_widget_visibility";
const WZ_LAYER_LAYOUT_VERSION_KEY = "wz_layer_layout_version";
const WZ_LAYER_LAYOUT_VERSION = "2026-04-live-recovery";
const DEFAULT_LAYER_STATE = {
    strikes: true,
    missiles: true,
    drones: true,
    airstrikes: true,
    aircraft: true,
    airspace: false,
    naval: true,
    "military-bases": false,
    ranges: false,
    sweepers: false,
    alerts: true,
    cyber: false,
    thermal: true,
    recon: true,
    seismic: true,
    hotspots: true,
    terrain: true,
};

let __layerState = {};
let __callbacks = [];
const PERFORMANCE_WARNING_LIMIT = 3;
const PERFORMANCE_WARNING_EXCLUDED = new Set(["terrain"]);
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

LAYER_DEFS.forEach((l) => {
    __layerState[l.id] = DEFAULT_LAYER_STATE[l.id] !== false;
});

function getLayerDef(id) {
    return LAYER_DEFS.find((l) => l.id === id) || null;
}

function hasPremiumAccess() {
    return !!window.__stratopsAuthState?.isAuthenticated;
}

function isPremiumLayer(id) {
    return !!getLayerDef(id)?.premium;
}

function canUseLayer(id) {
    if (!isPremiumLayer(id)) return true;
    return hasPremiumAccess();
}

function openLoginForPremiumLayer() {
    try {
        window.__openLoginModal?.();
    } catch {
        // ignore
    }
}

function getEffectiveLayerState(id) {
    if (!canUseLayer(id)) return false;
    return __layerState[id] !== false;
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        const savedVersion = String(localStorage.getItem(WZ_LAYER_LAYOUT_VERSION_KEY) || "");
        const shouldResetLayout = savedVersion !== WZ_LAYER_LAYOUT_VERSION;

        if (shouldResetLayout) {
            LAYER_DEFS.forEach((l) => {
                __layerState[l.id] = DEFAULT_LAYER_STATE[l.id] !== false;
            });
            saveState();
            try {
                localStorage.setItem(WZ_LAYER_LAYOUT_VERSION_KEY, WZ_LAYER_LAYOUT_VERSION);
            } catch {
                // ignore storage failures
            }
            return;
        }

        LAYER_DEFS.forEach((l) => {
            if (l.id in saved) {
                __layerState[l.id] = !!saved[l.id];
            }
        });
    } catch {
        // keep defaults
    }
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
export function getEventLayerId(event) {
    if (!event) return "news";

    const cat = String(event.category || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const subcat = String(event.subcategory || "").toLowerCase();
    const src = String(event.source_name || "").toLowerCase();

    if (cat === "alert") return "alerts";
    if (cat === "cyber") return "cyber";
    if (cat === "thermal") return "thermal";
    if (cat === "recon") return "recon";
    if (cat === "seismic" || cat === "signal") return "seismic";

    if (cat === "military") {
        if (NAVAL_LAYER_SUBTYPES.has(subcat)) return "naval";
        if (["fighter", "awacs", "recon", "tanker", "transport", "patrol"].includes(subcat)) return "aircraft";
        if (["drone", "uav", "shahed"].includes(subcat)) return "drones";
        return "aircraft";
    }

    if (cat === "strike") {
        if (/drone|uav|shahed|kamikaze/.test(weapon)) return "drones";
        if (/air.?strike|bomb|f-\d+|jas/.test(weapon)) return "airstrikes";
        if (/missile|rocket|ballistic|cruise/.test(weapon)) return "missiles";
        return "strikes";
    }

    if (src.includes("telegram") || src.includes("reddit") || src.includes("gdelt") || src.includes("twitter")) {
        return "news";
    }

    return "strikes";
}

export function isEventVisible(event) {
    const layerId = getEventLayerId(event);
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
        openLoginForPremiumLayer();
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
        if (widget) {
            widget.classList.toggle("wz-is-hidden", !enabled);
        }

        const saved = JSON.parse(localStorage.getItem(WZ_WIDGET_KEY) || "{}");
        saved[layerId] = enabled;
        localStorage.setItem(WZ_WIDGET_KEY, JSON.stringify(saved));

        const dockBtn = document.querySelector(`[data-dock-widget="${layerId}"]`);
        if (dockBtn) {
            dockBtn.classList.toggle("wz-dock--gone", enabled);
            dockBtn.setAttribute("aria-hidden", enabled ? "true" : "false");
        }
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

export function refreshLayerAccessUi() {
    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    syncAllLayerItemStates(container);
    notifyChange("*", true);
    updateBulkToggleState(container);
}

// ── Layer panel UI ─────────────────────────────────────────────────────────────
export function initLayerPanel() {
    loadState();

    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    const rows = LAYER_DEFS.map((l) => `
        <div class="wz-layer-item${getEffectiveLayerState(l.id) ? " is-on" : ""}${l.premium ? " is-premium" : ""}${l.premium && !hasPremiumAccess() ? " is-locked" : ""}" data-layer="${l.id}" aria-disabled="${l.premium && !hasPremiumAccess() ? "true" : "false"}" data-locked="${l.premium && !hasPremiumAccess() ? "true" : "false"}" title="${l.description || l.label}">
            <span class="wz-layer-icon">${l.icon}</span>
            <span class="wz-layer-dot" style="background:${l.color}"></span>
            <span class="wz-layer-copy">
                <span class="wz-layer-label">${l.label}</span>
                <span class="wz-layer-desc">${l.description || ""}</span>
            </span>
            <span class="wz-layer-toggle${l.premium && !hasPremiumAccess() ? " is-locked" : ""}"></span>
        </div>
    `).join("");

    container.innerHTML = `
        <div class="wz-layers__toolbar">
            <button class="btn-secondary white" id="wz-layers-all-on">All On<span aria-hidden="true"></span></button>
            <button class="btn-secondary white" id="wz-layers-all-off">All Off<span aria-hidden="true"></span></button>
        </div>
        <div class="wz-layers__list">${rows}</div>
    `;

    syncAllLayerItemStates(container);
    updateBulkToggleState(container);

    container.querySelectorAll(".wz-layer-item").forEach((item) => {
        item.addEventListener("click", async () => {
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
                openLoginForPremiumLayer();
            }
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
