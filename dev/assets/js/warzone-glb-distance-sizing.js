import * as Cesium from "cesium";

// Presentation units: 3 means the original/verified physical model size, not
// three metres or three glTF units. Focus never changes the sizing curve.
export function readGlbSizing(read, domain, category, physicalRatio = 1) {
    const prefix = `--warzone-live-${domain}-model-`;
    const value = (name, fallback) => read(`${prefix}${name}-${category}`, read(`${prefix}${name}`, fallback));
    const farSize = Math.max(.01, value("scale-min", value("scale", 3)));
    return {
        farSize, nearSize: Math.max(.01, value("scale-max", 7)),
        near: Math.max(1, read("--warzone-live-glb-zoom-near-distance", 2500)),
        far: Math.max(2, read("--warzone-live-glb-zoom-far-distance", 160000)),
        exponent: Math.max(.1, read("--warzone-live-glb-zoom-exponent", .7)),
        pixelUnit: Math.max(0, value("pixel-unit", 8)),
        minimum: Math.max(0, value("min-pixel-size", 24)),
        maximum: Math.max(.01, value("max-scale", 160)),
        physicalRatio: Number.isFinite(physicalRatio) && physicalRatio > 0 ? physicalRatio : 1,
    };
}

export function evaluateGlbSizing(config, distance, result = {}) {
    const t = Math.max(0, Math.min(1, (config.far - distance) / Math.max(1, config.far - config.near)));
    const smooth = t * t * (3 - 2 * t);
    const size = config.farSize + (config.nearSize - config.farSize) * smooth ** config.exponent;
    result.scale = size / 3 * config.physicalRatio;
    result.minimumPixelSize = Math.max(config.minimum, size * config.pixelUnit);
    // A finite world-scale ceiling defeats the pixel floor at regional/global
    // distances. The bounded CSS pixel goal controls enlargement instead.
    result.maximumScale = undefined;
    return result;
}

// One constant-cost property evaluation per visible model. No listeners,
// timers, CSS reads, registry scans or new tasks in the rendering path.
export function applyGlbDistanceSizing(entity, config, viewer) {
    if (!entity?.model || !viewer) return;
    let state = entity.__glbDistanceSizing;
    if (!state) {
        state = entity.__glbDistanceSizing = { scratch: new Cesium.Cartesian3(), result: {} };
        const evaluate = time => {
            const position = entity.position?.getValue(time, state.scratch);
            const camera = state.viewer.camera?.positionWC;
            const result = evaluateGlbSizing(state.config, position && camera ? Cesium.Cartesian3.distance(position, camera) : Infinity, state.result);
            return result;
        };
        state.scale = new Cesium.CallbackProperty(time => evaluate(time).scale, false);
        state.pixels = new Cesium.CallbackProperty(time => {
            const scene = state.viewer.scene;
            const ratio = scene?.canvas?.clientWidth > 0 ? scene.drawingBufferWidth / scene.canvas.clientWidth : 1;
            return evaluate(time).minimumPixelSize * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
        }, false);
    }
    state.config = config; state.viewer = viewer;
    entity.model.scale = state.scale;
    entity.model.minimumPixelSize = state.pixels;
    entity.model.maximumScale = evaluateGlbSizing(config, Infinity).maximumScale;
    viewer.scene?.requestRender?.();
}
