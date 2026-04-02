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
    initNewsTicker();
}

function bindTopViews() {
    const tabs = document.querySelectorAll(".top-tab");
    const panels = document.querySelectorAll(".warzone-view");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.view;
            tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
            panels.forEach((p) =>
                p.classList.toggle("is-active", p.dataset.viewPanel === target)
            );
        });
    });
}

function bindAlertDismiss() {
    // NOTE: sticky alerts are now dismissible via warzone-sticky-alert.js bindStickyDismiss().
    // This legacy handler is kept for non-sticky alerts only.
    const closeBtn = document.querySelector(".warzone-alert__close");
    const alert = document.getElementById("warzone-alert");
    if (!closeBtn || !alert) return;
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
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mapMode;
            buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
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
    trigger.addEventListener("click", () => {
        const isOpen = panel.hidden === false;
        panel.hidden = isOpen;
        trigger.setAttribute("aria-expanded", String(!isOpen));
    });
    closeBtn?.addEventListener("click", () => {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    });
    applyBtn?.addEventListener("click", () => {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
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
    const inner = document.getElementById("wz-ticker-inner");
    if (!inner || !events.length) return;

    // ── Clean title: remove repeated segments separated by — or –
    function cleanTitle(raw = "") {
        const t = String(raw).trim().slice(0, 140);
        // Split on em-dash / en-dash / " - " and deduplicate consecutive segments
        const parts = t.split(/\s*[—–]\s*/).map(s => s.trim()).filter(Boolean);
        const seen = new Set();
        const unique = [];
        for (const p of parts) {
            const key = p.toLowerCase();
            if (!seen.has(key)) { seen.add(key); unique.push(p); }
        }
        return unique.join(" — ");
    }

    // ── Deduplicate events by cleaned title similarity
    const seenTitles = new Set();
    const deduped = [];
    for (const e of events) {
        const cleaned = cleanTitle(e.title || "");
        // Use first 60 chars as dedup key — catches near-duplicates like
        // "ALERT — Jerusalem — East" and "ALERT — Jerusalem — East — Jerusalem"
        const key = cleaned.toLowerCase().slice(0, 60);
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        deduped.push({ ...e, _cleanTitle: cleaned });
        if (deduped.length >= 20) break;
    }

    if (!deduped.length) return;

    const items = deduped.map((e) => {
        const cat = String(e.category || "default").toLowerCase();
        const title = e._cleanTitle || cleanTitle(e.title || "");
        // Only append location if it adds real info not already in title
        const loc = e.location_label &&
            !title.toLowerCase().includes(e.location_label.toLowerCase())
            ? ` — ${e.location_label}` : "";
        return `<span class="wz-ticker-item">
            <span class="wz-ticker-item__cat wz-ticker-item__cat--${cat}">${cat.toUpperCase()}</span>
            <span>${title}${loc}</span>
        </span>`;
    }).join("");

    inner.innerHTML = items + items; // doubled for seamless CSS scroll loop
    inner.style.animation = "none";
    inner.offsetHeight; // force reflow
    inner.style.animation = "";
}