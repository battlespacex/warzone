// assets/js/warzone-ranges.js

import * as Cesium from "cesium";
import { isLayerEnabled } from "./warzone-layers.js";

let __rangeEntities = [];

function getViewer() {
    return window.__warzoneViewer;
}

function clearRanges() {
    const viewer = getViewer();
    if (!viewer) return;

    __rangeEntities.forEach(e => {
        try { viewer.entities.remove(e); } catch { }
    });

    __rangeEntities = [];
}

/**
 * Core renderer
 * Called from essential.js
 */
function renderRanges(events = []) {
    const viewer = getViewer();
    if (!viewer) return;

    // Clear previous
    clearRanges();

    // Layer toggle
    if (!isLayerEnabled("ranges")) return;

    events.forEach((event) => {
        const lat = Number(event.lat);
        const lon = Number(event.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        // === TYPE 1: Impact / highlight radius ===
        const highlight = Number(event.highlight_radius_m);
        if (highlight > 0) {
            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                ellipse: {
                    semiMajorAxis: highlight,
                    semiMinorAxis: highlight,
                    material: Cesium.Color.RED.withAlpha(0.08),
                    outline: true,
                    outlineColor: Cesium.Color.RED.withAlpha(0.4),
                    outlineWidth: 1.2,
                    height: 0,
                },
                properties: {
                    type: "highlight",
                    eventId: event.id,
                }
            });

            __rangeEntities.push(entity);
        }

        // === TYPE 2: Target radius ===
        const target = Number(event.target_radius_m);
        if (target > 0) {
            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                ellipse: {
                    semiMajorAxis: target,
                    semiMinorAxis: target,
                    material: Cesium.Color.ORANGE.withAlpha(0.06),
                    outline: true,
                    outlineColor: Cesium.Color.ORANGE.withAlpha(0.35),
                    outlineWidth: 1,
                    height: 0,
                },
                properties: {
                    type: "target",
                    eventId: event.id,
                }
            });

            __rangeEntities.push(entity);
        }

        // === TYPE 3: Incoming / missile envelope ===
        const incoming = Number(event.incoming_highlight_radius_m);
        if (incoming > 0) {
            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                ellipse: {
                    semiMajorAxis: incoming,
                    semiMinorAxis: incoming,
                    material: Cesium.Color.YELLOW.withAlpha(0.05),
                    outline: true,
                    outlineColor: Cesium.Color.YELLOW.withAlpha(0.3),
                    outlineWidth: 0.8,
                    height: 0,
                },
                properties: {
                    type: "incoming",
                    eventId: event.id,
                }
            });

            __rangeEntities.push(entity);
        }
    });

    viewer.scene.requestRender();
}

export {
    renderRanges,
    clearRanges,
};