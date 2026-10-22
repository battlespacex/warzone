// File Path: /assets/js/warzone-ui.js
import { initTheaterPanel } from "./warzone-theater-panel.js";
let __altitudeReadoutBound = false;
let __warzoneUiBound = false;

export function bindWarzoneUi() {
    if (__warzoneUiBound) return;
    __warzoneUiBound = true;
    bindTopViews();
    bindAlertDismiss();
    initTheaterPanel();
    startUtcClock();
    startAltitudeReadout();
    bindGlobeSurfaceControls();
}

export function attachWarzoneUiViewer() { startAltitudeReadout(); }

function bindTopViews() {
    const tabs = document.querySelectorAll(".top-tab");
    const panels = document.querySelectorAll(".warzone-view");
    const applyTopViewState = (activeTab) => {
        const target = String(activeTab?.dataset.view || "");
        tabs.forEach((tab) => {
            const active = tab === activeTab;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.setAttribute("aria-pressed", String(active));
            if (tab.getAttribute("role") === "tab") {
                tab.tabIndex = active ? 0 : -1;
            }
        });
        panels.forEach((panel) => {
            const active = panel.dataset.viewPanel === target;
            panel.classList.toggle("is-active", active);
            panel.setAttribute("aria-hidden", String(!active));
        });
    };
    const initialTab = Array.from(tabs).find((tab) => tab.classList.contains("is-active")) || tabs[0] || null;
    if (initialTab) applyTopViewState(initialTab);
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            applyTopViewState(tab);
        });
    });
}

function bindAlertDismiss() {
    // NOTE: sticky alerts are now dismissible via warzone-sticky-alert.js bindStickyDismiss().
    // This legacy handler is kept for non-sticky alerts only.
    const closeBtn = document.querySelector(".warzone-alert__close");
    const alert = document.getElementById("warzone-alert");
    if (!closeBtn || !alert) return;
    alert.hidden = true;
    alert.setAttribute("aria-hidden", "true");
    alert.style.display = "none";
    alert.classList.remove("is-active", "is-red", "is-orange");
    closeBtn.addEventListener("click", () => {
        // Only handle non-sticky (transient) alerts here — sticky ones are
        // handled by warzone-sticky-alert.js which also tracks dismissed keys
        const isSticky = alert.dataset.sticky === "true";
        if (isSticky) return; // sticky-alert.js handles this
        alert.classList.remove("is-active");
    });
}

// ── UTC Clock ──────────────────────────────────────────────────────────────────
function startUtcClock() {
    const el = document.getElementById("wz-utc-time");
    if (!el) return;
    function tick() {
        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, "0");
        const mm = String(now.getUTCMinutes()).padStart(2, "0");
        const ss = String(now.getUTCSeconds()).padStart(2, "0");
        el.textContent = `${hh}:${mm}:${ss}`;
    }
    tick();
    setInterval(tick, 1000);
}

function formatAltitude(heightMeters) {
    const h = Number(heightMeters);
    if (!Number.isFinite(h) || h < 0) return "--";
    if (h >= 1000000) {
        return `${Math.round(h / 1000).toLocaleString()} km`;
    }
    if (h >= 10000) {
        return `${(h / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
    }
    if (h >= 1000) {
        return `${(h / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
    }
    return `${Math.round(h).toLocaleString()} m`;
}

function startAltitudeReadout() {
    if (__altitudeReadoutBound) return;
    const el = document.getElementById("wz-altitude-readout");
    if (!el) return;
    const camera = window.__warzoneViewer?.camera;
    if (!camera) return;
    __altitudeReadoutBound = true;
    const ftEl = document.getElementById("wz-altitude-readout-ft");
    const kmEl = document.getElementById("wz-altitude-readout-km");
    let rafId = 0;
    let cameraMoving = false;
    let lastUpdateAt = 0;
    let lastValue = "";
    const update = () => {
        const height = Number(camera.positionCartographic?.height);
        const heightFt = Number.isFinite(height) && height >= 0
            ? Math.round(height * 3.280839895).toLocaleString()
            : "--";
        const nextFt = `ALT ${heightFt} FT`;
        const nextKm = `ALT ${formatAltitude(height)}`;
        const next = `${nextFt}|${nextKm}`;
        if (next !== lastValue) {
            if (ftEl && kmEl) {
                ftEl.textContent = nextFt;
                kmEl.textContent = nextKm;
            } else {
                el.textContent = nextKm;
            }
            lastValue = next;
        }
    };
    const tick = (now) => {
        rafId = 0;
        if (document.hidden) return;
        if ((now - lastUpdateAt) >= 100) {
            lastUpdateAt = now;
            update();
        }
        if (cameraMoving) rafId = requestAnimationFrame(tick);
    };
    const scheduleUpdate = () => {
        if (!rafId && !document.hidden) rafId = requestAnimationFrame(tick);
    };
    const onMoveStart = () => {
        cameraMoving = true;
        scheduleUpdate();
    };
    const onMoveEnd = () => {
        cameraMoving = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        lastUpdateAt = performance.now();
        update();
    };
    const onVisibilityChange = () => {
        if (document.hidden) {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            return;
        }
        if (cameraMoving) scheduleUpdate();
        else update();
    };
    const removeMoveStart = camera.moveStart?.addEventListener?.(onMoveStart);
    const removeMoveEnd = camera.moveEnd?.addEventListener?.(onMoveEnd);
    const removeChanged = camera.changed?.addEventListener?.(scheduleUpdate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    update();
    window.addEventListener("beforeunload", () => {
        if (rafId) cancelAnimationFrame(rafId);
        removeMoveStart?.();
        removeMoveEnd?.();
        removeChanged?.();
        document.removeEventListener("visibilitychange", onVisibilityChange);
    }, { once: true });
}

// ── DEFCON — auto-calculated from escalation score ─────────────────────────────
// Score 0-200 maps to DEFCON 5-1
// Called from essential.js after renderEscalation
export function updateDefcon(escalationScore) {
    const badge = document.getElementById("wz-defcon-badge");
    const levelEl = document.getElementById("wz-defcon-level");
    if (!badge || !levelEl) return;

    let level = 5;
    if (escalationScore >= 180) level = 1;
    else if (escalationScore >= 140) level = 2;
    else if (escalationScore >= 100) level = 3;
    else if (escalationScore >= 60) level = 4;
    else level = 5;

    levelEl.textContent = String(level);
    badge.dataset.level = String(level);
}

// Manual override — call window.setDefcon(3) from dev panel anytime
window.setDefcon = function (level) {
    const badge = document.getElementById("wz-defcon-badge");
    const levelEl = document.getElementById("wz-defcon-level");
    if (!badge || !levelEl) return;
    const n = Math.min(5, Math.max(1, Number(level) || 5));
    levelEl.textContent = String(n);
    badge.dataset.level = String(n);
};

// ── Cesium globe surface controls ────────────────────────────────────────────
function bindGlobeSurfaceControls() {
    const btnContour = document.getElementById("wz-toggle-contour");
    const btnTerrain = document.getElementById("wz-toggle-terrain");
    const mapApi = () => window.__warzoneViewer?.__warzone;
    const updateContourButton = (visible = false) => {
        if (!btnContour) return;
        btnContour.classList.toggle("is-active", visible === true);
        btnContour.setAttribute("aria-pressed", String(visible === true));
    };
    const updateTerrainButton = (visible = false) => {
        if (!btnTerrain) return;
        btnTerrain.classList.toggle("is-active", visible === true);
        btnTerrain.setAttribute("aria-pressed", String(visible === true));
    };
    btnTerrain?.addEventListener("click", () => {
        const api = mapApi();
        if (!api?.enableFocusedTerrain || !api?.disableFocusedTerrain) return;
        const active = api.isFocusedTerrainActive?.() === true;
        const action = active
            ? Promise.resolve(api.disableFocusedTerrain())
            : Promise.resolve(api.setContourLayerVisible?.(false)).then(() => api.enableFocusedTerrain());
        action
            .then((visible) => updateTerrainButton(active ? false : visible === true))
            .catch(() => updateTerrainButton(api.isFocusedTerrainActive?.() === true));
    });
    btnContour?.addEventListener("click", () => {
        const api = mapApi();
        if (!api?.setContourLayerVisible || !api?.isContourLayerVisible) return;
        const active = api.isContourLayerVisible() === true;
        const action = active
            ? Promise.resolve(api.setContourLayerVisible(false))
            : Promise.resolve(api.refreshContourFromViewport?.({ force: true }))
                .then(() => api.setContourLayerVisible(true));
        action
            .then((visible) => updateContourButton(visible === true))
            .catch(() => updateContourButton(api.isContourLayerVisible?.() === true));
    });
    document.addEventListener("wz:contour-layer-changed", (event) => {
        updateContourButton(event?.detail?.visible === true);
    });
    document.addEventListener("wz:focused-terrain-changed", (event) => {
        updateTerrainButton(event?.detail?.visible === true);
    });
    updateContourButton(mapApi()?.isContourLayerVisible?.() === true);
    updateTerrainButton(mapApi()?.isFocusedTerrainActive?.() === true);
}

// ── News Ticker ────────────────────────────────────────────────────────────────
function initNewsTicker() {
    if (document.getElementById("wz-news-ticker")) return;
    const ticker = document.createElement("div");
    ticker.className = "wz-news-ticker";
    ticker.id = "wz-news-ticker";
    ticker.innerHTML = `
        <span class="wz-news-ticker__label">LIVE</span>
        <div class="wz-news-ticker__track">
            <div class="wz-news-ticker__inner" id="wz-ticker-inner">
                <span class="wz-ticker-item">
                    <span class="wz-ticker-item__cat wz-ticker-item__cat--default">STANDBY</span>
                    <span>Awaiting live intel feed...</span>
                </span>
            </div>
        </div>`;
    document.body.appendChild(ticker);
}

export function updateNewsTicker(events = []) {
    void events;
}
