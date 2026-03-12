// assets/js/warzone-hotspots.js
//
// KEY ARCHITECTURE — no-blink DOM diff:
//   • Cards are created ONCE and stored in a persistent Map<id → element>
//   • On every render pass, we only update style.left / style.top
//   • Cards are only removed/created when the cluster SET changes
//   • Clicks directly mutate the clicked element's class — zero re-render
//   • postRender throttled to ~8fps for the overlay — Cesium still runs at full fps

import * as Cesium from "cesium";
import { isEventVisible } from "./warzone-layers.js";

// ─── tiny helpers ─────────────────────────────────────────────────────────────

function norm(v) { return String(v || "").replace(/\s+/g, " ").trim(); }

function timeAgo(d) {
    try {
        const m = Math.floor((Date.now() - new Date(d)) / 60000);
        if (m < 1) return "just now";
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    } catch { return ""; }
}

const ICONS = {
    strike: "✦", military: "⬢", recon: "◉", alert: "⚠",
    airspace: "✈", cyber: "◈", thermal: "⬤", signal: "◎", default: "●"
};

const LABELS = {
    strike: "STRIKE", military: "MILITARY", recon: "RECON", alert: "ALERT",
    airspace: "AIRSPACE", cyber: "CYBER", thermal: "THERMAL", signal: "SIGNAL", default: "ACTIVITY"
};

function icon(cat) { return ICONS[String(cat || "").toLowerCase()] || ICONS.default; }
function label(cat) { return LABELS[String(cat || "").toLowerCase()] || LABELS.default; }

function sevWeight(s) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[String(s || "").toLowerCase()] || 1;
}

function dominantCat(items) {
    const sc = new Map();
    for (const e of items) {
        const k = String(e.category || "default").toLowerCase();
        sc.set(k, (sc.get(k) || 0) + 1 + sevWeight(e.severity));
    }
    let best = "default", top = -1;
    for (const [k, v] of sc) if (v > top) { best = k; top = v; }
    return best;
}

function dominantSev(items) {
    for (const s of ["critical", "high", "medium", "low"])
        if (items.some(e => String(e.severity || "").toLowerCase() === s)) return s;
    return "medium";
}

function latestEvt(items) {
    return [...items].sort((a, b) =>
        new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)
    )[0];
}

// ─── hemisphere cull + Cesium projection ──────────────────────────────────────

function toScreen(scene, lon, lat) {
    try {
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        // Cull points behind the globe
        const camNorm = Cesium.Cartesian3.normalize(scene.camera.position, new Cesium.Cartesian3());
        const ptNorm = Cesium.Cartesian3.normalize(cart, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(camNorm, ptNorm) < 0.08) return null;

        const fn = Cesium.SceneTransforms.wgs84ToWindowCoordinates
            || Cesium.SceneTransforms.worldToWindowCoordinates;
        if (!fn) return null;

        const p = fn(scene, cart);
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return { x: p.x, y: p.y };
    } catch { return null; }
}

// ─── geo clustering ────────────────────────────────────────────────────────────

function geoCluster(events, dLat, dLon, minCount, maxCards) {
    const groups = [];
    for (const e of events) {
        const lat = Number(e.lat), lon = Number(e.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        let g = null;
        for (const gr of groups) {
            if (Math.abs(gr.lat - lat) <= dLat && Math.abs(gr.lon - lon) <= dLon) { g = gr; break; }
        }
        if (g) {
            const n = g.items.length;
            g.lat = (g.lat * n + lat) / (n + 1);
            g.lon = (g.lon * n + lon) / (n + 1);
            g.items.push(e);
        } else {
            groups.push({ lat, lon, items: [e] });
        }
    }

    return groups
        .filter(g => g.items.length >= minCount)
        .map(g => {
            const cat = dominantCat(g.items);
            const sev = dominantSev(g.items);
            const lat = latestEvt(g.items);
            return {
                id: `hs-${cat}-${g.lat.toFixed(2)}-${g.lon.toFixed(2)}`,
                lat: g.lat,
                lon: g.lon,
                count: g.items.length,
                cat, sev,
                icon: icon(cat),
                label: label(cat),
                latest: lat,
                items: g.items,
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, maxCards);
}

// ─── screen stacking ──────────────────────────────────────────────────────────

const STACK_OFF = [{ x: 0, y: 0 }, { x: -18, y: -14 }, { x: 18, y: 14 }];

function stackVisible(clusters, overlapPx, maxPer) {
    const stacks = [];
    for (const c of clusters) {
        let found = null;
        for (const s of stacks) {
            const dx = s.x - c.screen.x, dy = s.y - c.screen.y;
            if (Math.sqrt(dx * dx + dy * dy) <= overlapPx) { found = s; break; }
        }
        if (found) found.items.push(c);
        else stacks.push({ x: c.screen.x, y: c.screen.y, items: [c] });
    }

    const out = [];
    for (const s of stacks) {
        [...s.items].sort((a, b) => b.count - a.count).slice(0, maxPer).forEach((c, i) => {
            out.push({ ...c, stackIdx: i });
        });
    }
    return out;
}

// ─── DOM builders ─────────────────────────────────────────────────────────────

function buildExpandedHTML(items) {
    return items.slice(0, 6).map(e => {
        const sev = String(e.severity || "medium").toLowerCase();
        const t = norm(e.title || "Untitled").slice(0, 80);
        const loc = norm(e.location_label || "");
        const time = timeAgo(e.occurred_at);
        return `<div class="wzhs-item">
            <div class="wzhs-item__row">
                <span class="wzhs-item__sev wzhs-item__sev--${sev}">${sev.toUpperCase()}</span>
                <span class="wzhs-item__time">${time}</span>
            </div>
            <strong class="wzhs-item__title">${t}</strong>
            ${loc ? `<span class="wzhs-item__loc">${loc}</span>` : ""}
        </div>`;
    }).join("");
}

// Creates the card element for a cluster — called ONCE per cluster lifetime
function createCardEl(cluster, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.clusterId = cluster.id;

    // Re-usable render function for this specific card element
    function refreshContent(isExpanded) {
        const loc = norm(cluster.latest?.location_label || "");
        const time = timeAgo(cluster.latest?.occurred_at);

        btn.className = [
            "wzhs",
            `wzhs--${cluster.cat}`,
            `wzhs--sev-${cluster.sev}`,
            cluster.stackIdx === 1 ? "wzhs--s2" : "",
            cluster.stackIdx === 2 ? "wzhs--s3" : "",
            isExpanded ? "wzhs--open" : "",
        ].filter(Boolean).join(" ");

        btn.innerHTML = `
            <div class="wzhs__bar"></div>
            <div class="wzhs__body">
                <div class="wzhs__top">
                    <span class="wzhs__icon">${cluster.icon}</span>
                    <span class="wzhs__count">${cluster.count}</span>
                    <span class="wzhs__label">${cluster.label}</span>
                    <span class="wzhs__arr">${isExpanded ? "▲" : "▼"}</span>
                </div>
                ${isExpanded ? `
                <div class="wzhs__detail">
                    ${loc ? `<div class="wzhs__loc">📍 ${loc}</div>` : ""}
                    <div class="wzhs__time">${time}</div>
                    <div class="wzhs__items">${buildExpandedHTML(cluster.items)}</div>
                </div>` : ""}
            </div>`;
    }

    refreshContent(false);
    btn._refreshContent = refreshContent;

    btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(cluster.id, btn);
    });

    return btn;
}

// ─── main export ──────────────────────────────────────────────────────────────

export function createWarzoneHotspotLayer(viewer, rootEl, options = {}) {
    if (!viewer || !rootEl) return null;

    let allEvents = [];
    let expandedId = null;
    let destroyed = false;

    // Dirty flags
    let clustersDirty = true;
    let cachedClusters = [];   // geo clusters (recomputed only when events change)

    // Persistent DOM node registry  id → { el, x, y }
    const nodeMap = new Map();

    // Render scheduling
    let rafPending = false;
    let lastRenderMs = 0;
    let cameraMoving = false;  // true while user pans/zooms — skip throttle
    let moveEndTimer = 0;

    const cfg = {
        maxCards: options.maxCards ?? 24,
        clusterDistanceLat: options.clusterDistanceLat ?? 2.6,
        clusterDistanceLon: options.clusterDistanceLon ?? 3.2,
        stackDistancePx: options.stackDistancePx ?? 100,
        maxVisiblePerHotspot: options.maxVisiblePerHotspot ?? 3,
        minItemsForCluster: options.minItemsForCluster ?? 1,
        // Only throttle when camera is idle — during movement update every frame
        throttleIdle: options.throttleIdle ?? 100,
    };

    // ── toggle handler — NO re-render, mutates clicked element directly ────────
    function handleToggle(id, el) {
        const wasOpen = expandedId === id;
        expandedId = wasOpen ? null : id;

        // Close previously open card if different
        if (!wasOpen) {
            for (const [nid, node] of nodeMap) {
                if (nid !== id && node.el.classList.contains("wzhs--open")) {
                    node.el._refreshContent(false);
                    node.el.classList.remove("wzhs--open");
                }
            }
        }

        // Toggle the clicked card — direct DOM mutation, zero re-render
        el._refreshContent(!wasOpen);
    }

    // ── core render — DOM diff, only moves existing nodes ─────────────────────
    // Called two ways:
    //   render(false) -- via RAF (idle updates, throttled)
    //   render(true)  -- directly from postRender (camera moving, zero frame lag)
    function render(fromPostRender) {
        if (!fromPostRender) rafPending = false;
        if (destroyed || !viewer.scene || !rootEl) return;

        // Idle path: throttle to ~10fps to save CPU
        if (!fromPostRender) {
            const now = performance.now();
            if (now - lastRenderMs < cfg.throttleIdle) {
                scheduleRender(cfg.throttleIdle - (now - lastRenderMs));
                return;
            }
            lastRenderMs = now;
        }

        const canvas = viewer.scene.canvas;
        if (!canvas) return;

        const canvasRect = canvas.getBoundingClientRect();
        const overlayRect = rootEl.getBoundingClientRect();
        if (!canvasRect.width || !canvasRect.height) return;

        const offX = canvasRect.left - overlayRect.left;
        const offY = canvasRect.top - overlayRect.top;

        // Recompute geo clusters only when events changed
        if (clustersDirty) {
            cachedClusters = geoCluster(
                allEvents,
                cfg.clusterDistanceLat,
                cfg.clusterDistanceLon,
                cfg.minItemsForCluster,
                cfg.maxCards
            );
            clustersDirty = false;
        }

        // Project to screen
        const projected = [];
        for (const c of cachedClusters) {
            const s = toScreen(viewer.scene, c.lon, c.lat);
            if (!s) continue;
            const x = s.x + offX, y = s.y + offY;
            if (x < -140 || x > overlayRect.width + 140) continue;
            if (y < -140 || y > overlayRect.height + 140) continue;
            projected.push({ ...c, screen: { x, y } });
        }

        const visible = stackVisible(projected, cfg.stackDistancePx, cfg.maxVisiblePerHotspot);
        const visibleIds = new Set(visible.map(v => v.id));

        // ── REMOVE cards that are no longer visible ────────────────────────────
        for (const [id, node] of nodeMap) {
            if (!visibleIds.has(id)) {
                node.el.remove();
                nodeMap.delete(id);
            }
        }

        // ── CREATE or MOVE cards ───────────────────────────────────────────────
        for (const cluster of visible) {
            const off = STACK_OFF[cluster.stackIdx] || STACK_OFF[0];
            const tx = Math.round(cluster.screen.x + off.x);
            const ty = Math.round(cluster.screen.y + off.y);
            const zi = 40 - cluster.stackIdx;

            if (nodeMap.has(cluster.id)) {
                // Card already exists — just reposition (NO DOM recreation, NO blink)
                const node = nodeMap.get(cluster.id);
                if (node.x !== tx || node.y !== ty) {
                    node.el.style.left = `${tx}px`;
                    node.el.style.top = `${ty}px`;
                    node.el.style.zIndex = zi;
                    node.x = tx;
                    node.y = ty;
                }
                // Update stack depth classes if they changed
                node.el.classList.toggle("wzhs--s2", cluster.stackIdx === 1);
                node.el.classList.toggle("wzhs--s3", cluster.stackIdx === 2);
            } else {
                // New cluster — create element once
                const el = createCardEl(cluster, handleToggle);
                el.style.cssText = `position:absolute;left:${tx}px;top:${ty}px;z-index:${zi};`;
                rootEl.appendChild(el);
                nodeMap.set(cluster.id, { el, x: tx, y: ty });
            }
        }
    }

    function scheduleRender(delay = 0) {
        if (destroyed || rafPending) return;
        rafPending = true;
        if (delay <= 0) {
            requestAnimationFrame(() => render());
        } else {
            setTimeout(() => { rafPending = false; scheduleRender(0); }, delay);
        }
    }

    // ── Cesium event hooks ─────────────────────────────────────────────────────
    // postRender fires AFTER Cesium draws a frame — projection coords are valid.
    // During camera movement we render every postRender (no throttle).
    // During idle we throttle to cfg.throttleIdle to save CPU.

    function onPostRender() {
        // Camera moving: call render() DIRECTLY here, same synchronous callstack
        // as Cesium's draw. Zero RAF delay = cards move with zero perceived lag.
        // Idle: do nothing, scheduleRender handles periodic updates.
        if (cameraMoving) render(true);
    }

    function onCameraMoveStart() {
        cameraMoving = true;
        clearTimeout(moveEndTimer);
        scheduleRender(0);
    }

    function onCameraMoveEnd() {
        // Small grace period so the final settled position renders correctly
        clearTimeout(moveEndTimer);
        moveEndTimer = setTimeout(() => {
            cameraMoving = false;
            scheduleRender(0);   // one final accurate update
        }, 60);
    }

    function onResize() { scheduleRender(0); }

    viewer.scene.postRender.addEventListener(onPostRender);
    viewer.camera.moveStart.addEventListener(onCameraMoveStart);
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);
    window.addEventListener("resize", onResize, { passive: true });

    // ── public API ─────────────────────────────────────────────────────────────
    return {
        setEvents(next = []) {
            allEvents = Array.isArray(next) ? [...next] : [];
            clustersDirty = true;
            viewer.scene.requestRender();
            scheduleRender(0);
        },

        addEvent(evt) {
            if (!evt) return;
            if (!isEventVisible(evt)) return;   // respect layer toggles
            if (allEvents.some(e => String(e.id) === String(evt.id))) return;
            allEvents.unshift(evt);
            clustersDirty = true;
            viewer.scene.requestRender();
            scheduleRender(0);
        },

        clear() {
            for (const [, node] of nodeMap) node.el.remove();
            nodeMap.clear();
        },

        destroy() {
            destroyed = true;
            clearTimeout(moveEndTimer);
            for (const [, node] of nodeMap) node.el.remove();
            nodeMap.clear();
            viewer.scene.postRender.removeEventListener(onPostRender);
            viewer.camera.moveStart.removeEventListener(onCameraMoveStart);
            viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd);
            window.removeEventListener("resize", onResize);
        },
    };
}