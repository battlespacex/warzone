// File Path: /assets/js/warzone-layers.js
const LAYER_DEFS = [
    { id: "strikes", label: "Strikes & Artillery", icon: "💥", color: "#ff2a2a" },
    { id: "missiles", label: "Missiles & Rockets", icon: "🚀", color: "#ff5500" },
    { id: "drones", label: "Drones / UAVs", icon: "🛸", color: "#ffcc00" },
    { id: "airstrikes", label: "Air Strikes", icon: "✈️", color: "#ff7820" },
    { id: "aircraft", label: "Aircraft Tracker", icon: "🛩️", color: "#33d90a", premium: true },
    // airspace is uiOnly — it controls the Airspace Status widget visibility.
    // It is intentionally decoupled from the "aircraft" layer so toggling
    // live flight tracks on the globe does NOT affect the airspace panel.
    { id: "airspace", label: "Airspace Status", icon: "🌐", color: "#33d9ff", uiOnly: true, premium: true },
    { id: "naval", label: "Naval Activity", icon: "⚓", color: "#9b7bff" },
    { id: "military-bases", label: "Military Bases", icon: "🏛️", color: "#3a8eff", uiOnly: true, premium: true },
    { id: "ranges", label: "Detection / Threat Ranges", icon: "📡", color: "#33d9ff" },
    { id: "sweepers", label: "Radar Sweepers", icon: "🌀", color: "#18e2db", uiOnly: true },
    { id: "alerts", label: "Alerts & Sirens", icon: "🔔", color: "#ff2a2a" },
    { id: "cyber", label: "Cyber Operations", icon: "💻", color: "#9b7bff", premium: true },
    { id: "thermal", label: "Thermal / Fires", icon: "🔥", color: "#ff6600" },
    { id: "recon", label: "Recon / Intelligence", icon: "👁️", color: "#00d9b2" },
    { id: "seismic", label: "Seismic / Explosions", icon: "📡", color: "#ffdd00" },
    // { id: "news", label: "News / Reports", icon: "📰", color: "#888" },
    { id: "hotspots", label: "Hotspot Labels", icon: "📍", color: "#00d8b2", uiOnly: true },
    { id: "terrain", label: "Satellite Imagery", icon: "🛰️", color: "#4a9eff", uiOnly: true },
];

const STORAGE_KEY = "wz_layer_state";
const WZ_WIDGET_KEY = "wz_widget_visibility";

let __layerState = {};
let __callbacks = [];

LAYER_DEFS.forEach((l) => {
    __layerState[l.id] = true;
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
        if (["carrier", "destroyer", "frigate", "submarine", "naval", "logistics"].includes(subcat)) return "naval";
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

    const usableLayers = LAYER_DEFS.filter((l) => canUseLayer(l.id));

    if (!usableLayers.length) {
        allOnBtn?.classList.remove("is-active");
        allOffBtn?.classList.add("is-active");
        return;
    }

    const allOn = usableLayers.every((l) => getEffectiveLayerState(l.id));
    const allOff = usableLayers.every((l) => !getEffectiveLayerState(l.id));

    allOnBtn?.classList.toggle("is-active", allOn);
    allOffBtn?.classList.toggle("is-active", allOff);
}

function setAllLayers(enabled, container) {
    LAYER_DEFS.forEach((l) => {
        if (!canUseLayer(l.id)) return;
        __layerState[l.id] = !!enabled;
    });

    saveState();
    syncAllLayerItemStates(container);
    updateBulkToggleState(container);
    notifyChange("*", !!enabled);
}

export function refreshLayerAccessUi() {
    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    syncAllLayerItemStates(container);
    updateBulkToggleState(container);
    notifyChange("*", true);
}

// ── Layer panel UI ─────────────────────────────────────────────────────────────
export function initLayerPanel() {
    loadState();
    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    const rows = LAYER_DEFS.map((l) => `
        <div class="wz-layer-item${getEffectiveLayerState(l.id) ? " is-on" : ""}${l.premium ? " is-premium" : ""}${l.premium && !hasPremiumAccess() ? " is-locked" : ""}" data-layer="${l.id}" aria-disabled="${l.premium && !hasPremiumAccess() ? "true" : "false"}" data-locked="${l.premium && !hasPremiumAccess() ? "true" : "false"}">
            <span class="wz-layer-icon">${l.icon}</span>
            <span class="wz-layer-dot" style="background:${l.color}"></span>
            <span class="wz-layer-label">${l.label}</span>
            <span class="wz-layer-toggle${l.premium && !hasPremiumAccess() ? " is-locked" : ""}"></span>
        </div>
    `).join("");

    container.innerHTML = `
        <div class="wz-layers__toolbar">
            <button class="btn-secondary white" id="wz-layers-all-on">ALL ON<span aria-hidden="true"></span></button>
            <button class="btn-secondary white" id="wz-layers-all-off">ALL OFF<span aria-hidden="true"></span></button>
        </div>
        <div class="wz-layers__list">${rows}</div>
    `;

    container.querySelectorAll(".wz-layer-item").forEach((item) => {
        item.addEventListener("click", () => {
            const id = item.dataset.layer;
            const newVal = toggleLayer(id);

            syncLayerItemState(item, id);
            updateBulkToggleState(container);

            if (!newVal && isPremiumLayer(id) && !hasPremiumAccess()) {
                openLoginForPremiumLayer();
            }
        });
    });

    document.getElementById("wz-layers-all-on")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setAllLayers(true, container);
    });

    document.getElementById("wz-layers-all-off")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setAllLayers(false, container);
    });

    updateBulkToggleState(container);

    setTimeout(() => {
        LAYER_DEFS.forEach((l) => {
            if (!getEffectiveLayerState(l.id)) {
                notifyChange(l.id, false);
            }
        });

        updateBulkToggleState(container);
    }, 200);

    window.addEventListener("stratops-auth-changed", () => {
        refreshLayerAccessUi();
    });
}

export { LAYER_DEFS };