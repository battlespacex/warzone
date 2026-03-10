// assets/js/warzone-siren-alert.js
//
// Siren alert system — StrikeMap style
// 3 levels:
//   "red"    — active / sirens firing now   → "SIRENS GOING OFF IN: ..."
//   "orange" — confirmed / reported sirens  → "SIRENS REPORTED IN: ..."
//   "yellow" — incoming / warning           → "INCOMING THREAT: ..."
//
// Usage:
//   import { showSirenAlert, classifyAlertLevel } from "./warzone-siren-alert.js";
//   showSirenAlert({ title: "Tel Aviv, Haifa", source: "IDF Home Front", level: "red" });
//
// Or pass full event:
//   import { sirenAlertFromEvent } from "./warzone-siren-alert.js";
//   sirenAlertFromEvent(normalizedEvent);

// ── Config ─────────────────────────────────────────────────────────────────────
const MAX_VISIBLE = 3;       // max banners on screen at once
const AUTO_DISMISS = {
    red: 12000,   // 12s
    orange: 10000,   // 10s
    yellow: 8000,    // 8s
};

// ── Stack ──────────────────────────────────────────────────────────────────────
let __stack = [];   // [ { id, el, timer } ]
let __seq = 0;

function getOrCreateStack() {
    let el = document.getElementById("wz-siren-stack");
    if (!el) {
        el = document.createElement("div");
        el.id = "wz-siren-stack";
        document.body.appendChild(el);
    }
    return el;
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

    const src = String(event?.source_name || "").trim();
    if (src && !src.includes("DEV TEST")) {
        // Shorten Telegram / Reddit names
        const shortSrc = src
            .replace("Telegram OSINT", "Telegram")
            .replace("Reddit CombatFootage", "Reddit")
            .replace("Reddit UkraineWarVideoReport", "Reddit")
            .replace("ADS-B / OpenSky Network", "ADS-B")
            .replace("AIS / AISStream.io", "AIS");
        parts.push(`via ${shortSrc}`);
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
}

// ── Remove oldest if over cap ──────────────────────────────────────────────────
function enforceCap() {
    while (__stack.length >= MAX_VISIBLE) {
        dismiss(__stack[0].id);
    }
}

// ── Sound ──────────────────────────────────────────────────────────────────────
let __sirenAudio = null;

function playSirenSound(level) {
    // Use existing warzone alert audio element if available
    const el = document.getElementById("warzone-alert-audio");
    if (el) {
        try {
            el.currentTime = 0;
            el.play().catch(() => { });
        } catch { }
        return;
    }

    // Fallback: Web Audio API beep pattern (no file needed)
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const freqs = level === "red" ? [880, 660, 880, 660] : [660, 440];

        freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = "sine";
            gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
            gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.04);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.18 + 0.14);
            osc.start(ctx.currentTime + i * 0.18);
            osc.stop(ctx.currentTime + i * 0.18 + 0.15);
        });
    } catch { }
}

// ── Main API ───────────────────────────────────────────────────────────────────
export function showSirenAlert({ title, meta = "", level = "orange", sound = true } = {}) {
    enforceCap();

    const id = ++__seq;
    const stack = getOrCreateStack();

    const banner = document.createElement("div");
    banner.className = `wz-siren-banner wz-siren-banner--${level}`;
    banner.dataset.alertId = id;

    banner.innerHTML = `
        <span class="wz-siren-bell" aria-hidden="true">🔔</span>
        <span class="wz-siren-body">
            <strong class="wz-siren-title">${title}</strong>
            ${meta ? `<span class="wz-siren-meta">${meta}</span>` : ""}
        </span>
        <span class="wz-siren-bell-right" aria-hidden="true">🔔</span>
        <button class="wz-siren-close" aria-label="Dismiss" data-dismiss="${id}">✕</button>
    `;

    // Close button
    banner.querySelector(".wz-siren-close").addEventListener("click", (e) => {
        e.stopPropagation();
        dismiss(id);
    });

    stack.appendChild(banner);

    const timer = setTimeout(() => dismiss(id), AUTO_DISMISS[level] || 10000);
    __stack.push({ id, el: banner, timer });

    if (sound) playSirenSound(level);
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
    const isAlertSource = String(event.source_name || "").toLowerCase().includes("telegram");

    if (hasSirenPhrase && isShortTitle) return true;

    // Summary-based only if category strongly suggests it
    if (category === "strike" && summary.includes("siren") && summary.length < 200) return true;

    return false;
}