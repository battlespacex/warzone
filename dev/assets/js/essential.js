// assets/js/essential.js
import { initSmoothHomeAnchors } from "./home-anchors.js";
import { supabase } from "./supabase.js";
import { createWarzoneHotspotLayer } from "./warzone-hotspots.js";
import { showSirenAlert, sirenAlertFromEvent, isSirenEvent } from "./warzone-siren-alert.js";
import { initMilitaryTracks, isMilitaryTrackEvent } from "./warzone-military-tracks.js";
import { initRegionSelector, onRegionChange, filterEventsByRegion, getActiveRegion } from "./warzone-region-selector.js";
import { initLayerPanel, onLayerChange, isEventVisible, isLayerEnabled } from "./warzone-layers.js";
import { initDevPanel } from "./warzone-dev-panel.js";

let __eventsCache = [];

// Single source of truth: apply both region AND layer filters
function applyAllFilters(events) {
    const region = getActiveRegion?.();
    const regional = filterEventsByRegion ? filterEventsByRegion(events, region) : events;
    return regional.filter(e => isEventVisible(e));
}
let __alertAudio = null;
let __scrollClassBound = false;
let __scrollToTargetBound = false;
let __lastSeenOccurredAt = null;
let __hotspotLayer = null;
let __militaryTracks = null;

// ── Performance: debounced UI renders ─────────────────────────────────────────
function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
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

    const hasImpact =
        Number.isFinite(impactLat) &&
        Number.isFinite(impactLon);

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

    // Derive airspace status intelligently from event data.
    // Priority: explicit airspace_status field → inferred from strikes/alerts → normal
    function deriveStatus(country) {
        const lc = country.toLowerCase();
        const countryEvents = events.filter(e =>
            String(e.location_label || "").toLowerCase().includes(lc) ||
            String(e.country || "").toLowerCase().includes(lc)
        );

        if (!countryEvents.length) return "unknown";

        // Check explicit field first
        const explicit = countryEvents.find(e => e.airspace_status && e.airspace_status !== "unknown");
        if (explicit) return explicit.airspace_status;

        // Infer: any alert/siren category → closed
        const hasAlert = countryEvents.some(e => e.category === "alert");
        if (hasAlert) return "closed";

        // Infer: airstrikes or missiles in last 2h → restricted
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const hasRecentStrike = countryEvents.some(e => {
            const t = new Date(e.occurred_at).getTime();
            return t > twoHoursAgo && (e.category === "strike" || e.category === "military");
        });
        if (hasRecentStrike) return "restricted";

        // Has old events → normal
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
    // Redirect to new siren alert system
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

    // Fast renders — happen immediately
    debouncedRenderFeed(__eventsCache);
    debouncedRenderUI(__eventsCache);

    // Heavy renders — debounced 2s (analytics, weapons, etc.)
    debouncedRenderHeavy(__eventsCache);
}

// ─── Globe circle clustering ──────────────────────────────────────────────────
// Globe pe har event ka alag circle nahi banana — nearby events merge karo.
// Radius: ~0.5 degrees (~55km). Ek cluster = 1 circle with count.
// Military tracks (aircraft/ships) cluster se bahar hain — unka apna system hai.

const GLOBE_CLUSTER_RADIUS_DEG = 0.5;

// Category priority — cluster mein highest priority wala dikhega
const CAT_PRIORITY = {
    alert: 10, strike: 9, airspace: 8, military: 7,
    recon: 6, cyber: 5, thermal: 4, seismic: 3, signal: 2,
};

function catScore(e) {
    return (CAT_PRIORITY[String(e.category || "").toLowerCase()] || 1) +
        (e.severity === "critical" ? 4 : e.severity === "high" ? 2 : 0);
}

function clusterEventsForGlobe(events) {
    // Military tracks skip — handled by warzone-military-tracks.js
    const toCluster = events.filter(e => {
        const src = String(e.source_name || "").toLowerCase();
        return !src.includes("ads-b") && !src.includes("ais");
    });

    const clusters = [];   // [ { rep: event, count, events[] } ]

    for (const event of toCluster) {
        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        // Find nearest cluster
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

        if (nearest && nearestDist <= GLOBE_CLUSTER_RADIUS_DEG) {
            nearest.events.push(event);
            nearest.count++;
            // Replace rep if this event has higher priority
            if (catScore(event) > catScore(nearest.rep)) {
                nearest.rep = event;
            }
        } else {
            clusters.push({ rep: event, count: 1, events: [event] });
        }
    }

    // Return representative events with _clusterCount attached
    return clusters.map(c => ({
        ...c.rep,
        _clusterCount: c.count,
        _clusterEvents: c.events,
    }));
}

function syncInitialEventsToGlobe(events) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;

    globe.clearEventEntities?.();

    const visible = applyAllFilters(events);

    // Adjust render rate based on how many events are visible
    // 0 = idle (very low GPU), 1–30 = light, 31+ = full
    globe.setPerformanceMode?.(visible.length);

    // Nothing to render — already cleared above, bail early
    if (!visible.length) {
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }

    const clustered = clusterEventsForGlobe(visible);
    globe.addEvents?.(clustered);

    visible.forEach((event) => {
        if (isTrackLikeEvent(event)) globe.animateMissileTrack?.(event);
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

    __hotspotLayer?.setEvents(applyAllFilters(events));

    // ── Region selector ─────────────────────────────────────────────────────
    if (viewer) {
        initRegionSelector(viewer);
        onRegionChange(() => {
            syncInitialEventsToGlobe(__eventsCache);
            __hotspotLayer?.setEvents(applyAllFilters(__eventsCache));
            debouncedRenderUI(applyAllFilters(__eventsCache));
        });
    }

    // ── Layer panel ─────────────────────────────────────────────────────────
    initLayerPanel();
    onLayerChange((id) => {
        // Hotspot labels — instant show/hide
        if (id === "hotspots" || id === "*") {
            const hotspotRoot = document.getElementById("warzone-hotspot-layer");
            if (hotspotRoot) {
                hotspotRoot.style.display = isLayerEnabled("hotspots") ? "" : "none";
            }
        }
        // Satellite imagery — toggle ArcGIS layers (big perf boost when off)
        if (id === "terrain" || id === "*") {
            const globe = window.__warzoneViewer?.__warzone;
            globe?.setTerrainVisible?.(isLayerEnabled("terrain"));
            // Also recalculate perf mode since terrain off = lighter GPU
            globe?.setPerformanceMode?.(applyAllFilters(__eventsCache).length);
        }
        // Re-sync globe + hotspot cards for data layers
        if (id !== "hotspots" && id !== "terrain") {
            const filtered = applyAllFilters(__eventsCache);
            syncInitialEventsToGlobe(__eventsCache);
            __hotspotLayer?.setEvents(filtered);
            debouncedRenderUI(filtered);
        }
    });

    // ── Military tracks init ────────────────────────────────────────────────
    if (viewer && !__militaryTracks) {
        __militaryTracks = initMilitaryTracks(viewer);
        window.__warzoneViewer = viewer;  // ensure global reference
    }

    // ── Re-cluster on zoom change ────────────────────────────────────────────
    // Re-cluster only when zoom changes significantly — NOT on every pan
    // Panning does not need re-sync since all visible events are already rendered
    window.addEventListener("wz:recluster", () => {
        syncInitialEventsToGlobe(__eventsCache);
    });

    if (__militaryTracks) {
        const milEvents = events.filter(isMilitaryTrackEvent);
        __militaryTracks.setTracks(milEvents);
        console.log(`[tracks] Loaded ${milEvents.length} military tracks`);
    }
    // ───────────────────────────────────────────────────────────────────────

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

    // Keep UI counters / feed / escalation current on every new event
    renderAll(__eventsCache);

    flashFeedCard(normalized.id);

    const globe = window.__warzoneViewer?.__warzone;

    // Apply region + layer filter before globe render
    const region = getActiveRegion?.();
    const inRegion = !filterEventsByRegion || !region || region.id === "global" || (() => {
        const b = region.bounds;
        const lat = Number(normalized.lat), lon = Number(normalized.lon);
        return lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;
    })();

    const layerOk = !isEventVisible || isEventVisible(normalized);

    if (inRegion && layerOk) {
        // Check if a circle already exists nearby
        const isNearExisting = __eventsCache.some(e => {
            if (String(e.id) === String(normalized.id)) return false;
            const dLat = Math.abs(Number(e.lat) - Number(normalized.lat));
            const dLon = Math.abs(Number(e.lon) - Number(normalized.lon));
            return dLat < GLOBE_CLUSTER_RADIUS_DEG && dLon < GLOBE_CLUSTER_RADIUS_DEG;
        });
        globe?.addEvent?.({ ...normalized, _nearExisting: isNearExisting });
        globe?.highlightAlertRegion?.(normalized);
    }

    if (isTrackLikeEvent(normalized)) {
        globe?.animateMissileTrack?.(normalized);
    }

    __hotspotLayer?.addEvent(normalized);   // hotspot layer does its own cluster rebuild

    // ── Military track (aircraft / naval) ──────────────────────────────────
    if (isMilitaryTrackEvent(normalized) && __militaryTracks) {
        __militaryTracks.addTrack(normalized);
    }
    // ───────────────────────────────────────────────────────────────────────

    // Use tight siren check — avoids news articles falsely triggering
    if (isSirenEvent(normalized)) {
        sirenAlertFromEvent(normalized);
        // Pulse the country/region on the globe too
        globe?.highlightAlertRegion?.(normalized);
        return;
    }

    // Non-siren events: NO banner — only map circle + feed update
    // (MonitorX / Telegram news articles should not pop up as alerts)
}

function initFloatingPanels() {
    const panels = document.querySelectorAll(".warzone-panel--floating");

    panels.forEach((panel) => {
        const head = panel.querySelector(".panel-head");
        const collapseBtn = panel.querySelector("[data-panel-collapse]");
        const content = panel.querySelector(".panel-content");

        // Collapse handled by warzone-boot.js via CSS grid-template-rows trick.

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
    initDevPanel();
}

export function initBoot() {
    document.addEventListener("DOMContentLoaded", () => {
        initGlobal();
        window.SiteLoader?.forceHide?.();
    });
}