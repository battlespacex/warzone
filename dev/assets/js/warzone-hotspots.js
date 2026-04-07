// File Path: /assets/js/warzone-hotspots.js
import * as Cesium from "cesium";
import { isEventVisible } from "./warzone-layers.js";
// ─── tiny helpers ─────────────────────────────────────────────────────────────
function sanitizeText(v) {
    if (!v) return "";
    let t = String(v);
    t = t.replace(/https?:\/\/\S+/gi, " ");
    t = t.replace(/t\.me\/\S+/gi, " ");
    t = t.replace(/@[A-Za-z0-9_]+/g, " ");
    t = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
    t = t.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, " ");
    t = t.replace(/[\u200E\u200F\u202A-\u202E]/g, " ");
    t = t.replace(/[،؛ـ]+/g, " ");
    t = t.replace(/[^\p{L}\p{N}\s.,:;!?()\-\/&]/gu, " ");
    t = t.replace(/\s+/g, " ").trim();
    return t;
}
function norm(v) {
    return sanitizeText(v);
}
function compactPlaceLabel(v) {
    const clean = sanitizeText(v);
    if (!clean) return "";
    const parts = clean.split(",").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0] || "";
    const last = parts[parts.length - 1] || "";
    if (/[a-z]/i.test(first) && !/\d/.test(first)) return first;
    if (/[a-z]/i.test(last) && !/\d/.test(last)) return last;
    return clean;
}
function timeAgo(d) {
    try {
        const m = Math.floor((Date.now() - new Date(d)) / 60000);
        if (m < 1) return "just now";
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    } catch {
        return "";
    }
}
function truncateText(v, max = 90) {
    const clean = sanitizeText(v);
    if (!clean) return "";
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max).trim()}…`;
}
function isRecentActivity(occurredAt, windowMs = 60 * 60 * 1000) {
    const ts = new Date(occurredAt || 0).getTime();
    return Number.isFinite(ts) && (Date.now() - ts) <= windowMs;
}
function englishRatio(text) {
    const clean = sanitizeText(text);
    if (!clean) return 0;
    const letters = (clean.match(/[A-Za-z]/g) || []).length;
    return letters / Math.max(clean.length, 1);
}
function tokenCount(text) {
    const clean = sanitizeText(text);
    if (!clean) return 0;
    return clean.split(/\s+/).filter(Boolean).length;
}
function genericNoiseScore(text) {
    const clean = sanitizeText(text);
    const t = clean.toLowerCase();
    let score = 0;
    if (!clean) return 100;
    if (clean.length < 14) score += 3;
    if (tokenCount(clean) < 3) score += 3;
    if (englishRatio(clean) < 0.45) score += 3;
    const weakPhrases = [
        "live news",
        "breaking",
        "update",
        "updates",
        "open source intel",
        "osint",
        "telegram",
        "combat footage",
        "wartranslated",
        "enemy media",
        "media",
        "video",
        "photos",
        "photo",
        "footage",
        "source",
        "channel",
        "war military news",
        "war and military news",
        "news",
    ];
    for (const phrase of weakPhrases) {
        if (t === phrase || t.includes(phrase)) score += 2;
    }
    if (!/[a-z]/i.test(clean)) score += 4;
    if (/^(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(clean)) score += 6;
    return score;
}
function containsSignalWords(text) {
    const t = sanitizeText(text).toLowerCase();
    return /(strike|missile|drone|uav|rocket|launch|attack|aircraft|fighter|awacs|helicopter|bomber|alert|siren|explosion|intercept|raid|airspace|recon|military|troops|naval|ship|radar|defense|sam|closure|patrol|surveillance|fire|blast)/.test(t);
}
function looksUsefulText(v) {
    const clean = sanitizeText(v);
    if (!clean) return false;
    if (clean.length < 18) return false;
    if (!/[a-z]/i.test(clean)) return false;
    if (/^(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(clean)) return false;
    const score = genericNoiseScore(clean);
    const useful = containsSignalWords(clean);
    if (score >= 7) return false;
    if (score >= 5 && !useful) return false;
    return true;
}
function cleanSourceName(v) {
    const clean = sanitizeText(v);
    if (!clean) return "OSINT Feed";
    const s = clean.toLowerCase();
    if (/reddit/i.test(clean)) return "Community Report";
    if (/twitter|x\.com/i.test(clean)) return "Social Feed";
    if (/facebook|instagram|threads|youtube/i.test(clean)) return "Social Feed";
    if (
        s.includes("telegram") ||
        s.includes("t.me") ||
        s.includes("wartranslated") ||
        s.includes("osint") ||
        s.includes("combatfootage") ||
        s.includes("enemy media") ||
        s.includes("war military news") ||
        s.includes("war and military news") ||
        s.includes("open source intel")
    ) {
        return "OSINT Feed";
    }
    return truncateText(clean, 24);
}
const ICONS = {
    strike: "bx-web-ico-conflict-1-0",
    military: "bx-web-ico-air-1-0",
    recon: "bx-web-ico-warfare-1-0",
    alert: "bx-web-ico-alerts-1-2",
    airspace: "bx-ico-c4isr-1",
    cyber: "bx-web-ico-website-1-0",
    thermal: "bx-web-ico-bookmark-1-0",
    signal: "bx-web-ico-status-1-0",
    default: "bx-web-ico-Profile-1-0",
};
const LABELS = {
    strike: "STRIKE",
    military: "MILITARY",
    recon: "RECON",
    alert: "ALERT",
    airspace: "AIRSPACE",
    cyber: "CYBER",
    thermal: "THERMAL",
    signal: "SIGNAL",
    default: "ACTIVITY",
};
function icon(cat) {
    const key = String(cat || "").toLowerCase();
    return ICONS[key] || ICONS.default;
}
function label(cat) {
    return LABELS[String(cat || "").toLowerCase()] || LABELS.default;
}
function sevWeight(s) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[String(s || "").toLowerCase()] || 1;
}
function dominantCat(items) {
    const sc = new Map();
    for (const e of items) {
        const k = String(e.category || "default").toLowerCase();
        sc.set(k, (sc.get(k) || 0) + 1 + sevWeight(e.severity));
    }
    let best = "default";
    let top = -1;
    for (const [k, v] of sc) {
        if (v > top) {
            best = k;
            top = v;
        }
    }
    return best;
}
function dominantSev(items) {
    for (const s of ["critical", "high", "medium", "low"]) {
        if (items.some((e) => String(e.severity || "").toLowerCase() === s)) return s;
    }
    return "medium";
}
function latestEvt(items) {
    return [...items].sort((a, b) =>
        new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)
    )[0];
}
function buildFallbackHeadline(e = {}) {
    const cat = label(e.category);
    const place = compactPlaceLabel(
        e.location_label ||
        e.impact_label ||
        e.origin_label ||
        e.place ||
        ""
    );
    if (String(e.category || "").toLowerCase() === "strike") {
        return place ? `Strike activity detected near ${place}` : "Strike activity detected";
    }
    if (String(e.category || "").toLowerCase() === "military") {
        return place ? `Military activity detected near ${place}` : "Military activity detected";
    }
    if (String(e.category || "").toLowerCase() === "alert") {
        return place ? `Alert activity detected in ${place}` : "Alert activity detected";
    }
    if (String(e.category || "").toLowerCase() === "recon") {
        return place ? `Recon activity detected near ${place}` : "Recon activity detected";
    }
    if (place) return `${cat} activity near ${place}`;
    return `${cat} activity detected`;
}
function eventHeadline(e = {}) {
    const candidates = [
        e.title,
        e.summary,
        e.description,
        e.text,
        e.message,
        e.headline,
    ];
    let best = "";
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        const clean = sanitizeText(candidate);
        if (!clean) continue;
        const useful = looksUsefulText(clean);
        const score = (useful ? 10 : 0)
            + (containsSignalWords(clean) ? 3 : 0)
            - genericNoiseScore(clean)
            + Math.min(tokenCount(clean), 12) * 0.2;
        if (useful && score > bestScore) {
            best = clean;
            bestScore = score;
        }
    }
    if (best) return truncateText(best, 110);
    return buildFallbackHeadline(e);
}
function eventSubline(e = {}) {
    const place = compactPlaceLabel(
        e.location_label ||
        e.impact_label ||
        e.origin_label ||
        e.place ||
        ""
    );
    const source = cleanSourceName(e.source_name || e.source || "");
    const bits = [place, source].filter(Boolean);
    return bits.join(" • ");
}
function normalizeEventForDisplay(e = {}) {
    return {
        ...e,
        __displayTitle: eventHeadline(e),
        __displaySubline: eventSubline(e),
    };
}
// ─── hemisphere cull + Cesium projection ──────────────────────────────────────
function toScreen(scene, lon, lat) {
    try {
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        const camNorm = Cesium.Cartesian3.normalize(scene.camera.position, new Cesium.Cartesian3());
        const ptNorm = Cesium.Cartesian3.normalize(cart, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.dot(camNorm, ptNorm) < 0.08) return null;
        const fn = Cesium.SceneTransforms.worldToWindowCoordinates
            || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        if (!fn) return null;
        const p = fn(scene, cart);
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return { x: p.x, y: p.y };
    } catch {
        return null;
    }
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function getZoomAwareHotspotConfig(viewer, cfg) {
    const height = getCameraHeight(viewer);
    if (height > 9000000) {
        return {
            clusterDistanceLat: Math.max(cfg.clusterDistanceLat, 4.8),
            clusterDistanceLon: Math.max(cfg.clusterDistanceLon, 5.8),
            maxCards: Math.max(cfg.maxCards, 10),
            maxVisiblePerHotspot: 1,
            stackDistancePx: Math.max(cfg.stackDistancePx, 150),
            edgePad: 220,
        };
    }
    if (height > 4500000) {
        return {
            clusterDistanceLat: Math.max(cfg.clusterDistanceLat, 3.5),
            clusterDistanceLon: Math.max(cfg.clusterDistanceLon, 4.2),
            maxCards: Math.max(cfg.maxCards, 14),
            maxVisiblePerHotspot: 2,
            stackDistancePx: Math.max(cfg.stackDistancePx, 120),
            edgePad: 180,
        };
    }
    return {
        clusterDistanceLat: cfg.clusterDistanceLat,
        clusterDistanceLon: cfg.clusterDistanceLon,
        maxCards: cfg.maxCards,
        maxVisiblePerHotspot: cfg.maxVisiblePerHotspot,
        stackDistancePx: cfg.stackDistancePx,
        edgePad: 140,
    };
}
// ─── geo clustering ────────────────────────────────────────────────────────────
function geoCluster(events, dLat, dLon, minCount, maxCards) {
    const groups = [];
    for (const e of events) {
        const lat = Number(e.lat);
        const lon = Number(e.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        let g = null;
        for (const gr of groups) {
            if (Math.abs(gr.lat - lat) <= dLat && Math.abs(gr.lon - lon) <= dLon) {
                g = gr;
                break;
            }
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
        .filter((g) => g.items.length >= minCount)
        .map((g) => {
            const cat = dominantCat(g.items);
            const sev = dominantSev(g.items);
            const latest = latestEvt(g.items);
            return {
                id: `hs-${cat}-${g.lat.toFixed(2)}-${g.lon.toFixed(2)}`,
                lat: g.lat,
                lon: g.lon,
                count: g.items.length,
                cat,
                sev,
                icon: icon(cat),
                label: label(cat),
                latest,
                items: g.items,
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, maxCards);
}
// ─── screen stacking ──────────────────────────────────────────────────────────
const STACK_OFF = [
    { x: 0, y: 0 },
    { x: -18, y: -14 },
    { x: 18, y: 14 },
];
function stackVisible(clusters, overlapPx, maxPer) {
    const stacks = [];
    for (const c of clusters) {
        let found = null;
        for (const s of stacks) {
            const dx = s.x - c.screen.x;
            const dy = s.y - c.screen.y;
            if (Math.sqrt(dx * dx + dy * dy) <= overlapPx) {
                found = s;
                break;
            }
        }
        if (found) found.items.push(c);
        else stacks.push({ x: c.screen.x, y: c.screen.y, items: [c] });
    }
    const out = [];
    for (const s of stacks) {
        [...s.items]
            .sort((a, b) => b.count - a.count)
            .slice(0, maxPer)
            .forEach((c, i) => {
                out.push({ ...c, stackIdx: i });
            });
    }
    return out;
}
// ─── DOM builders ─────────────────────────────────────────────────────────────
function buildExpandedHTML(items) {
    return items.slice(0, 6).map((e) => {
        const sev = String(e.severity || "medium").toLowerCase();
        const title = e.__displayTitle || eventHeadline(e);
        const subline = e.__displaySubline || eventSubline(e);
        const time = timeAgo(e.occurred_at);
        return `<div class="wzhs-item">
            <div class="wzhs-item__row">
                <span class="wzhs-item__sev wzhs-item__sev--${sev}">${sev.toUpperCase()}</span>
                <span class="wzhs-item__time">${time}</span>
            </div>
            <strong class="wzhs-item__title">${title}</strong>
            ${subline ? `<span class="wzhs-item__loc">${subline}</span>` : ""}
        </div>`;
    }).join("");
}
function createCardEl(cluster, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.clusterId = cluster.id;
    function refreshContent(isExpanded) {
        const loc = compactPlaceLabel(
            cluster.latest?.location_label ||
            cluster.latest?.impact_label ||
            cluster.latest?.origin_label ||
            cluster.latest?.place ||
            ""
        );
        const time = timeAgo(cluster.latest?.occurred_at);
        const isFresh = cluster.items.some((item) => isRecentActivity(item?.occurred_at));
        btn.className = [
            "wzhs",
            `wzhs--${cluster.cat}`,
            `wzhs--sev-${cluster.sev}`,
            isFresh ? "wzhs--fresh" : "",
            cluster.stackIdx === 1 ? "wzhs--s2" : "",
            cluster.stackIdx === 2 ? "wzhs--s3" : "",
            isExpanded ? "wzhs--open" : "",
        ].filter(Boolean).join(" ");
        btn.innerHTML = `
            <div class="wzhs__body">
                <div class="wzhs__top">
                    <div class="wzhs__title">
                        <div class="wzhs__icon static-icon">
                            <span class="${cluster.icon}" aria-hidden="true"></span>
                        </div>
                        <span class="wzhs__count">${cluster.count}</span>
                        <span class="wzhs__label">${cluster.label}</span>
                    </div>
                    <span class="wzhs__arr static-icon">
                        <span class="bx-web-ico-top-1-0" aria-hidden="true"></span>
                    </span>
                </div>
                ${isExpanded ? `
                <div class="wzhs__detail">
                    <div class="wzhs__header">
                        ${loc ? `<span class="wzhs__loc">${loc}</span>` : ""}
                        <span class="wzhs__time">${time}</span>
                    </div>
                    <div class="wzhs__items">${buildExpandedHTML(cluster.items)}</div>
                </div>` : ""}
            </div>`;
    }
    refreshContent(false);
    btn._refreshContent = refreshContent;
    btn.addEventListener("click", (e) => {
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
    let clustersDirty = true;
    let cachedClusters = [];
    const nodeMap = new Map();
    let rafPending = false;
    let lastRenderMs = 0;
    let cameraMoving = false;
    let moveEndTimer = 0;
    const cfg = {
        maxCards: options.maxCards ?? 24,
        clusterDistanceLat: options.clusterDistanceLat ?? 2.6,
        clusterDistanceLon: options.clusterDistanceLon ?? 3.2,
        stackDistancePx: options.stackDistancePx ?? 100,
        maxVisiblePerHotspot: options.maxVisiblePerHotspot ?? 3,
        minItemsForCluster: options.minItemsForCluster ?? 1,
        throttleIdle: options.throttleIdle ?? 100,
    };
    function handleToggle(id, el) {
        const wasOpen = expandedId === id;
        expandedId = wasOpen ? null : id;
        if (!wasOpen) {
            for (const [nid, node] of nodeMap) {
                if (nid !== id && node.el.classList.contains("wzhs--open")) {
                    node.el._refreshContent(false);
                    node.el.classList.remove("wzhs--open");
                }
            }
        }
        el._refreshContent(!wasOpen);
    }
    function render(fromPostRender) {
        if (!fromPostRender) rafPending = false;
        if (destroyed || !viewer.scene || !rootEl) return;
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
        const zoomCfg = getZoomAwareHotspotConfig(viewer, cfg);
        if (clustersDirty) {
            cachedClusters = geoCluster(
                allEvents,
                zoomCfg.clusterDistanceLat,
                zoomCfg.clusterDistanceLon,
                cfg.minItemsForCluster,
                zoomCfg.maxCards
            );
            clustersDirty = false;
        }
        const projected = [];
        for (const c of cachedClusters) {
            const s = toScreen(viewer.scene, c.lon, c.lat);
            if (!s) continue;
            const x = s.x + offX;
            const y = s.y + offY;
            if (x < -zoomCfg.edgePad || x > overlayRect.width + zoomCfg.edgePad) continue;
            if (y < -zoomCfg.edgePad || y > overlayRect.height + zoomCfg.edgePad) continue;
            projected.push({ ...c, screen: { x, y } });
        }
        const visible = stackVisible(projected, zoomCfg.stackDistancePx, zoomCfg.maxVisiblePerHotspot);
        const visibleIds = new Set(visible.map((v) => v.id));
        for (const [id, node] of nodeMap) {
            if (!visibleIds.has(id)) {
                node.el.remove();
                nodeMap.delete(id);
            }
        }
        for (const cluster of visible) {
            const off = STACK_OFF[cluster.stackIdx] || STACK_OFF[0];
            const tx = cluster.screen.x + off.x;
            const ty = cluster.screen.y + off.y;
            const zi = 25 - cluster.stackIdx;
            if (nodeMap.has(cluster.id)) {
                const node = nodeMap.get(cluster.id);
                if (node.x !== tx || node.y !== ty) {
                    node.el.style.left = `${tx}px`;
                    node.el.style.top = `${ty}px`;
                    node.el.style.zIndex = zi;
                    node.x = tx;
                    node.y = ty;
                }
                node.el.classList.toggle("wzhs--s2", cluster.stackIdx === 1);
                node.el.classList.toggle("wzhs--s3", cluster.stackIdx === 2);
            } else {
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
            setTimeout(() => {
                rafPending = false;
                scheduleRender(0);
            }, delay);
        }
    }
    function onPostRender() {
        if (cameraMoving) render(true);
    }
    function onCameraMoveStart() {
        cameraMoving = true;
        clearTimeout(moveEndTimer);
        scheduleRender(0);
    }
    function onCameraMoveEnd() {
        clearTimeout(moveEndTimer);
        moveEndTimer = setTimeout(() => {
            cameraMoving = false;
            scheduleRender(0);
        }, 60);
    }
    function onResize() {
        scheduleRender(0);
    }
    viewer.scene.postRender.addEventListener(onPostRender);
    viewer.camera.moveStart.addEventListener(onCameraMoveStart);
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);
    window.addEventListener("resize", onResize, { passive: true });
    return {
        setEvents(next = []) {
            const arr = Array.isArray(next) ? next : [];
            allEvents = arr
                .filter((evt) => evt && Number.isFinite(Number(evt.lat)) && Number.isFinite(Number(evt.lon)))
                .map((evt) => normalizeEventForDisplay(evt));
            clustersDirty = true;
            viewer.scene.requestRender();
            scheduleRender(0);
        },
        addEvent(evt) {
            if (!evt) return;
            if (!isEventVisible(evt)) return;
            if (!Number.isFinite(Number(evt.lat)) || !Number.isFinite(Number(evt.lon))) return;
            if (allEvents.some((e) => String(e.id) === String(evt.id))) return;
            allEvents.unshift(normalizeEventForDisplay(evt));
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
