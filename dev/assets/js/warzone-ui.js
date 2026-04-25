// File Path: /assets/js/warzone-ui.js
import { initTheaterPanel } from "./warzone-theater-panel.js";

const __sceneModeUiState = {
    currentMode: "3d",
    snapshotModeBeforeFocus: null,
    aircraftFocused: false,
    navalFocused: false,
    listenersBound: false,
    bootstrapTimer: null,
};

export function bindWarzoneUi() {
    bindTopViews();
    bindAlertDismiss();
    bindMapModeButtons();
    bindMobileSettingsPanel();
    initTheaterPanel();
    startUtcClock();
    startAltitudeReadout();
    bindGlobeToggle();
}

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

function bindMapModeButtons() {
    const buttons = document.querySelectorAll("[data-map-mode]");
    const applyMapModeState = (activeBtn) => {
        buttons.forEach((btn) => {
            const active = btn === activeBtn;
            btn.classList.toggle("is-active", active);
            btn.setAttribute("aria-pressed", String(active));
        });
    };
    const initialBtn = Array.from(buttons).find((btn) => btn.classList.contains("is-active")) || buttons[0] || null;
    if (initialBtn) applyMapModeState(initialBtn);
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mapMode;
            applyMapModeState(btn);
            window.__warzoneViewer?.__warzone?.setMapMode?.(mode);
        });
    });
}

function isMobileSettingsMode() {
    return window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
}

function bindMobileSettingsPanel() {
    const trigger = document.getElementById("warzone-mobile-settings-trigger");
    const panel = document.getElementById("warzone-mobile-settings-panel");
    const closeBtn = document.getElementById("warzone-mobile-settings-close");
    const applyBtn = document.getElementById("warzone-mobile-settings-apply");
    if (!trigger || !panel) return;
    const setPanelOpen = (open, { focus = true } = {}) => {
        panel.hidden = !open;
        panel.setAttribute("aria-hidden", String(!open));
        trigger.setAttribute("aria-expanded", String(open));
        if (!focus) return;
        if (open) {
            requestAnimationFrame(() => closeBtn?.focus());
        } else {
            requestAnimationFrame(() => trigger.focus());
        }
    };
    setPanelOpen(!panel.hidden, { focus: false });
    trigger.addEventListener("click", () => {
        setPanelOpen(panel.hidden);
    });
    closeBtn?.addEventListener("click", () => {
        setPanelOpen(false);
    });
    applyBtn?.addEventListener("click", () => {
        setPanelOpen(false);
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
    const el = document.getElementById("wz-altitude-readout");
    if (!el) return;
    let rafId = 0;
    let lastValue = "";
    const tick = () => {
        const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height);
        const next = `ALT ${formatAltitude(height)}`;
        if (next !== lastValue) {
            el.textContent = next;
            lastValue = next;
        }
        rafId = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("beforeunload", () => {
        if (rafId) cancelAnimationFrame(rafId);
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

// ── 2D/3D Globe Toggle ─────────────────────────────────────────────────────────
function bindGlobeToggle() {
    const btn3d = document.getElementById("wz-toggle-3d");
    const btn2d = document.getElementById("wz-toggle-2d");
    if (!btn3d || !btn2d) return;
    const normalizeSceneMode = (value = "") => {
        const mode = String(value || "").trim().toLowerCase();
        if (mode === "2d" || mode === "flat") return "2d";
        if (mode === "3d" || mode === "globe") return "3d";
        return "";
    };
    // Auto scene-mode switching on focus can produce repeated morphs when
    // focus signals flap under live updates. Keep it opt-in only.
    const autoFocusSceneModeEnabled = window.__stratopsConfig?.autoSceneModeOnFocus === true;
    const getWarzoneMapApi = () => window.__warzoneViewer?.__warzone || null;
    const updateButtons = (mode = "3d") => {
        const nextMode = normalizeSceneMode(mode) || "3d";
        const is3d = nextMode === "3d";
        btn3d.classList.toggle("is-active", is3d);
        btn2d.classList.toggle("is-active", !is3d);
        btn3d.setAttribute("aria-pressed", String(is3d));
        btn2d.setAttribute("aria-pressed", String(!is3d));
        __sceneModeUiState.currentMode = nextMode;
    };
    const readSceneMode = () => {
        const mode = normalizeSceneMode(getWarzoneMapApi()?.getSceneMode?.());
        if (mode) return mode;
        return __sceneModeUiState.currentMode || "3d";
    };
    const applySceneMode = (mode, options = {}) => {
        const nextMode = normalizeSceneMode(mode);
        if (!nextMode) return readSceneMode();
        const api = getWarzoneMapApi();
        let appliedMode = nextMode;
        if (api?.setSceneMode) {
            const result = api.setSceneMode(nextMode, {
                source: String(options.source || "ui"),
                duration: Number.isFinite(Number(options.duration)) ? Number(options.duration) : undefined,
            });
            appliedMode = normalizeSceneMode(result) || nextMode;
        } else if (api?.setMapMode) {
            const result = api.setMapMode(nextMode);
            appliedMode = normalizeSceneMode(result) || nextMode;
        }
        updateButtons(appliedMode);
        return appliedMode;
    };
    const isAnyFocusActive = () => __sceneModeUiState.aircraftFocused || __sceneModeUiState.navalFocused;
    const syncAutoFocusSceneMode = () => {
        if (!autoFocusSceneModeEnabled) return;
        const focusActive = isAnyFocusActive();
        if (focusActive) {
            if (!__sceneModeUiState.snapshotModeBeforeFocus) {
                __sceneModeUiState.snapshotModeBeforeFocus = readSceneMode();
            }
            applySceneMode("2d", { source: "auto-focus", duration: 0.55 });
            return;
        }
        if (__sceneModeUiState.snapshotModeBeforeFocus) {
            const restoreMode = __sceneModeUiState.snapshotModeBeforeFocus;
            __sceneModeUiState.snapshotModeBeforeFocus = null;
            applySceneMode(restoreMode, { source: "auto-restore", duration: 0.72 });
        }
    };
    const handleManualToggle = (nextMode) => {
        applySceneMode(nextMode, { source: "manual", duration: 0.72 });
        if (isAnyFocusActive()) {
            syncAutoFocusSceneMode();
        }
    };
    btn3d.addEventListener("click", () => handleManualToggle("3d"));
    btn2d.addEventListener("click", () => handleManualToggle("2d"));
    if (!__sceneModeUiState.listenersBound) {
        __sceneModeUiState.listenersBound = true;
        document.addEventListener("wz:scene-mode-changed", (event) => {
            const mode = normalizeSceneMode(event?.detail?.mode);
            if (!mode) return;
            updateButtons(mode);
        });
        document.addEventListener("wz:aircraft-track-selected", (event) => {
            const trackKey = String(event?.detail?.trackKey || "").trim();
            const mode = String(event?.detail?.mode || "").trim().toLowerCase();
            __sceneModeUiState.aircraftFocused = Boolean(trackKey) && mode === "focus";
            syncAutoFocusSceneMode();
        });
        document.addEventListener("wz:naval-track-selected", (event) => {
            const focused = Boolean(event?.detail?.focused) || Boolean(String(event?.detail?.trackKey || "").trim());
            __sceneModeUiState.navalFocused = focused;
            syncAutoFocusSceneMode();
        });
    }
    updateButtons(readSceneMode());
    if (__sceneModeUiState.bootstrapTimer) {
        clearTimeout(__sceneModeUiState.bootstrapTimer);
        __sceneModeUiState.bootstrapTimer = null;
    }
    const bootstrapFromViewer = (attempt = 0) => {
        const mode = normalizeSceneMode(getWarzoneMapApi()?.getSceneMode?.());
        if (mode) {
            updateButtons(mode);
            return;
        }
        if (attempt >= 50) return;
        __sceneModeUiState.bootstrapTimer = setTimeout(() => {
            bootstrapFromViewer(attempt + 1);
        }, 120);
    };
    bootstrapFromViewer(0);
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
