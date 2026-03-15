// assets/js/essential.js
import { initSmoothHomeAnchors } from "./home-anchors.js";
import { supabase } from "./supabase.js";
import { createWarzoneHotspotLayer } from "./warzone-hotspots.js";
import { showSirenAlert, sirenAlertFromEvent, isSirenEvent } from "./warzone-siren-alert.js";
import { initMilitaryTracks, isMilitaryTrackEvent } from "./warzone-military-tracks.js";
import { initRegionSelector, onRegionChange, filterEventsByRegion, getActiveRegion } from "./warzone-region-selector.js";
import { initLayerPanel, onLayerChange, isEventVisible, isLayerEnabled, getEventLayerId } from "./warzone-layers.js";

let __eventsCache = [];
let __liveRecentEvents = [];
let __alertAudio = null;
let __scrollClassBound = false;
let __scrollToTargetBound = false;
let __lastSeenOccurredAt = null;
let __hotspotLayer = null;
let __militaryTracks = null;
let __pollTimer = null;
let __viewportFetchTimer = null;
let __lastViewportKey = "";

// Single source of truth: apply both region AND layer filters
function applyAllFilters(events) {
    const region = getActiveRegion?.();
    const regional = filterEventsByRegion ? filterEventsByRegion(events, region) : events;
    return regional.filter((e) => isEventVisible(e));
}

function roundCoord(value, step = 2) {
    return Math.round(Number(value) / step) * step;
}

function makeViewportKey(bounds, regionId = "global") {
    if (!bounds) return `${regionId}:none`;
    return [
        regionId,
        roundCoord(bounds.minLat, 2),
        roundCoord(bounds.maxLat, 2),
        roundCoord(bounds.minLon, 2),
        roundCoord(bounds.maxLon, 2),
    ].join("|");
}

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

const debouncedRenderUI = debounce((events) => {
    renderStrikeCounters(events);
    renderCyberStatus(events);
    renderAirspaceStatus(events);
    renderEscalation(events);
}, 800);

const debouncedRenderFeed = debounce((events) => {
    renderFeed(events);
}, 400);

const debouncedRenderHeavy = debounce((events) => {
    renderSummary(events);
    renderTimeline(events);
    renderAnalytics(events);
    renderRecon(events);
    renderWeapons(events);
    renderKillChain(events);
}, 2000);

function scheduleViewportFetch(delay = 500) {
    clearTimeout(__viewportFetchTimer);
    __viewportFetchTimer = setTimeout(() => {
        fetchViewportEvents();
    }, delay);
}

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

function isTrackLikeEvent(event) {
    const category = String(event.category || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    const haystack = `${category} ${weapon} ${title} ${summary}`;

    const originLat = Number(event.origin_lat);
    const originLon = Number(event.origin_lon);
    const impactLat = Number(event.impact_lat ?? event.lat);
    const impactLon = Number(event.impact_lon ?? event.lon);

    const hasOrigin =
        event.origin_lat != null &&
        event.origin_lat !== "" &&
        Number.isFinite(originLat) &&
        Number.isFinite(originLon) &&
        !(originLat === 0 && originLon === 0);

    const hasImpact = Number.isFinite(impactLat) && Number.isFinite(impactLon);

    if (!hasOrigin || !hasImpact) return false;

    const samePoint =
        Math.abs(originLat - impactLat) < 0.01 &&
        Math.abs(originLon - impactLon) < 0.01;

    if (samePoint) return false;

    return (
        haystack.includes("missile") ||
        haystack.includes("rocket") ||
        haystack.includes("drone") ||
        haystack.includes("uav") ||
        haystack.includes("air strike") ||
        haystack.includes("airstrike")
    );
}

async function fetchViewportEvents() {
    const globe = window.__warzoneViewer?.__warzone;
    const bounds = globe?.getViewportBounds?.();
    const region = getActiveRegion?.();
    const regionId = region?.id || "global";

    if (!bounds) return;

    const viewportKey = makeViewportKey(bounds, regionId);
    if (viewportKey === __lastViewportKey) return;
    __lastViewportKey = viewportKey;

    try {
        const { data, error } = await supabase
            .from("events")
            .select("*")
            .gte("lat", bounds.minLat)
            .lte("lat", bounds.maxLat)
            .gte("lon", bounds.minLon)
            .lte("lon", bounds.maxLon)
            .order("occurred_at", { ascending: false })
            .limit(500);

        if (error) {
            console.error("Viewport events fetch error:", error);
            return;
        }

        const viewportRows = Array.isArray(data) ? data.map(normalizeEvent) : [];
        const merged = [...viewportRows];
        const seen = new Set(merged.map((e) => String(e.id)));

        for (const evt of __liveRecentEvents) {
            if (seen.has(String(evt.id))) continue;

            const lat = Number(evt.lat);
            const lon = Number(evt.lon);
            if (
                lat >= bounds.minLat &&
                lat <= bounds.maxLat &&
                lon >= bounds.minLon &&
                lon <= bounds.maxLon
            ) {
                merged.push(evt);
            }
        }

        renderAll(merged);
        syncInitialEventsToGlobe(merged, { animateTracks: false });

        if (__hotspotLayer) {
            __hotspotLayer.setEvents(
                isLayerEnabled("hotspots") ? applyAllFilters(merged) : []
            );
        }

        window.__warzoneViewer?.scene?.requestRender?.();
    } catch (err) {
        console.error("Viewport fetch failed:", err);
    }
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

    function deriveStatus(country) {
        const lc = country.toLowerCase();
        const countryEvents = events.filter((e) =>
            String(e.location_label || "").toLowerCase().includes(lc) ||
            String(e.country || "").toLowerCase().includes(lc)
        );

        if (!countryEvents.length) return "unknown";

        const explicit = countryEvents.find((e) => e.airspace_status && e.airspace_status !== "unknown");
        if (explicit) return explicit.airspace_status;

        const hasAlert = countryEvents.some((e) => e.category === "alert");
        if (hasAlert) return "closed";

        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const hasRecentStrike = countryEvents.some((e) => {
            const t = new Date(e.occurred_at).getTime();
            return t > twoHoursAgo && (e.category === "strike" || e.category === "military");
        });
        if (hasRecentStrike) return "restricted";

        return "normal";
    }

    const markup = countries.map((country) => {
        const status = deriveStatus(country);
        const label = status.charAt(0).toUpperCase() + status.slice(1);
        return `
            <div class="status-row">
                <span>${country}</span>
                <strong class="status-pill status-pill--${status}">${label}</strong>
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
        ["Kuwait", "OKAC"],
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
    const alertLevel = level === "critical" ? "red" : level === "high" ? "orange" : "yellow";
    showSirenAlert({
        title: String(title || "ALERT"),
        meta: String(location || ""),
        level: alertLevel,
        sound: playSound,
    });
}

function flashFeedCard(eventId) {
    const card = document.querySelector(`[data-event-id="${eventId}"]`);
    if (!card) return;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1200);
}

function renderAll(events) {
    __eventsCache = sortEvents(events.map(normalizeEvent));

    debouncedRenderFeed(__eventsCache);
    debouncedRenderUI(__eventsCache);
    debouncedRenderHeavy(__eventsCache);
}

function syncFilteredUi(events) {
    const filtered = applyAllFilters(events);
    debouncedRenderFeed(filtered);
    debouncedRenderUI(filtered);
    debouncedRenderHeavy(filtered);
    return filtered;
}

const GLOBE_CLUSTER_RADIUS_DEG = 1;
const GLOBE_CLUSTER_THRESHOLD = 60;

function getGlobeClusterRadiusDeg() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    if (height > 7000000) return 1.1;
    if (height > 4500000) return 0.8;
    if (height > 2800000) return 0.6;
    if (height > 1600000) return 0.45;
    return 0.28;
}

const CAT_PRIORITY = {
    alert: 10,
    strike: 9,
    airspace: 8,
    military: 7,
    recon: 6,
    cyber: 5,
    thermal: 4,
    seismic: 3,
    signal: 2,
};

function catScore(e) {
    return (CAT_PRIORITY[String(e.category || "").toLowerCase()] || 1) +
        (e.severity === "critical" ? 4 : e.severity === "high" ? 2 : 0);
}

function clusterEventsForGlobe(events) {
    if (!Array.isArray(events) || !events.length) return [];
    if (events.length < GLOBE_CLUSTER_THRESHOLD) {
        return events.map((event) => ({
            ...event,
            _clusterCount: Number(event._clusterCount || 1),
            _clusterEvents: Array.isArray(event._clusterEvents) ? event._clusterEvents : [event],
        }));
    }

    const clusterRadiusDeg = getGlobeClusterRadiusDeg();
    const toCluster = events.filter((e) => {
        const src = String(e.source_name || "").toLowerCase();
        return !src.includes("ads-b") && !src.includes("ais");
    });

    const clusters = [];

    for (const event of toCluster) {
        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        let nearest = null;
        let nearestDist = Infinity;

        for (const cluster of clusters) {
            const dLat = cluster.rep.lat - lat;
            const dLon = cluster.rep.lon - lon;
            const dist = Math.sqrt(dLat * dLat + dLon * dLon);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = cluster;
            }
        }

        if (nearest && nearestDist <= clusterRadiusDeg) {
            nearest.events.push(event);
            nearest.count++;
            if (catScore(event) > catScore(nearest.rep)) {
                nearest.rep = event;
            }
        } else {
            clusters.push({ rep: event, count: 1, events: [event] });
        }
    }

    return clusters.map((c) => ({
        ...c.rep,
        _clusterCount: c.count,
        _clusterEvents: c.events,
    }));
}

function syncInitialEventsToGlobe(events, { animateTracks = false } = {}) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;

    const visible = applyAllFilters(events);
    globe.setPerformanceMode?.(visible.length);
    globe.clearEventEntities?.();

    if (!visible.length) {
        __militaryTracks?.setTracks([]);
        __hotspotLayer?.setEvents([]);
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }

    const clustered = clusterEventsForGlobe(
        visible.map((event) => ({
            ...event,
            _layerId: getEventLayerId(event),
        }))
    );

    globe.addEvents?.(clustered);

    if (__militaryTracks) {
        __militaryTracks.setTracks(
            visible.filter((event) => isMilitaryTrackEvent(event) && isEventVisible(event))
        );
    }

    if (__hotspotLayer) {
        __hotspotLayer.setEvents(isLayerEnabled("hotspots") ? visible : []);
    }

    if (animateTracks) {
        for (const event of visible) {
            if (isTrackLikeEvent(event)) {
                globe.animateMissileTrack?.(event);
            }
        }
    }

    window.__warzoneViewer?.scene?.requestRender?.();
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

    const hotspotRoot = document.getElementById("warzone-hotspot-layer");
    const viewer = window.__warzoneViewer;

    if (hotspotRoot && viewer && !__hotspotLayer) {
        __hotspotLayer = createWarzoneHotspotLayer(viewer, hotspotRoot, {
            maxCards: 20,
            clusterDistanceLat: 2.6,
            clusterDistanceLon: 3.2,
            stackDistancePx: 90,
            maxVisiblePerHotspot: 3,
            minItemsForCluster: 1,
        });
    }

    __hotspotLayer?.setEvents(isLayerEnabled("hotspots") ? applyAllFilters(events) : []);

    if (viewer && !__militaryTracks) {
        __militaryTracks = initMilitaryTracks(viewer);
        window.__militaryTracks = __militaryTracks;
    }

    if (viewer) {
        initRegionSelector(viewer);

        onRegionChange(() => {
            __lastViewportKey = "";
            scheduleViewportFetch(250);
        });

        if (viewer.camera?.moveEnd) {
            viewer.camera.moveEnd.addEventListener(() => {
                scheduleViewportFetch(500);
            });
        }
    }

    initLayerPanel();
    onLayerChange((id) => {
        const globe = window.__warzoneViewer?.__warzone;
        const filtered = applyAllFilters(__eventsCache);

        if (id === "hotspots" || id === "*") {
            const hotspotRootEl = document.getElementById("warzone-hotspot-layer");
            const enabled = isLayerEnabled("hotspots");
            if (hotspotRootEl) hotspotRootEl.style.display = enabled ? "" : "none";
            __hotspotLayer?.setEvents(enabled ? filtered : []);
        }

        if (id === "terrain") {
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
            window.__warzoneViewer?.scene?.requestRender?.();
            return;
        }

        if (id === "*") {
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
        }

        syncFilteredUi(__eventsCache);
        syncInitialEventsToGlobe(__eventsCache, { animateTracks: false });
    });

    window.addEventListener("wz:recluster", () => {
        syncInitialEventsToGlobe(__eventsCache, { animateTracks: false });
    });

    if (__militaryTracks) {
        __militaryTracks.setTracks(applyAllFilters(events).filter(isMilitaryTrackEvent));
    }

    if (events[0]?.occurred_at) {
        __lastSeenOccurredAt = events[0].occurred_at;
    }

    __lastViewportKey = "";
    scheduleViewportFetch(150);

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
    if (__pollTimer) return;
    __pollTimer = setInterval(() => {
        pollLatestEvents();
    }, 30000);
}

export function handleIncomingEvent(event) {
    const normalized = normalizeEvent(event);

    __liveRecentEvents.unshift(normalized);
    if (__liveRecentEvents.length > 300) {
        __liveRecentEvents.length = 300;
    }

    const exists = __eventsCache.findIndex((e) => String(e.id) === String(normalized.id));

    if (exists >= 0) {
        __eventsCache[exists] = normalized;
    } else {
        __eventsCache.unshift(normalized);
    }

    renderAll(__eventsCache);
    flashFeedCard(normalized.id);

    const globe = window.__warzoneViewer?.__warzone;
    const region = getActiveRegion?.();
    const inRegion =
        !filterEventsByRegion ||
        !region ||
        region.id === "global" ||
        (() => {
            const b = region.bounds;
            const lat = Number(normalized.lat);
            const lon = Number(normalized.lon);
            return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
        })();

    const layerOk = isEventVisible(normalized);

    if (isMilitaryTrackEvent(normalized) && __militaryTracks) {
        if (inRegion && layerOk) __militaryTracks.addTrack(normalized);
    } else if (inRegion && layerOk) {
        globe?.addEvent?.({ ...normalized, _layerId: getEventLayerId(normalized) });
    }

    if (isTrackLikeEvent(normalized) && inRegion && layerOk) {
        globe?.animateMissileTrack?.(normalized);
    }

    if (isLayerEnabled("hotspots") && inRegion && layerOk) {
        __hotspotLayer?.addEvent?.(normalized);
    }

    if (isSirenEvent(normalized)) {
        sirenAlertFromEvent(normalized);
        if (inRegion && layerOk) {
            globe?.highlightAlertRegion?.(normalized);
        }
    }
}

function initFloatingPanels() {
    const panels = document.querySelectorAll(".warzone-panel--floating");

    panels.forEach((panel) => {
        const head = panel.querySelector(".panel-head");

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
