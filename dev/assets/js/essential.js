import { initSmoothHomeAnchors } from "./home-anchors.js";
let __scrollClassBound = false;
let __scrollToTargetBound = false;
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
            return window.pageYOffset || docEl.scrollTop || document.body.scrollTop
                || 0;
        }
        return scroller.scrollTop || 0;
    };
    const apply = () => {
        const scrolled = getScrollTop() > 2;
        if (scrolled !== lastScrolled) {
            lastScrolled = scrolled;
            body.classList.toggle("on--scroll", scrolled);
            if (main) main.classList.toggle("on--scroll", scrolled);
            window.dispatchEvent(new CustomEvent("warzone:nav-refresh"));
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
    window.addEventListener("pageshow", refreshScroller);
    window.visualViewport?.addEventListener("scroll", onScroll, {
        passive:
            true
    });
    window.visualViewport?.addEventListener("resize", refreshScroller, {
        passive:
            true
    });
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
    const body = document.body;
    const loader = document.getElementById("site-loader");
    if (!loader) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion:reduce)")?.matches;
    let activeCount = 0;
    let hideTimer = null;
    let hideToken = 0;
    loader.classList.add("is-gone");
    loader.setAttribute("aria-hidden", "true");
    body.classList.remove("show-loader");
    const show = () => {
        clearTimeout(hideTimer);
        hideToken += 1;
        loader.classList.remove("is-gone");
        loader.setAttribute("aria-hidden", "false");
        body.classList.add("show-loader");
    };
    const hide = () => {
        const tokenAtHide = ++hideToken;
        body.classList.remove("show-loader");
        loader.setAttribute("aria-hidden", "true");
        body.classList.remove("is-booting");
        if (reduceMotion) {
            loader.classList.add("is-gone");
            return;
        }
        const onEnd = (e) => {
            if (tokenAtHide !== hideToken) return;
            if (e.target !== loader) return;
            if (e.propertyName !== "opacity") return;
            loader.classList.add("is-gone");
            loader.removeEventListener("transitionend", onEnd);
        };
        loader.addEventListener("transitionend", onEnd);
    };
    window.SiteLoader = {
        start() {
            activeCount += 1;
            show();
        },
        stop({ delay = 250 } = {}) {
            activeCount = Math.max(0, activeCount - 1);
            if (activeCount === 0) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hide, delay);
            }
        },
        forceHide() {
            activeCount = 0;
            clearTimeout(hideTimer);
            hide();
        }
    };
    window.addEventListener("pageshow", () => {
        activeCount = 0;
        window.SiteLoader.forceHide();
    });
    setTimeout(() => {
        window.SiteLoader.forceHide();
    }, 2500);
}
function initNav() {
    const menu = document.getElementById("nav-menu");
    if (!menu) return;
    const links = Array.from(menu.querySelectorAll("a"));
    if (!links.length) return;
    const underline = document.createElement("span");
    underline.className = "nav__underline";
    menu.appendChild(underline);
    function moveUnderline(link) {
        if (!link) return;
        const linkRect = link.getBoundingClientRect();
        const navRect = menu.getBoundingClientRect();
        underline.style.width = `${linkRect.width}px`;
        underline.style.left = `${linkRect.left - navRect.left}px`;
    }
    function setActiveLink() {
        const pathname = window.location.pathname.replace(/\/+$/, "") || "/warzone";
        links.forEach((l) => l.classList.remove("active"));
        const active = links.find((link) => {
            const href = link.getAttribute("href") || "";
            return href.replace(/\/+$/, "") === pathname;
        }) || links[0];
        active.classList.add("active");
        requestAnimationFrame(() => moveUnderline(active));
    }
    window.addEventListener("resize", () => {
        const active = menu.querySelector("a.active");
        if (active) requestAnimationFrame(() => moveUnderline(active));
    });
    window.addEventListener("warzone:nav-refresh", () => {
        const active = menu.querySelector("a.active") || links[0];
        if (active) requestAnimationFrame(() => moveUnderline(active));
    });
    setActiveLink();
}
async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
}
function formatTime(value) {
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value || "";
    }
}
function createMarkerSize(count) {
    if (count >= 100) return "is-xl";
    if (count >= 50) return "is-lg";
    if (count >= 20) return "is-md";
    return "is-sm";
}
function buildCluster(points) {
    const rounded = new Map();
    for (const point of points) {
        const lat = Number(point.lat);
        const lon = Number(point.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const key = `${lat.toFixed(1)}|${lon.toFixed(1)}`;
        if (!rounded.has(key)) {
            rounded.set(key, {
                lat,
                lon,
                count: 0,
                items: []
            });
        }
        const bucket = rounded.get(key);
        bucket.count += 1;
        bucket.items.push(point);
    }
    return Array.from(rounded.values());
}
function renderMap(events) {
    const map = document.getElementById("warzone-map");
    if (!map) return;
    map.innerHTML = "";
    const clusters = buildCluster(events);
    clusters.forEach((cluster, index) => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = `warzone-marker ${createMarkerSize(cluster.count)}`;
        marker.style.left = `${12 + ((cluster.lon + 180) / 360) * 76}%`;
        marker.style.top = `${10 + ((90 - (cluster.lat + 90)) / 180) * 72}%`;
        marker.textContent = String(cluster.count);
        marker.setAttribute("aria-label", `${cluster.count} events`);
        marker.addEventListener("click", () => {
            const focusEvent = cluster.items[0];
            const feedCard = document.querySelector(`[data-event-id="$
{focusEvent.id}"]`);
            if (feedCard) {
                feedCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
                feedCard.classList.add("is-flash");
                setTimeout(() => feedCard.classList.remove("is-flash"), 1200);
            }
        })
        marker.style.zIndex = String(10 + index);
        map.appendChild(marker);
    });
}
function renderFeed(events) {
    const feed = document.getElementById("live-feed-list");
    if (!feed) return;
    feed.innerHTML = "";
    if (!events.length) {
        const empty = document.createElement("div");
        empty.className = "feed-empty";
        empty.textContent = "No events available yet.";
        feed.appendChild(empty);
        return;
    }
    events.slice(0, 50).forEach((event) => {
        const card = document.createElement("article");
        card.className = "feed-card";
        card.dataset.eventId = event.id;
        card.innerHTML = `
         <div class="feed-card__meta">
             <span class="feed-pill">${event.category || "strike"}</span>
             <time>${formatTime(event.occurred_at)}</time>
             </div>
             <h3 class="feed-card__title">${event.title || "Untitled event"}</h3>
             <p class="feed-card__summary">${event.summary || "No summary available."}
            </p>
             <div class="feed-card__foot">
             <span>${event.location_label || `${Number(event.lat).toFixed(2)}, ${Number(event.lon).toFixed(2)}`}</span>
            ${event.source_url ? `<a href="${event.source_url}" target="_blank"
            rel="noopener noreferrer">Source</a>` : ""}
         </div>
         `;
        feed.appendChild(card);
    });
}
function renderCounters(events) {
    const totalEl = document.getElementById("stat-total");
    const mappedEl = document.getElementById("stat-mapped");
    const latestEl = document.getElementById("stat-latest");
    const countryEl = document.getElementById("stat-countries");
    const uniqueCountries = new Set(
        events.map((e) => String(e.location_label ||
            "").split(",").pop()?.trim()).filter(Boolean)
    );
    if (totalEl) totalEl.textContent = String(events.length);
    if (mappedEl) mappedEl.textContent = String(events.filter((e) =>
        Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lon))).length);
    if (latestEl) latestEl.textContent = events[0]?.occurred_at ?
        formatTime(events[0].occurred_at) : "--";
    if (countryEl) countryEl.textContent = String(uniqueCountries.size || 0);
}
export async function initWarzoneApp() {
    const root = document.getElementById("warzone-app");
    if (!root) return;
    const apiBase = root.dataset.apiBase || "https://api.battlespacex.com";
    const endpoint = `${apiBase.replace(/\/+$/, "")}/events?limit=250`;
    try {
        root.classList.add("is-loading");
        const data = await fetchJson(endpoint);
        const events = Array.isArray(data.events) ? data.events : [];
        renderCounters(events);
        renderMap(events);
        renderFeed(events);
    } catch (err) {
        const feed = document.getElementById("live-feed-list");
        if (feed) {
            feed.innerHTML = '<div class="feed-empty">Could not load live data right now.</div > ';
        }
    } finally {
        root.classList.remove("is-loading");
    }
}
export function initGlobal() {
    bindScrollClassToggles();
    bindScrollToTargets();
    initSmoothHomeAnchors();
    initSiteLoader();
    initNav();

    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
}
export function initBoot() {
    document.addEventListener("DOMContentLoaded", async () => {
        const body = document.body;
        body.classList.add("is-booting");
        window.SiteLoader?.start?.();
        try {
            initGlobal();
            await initWarzoneApp();
        } finally {
            body.classList.add("is-ready");
            body.classList.remove("is-booting");
            body.classList.remove("show-loader");
            window.SiteLoader?.stop?.({ delay: 0 });
            window.SiteLoader?.forceHide?.();
        }
    });
}