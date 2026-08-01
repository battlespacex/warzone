// File Path: /assets/js/warzone-siren-alert.js
// ── Config ─────────────────────────────────────────────────────────────────────
const MAX_VISIBLE = 8; 
const AUTO_DISMISS = {
    red: 15000,   // 12s
    orange: 12000,   // 10s
    yellow: 10000,    // 8s
};
// ── Stack ──────────────────────────────────────────────────────────────────────
// Stack container lives in partials/popups.html → #wz-siren-stack
// Banner template lives in partials/popups.html → #tpl-siren-banner
let __stack = [];   // [ { id, el, timer } ]
let __seq = 0;
let __sirenLoopTimer = null;
let __sirenAudioEl = null;
const SIREN_STYLE_MODE = false;
function getStack() {
    return document.getElementById("wz-siren-stack");
}
// ── Classify level from event ──────────────────────────────────────────────────
export function classifyAlertLevel(event) {
    if (!event) return "orange";
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    const full = `${title} ${summary}`;
    // Red — active, immediate, going off right now
    if (
        full.includes("going off") ||
        full.includes("activated") ||
        full.includes("firing") ||
        full.includes("take shelter immediately") ||
        (full.includes("siren") && full.includes("now")) ||
        event.severity === "critical"
    ) return "red";
    // Yellow — unconfirmed, incoming warning
    if (
        full.includes("incoming") ||
        full.includes("unconfirmed") ||
        full.includes("warning") ||
        full.includes("possible") ||
        full.includes("expected")
    ) return "yellow";
    // Orange — default confirmed siren report
    return "orange";
}
// ── Label prefix by level ──────────────────────────────────────────────────────
function getLabelPrefix(level) {
    switch (level) {
        case "red": return "SIRENS GOING OFF IN:";
        case "yellow": return "INCOMING THREAT —";
        default: return "SIRENS REPORTED IN:";
    }
}
// ── Format title ──────────────────────────────────────────────────────────────
// Extract location — remove noise words, keep clean place names
function formatAlertTitle(event, level) {
    const prefix = getLabelPrefix(level);
    // Try to extract location from title
    let location = "";
    const title = String(event?.title || "");
    // If title already looks like a clean siren — use location_label
    if (
        title.toLowerCase().includes("siren") ||
        title.toLowerCase().includes("air raid") ||
        title.toLowerCase().includes("red alert") ||
        title.toLowerCase().includes("take shelter")
    ) {
        location = String(event?.location_label || "").toUpperCase();
    } else {
        location = String(event?.location_label || title).toUpperCase();
    }
    // Clean up noise
    location = location
        .replace(/SIRENS?/gi, "")
        .replace(/REPORTED IN/gi, "")
        .replace(/GOING OFF IN/gi, "")
        .replace(/AIR RAID/gi, "")
        .replace(/RED ALERT/gi, "")
        .replace(/TAKE SHELTER/gi, "")
        .replace(/INCOMING/gi, "")
        .replace(/WARNING/gi, "")
        .replace(/^\W+/, "")
        .trim();
    if (!location) location = "ACTIVE ZONE";
    return `${prefix} ${location}`;
}
// ── Source + time meta line ────────────────────────────────────────────────────
function formatMeta(event) {
    const parts = [];
    const src = String(event?.source_name || "").toLowerCase().trim();
    if (src && !src.includes("dev test")) {
        let sourceLabel = "";
        if (src.includes("telegram")) sourceLabel = "Telegram OSINT";
        else if (src.includes("reddit")) sourceLabel = "Reddit";
        else if (src.includes("ads-b")) sourceLabel = "ADS-B";
        else if (src.includes("ais")) sourceLabel = "AIS";
        else sourceLabel = "OSINT Feed";
        parts.push(`via ${sourceLabel}`);
    }
    if (event?.occurred_at) {
        try {
            const d = new Date(event.occurred_at);
            const hh = String(d.getHours()).padStart(2, "0");
            const mm = String(d.getMinutes()).padStart(2, "0");
            parts.push(`${hh}:${mm}`);
        } catch { }
    }
    return parts.join(" · ");
}
// ── Dismiss one banner ─────────────────────────────────────────────────────────
function dismiss(id) {
    const idx = __stack.findIndex(s => s.id === id);
    if (idx < 0) return;
    const item = __stack[idx];
    clearTimeout(item.timer);
    item.el.classList.add("is-closing");
    item.el.addEventListener("animationend", () => {
        try { item.el.remove(); } catch { }
    }, { once: true });
    // Fallback remove
    setTimeout(() => { try { item.el.remove(); } catch { } }, 400);
    __stack.splice(idx, 1);
    if (__stack.length === 0) {
        stopSirenLoop();
    }
}
// ── Remove oldest if over cap ──────────────────────────────────────────────────
function enforceCap() {
    while (__stack.length >= MAX_VISIBLE) {
        dismiss(__stack[0].id);
    }
}
function startSirenLoop() {
    if (__sirenLoopTimer) return;
    if (!__sirenAudioEl) {
        __sirenAudioEl = new Audio("/assets/audio/stratops-siren.mp3");
        __sirenAudioEl.preload = "auto";
        __sirenAudioEl.volume = 0.7;
    }
    const play = () => {
        try {
            __sirenAudioEl.currentTime = 0;
            __sirenAudioEl.play().catch(() => { });
        } catch { }
    };
    // play once immediately
    play();
    // then every 10 seconds
    __sirenLoopTimer = setInterval(() => {
        play();
    }, 10000);
}
function stopSirenLoop() {
    if (__sirenLoopTimer) {
        clearInterval(__sirenLoopTimer);
        __sirenLoopTimer = null;
    }
}
// ── Main API ───────────────────────────────────────────────────────────────────
export function showSirenAlert({ title, meta = "", level = "orange", sound = true, pulse = true } = {}) {
    enforceCap();
    const id = ++__seq;
    const stack = getStack();
    if (!stack) return;
    const tpl = document.getElementById("tpl-siren-banner");
    if (!tpl) return;
    const banner = tpl.content.cloneNode(true).firstElementChild;
    banner.className = `wz-siren-banner wz-siren-banner--${level}`;
    banner.classList.toggle("wz-siren-banner--steady", pulse === false);
    banner.dataset.alertId = id;
    banner.querySelector(".wz-siren-title").textContent = title;
    const metaEl = banner.querySelector(".wz-siren-meta");
    if (meta) {
        metaEl.textContent = meta;
        metaEl.hidden = false;
    } else {
        metaEl.hidden = true;
    }
    banner.querySelector(".wz-siren-close").addEventListener("click", (e) => {
        e.stopPropagation();
        dismiss(id);
    });
    stack.appendChild(banner);
    if (__stack.length === 0 && sound) {
        startSirenLoop();
    }
    const timer = SIREN_STYLE_MODE
        ? null
        : setTimeout(() => dismiss(id), AUTO_DISMISS[level] || 10000);
    __stack.push({ id, el: banner, timer });
}
// ── From normalized event ──────────────────────────────────────────────────────
export function sirenAlertFromEvent(event) {
    if (!event) return;
    const level = classifyAlertLevel(event);
    const title = formatAlertTitle(event, level);
    const meta = formatMeta(event);
    showSirenAlert({ title, meta, level, sound: true });
}
// ── isSirenEvent — tighter check than before ──────────────────────────────────
// Only real siren/air-raid events, NOT news articles that mention sirens
export function isSirenEvent(event) {
    if (!event) return false;
    const category = String(event.category || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    // Category-based: explicit alert type
    if (category === "alert") return true;
    // Title must START with or be primarily about sirens
    // NOT just mentioning sirens in passing (like a news article)
    const sirenPhrases = [
        "sirens", "air raid", "red alert", "take shelter",
        "rocket alert", "incoming missile", "missile alert",
        "air defense", "home front", "color red",
    ];
    // Title must contain siren phrase AND be short (< 120 chars — real alert, not article)
    const hasSirenPhrase = sirenPhrases.some(p => title.includes(p));
    const isShortTitle = title.length < 120;
    if (hasSirenPhrase && isShortTitle) return true;
    // Summary-based only if category strongly suggests it
    if (category === "strike" && summary.includes("siren") && summary.length < 200) return true;
    return false;
}
if (SIREN_STYLE_MODE) {
    window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
            showSirenAlert({
                title: "SIRENS GOING OFF IN: TEL AVIV, HAIFA, CENTRAL ISRAEL",
                meta: "via Telegram",
                level: "red",
                sound: false
            });
            showSirenAlert({
                title: "SIRENS REPORTED IN: BEIRUT, SOUTHERN LEBANON",
                meta: "via Telegram",
                level: "orange",
                sound: false
            });
            showSirenAlert({
                title: "INCOMING THREAT — NORTHERN ISRAEL",
                meta: "via Alert Feed",
                level: "yellow",
                sound: false
            });
        }, 300);
    });
}
