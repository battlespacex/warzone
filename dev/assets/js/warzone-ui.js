// File Path: /assets/js/warzone-ui.js
import { initTheaterPanel } from "./warzone-theater-panel.js";

export function bindWarzoneUi() {
    bindTopViews();
    bindAlertDismiss();
    bindMapModeButtons();
    bindMobileSettingsPanel();
    initTheaterPanel();
    startUtcClock();
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
    btn3d.addEventListener("click", () => {
        btn3d.classList.add("is-active");
        btn2d.classList.remove("is-active");
        window.__warzoneViewer?.__warzone?.setMapMode?.("3d");
    });
    btn2d.addEventListener("click", () => {
        btn2d.classList.add("is-active");
        btn3d.classList.remove("is-active");
        window.__warzoneViewer?.__warzone?.setMapMode?.("2d");
    });
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
