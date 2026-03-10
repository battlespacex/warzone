// assets/js/essential.js
import { initSmoothHomeAnchors } from "./home-anchors.js";
import { supabase } from "./supabase.js";

let __eventsCache = [];
let __alertAudio = null;
let __scrollClassBound = false;
let __scrollToTargetBound = false;
let __lastSeenOccurredAt = null;

function bindScrollClassToggles() {
    if (__scrollClassBound) return;
    __scrollClassBound = true;

    const body = document.body;
    const main = document.querySelector("main");
    const docEl = document.scrollingElement || document.documentElement;

    let ticking = false;
    let lastScrolled = null;

    const getScrollContainer = () => {
        const docScrollable = docEl.scrollHeight - docEl.clientHeight > 2;
        if (docScrollable) return window;
        if (main && main.scrollHeight - main.clientHeight > 2) return main;
        return window;
    };

    let scroller = getScrollContainer();

    const getScrollTop = () => {
        if (scroller === window) {
            return window.pageYOffset || docEl.scrollTop || document.body.scrollTop || 0;
        }
        return scroller.scrollTop || 0;
    };

    const apply = () => {
        const scrolled = getScrollTop() > 2;
        if (scrolled !== lastScrolled) {
            lastScrolled = scrolled;
            body.classList.toggle("on--scroll", scrolled);
        }
        ticking = false;
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(apply);
    };

    const refreshScroller = () => {
        scroller = getScrollContainer();
        apply();
    };

    refreshScroller();

    window.addEventListener("scroll", onScroll, { passive: true });
    if (main) main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", refreshScroller, { passive: true });
}

function bindScrollToTargets() {
    if (__scrollToTargetBound) return;
    __scrollToTargetBound = true;

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-target]");
        if (!btn) return;

        const el = document.querySelector(btn.dataset.target);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    });
}

function initSiteLoader() {
    const loader = document.getElementById("site-loader");
    if (!loader) return;

    window.SiteLoader = {
        start() {
            document.body.classList.add("show-loader");
            loader.classList.remove("is-gone");
        },
        stop() {
            document.body.classList.remove("show-loader");
            loader.classList.add("is-gone");
        },
        forceHide() {
            document.body.classList.remove("show-loader");
            loader.classList.add("is-gone");
        },
    };
}

function initNav() {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
}

function formatTime(value) {
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value || "";
    }
}

function normalizeEvent(event) {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const impactLat = Number(event.impact_lat ?? event.lat);
    const impactLon = Number(event.impact_lon ?? event.lon);
    const originLat = Number(event.origin_lat);
    const originLon = Number(event.origin_lon);

    return {
        ...event,
        category: event.category || "strike",
        lat,
        lon,
        impact_lat: impactLat,
        impact_lon: impactLon,
        impact_label: event.impact_label || event.location_label || "",
        origin_lat: Number.isFinite(originLat) ? originLat : null,
        origin_lon: Number.isFinite(originLon) ? originLon : null,
        origin_label: event.origin_label || "",
        confidence: Number(event.confidence ?? 0),
        actor_side: event.actor_side || "unknown",
        target_side: event.target_side || "unknown",
        weapon_type: event.weapon_type || "unknown",
        target_type: event.target_type || "unknown",
        impact_type: event.impact_type || "unknown",
        report_type: event.report_type || "strike",
        severity: event.severity || "medium",
        airspace_status: event.airspace_status || "unknown",
        cyber_status: event.cyber_status || "unknown",
        fir_code: event.fir_code || "",
        tags: Array.isArray(event.tags) ? event.tags : [],
    };
}

function hasTrajectory(event) {
    return (
        Number.isFinite(Number(event.origin_lat)) &&
        Number.isFinite(Number(event.origin_lon)) &&
        Number.isFinite(Number(event.impact_lat ?? event.lat)) &&
        Number.isFinite(Number(event.impact_lon ?? event.lon))
    );
}

function isTrackLikeEvent(event) {
    const category = String(event.category || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    const haystack = `${category} ${weapon} ${title} ${summary}`;

    return (
        hasTrajectory(event) &&
        (
            haystack.includes("missile") ||
            haystack.includes("rocket") ||
            haystack.includes("drone") ||
            haystack.includes("uav") ||
            haystack.includes("air strike") ||
            haystack.includes("airstrike") ||
            haystack.includes("fighter") ||
            haystack.includes("sortie")
        )
    );
}

function isSirenLikeEvent(event) {
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const category = String(event.category || "").toLowerCase();
    const full = `${title} ${summary} ${weapon} ${category}`;

    return (
        category === "alert" ||
        full.includes("siren") ||
        full.includes("sirens") ||
        full.includes("air raid") ||
        full.includes("red alert") ||
        full.includes("take shelter") ||
        full.includes("incoming")
    );
}

function sortEvents(events) {
    return [...events].sort((a, b) => {
        const aa = new Date(a.occurred_at || 0).getTime();
        const bb = new Date(b.occurred_at || 0).getTime();
        return bb - aa;
    });
}

function countBy(events, key) {
    const out = new Map();

    for (const item of events) {
        const raw = typeof key === "function" ? key(item) : item[key];
        const value = String(raw || "unknown");
        out.set(value, (out.get(value) || 0) + 1);
    }

    return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function renderFeed(events) {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;

    feed.innerHTML = "";

    const rows = events.slice(0, 40);

    if (!rows.length) {
        feed.innerHTML = '<div class="feed-empty">No events available yet.</div>';
        return;
    }

    rows.forEach((event) => {
        const card = document.createElement("article");
        card.className = "feed-card";
        card.dataset.eventId = event.id;

        card.innerHTML = `
            <div class="feed-card__meta">
                <span class="feed-pill">${event.category || "strike"}</span>
                <time>${formatTime(event.occurred_at)}</time>
            </div>
            <h3 class="feed-card__title">${event.title || "Untitled event"}</h3>
            <p class="feed-card__summary">${event.summary || "No summary available."}</p>
            <div class="feed-card__foot">
                <span>${event.location_label || "Unknown location"}</span>
                ${event.source_url ? `<a href="${event.source_url}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}
            </div>
        `;

        feed.appendChild(card);
    });
}

function renderStrikeCounters(events) {
    const iran = events.filter((e) => e.actor_side === "iran").length;
    const usisr = events.filter((e) => e.actor_side === "us_israel").length;
    const mapped = events.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon)).length;

    setText("stat-total", events.length);
    setText("stat-mapped", mapped);
    setText("stat-iran", iran);
    setText("stat-usisr", usisr);

    setText("analytics-total", events.length);
    setText("analytics-iran", iran);
    setText("analytics-usisr", usisr);

    const latest = events[0]?.occurred_at ? new Date(events[0].occurred_at) : null;
    const oldest = events[events.length - 1]?.occurred_at ? new Date(events[events.length - 1].occurred_at) : null;
    const range = latest && oldest
        ? `${String(oldest.getMonth() + 1).padStart(2, "0")}-${String(oldest.getDate()).padStart(2, "0")} → ${String(latest.getMonth() + 1).padStart(2, "0")}-${String(latest.getDate()).padStart(2, "0")}`
        : "--";

    setText("analytics-range", range);
}

function renderCyberStatus(events) {
    const container = document.getElementById("cyber-status-list");
    if (!container) return;

    const countries = ["iran", "israel", "iraq", "lebanon", "syria", "yemen"];
    const markup = countries.map((name) => {
        const hit = events.find((e) => String(e.location_label).toLowerCase().includes(name));
        const status = hit?.cyber_status || "normal";
        return `
            <div class="status-row">
                <span>${name.toUpperCase()}</span>
                <strong class="status-pill status-pill--${status}">${status}</strong>
            </div>
        `;
    }).join("");

    container.innerHTML = markup;
}

function renderAirspaceStatus(events) {
    const container = document.getElementById("airspace-status-list");
    if (!container) return;

    const countries = ["Iran", "Israel", "Lebanon", "Syria", "Iraq", "Jordan", "Saudi Arabia", "UAE", "Bahrain", "Oman"];
    const markup = countries.map((country) => {
        const hit = events.find((e) => String(e.location_label).toLowerCase().includes(country.toLowerCase()));
        const status = hit?.airspace_status || "unknown";
        return `
            <div class="status-row">
                <span>${country}</span>
                <strong class="status-pill status-pill--${status}">${status}</strong>
            </div>
        `;
    }).join("");

    container.innerHTML = markup;
}

function renderEscalation(events) {
    const critical = events.filter((e) => e.severity === "critical").length;
    const high = events.filter((e) => e.severity === "high").length;
    const alerts = events.filter((e) => e.category === "alert").length;
    const strikes = events.filter((e) => e.category === "strike").length;
    const military = events.filter((e) => e.category === "military").length;
    const recon = events.filter((e) => e.category === "recon").length;
    const closedAirspace = events.filter((e) => e.airspace_status === "closed").length;

    const rawScore =
        critical * 12 +
        high * 6 +
        alerts * 5 +
        strikes * 4 +
        military * 3 +
        recon * 2 +
        closedAirspace * 8;

    const score = Math.min(200, rawScore);

    let label = "Moderate";
    if (score >= 160) label = "Extreme";
    else if (score >= 120) label = "Critical";
    else if (score >= 80) label = "High";
    else if (score >= 45) label = "Elevated";

    setText("escalation-score", score);
    setText("escalation-label", label);

    const list = document.getElementById("escalation-breakdown");
    if (!list) return;

    list.innerHTML = `
        <li>${critical} critical incidents</li>
        <li>${high} high severity incidents</li>
        <li>${alerts} active alerts / sirens</li>
        <li>${closedAirspace} airspace closures</li>
        <li>${events.length} total incidents in window</li>
    `;
}

function renderSummary(events) {
    const p = document.getElementById("executive-summary");
    const meta = document.getElementById("intel-meta-line");
    if (!p || !meta) return;

    const iran = events.filter((e) => e.actor_side === "iran").length;
    const usisr = events.filter((e) => e.actor_side === "us_israel").length;
    const topWeapons = countBy(events, "weapon_type").slice(0, 3).map(([k]) => k).join(", ");

    p.textContent = `Over the current reporting window, the event stream indicates an elevated and highly fluid regional conflict picture. Iranian-attributed events total ${iran}, while US/Israel-attributed events total ${usisr}. Most frequently observed weapon categories in the current stream are ${topWeapons || "unknown systems"}. This summary is automatically derived from your current event dataset and should be treated as an OSINT-style operational overview rather than a verified intelligence product.`;

    meta.textContent = `Generated: ${new Date().toLocaleString()} | Incidents analyzed: ${events.length} | Coverage: live rolling dataset`;
}

function renderTimeline(events) {
    const wrap = document.getElementById("timeline-list");
    if (!wrap) return;

    const items = events.slice(0, 15).map((event) => `
        <div class="timeline-item">
            <div class="timeline-time">${formatTime(event.occurred_at)}</div>
            <div class="timeline-body">
                <strong>${event.title}</strong>
                <p>${event.summary || "No summary available."}</p>
                <small>[${event.location_label || "Unknown location"}]</small>
            </div>
        </div>
    `).join("");

    wrap.innerHTML = items || '<div class="feed-empty">No timeline items.</div>';
}

function renderBars(targetId, rows) {
    const el = document.getElementById(targetId);
    if (!el) return;

    el.innerHTML = rows.map(([label, value]) => `
        <div class="bar-row">
            <span>${label}</span>
            <div class="bar-track"><i style="width:${Math.max(2, value)}%"></i></div>
            <strong>${value}</strong>
        </div>
    `).join("");
}

function renderAnalytics(events) {
    const side = countBy(events, "actor_side");
    const weapons = countBy(events, "weapon_type").slice(0, 12);
    const targets = countBy(events, "target_type").slice(0, 12);

    const sideWrap = document.getElementById("analytics-side-breakdown");
    if (sideWrap) {
        sideWrap.innerHTML = side.map(([label, value]) => `
            <div class="ring-stat-card">
                <strong>${value}</strong>
                <span>${label}</span>
            </div>
        `).join("");
    }

    renderBars("analytics-weapons", weapons);
    renderBars("analytics-targets", targets);
}

function renderRecon(events) {
    const regionGrid = document.getElementById("recon-region-grid");
    const alertList = document.getElementById("recon-alert-list");
    const correlationList = document.getElementById("recon-correlation-list");
    const banner = document.getElementById("recon-closure-banner");

    if (banner) {
        const closedCount = events.filter((e) => e.airspace_status === "closed").length;
        banner.textContent = `Regional Airspace Closure Detected — ${closedCount} alerts in dataset`;
    }

    const regions = [
        ["Iran", "OIIX"],
        ["Israel", "LLLL"],
        ["Lebanon", "OLBB"],
        ["Syria", "OSTT"],
        ["Iraq", "ORBB"],
        ["Jordan", "OJAC"],
        ["Saudi Arabia", "OEJD"],
        ["UAE", "OMAE"],
        ["Bahrain", "OBBB"],
        ["Oman", "OOMM"],
        ["Qatar", "OTBD"],
        ["Kuwait", "OKAC"]
    ];

    if (regionGrid) {
        regionGrid.innerHTML = regions.map(([name, fir]) => {
            const hit = events.find((e) => String(e.location_label).toLowerCase().includes(name.toLowerCase()));
            const status = hit?.airspace_status || "unknown";
            return `
                <div class="region-card">
                    <h4>${name}</h4>
                    <small>${fir}</small>
                    <strong class="status-pill status-pill--${status}">${status}</strong>
                </div>
            `;
        }).join("");
    }

    if (alertList) {
        alertList.innerHTML = events
            .filter((e) => e.airspace_status !== "unknown")
            .slice(0, 16)
            .map((e) => `
                <div class="recon-alert-row">
                    <strong>${e.fir_code || "FIR"} | ${e.location_label}</strong>
                    <span>${e.airspace_status}</span>
                    <small>${formatTime(e.occurred_at)}</small>
                </div>
            `)
            .join("");
    }

    if (correlationList) {
        correlationList.innerHTML = events
            .slice(0, 12)
            .map((e) => `
                <div class="correlation-row">
                    <span>${e.fir_code || "FIR"}</span>
                    <p>Airspace ${e.airspace_status} → ${e.title}</p>
                    <strong>${e.severity}</strong>
                </div>
            `)
            .join("");
    }
}

function renderWeapons(events) {
    const grid = document.getElementById("weapons-grid");
    if (!grid) return;

    const rows = countBy(events, "weapon_type").slice(0, 16);

    grid.innerHTML = rows.map(([name, count], index) => `
        <article class="weapon-card">
            <div class="weapon-card__top">
                <h3>${name}</h3>
                <span>${index % 2 === 0 ? "IRAN" : "US/ISR"}</span>
            </div>
            <div class="weapon-badges">
                <span class="weapon-tag">${name}</span>
            </div>
            <p>Observed in current stream ${count} times. Detailed range, CEP, speed, and warhead data can be filled from your curated database later.</p>
        </article>
    `).join("");
}

function renderKillChain(events) {
    const list = document.getElementById("killchain-list");
    if (!list) return;

    list.innerHTML = events.slice(0, 8).map((e) => `
        <article class="killchain-card killchain-card--${e.actor_side}">
            <div class="killchain-head">
                <strong>${e.actor_side}</strong>
                <span>${e.location_label}</span>
                <small>${new Date(e.occurred_at).toISOString().slice(0, 10)}</small>
            </div>
            <div class="killchain-flow">
                <div>Launch</div>
                <div>Impact</div>
                <div>Assessment</div>
            </div>
            <p>${e.weapon_type} → ${e.target_type} → ${e.impact_type}</p>
        </article>
    `).join("");
}

function ensureAlertAudio() {
    if (__alertAudio) return __alertAudio;
    __alertAudio = document.getElementById("warzone-alert-audio");
    return __alertAudio;
}

export function triggerWarzoneAlert({ title, location, level = "high", playSound = true } = {}) {
    const root = document.getElementById("warzone-alert");
    const titleEl = document.getElementById("warzone-alert-title");
    const metaEl = document.getElementById("warzone-alert-meta");

    if (!root || !titleEl || !metaEl) return;

    root.classList.remove("is-red", "is-orange");
    root.classList.add(level === "critical" ? "is-red" : "is-orange", "is-active");

    titleEl.textContent = title || "Incoming alert";
    metaEl.textContent = location || "Live event detected";

    if (playSound) {
        const audio = ensureAlertAudio();
        audio?.play?.().catch(() => { });
    }

    clearTimeout(root.__timer);
    root.__timer = setTimeout(() => root.classList.remove("is-active"), 7000);
}

function flashFeedCard(eventId) {
    const card = document.querySelector(`[data-event-id="${eventId}"]`);
    if (!card) return;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1200);
}

function renderAll(events) {
    __eventsCache = sortEvents(events.map(normalizeEvent));

    renderStrikeCounters(__eventsCache);
    renderFeed(__eventsCache);
    renderCyberStatus(__eventsCache);
    renderAirspaceStatus(__eventsCache);
    renderEscalation(__eventsCache);
    renderSummary(__eventsCache);
    renderTimeline(__eventsCache);
    renderAnalytics(__eventsCache);
    renderRecon(__eventsCache);
    renderWeapons(__eventsCache);
    renderKillChain(__eventsCache);
}

function syncInitialEventsToGlobe(events) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;

    events.forEach((event) => {
        globe.addEvent?.(event);

        if (isTrackLikeEvent(event)) {
            globe.animateMissileTrack?.(event);
        }
    });
}

export async function initWarzoneApp() {
    const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("occurred_at", { ascending: false });

    if (error) {
        console.error("Supabase events error:", error);
        return [];
    }

    const events = Array.isArray(data) ? data.map(normalizeEvent) : [];
    renderAll(events);
    syncInitialEventsToGlobe(events);

    if (events[0]?.occurred_at) {
        __lastSeenOccurredAt = events[0].occurred_at;
    }

    return events;
}

async function pollLatestEvents() {
    try {
        let query = supabase
            .from("events")
            .select("*")
            .order("occurred_at", { ascending: false })
            .limit(25);

        if (__lastSeenOccurredAt) {
            query = query.gt("occurred_at", __lastSeenOccurredAt);
        }

        const { data, error } = await query;

        if (error) {
            console.error("Polling latest events error:", error);
            return;
        }

        const rows = Array.isArray(data) ? data.map(normalizeEvent) : [];
        if (!rows.length) return;

        rows
            .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
            .forEach(handleIncomingEvent);

        const newest = rows[0];
        if (newest?.occurred_at) {
            __lastSeenOccurredAt = newest.occurred_at;
        }
    } catch (err) {
        console.error("Polling latest events failed:", err);
    }
}

export function startEventPollingFallback() {
    setInterval(() => {
        pollLatestEvents();
    }, 30000);
}

export function handleIncomingEvent(event) {
    const normalized = normalizeEvent(event);
    const exists = __eventsCache.findIndex((e) => String(e.id) === String(normalized.id));

    if (exists >= 0) {
        __eventsCache[exists] = normalized;
    } else {
        __eventsCache.unshift(normalized);
    }

    renderAll(__eventsCache);
    flashFeedCard(normalized.id);

    const globe = window.__warzoneViewer?.__warzone;

    globe?.addEvent?.(normalized);
    globe?.highlightAlertRegion?.(normalized);

    if (isTrackLikeEvent(normalized)) {
        globe?.animateMissileTrack?.(normalized);
    }

    if (isSirenLikeEvent(normalized)) {
        triggerWarzoneAlert({
            title: normalized.title || "Air raid sirens active",
            location: normalized.location_label || "Warning area",
            level: normalized.severity === "critical" ? "critical" : "high",
            playSound: true,
        });
        return;
    }

    triggerWarzoneAlert({
        title: normalized.title,
        location: normalized.location_label,
        level: normalized.severity === "critical" ? "critical" : "high",
        playSound: false,
    });
}

function initFloatingPanels() {
    const panels = document.querySelectorAll(".warzone-panel--floating");

    panels.forEach((panel) => {
        const head = panel.querySelector(".panel-head");
        const collapseBtn = panel.querySelector("[data-panel-collapse]");
        const content = panel.querySelector(".panel-content");

        if (collapseBtn && content) {
            collapseBtn.addEventListener("click", () => {
                const isCollapsed = panel.classList.toggle("is-collapsed");
                collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));

                if (isCollapsed) {
                    content.hidden = false;
                    content.style.height = `${content.scrollHeight}px`;
                    requestAnimationFrame(() => {
                        content.style.height = "0px";
                        content.style.opacity = "0";
                    });
                } else {
                    content.hidden = false;
                    content.style.height = "0px";
                    content.style.opacity = "0";
                    requestAnimationFrame(() => {
                        content.style.height = `${content.scrollHeight}px`;
                        content.style.opacity = "1";
                    });
                }
            });

            content.addEventListener("transitionend", (e) => {
                if (e.propertyName !== "height") return;
                if (panel.classList.contains("is-collapsed")) {
                    content.hidden = true;
                } else {
                    content.style.height = "auto";
                }
            });
        }

        if (!head) return;

        let dragging = false;
        let activePointerId = null;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        function stopDrag() {
            dragging = false;
            if (activePointerId !== null) {
                try { head.releasePointerCapture(activePointerId); } catch { }
            }
            activePointerId = null;
            panel.classList.remove("is-dragging");

            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", onPointerUp);
            window.removeEventListener("blur", stopDrag);
        }

        function onPointerMove(e) {
            if (!dragging) return;
            if (activePointerId !== null && e.pointerId !== activePointerId) return;

            const parent = panel.offsetParent || panel.parentElement;
            if (!parent) return;

            let nextLeft = e.clientX - parent.getBoundingClientRect().left - dragOffsetX;
            let nextTop = e.clientY - parent.getBoundingClientRect().top - dragOffsetY;

            const maxLeft = parent.clientWidth - panel.offsetWidth;
            const maxTop = parent.clientHeight - panel.offsetHeight;

            nextLeft = Math.max(0, Math.min(nextLeft, maxLeft));
            nextTop = Math.max(0, Math.min(nextTop, maxTop));

            panel.style.left = `${nextLeft}px`;
            panel.style.top = `${nextTop}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
        }

        function onPointerUp(e) {
            if (activePointerId !== null && e.pointerId !== activePointerId) return;
            stopDrag();
        }

        head.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button,a,input,select,textarea")) return;

            const parent = panel.offsetParent || panel.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();

            const currentLeft = panelRect.left - parentRect.left;
            const currentTop = panelRect.top - parentRect.top;

            panel.style.left = `${currentLeft}px`;
            panel.style.top = `${currentTop}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";

            dragOffsetX = e.clientX - panelRect.left;
            dragOffsetY = e.clientY - panelRect.top;

            dragging = true;
            activePointerId = e.pointerId;
            panel.classList.add("is-dragging");

            try { head.setPointerCapture(activePointerId); } catch { }

            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            document.addEventListener("pointercancel", onPointerUp);
            window.addEventListener("blur", stopDrag);

            e.preventDefault();
        });
    });
}

export function initGlobal() {
    bindScrollClassToggles();
    bindScrollToTargets();
    initSmoothHomeAnchors();
    initSiteLoader();
    initNav();
    initFloatingPanels();
}

export function initBoot() {
    document.addEventListener("DOMContentLoaded", () => {
        initGlobal();
        window.SiteLoader?.forceHide?.();
    });
}