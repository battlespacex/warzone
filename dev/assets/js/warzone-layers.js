// assets/js/warzone-layers.js
// Layer toggle system — show/hide event types on globe + feed
// Persisted to localStorage

const LAYER_DEFS = [
    { id: "strikes", label: "Strikes & Artillery", icon: "💥", color: "#ff2a2a" },
    { id: "missiles", label: "Missiles & Rockets", icon: "🚀", color: "#ff5500" },
    { id: "drones", label: "Drones / UAVs", icon: "🛸", color: "#ffcc00" },
    { id: "airstrikes", label: "Air Strikes", icon: "✈️", color: "#ff7820" },
    { id: "aircraft", label: "Military Aircraft", icon: "🛩️", color: "#33d90a" },
    { id: "naval", label: "Naval Activity", icon: "⚓", color: "#9b7bff" },
    { id: "alerts", label: "Alerts & Sirens", icon: "🔔", color: "#ff2a2a" },
    { id: "cyber", label: "Cyber Operations", icon: "💻", color: "#9b7bff" },
    { id: "thermal", label: "Thermal / Fires", icon: "🔥", color: "#ff6600" },
    { id: "recon", label: "Recon / Intelligence", icon: "👁️", color: "#00d9b2" },
    { id: "seismic", label: "Seismic / Explosions", icon: "📡", color: "#ffdd00" },
    { id: "news", label: "News / Reports", icon: "📰", color: "#888" },
    { id: "hotspots", label: "Hotspot Labels", icon: "📍", color: "#00d8b2", uiOnly: true },
    { id: "terrain", label: "Satellite Imagery", icon: "🛰️", color: "#4a9eff", uiOnly: true },
];

const STORAGE_KEY = "wz_layer_state";
let __layerState = {};
LAYER_DEFS.forEach(l => { __layerState[l.id] = true; });

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        LAYER_DEFS.forEach(l => {
            if (l.id in saved) __layerState[l.id] = saved[l.id];
        });
    } catch { }
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(__layerState)); } catch { }
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

    if (src.includes("telegram") || src.includes("reddit") || src.includes("gdelt") || src.includes("twitter")) return "news";
    return "strikes";
}

export function isEventVisible(event) {
    const layerId = getEventLayerId(event);
    return __layerState[layerId] !== false;
}

export function isLayerEnabled(id) { return __layerState[id] !== false; }

export function setLayer(id, enabled) {
    __layerState[id] = enabled;
    saveState();
}

export function toggleLayer(id) {
    __layerState[id] = !__layerState[id];
    saveState();
    return __layerState[id];
}

// Callbacks
let __callbacks = [];
export function onLayerChange(cb) { __callbacks.push(cb); }
function notifyChange(id, val) {
    __callbacks.forEach(cb => { try { cb(id, val, __layerState); } catch { } });
}

// ── Layer panel UI ─────────────────────────────────────────────────────────────
// Panel chrome (panel-head, X button) lives in index.html as a proper .warzone-widget.
// This function only populates the list body inside #wz-layer-panel.
export function initLayerPanel() {
    loadState();

    const container = document.getElementById("wz-layer-panel");
    if (!container) return;

    const rows = LAYER_DEFS.map(l => `
        <div class="wz-layer-item${__layerState[l.id] ? " is-on" : ""}" data-layer="${l.id}">
            <span class="wz-layer-icon">${l.icon}</span>
            <span class="wz-layer-dot" style="background:${l.color}"></span>
            <span class="wz-layer-label">${l.label}</span>
            <span class="wz-layer-toggle"></span>
        </div>
    `).join("");

    container.innerHTML = `
        <div class="wz-layers__toolbar">
            <button class="wz-layers__all-on" id="wz-layers-all-on">ALL ON</button>
            <button class="wz-layers__all-off" id="wz-layers-all-off">ALL OFF</button>
        </div>
        <div class="wz-layers__list">${rows}</div>
    `;

    // Wire each row
    container.querySelectorAll(".wz-layer-item").forEach(item => {
        item.addEventListener("click", () => {
            const id = item.dataset.layer;
            const newVal = toggleLayer(id);
            item.classList.toggle("is-on", newVal);
            notifyChange(id, newVal);
        });
    });

    // ALL ON
    document.getElementById("wz-layers-all-on")?.addEventListener("click", (e) => {
        e.stopPropagation();
        LAYER_DEFS.forEach(l => {
            __layerState[l.id] = true;
            container.querySelector(`[data-layer="${l.id}"]`)?.classList.add("is-on");
        });
        saveState();
        notifyChange("*", true);
    });

    // ALL OFF
    document.getElementById("wz-layers-all-off")?.addEventListener("click", (e) => {
        e.stopPropagation();
        LAYER_DEFS.forEach(l => {
            __layerState[l.id] = false;
            container.querySelector(`[data-layer="${l.id}"]`)?.classList.remove("is-on");
        });
        saveState();
        notifyChange("*", false);
    });
}

export { LAYER_DEFS };