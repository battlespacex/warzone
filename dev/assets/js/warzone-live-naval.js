// File Path: /assets/js/live-naval.js
//
// Naval vessel tracker — frontend counterpart to warzone-live-fighter.js
// Renders AIS military vessels on the Cesium globe with:
//  - Ship billboard icons with heading rotation
//  - Zoom-level labels (vessel name + class)
//  - Click → X-lines targeting reticle + info panel near vessel
//  - Naval Tracker widget list with live positions
import * as Cesium from "cesium";

// ─── State ────────────────────────────────────────────────────────────────────
const __navalState = {
    vessels: new Map(),    // track_key → { entity, data }
    overlayRoot: null,
    overlayBound: false,
    clickBound: false,
    clickHandler: null,
    selectedKey: null,
    focusGuideEl: null,
    isCameraFlying: false,
};

// ─── Constants ────────────────────────────────────────────────────────────────
const NAVAL_LABEL_HEIGHT_MAX = 3500000;  // Show labels below this camera altitude
const NAVAL_FOCUS_GUIDE_COLOR = "rgba(51, 217, 255, 0.75)";
const NAVAL_MIN_ANIM_DISTANCE_METERS = 40;
const NAVAL_MIN_ANIM_MS = 1800;
const NAVAL_MAX_ANIM_MS = 12000;

// ─── Ship icon canvases (cached) ──────────────────────────────────────────────
const __navalIconCache = new Map();

function createShipIcon(color = "#33d9ff", subcat = "naval") {
    const key = `${color}:${subcat}`;
    if (__navalIconCache.has(key)) return __navalIconCache.get(key);

    const sz = 64;
    const cx = sz / 2;
    const cy = sz / 2;
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, sz, sz);

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    glow.addColorStop(0, color);
    glow.addColorStop(0.4, color + "60");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();

    // Ship silhouette — top-facing arrow for heading
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Hull: elongated diamond pointing up (north = ship bow)
    ctx.moveTo(cx, cy - 14); // bow (top)
    ctx.lineTo(cx + 6, cy + 2);
    ctx.lineTo(cx + 4, cy + 14); // stern right
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx - 4, cy + 14); // stern left
    ctx.lineTo(cx - 6, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center dot
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");
    __navalIconCache.set(key, dataUrl);
    return dataUrl;
}

// ─── Vessel color by class ────────────────────────────────────────────────────
function getVesselColor(subcat = "naval") {
    const map = {
        carrier: "#ff3a3a",
        destroyer: "#ff7820",
        frigate: "#ffcc00",
        submarine: "#9b7bff",
        logistics: "#57b8ff",
        patrol: "#33d9ff",
        minesweeper: "#00d9b2",
        naval: "#33d9ff",
    };
    return map[subcat] || "#33d9ff";
}

// ─── Label visibility ─────────────────────────────────────────────────────────
function shouldShowNavalLabel(trackKey) {
    if (__navalState.selectedKey === trackKey) return true;
    const h = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    return h > 0 && h <= NAVAL_LABEL_HEIGHT_MAX;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function getEntityPosition(entity) {
    if (!entity?.position) return null;
    try {
        if (typeof entity.position.getValue === "function") {
            return entity.position.getValue(Cesium.JulianDate.now());
        }
        return entity.position || null;
    } catch {
        return null;
    }
}
function animateVesselTo(entity, vessel) {
    if (!entity) return;
    if (entity.__navalAnimFrame) {
        cancelAnimationFrame(entity.__navalAnimFrame);
        entity.__navalAnimFrame = null;
    }
    const nextCartesian = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 0);
    const startCartesian = getEntityPosition(entity);
    if (!startCartesian) {
        entity.position = nextCartesian;
        return;
    }
    const distanceMeters = Cesium.Cartesian3.distance(startCartesian, nextCartesian);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= NAVAL_MIN_ANIM_DISTANCE_METERS) {
        entity.position = nextCartesian;
        return;
    }
    const duration = clamp(distanceMeters * 0.2, NAVAL_MIN_ANIM_MS, NAVAL_MAX_ANIM_MS);
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startHeading = Number(entity.__navalHeadingDeg || 0);
    const endHeading = Number(vessel.heading_deg || 0);
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const lon = startLon + ((vessel.lon - startLon) * eased);
        const lat = startLat + ((vessel.lat - startLat) * eased);
        entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        if (entity.billboard) {
            entity.billboard.rotation = Cesium.Math.toRadians(-(startHeading + ((endHeading - startHeading) * eased)));
        }
        window.__warzoneViewer?.scene?.requestRender?.();
        if (t < 1) {
            entity.__navalAnimFrame = requestAnimationFrame(step);
        } else {
            entity.__navalAnimFrame = null;
            entity.__navalHeadingDeg = endHeading;
        }
    };
    entity.__navalAnimFrame = requestAnimationFrame(step);
}

// ─── Create vessel entity ─────────────────────────────────────────────────────
function createVesselEntity(viewer, vessel) {
    const { track_key, lat, lon, heading_deg = 0, subcategory = "naval" } = vessel;
    const color = getVesselColor(subcategory);
    const icon = createShipIcon(color, subcategory);
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    // Heading: 0° = North. Convert to Cesium HPR.
    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(heading_deg || 0),
        0, 0
    );

    const entity = viewer.entities.add({
        id: `naval-${track_key}`,
        position: pos,
        billboard: {
            image: icon,
            scale: 0.7,
            rotation: Cesium.Math.toRadians(-(heading_deg || 0)),
            alignedAxis: Cesium.Cartesian3.UNIT_Z,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            text: vessel.vessel_name || vessel.title || subcategory,
            show: new Cesium.CallbackProperty(() => shouldShowNavalLabel(track_key), false),
            scale: 0.5,
            pixelOffset: new Cesium.Cartesian2(0, -28),
            fillColor: Cesium.Color.fromCssColorString(color).withAlpha(1),
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.65),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
            outlineWidth: 0,
            style: Cesium.LabelStyle.FILL,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });

    entity.__navalKey = track_key;
    entity.__navalData = vessel;
    entity.__navalHeadingDeg = heading_deg || 0;
    return entity;
}

// ─── Update vessel position ───────────────────────────────────────────────────
function updateVesselEntity(entity, vessel) {
    const { heading_deg = 0 } = vessel;
    animateVesselTo(entity, vessel);
    if (entity.label) {
        entity.label.text = vessel.vessel_name || vessel.title || vessel.subcategory || "Naval";
    }
    entity.__navalHeadingDeg = heading_deg || 0;
    entity.__navalData = vessel;
}

// ─── X-lines overlay (targeting reticle) ─────────────────────────────────────
function ensureNavalOverlayRoot(viewer) {
    if (__navalState.overlayRoot?.isConnected) return __navalState.overlayRoot;
    const host = viewer?.container || document.body;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";

    const root = document.createElement("div");
    root.id = "wz-naval-focus-overlay";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;display:none;pointer-events:none;z-index:28;transform:translate(-50%,-50%)";

    const arms = [
        { cls: "is-top-left", x: -132, y: -88, rotate: 48 },
        { cls: "is-top-right", x: 40, y: -88, rotate: -48 },
        { cls: "is-bottom-left", x: -132, y: 82, rotate: -48 },
        { cls: "is-bottom-right", x: 40, y: 82, rotate: 48 },
    ];
    arms.forEach(item => {
        const arm = document.createElement("span");
        arm.style.cssText = `position:absolute;display:block;width:92px;height:4px;border-radius:999px;background:${NAVAL_FOCUS_GUIDE_COLOR};box-shadow:0 0 10px rgba(51,217,255,0.32);transform-origin:center;transform:translate(${item.x}px,${item.y}px) rotate(${item.rotate}deg);pointer-events:none`;
        root.appendChild(arm);
    });

    host.appendChild(root);
    __navalState.overlayRoot = root;
    return root;
}

function getScreenPosForVessel(trackKey) {
    const viewer = window.__warzoneViewer;
    if (!viewer) return null;
    const entry = __navalState.vessels.get(trackKey);
    if (!entry?.entity) return null;
    try {
        const pos = entry.entity.position.getValue(Cesium.JulianDate.now());
        if (!pos) return null;
        const fn = Cesium.SceneTransforms.worldToWindowCoordinates
            ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        const screen = fn(viewer.scene, pos);
        if (!screen || !Number.isFinite(screen.x)) return null;
        return screen;
    } catch { return null; }
}

function syncNavalOverlay() {
    const root = __navalState.overlayRoot;
    if (!root) return;
    const key = __navalState.selectedKey;
    if (!key) { root.style.display = "none"; return; }
    const screen = getScreenPosForVessel(key);
    if (!screen) { root.style.display = "none"; return; }
    root.style.display = "block";
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
}

function clearNavalSelection() {
    __navalState.selectedKey = null;
    if (__navalState.overlayRoot) __navalState.overlayRoot.style.display = "none";
    document.getElementById("warzone-naval-panel")?.remove();
    syncNavalWidgetHighlight(null);
}

// ─── Info panel near vessel ───────────────────────────────────────────────────
function showNavalPanel(data, sx, sy) {
    document.getElementById("warzone-naval-panel")?.remove();

    const sub = data.subcategory || data.vessel_class || "naval";
    const color = getVesselColor(sub);
    const name = data.vessel_name || data.title || "Unknown Vessel";
    const speed = data.speed_kts != null ? `${Number(data.speed_kts).toFixed(1)} kt` : "—";
    const hdg = data.heading_deg != null ? `${Math.round(data.heading_deg)}°` : "—";
    const mmsi = data.mmsi || data.metadata?.mmsi || "—";
    const flag = data.country || data.metadata?.country || data.flag_country || "—";

    const panel = document.createElement("div");
    panel.id = "warzone-naval-panel";
    panel.style.cssText = "position:fixed;width:280px;z-index:900;background:rgba(8,12,20,0.96);border:1px solid rgba(51,217,255,0.18);border-radius:6px;padding:14px 16px;color:#fff;font-family:var(--warzone-font,'Barlow Condensed',sans-serif);box-shadow:0 4px 24px rgba(0,0,0,0.6);backdrop-filter:blur(8px);animation:milbase-fadein 0.18s ease";
    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <span style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);flex:1">${sub.toUpperCase()}</span>
            <button id="wz-naval-panel-close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:13px;padding:0;line-height:1">✕</button>
        </div>
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:10px">${name}</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
            ${flag !== "—" ? `<div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Flag</span><span style="color:rgba(255,255,255,.85)">${flag}</span></div>` : ""}
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Speed</span><span style="color:rgba(255,255,255,.85)">${speed}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Heading</span><span style="color:rgba(255,255,255,.85)">${hdg}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">MMSI</span><span style="color:rgba(255,255,255,.85);font-family:var(--font-mono,monospace)">${mmsi}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:rgba(255,255,255,.4);text-transform:uppercase;font-size:10px">Lat / Lon</span><span style="color:rgba(255,255,255,.85)">${Number(data.lat).toFixed(4)}°, ${Number(data.lon).toFixed(4)}°</span></div>
        </div>`;

    document.body.appendChild(panel);

    // Position near click, auto-adjust to stay on screen
    const W = 288, H = 200;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = sx + 16, top = sy - 16;
    if (left + W > vw - 8) left = sx - W - 16;
    if (top + H > vh - 8) top = vh - H - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    document.getElementById("wz-naval-panel-close")?.addEventListener("click", e => {
        e.stopPropagation();
        clearNavalSelection();
    });
}

// ─── Widget row highlight ─────────────────────────────────────────────────────
function syncNavalWidgetHighlight(trackKey) {
    try {
        const widget = document.querySelector('[data-widget-id="naval"]');
        if (!widget) return;
        widget.querySelectorAll(".wz-naval-item[data-track-key]").forEach(row => {
            const match = row.dataset.trackKey === trackKey;
            row.classList.toggle("is-selected", match);
            if (match) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    } catch { }
}

// ─── Click + hover binding ────────────────────────────────────────────────────
function bindNavalPicking(viewer) {
    if (__navalState.clickBound) return;
    __navalState.clickBound = true;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    __navalState.clickHandler = handler;

    // Hover — cursor
    handler.setInputAction(movement => {
        const picked = viewer.scene.pick(movement.endPosition);
        const isNaval = picked?.id?.__navalKey;
        if (isNaval) {
            viewer.container.style.cursor = "pointer";
        } else if (!window.__wzBaseHover) {
            viewer.container.style.cursor = "";
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Click
    handler.setInputAction(movement => {
        const picked = viewer.scene.pick(movement.position);
        const trackKey = picked?.id?.__navalKey;

        if (!trackKey) {
            clearNavalSelection();
            return;
        }

        const entry = __navalState.vessels.get(trackKey);
        if (!entry) return;

        __navalState.selectedKey = trackKey;

        // Fly to vessel
        __navalState.isCameraFlying = true;
        viewer.camera.cancelFlight?.();
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                entry.data.lon, entry.data.lat, 800000
            ),
            duration: 1.2,
            complete: () => { __navalState.isCameraFlying = false; },
            cancel: () => { __navalState.isCameraFlying = false; },
        });

        showNavalPanel(entry.data, movement.position.x, movement.position.y);
        syncNavalWidgetHighlight(trackKey);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Clear on camera drag
    viewer.camera.moveStart.addEventListener(() => {
        if (!__navalState.isCameraFlying && __navalState.selectedKey) {
            clearNavalSelection();
        }
    });
}

// ─── Overlay sync post-render ─────────────────────────────────────────────────
function bindNavalOverlay(viewer) {
    if (__navalState.overlayBound) return;
    __navalState.overlayBound = true;
    ensureNavalOverlayRoot(viewer);
    viewer.scene.postRender.addEventListener(syncNavalOverlay);
}

// ─── Public: upsert vessel (called from essential.js event handler) ───────────
export function upsertNavalVessel(event) {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;

    bindNavalOverlay(viewer);
    bindNavalPicking(viewer);

    // Build a unified vessel data object from event fields
    const trackKey = event.dedupe_key || event.source_key || `naval-${event.id}`;
    const vessel = {
        track_key: trackKey,
        vessel_name: event.metadata?.vessel_name || event.title?.replace(/\s*—.*$/, "") || "",
        subcategory: event.subcategory || event.metadata?.vessel_class || "naval",
        vessel_class: event.metadata?.vessel_class || event.subcategory || "naval",
        lat: Number(event.lat),
        lon: Number(event.lon),
        heading_deg: event.metadata?.heading ?? event.heading_deg ?? 0,
        speed_kts: event.metadata?.speed_kts ?? event.speed_kts ?? null,
        mmsi: event.metadata?.mmsi || "",
        country: event.metadata?.country || event.country || "",
        title: event.title || "",
    };

    if (!Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lon)) return;

    const existing = __navalState.vessels.get(trackKey);
    if (existing?.entity) {
        updateVesselEntity(existing.entity, vessel);
        existing.data = vessel;
    } else {
        const entity = createVesselEntity(viewer, vessel);
        __navalState.vessels.set(trackKey, { entity, data: vessel });
    }

    viewer.scene.requestRender();
    dispatchNavalRegistryUpdate();
}

// ─── Public: clear vessel ─────────────────────────────────────────────────────
export function clearNavalVessel(trackKey) {
    const viewer = window.__warzoneViewer;
    const entry = __navalState.vessels.get(trackKey);
    if (entry?.entity?.__navalAnimFrame) {
        cancelAnimationFrame(entry.entity.__navalAnimFrame);
        entry.entity.__navalAnimFrame = null;
    }
    if (entry?.entity && viewer) viewer.entities.remove(entry.entity);
    __navalState.vessels.delete(trackKey);
    if (__navalState.selectedKey === trackKey) clearNavalSelection();
    viewer?.scene.requestRender();
}

// ─── Public: get all vessel snapshots (for widget) ────────────────────────────
export function getAllNavalSnapshots() {
    return [...__navalState.vessels.values()]
        .map(v => v.data)
        .sort((a, b) => {
            // Carriers first, then by name
            const priority = { carrier: 0, destroyer: 1, frigate: 2, submarine: 3, patrol: 4, logistics: 5, minesweeper: 6, naval: 7 };
            return (priority[a.subcategory] ?? 8) - (priority[b.subcategory] ?? 8);
        });
}

// ─── Registry update event ────────────────────────────────────────────────────
function dispatchNavalRegistryUpdate() {
    document.dispatchEvent(new CustomEvent("wz:naval-log-updated"));
}

// ─── Widget renderer ──────────────────────────────────────────────────────────
// Called from essential.js or warzone-ui.js to populate the naval widget list
export function renderNavalTrackerWidget() {
    const container = document.getElementById("wz-naval-panel-list");
    if (!container) return;

    const vessels = getAllNavalSnapshots();

    if (!vessels.length) {
        container.innerHTML = `<div class="wz-aircraft-empty">No naval contacts in current filter</div>`;
        return;
    }

    container.innerHTML = vessels.slice(0, 20).map(v => {
        const color = getVesselColor(v.subcategory);
        const name = v.vessel_name || v.title || "Unknown Vessel";
        const sub = (v.subcategory || "naval").toUpperCase();
        const speed = v.speed_kts != null ? `${Number(v.speed_kts).toFixed(0)} kt` : "";
        const flag = v.country ? `${v.country}` : "";

        return `<div class="wz-aircraft-item wz-naval-item" data-track-key="${v.track_key}" style="cursor:pointer" onclick="window.__navalFocusVessel?.('${v.track_key}')">
            <div class="wz-aircraft-item__top">
                <span class="wz-aircraft-badge" style="background:${color}22;color:${color};border-color:${color}44">${sub}</span>
                <span class="wz-aircraft-title">
                    <strong class="wz-aircraft-title__name">${name}</strong>
                    ${flag ? `<span class="wz-aircraft-title__status">${flag}</span>` : ""}
                </span>
            </div>
            ${speed ? `<div class="wz-aircraft-item__stats"><span>${speed}</span></div>` : ""}
        </div>`;
    }).join("");
}

// ─── Global focus helper (called from widget onclick) ─────────────────────────
window.__navalFocusVessel = (trackKey) => {
    const viewer = window.__warzoneViewer;
    const entry = __navalState.vessels.get(trackKey);
    if (!viewer || !entry) return;

    __navalState.selectedKey = trackKey;
    __navalState.isCameraFlying = true;
    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(entry.data.lon, entry.data.lat, 800000),
        duration: 1.2,
        complete: () => { __navalState.isCameraFlying = false; },
        cancel: () => { __navalState.isCameraFlying = false; },
    });

    // Show panel at center of screen
    showNavalPanel(entry.data, window.innerWidth / 2, window.innerHeight / 2);
    syncNavalWidgetHighlight(trackKey);
};
