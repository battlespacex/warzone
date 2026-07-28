// File Path: /assets/js/warzone-military-bases.js
import * as Cesium from "cesium";
import { MILITARY_BASES } from "./warzone-military-bases-data.js";
import { normalizeMilitaryBaseDisplayData } from "./warzone-military-base-quality.js";

/* ─── State ─────────────────────────────────────────────────────────────── */
const __state = {
    viewer: null,
    entities: [],
    dataSource: null,
    activePanel: null,
    visible: true,
    // authGated: true until wz:auth-success fires or user is already logged in
    authGated: true,
    baseCameraFlightActive: false,
    manualDismissArmedAt: 0,
};

/* ─── Type config ────────────────────────────────────────────────────────── */
const TYPE_COLOR_VAR = {
    airbase: "--warzone-base-airbase-color",
    naval: "--warzone-base-naval-color",
    army: "--warzone-base-army-color",
    missile: "--warzone-base-missile-color",
    cyber: "--warzone-base-cyber-color",
    joint: "--warzone-base-joint-color",
    hq: "--warzone-base-hq-color",
    space_launch: "--warzone-base-space-launch-color",
    radar: "--warzone-base-radar-color",
    drone: "--warzone-base-drone-color",
    weapons_storage: "--warzone-base-weapons-storage-color",
    training_logistics: "--warzone-base-training-logistics-color",
    wmd: "--warzone-base-wmd-color",
    unknown: "--warzone-base-unknown-color",
};
const TYPE_LABEL = {
    airbase: "Air Base", naval: "Naval Base", army: "Army Base",
    missile: "Missile / ICBM Site", cyber: "Cyber / Space Ops",
    joint: "Joint / Multi-Service Base", hq: "Military HQ / Command",
    space_launch: "Space Launch Site", radar: "Radar / Tracking Site",
    drone: "Drone / UAV Facility", weapons_storage: "Weapons Storage",
    training_logistics: "Training / Logistics",
    wmd: "Nuclear Explosion Site",
    unknown: "Military Installation",
};
const TYPE_PANEL_ICON = {
    airbase: "stratops-ico-assets-air-1",
    naval: "stratops-ico-assets-naval-1",
    army: "stratops-ico-assets-army-1",
    missile: "stratops-ico-assets-missile-1",
    cyber: "stratops-ico-assets-cyber-1",
    joint: "stratops-ico-assets-joint-1",
    hq: "stratops-ico-assets-hq-1",
    space_launch: "stratops-ico-assets-space-launch-1",
    radar: "stratops-ico-assets-radar-1",
    drone: "stratops-ico-assets-drone-1",
    weapons_storage: "stratops-ico-assets-unknown-1",
    training_logistics: "stratops-ico-assets-unknown-1",
    wmd: "stratops-ico-assets-wmd-1",
    unknown: "stratops-ico-assets-unknown-1",
};

function cssNumber(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

/* ─── PNG Icons ─────────────────────────────────────────────────────────── */
const ICON = {
    airbase: "/assets/images/bases/airbase-1.png",
    naval: "/assets/images/bases/naval-1.png",
    army: "/assets/images/bases/army-1.png",
    missile: "/assets/images/bases/missile-1.png",
    cyber: "/assets/images/bases/cyber-1.png",
    joint: "/assets/images/bases/joint-1.png",
    hq: "/assets/images/bases/hq-1.png",
    space_launch: "/assets/images/bases/space-launch.png",
    radar: "/assets/images/bases/radar-1.png",
    drone: "/assets/images/bases/drone-1.png",
    weapons_storage: "/assets/images/bases/unknown-1.png",
    training_logistics: "/assets/images/bases/unknown-1.png",
    wmd: "/assets/images/bases/wmd-1.png",
    unknown: "/assets/images/bases/unknown-1.png",
};
function getIcon(t, fallbackIcon = "") { return ICON[t] || fallbackIcon || ICON.unknown; }
function getBaseIconPixelSize(size) {
    const minSize = cssNumber("--warzone-base-icon-min-px", 16);
    const defaultSize = cssNumber("--warzone-base-icon-px", 22);
    const viewportScale = Math.max(0.5, Math.min(1.1, cssNumber("--warzone-base-icon-viewport-scale", 1)));
    const sizeVar = size === "major"
        ? "--warzone-base-icon-major-px"
        : size === "significant"
            ? "--warzone-base-icon-significant-px"
            : "--warzone-base-icon-px";
    return Math.max(minSize, Math.round(cssNumber(sizeVar, defaultSize) * viewportScale));
}

function getTypeColor(type) {
    const varName = TYPE_COLOR_VAR[type] || TYPE_COLOR_VAR.unknown;
    return `var(${varName}, #aaa)`;
}


/* ─── Entity creation ───────────────────────────────────────────────────── */
function createBaseEntity(dataSource, base) {
    const displayBase = normalizeMilitaryBaseDisplayData(base);
    const lat = Number(displayBase.lat ?? displayBase.coordinates?.lat);
    const lon = Number(displayBase.lon ?? displayBase.coordinates?.lon);
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const iconPixelSize = getBaseIconPixelSize(displayBase.size);
    const pixelOffsetY = Math.round(cssNumber("--warzone-base-icon-pixel-offset-y", 6));
    const entity = dataSource.entities.add({
        id: `milbase:${displayBase.id}`,
        position: pos,
        billboard: {
            image: getIcon(displayBase.type, displayBase.icon),
            scale: 1,
            width: iconPixelSize,
            height: iconPixelSize,
            alignedAxis: Cesium.Cartesian3.ZERO,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, pixelOffsetY),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            translucencyByDistance: new Cesium.NearFarScalar(7e6, 1.0, 1.4e7, 0.0),
            disableDepthTestDistance: 0,
        },
        properties: {
            milbase: true,
            name: displayBase.name,
            country: displayBase.country,
            operator: displayBase.operator,
            type: displayBase.type,
            typeLabel: TYPE_LABEL[displayBase.type] || "Military Installation",
            size: displayBase.size,
            lat,
            lon,
        },
    });
    entity.__militaryBaseData = displayBase;
    return entity;
}

/* ─── Visibility ─────────────────────────────────────────────────────────── */
function applyVisibility() {
    // Hidden if layer toggled off OR user not yet authenticated
    const shouldShow = __state.visible && !__state.authGated;
    if (__state.dataSource) {
        __state.dataSource.show = shouldShow;
    } else {
        __state.entities.forEach(e => { e.show = shouldShow; });
    }
    __state.viewer?.scene.requestRender();
}
function refreshBaseIconSizing() {
    __state.entities.forEach((entity) => {
        if (!entity?.billboard) return;
        const iconPixelSize = getBaseIconPixelSize(entity.__militaryBaseData?.size);
        entity.billboard.width = iconPixelSize;
        entity.billboard.height = iconPixelSize;
    });
    __state.viewer?.scene.requestRender();
}
function areMilitaryBasesInteractive() {
    return __state.visible && !__state.authGated;
}

function findPickedMilitaryBase(viewer, screenPosition) {
    if (!viewer || !screenPosition) return null;
    const picks = viewer.scene.drillPick(screenPosition) || [];
    return picks.find((picked) => Cesium.defined(picked?.id) &&
        picked.id?.properties?.milbase?.getValue?.() === true) || null;
}

/* ─── Popup near selected base ──────────────────────────────────────────── */
function positionBasePanel(panel, sx, sy) {
    if (!panel || !Number.isFinite(sx) || !Number.isFinite(sy)) return;

    const rect = panel.getBoundingClientRect();
    const W = rect.width || 448;
    const H = rect.height || 240;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = sx + 16;
    let top = sy - 16;

    if (left + W > vw - 8) left = sx - W - 16;
    if (top + H > vh - 8) top = vh - H - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
}

function isScreenPointInViewport(screen) {
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
    return screen.x >= 0 &&
        screen.x <= window.innerWidth &&
        screen.y >= 0 &&
        screen.y <= window.innerHeight;
}

function setBasePanelVisible(panel, visible) {
    if (!panel) return;
    panel.style.opacity = visible ? "1" : "0";
    panel.style.transform = visible ? "translateY(0)" : "translateY(0.35rem)";
    panel.style.pointerEvents = visible ? "auto" : "none";
}

function getEntityScreenPosition(entity) {
    const scene = __state.viewer?.scene;
    if (!scene || !entity?.position) return null;

    const time = Cesium.JulianDate.now();
    const position = entity.position.getValue?.(time) || entity.position;
    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    if (!position || !toWindow) return null;

    const screen = toWindow(scene, position);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
    return screen;
}

function updateActiveBasePanelPosition() {
    const active = __state.activePanel;
    if (!active?.panel?.isConnected) {
        __state.activePanel = null;
        return;
    }

    const screen = getEntityScreenPosition(active.entity);
    if (!screen || !isScreenPointInViewport(screen)) {
        closeActiveBasePanel();
        return;
    }

    positionBasePanel(active.panel, screen.x, screen.y);
    setBasePanelVisible(active.panel, true);
}

function closeActiveBasePanel() {
    const active = __state.activePanel;
    active?.cleanup?.();
    active?.panel?.remove();
    __state.activePanel = null;
}
function clearBaseViewerSelection(viewer) {
    if (!viewer) return;
    try { viewer.selectedEntity = undefined; } catch { }
    try { viewer.trackedEntity = undefined; } catch { }
}
function flyToBaseTopDown(viewer, base = {}) {
    const lat = Number(base?.lat);
    const lon = Number(base?.lon);
    if (!viewer?.camera || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const height = Math.max(2500, cssNumber("--warzone-base-flyto-height", 42000));
    const duration = Math.max(0.2, cssNumber("--warzone-base-flyto-duration", 1.2));
    __state.baseCameraFlightActive = true;
    __state.manualDismissArmedAt = 0;
    const finishFlight = () => {
        __state.baseCameraFlightActive = false;
        __state.manualDismissArmedAt = Date.now() + 350;
        viewer.scene?.requestRender?.();
    };
    try {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            orientation: {
                heading: Number(viewer.camera.heading || 0),
                pitch: Cesium.Math.toRadians(-89.5),
                roll: 0,
            },
            duration,
            complete: finishFlight,
            cancel: finishFlight,
        });
        return true;
    } catch {
        finishFlight();
        return false;
    }
}

function showBasePanel(base, sx, sy, entity = null) {
    closeActiveBasePanel();
    const displayBase = normalizeMilitaryBaseDisplayData(base);

    const escapeHTML = (value) => {
        if (value === null || value === undefined || value === "") return "—";
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    };

    const formatCoord = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? `${num.toFixed(4)}°` : "—";
    };

    const titleCase = (value) => {
        if (!value) return "—";
        const str = String(value).trim();
        return str ? str.charAt(0).toUpperCase() + str.slice(1) : "—";
    };

    const renderExtraRows = () => {
        const fields = Array.isArray(base?.metadata?.displayFields)
            ? base.metadata.displayFields
            : [];
        const hiddenLabels = new Set(["source", "source section", "country"]);
        return fields
            .filter((field) => field?.label && field?.value)
            .filter((field) => !hiddenLabels.has(String(field.label).trim().toLowerCase()))
            .map((field) => {
                const label = escapeHTML(field.label);
                const value = escapeHTML(field.value);
                const url = String(field.url || "").trim();
                const content = /^https?:\/\//i.test(url)
                    ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${value}</a>`
                    : `<span>${value}</span>`;
                return `<li><strong>${label}</strong>${content}</li>`;
            })
            .join("");
    };

    const tc = getTypeColor(displayBase?.type);
    const tl = TYPE_LABEL?.[displayBase?.type] || "Military Installation";

    const name = displayBase?.name || "Unknown Installation";
    const country = displayBase?.country || "—";
    const operator = displayBase?.operator || "—";
    const classification = titleCase(displayBase?.size);
    const lat = formatCoord(displayBase?.lat);
    const lon = formatCoord(displayBase?.lon);
    const iconClass = TYPE_PANEL_ICON?.[displayBase?.type] || TYPE_PANEL_ICON.unknown;
    const countryCorrection = ["coordinate_corrected", "host_country_corrected"].includes(displayBase?.countryQuality) && displayBase?.originalCountry
        ? `<li><strong>Data Quality</strong><span>Host country corrected from imported value "${escapeHTML(displayBase.originalCountry)}" by coordinates.</span></li>`
        : "";

    const panel = document.createElement("div");
    panel.id = "warzone-milbase-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "milbase-name");
    panel.setAttribute("aria-describedby", "milbase-desc milbase-info");
    panel.setAttribute("tabindex", "-1");
    panel.style.cssText = "position:fixed; width:28rem; max-width:calc(100vw - 1rem); z-index:900; opacity:0; transform:translateY(0.35rem); pointer-events:none; transition:opacity 160ms ease, transform 160ms ease;";

    panel.innerHTML = `
    <div class="wz-widget-milbase" itemscope itemtype="https://schema.org/Place">
        <header class="wz-widget-header">
            <div class="wz-widget-kicker">
                <span class="static-icon ${escapeHTML(iconClass)}"
                    style="color:${escapeHTML(tc)}"
                    aria-hidden="true"></span>
                <span >${escapeHTML(tl)}</span>
            </div>
            <div class="wz-widget-header-actions">
                <button
                    type="button"
                    id="milbase-close"
                    class="static-icon"
                    data-widget-close
                    aria-label="Close military base information panel">
                    <span class="stratops-ico-close-1" aria-hidden="true"></span>
                </button>
            </div>
        </header>

        <section class="wz-widget-body">
            <p id="milbase-desc" class="sr-only">
                Military base information dialog showing installation name, country, operator, classification, and coordinates.
            </p>

            <h3 id="milbase-name" itemprop="name">${escapeHTML(name)}</h3>

            <ul id="milbase-info" class="wz-widget-data-list">
                <li>
                    <strong>Type</strong>
                    <span>${escapeHTML(tl)}</span>
                </li>
                <li>
                    <strong>Country</strong>
                    <span>${escapeHTML(country)}</span>
                </li>
                <li>
                    <strong>Operator</strong>
                    <span>${escapeHTML(operator)}</span>
                </li>
                <li>
                    <strong>Classification</strong>
                    <span>${escapeHTML(classification)}</span>
                </li>
                <li>
                    <strong>Coordinates</strong>
                    <span>${lat}, ${lon}</span>
                </li>
                ${countryCorrection}
                ${renderExtraRows()}
            </ul>
        </section>
    </div>`;

    document.body.appendChild(panel);

    __state.activePanel = { panel, entity };
    updateActiveBasePanelPosition();
    if (!entity) positionBasePanel(panel, sx, sy);

    const closePanel = () => closeActiveBasePanel();

    const escHandler = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closePanel();
        }
    };

    document.addEventListener("keydown", escHandler);
    if (__state.activePanel?.panel === panel) {
        __state.activePanel.cleanup = () => document.removeEventListener("keydown", escHandler);
    }

    document.getElementById("milbase-close")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closePanel();
    });

    panel.focus();
}

/* ─── Click + hover handler ───────────────────────────────────────────────── */
function bindClickHandler(viewer) {
    const canvas = viewer.scene.canvas;
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);

    // MOUSE_MOVE — show pointer cursor when hovering a base icon.
    // Sets window.__wzBaseHover so the aircraft tracker's MOUSE_MOVE handler
    // knows not to reset the cursor back to "" when it runs.
    handler.setInputAction(movement => {
        if (!areMilitaryBasesInteractive()) {
            window.__wzBaseHover = false;
            return;
        }
        const picked = findPickedMilitaryBase(viewer, movement.endPosition);
        const isBase = Cesium.defined(picked?.id);
        window.__wzBaseHover = isBase;
        if (isBase) {
            canvas.style.cursor = "pointer";
        }
        // Do NOT reset to "" here — aircraft handler owns the reset path.
        // It checks window.__wzBaseHover before clearing (see warzone-live-airforce.js).
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // LEFT_CLICK — open info panel next to click position
    handler.setInputAction(click => {
        if (!areMilitaryBasesInteractive()) return;
        const picked = findPickedMilitaryBase(viewer, click.position);
        if (Cesium.defined(picked?.id)) {
            const props = picked.id?.properties;
            if (props?.milbase?.getValue?.()) {
                showBasePanel({
                    ...(picked.id.__militaryBaseData || {}),
                    name: props.name.getValue(),
                    country: props.country.getValue(),
                    operator: props.operator.getValue(),
                    type: props.type.getValue(),
                    typeLabel: props.typeLabel.getValue(),
                    size: props.size.getValue(),
                    lat: props.lat.getValue(),
                    lon: props.lon.getValue(),
                }, click.position.x, click.position.y, picked.id);
                clearBaseViewerSelection(viewer);
                flyToBaseTopDown(viewer, picked.id.__militaryBaseData || {
                    lat: props.lat.getValue(),
                    lon: props.lon.getValue(),
                });
                return; // keep panel open
            }
        }
        closeActiveBasePanel();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/* ─── Public API ─────────────────────────────────────────────────────────── */
export function initWarzoneMilitaryBases(viewer) {
    if (!viewer) return;
    __state.viewer = viewer;

    // Gate behind authentication — check if already logged in at init time
    __state.authGated = !document.body.classList.contains("is-authenticated");

    // Use a CustomDataSource so bases are isolated from viewer.entities.removeAll()
    // which gets called when events reload, wiping any entities added to the main collection
    const ds = new Cesium.CustomDataSource("military-bases");
    viewer.dataSources.add(ds);
    __state.dataSource = ds;

    __state.entities = MILITARY_BASES
        .map((base) => normalizeMilitaryBaseDisplayData(base))
        .filter((base) => Number.isFinite(base.lat) && Number.isFinite(base.lon))
        .map((base) => createBaseEntity(ds, base));
    viewer.scene.postRender.addEventListener(updateActiveBasePanelPosition);
    viewer.scene.morphStart?.addEventListener?.(closeActiveBasePanel);
    viewer.scene.morphComplete?.addEventListener?.(() => {
        closeActiveBasePanel();
        applyVisibility();
        viewer.scene.requestRender?.();
    });
    document.addEventListener("wz:scene-mode-changed", closeActiveBasePanel);
    viewer.camera.changed.addEventListener(() => {
        if (!areMilitaryBasesInteractive() && !__state.activePanel) return;
        if (__state.activePanel && !__state.baseCameraFlightActive && Date.now() > __state.manualDismissArmedAt) {
            closeActiveBasePanel();
        }
        viewer.scene.requestRender();
    });
    window.addEventListener("resize", refreshBaseIconSizing, { passive: true });
    bindClickHandler(viewer);

    // When user logs in (either via form or silent check), unlock bases
    document.addEventListener("wz:auth-success", () => {
        __state.authGated = false;
        applyVisibility();
    }, { once: true });

    applyVisibility();
}

export function setWarzoneMilitaryBasesVisible(visible) {
    __state.visible = Boolean(visible);
    if (!__state.visible) closeActiveBasePanel();
    applyVisibility();
}

export function toggleWarzoneMilitaryBases() {
    setWarzoneMilitaryBasesVisible(!__state.visible);
    return __state.visible;
}

export function isWarzoneMilitaryBasesVisible() {
    return __state.visible;
}
