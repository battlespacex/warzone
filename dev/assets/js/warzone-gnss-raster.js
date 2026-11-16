import * as Cesium from "cesium";
import { gnssBoundary, unwrapGnssPolygon, gnssContains } from "../../../apps/shared/gnss-geometry.js";

// One owned imagery layer; no GNSS geometry workers, entities, or private Cesium APIs.
export function createGnssRasterLayer(viewer, { onError = () => {}, fetchImpl = globalThis.fetch } = {}) {
    let layer = null, provider = null, removeError = null, signature = "", config = null;
    let controller = null, timer = null, ticket = 0, disposed = false, failed = false;
    const cells = new Map();
    let settle = null;
    let completedTiles = 0, requestedTiles = 0;
    function cancelPick() {
        ticket++;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        controller?.abort(); controller = null;
        settle?.(null); settle = null;
    }
    function removeLayer() {
        removeError?.(); removeError = null;
        if (layer) viewer.imageryLayers.remove(layer, true);
        layer = null; provider = null;
    }
    return {
        set(next) {
            if (disposed) return;
            const key = JSON.stringify([next.raster.revision, next.raster.tileUrl, next.filter, next.style]);
            config = next;
            if (key !== signature) {
                cancelPick(); removeLayer(); cells.clear(); failed = false; signature = key;
                const query = new URLSearchParams({ filter: next.filter, style: JSON.stringify(next.style) });
                provider = new Cesium.UrlTemplateImageryProvider({
                    url: `${next.raster.tileUrl}?${query}`,
                    tilingScheme: new Cesium.GeographicTilingScheme(),
                    maximumLevel: next.raster.maximumLevel, tileWidth: 256, tileHeight: 256,
                    hasAlphaChannel: true, enablePickFeatures: false,
                });
                completedTiles = 0; requestedTiles = 0;
                const owner = provider, requestImage = provider.requestImage?.bind(provider);
                if (requestImage) provider.requestImage = (...args) => {
                    const image = requestImage(...args);
                    if (image !== undefined) {
                        requestedTiles++;
                        Promise.resolve(image).then(() => { if (!disposed && provider === owner) completedTiles++; }, () => {});
                    }
                    return image;
                };
                layer = viewer.imageryLayers.addImageryProvider(provider);
                removeError = provider.errorEvent.addEventListener(error => {
                    // Cesium imagery failures stay local to this layer. Never restart the scene loop.
                    if (disposed || failed) return;
                    failed = true; cancelPick(); removeLayer();
                    onError(error);
                });
            }
            if (layer) layer.show = next.show && !failed;
            if (!next.show) cancelPick();
            viewer.scene.requestRender?.();
        },
        pick(screen, { immediate = false } = {}) {
            cancelPick();
            if (disposed || !config?.show || failed || !screen) return Promise.resolve(null);
            const ray = viewer.camera.getPickRay(screen);
            const position = ray && viewer.scene.globe.pick(ray, viewer.scene);
            if (!position) return Promise.resolve(null);
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const lon = Cesium.Math.toDegrees(cartographic.longitude), lat = Cesium.Math.toDegrees(cartographic.latitude);
            // Hover may reuse a known polygon for the pointer. Clicks always resolve
            // authoritative draw order, including overlapping provider/fallback cells.
            for (const cell of immediate ? [] : [...cells.values()].reverse()) {
                const points = unwrapGnssPolygon(gnssBoundary(cell, config.style.size));
                if ([-360, 0, 360].some(shift => gnssContains(points, lon + shift, lat))) return Promise.resolve(cell);
            }
            const current = ticket, selectedConfig = config;
            return new Promise(resolve => {
                settle = resolve;
                timer = setTimeout(async () => {
                    timer = null; const request = new AbortController(); controller = request;
                    try {
                        const query = new URLSearchParams({ lon, lat, filter: selectedConfig.filter, style: JSON.stringify(selectedConfig.style) });
                        const response = await fetchImpl(`${selectedConfig.raster.lookupUrl}?${query}`, { signal: request.signal });
                        if (!response.ok) throw Object.assign(new Error(`GNSS cell lookup HTTP ${response.status}`), { statusCode: response.status });
                        const { cell } = await response.json();
                        if (disposed || current !== ticket) return;
                        if (cell) { cells.set(cell.id || cell.cellId, cell); if (cells.size > 64) cells.delete(cells.keys().next().value); }
                        resolve(cell || null);
                    } catch (error) {
                        if (!request.signal.aborted && current === ticket) { resolve(null); onError(error); }
                    } finally {
                        if (current === ticket) { settle = null; controller = null; }
                    }
                }, immediate ? 0 : 180);
            });
        },
        cancelPick,
        dispose() {
            disposed = true; cancelPick(); removeLayer(); cells.clear(); config = null; signature = "";
            viewer.scene.requestRender?.();
        },
        diagnostics: () => ({ imageryLayers: layer ? 1 : 0, cachedPickCells: cells.size, pendingPick: Boolean(controller || timer !== null), failed, completedTiles, requestedTiles }),
    };
}
