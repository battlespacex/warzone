// Shared hover pulse for unfocused live aircraft/naval billboards.
import * as Cesium from "cesium";
import {
    registerAnimationTask,
    requestSharedSceneRender,
    unregisterAnimationTask,
} from "./warzone-animation-scheduler.js";

const HOVER_PULSE_ANIMATION_TASK_KEY = "overlay:live-asset-hover-pulse";
const HOVER_PULSE_TARGET_HZ = 30;
const __hoverPulseStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let __hoverPulseUpdates = 0;

const __pulseState = {
    viewer: null,
    entity: null,
    frame: 0,
    startedAt: 0,
    config: null,
};

function cssValue(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function cssNumber(name, fallback) {
    const parsed = Number.parseFloat(cssValue(name, String(fallback)));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig() {
    return {
        minOpacity: Math.max(0, Math.min(1, cssNumber("--warzone-live-asset-hover-pulse-min-opacity", 0.58))),
        maxOpacity: Math.max(0, Math.min(1, cssNumber("--warzone-live-asset-hover-pulse-max-opacity", 1))),
        durationMs: Math.max(160, cssNumber("--warzone-live-asset-hover-pulse-duration", 900)),
    };
}

function resolveBillboardColor(entity) {
    const raw = entity?.billboard?.color;
    try {
        const value = raw?.getValue?.(Cesium.JulianDate.now()) || raw;
        if (value && Number.isFinite(value.red) && Number.isFinite(value.green) && Number.isFinite(value.blue)) {
            return Cesium.Color.clone(value);
        }
    } catch {
        // fall through to default white
    }
    return Cesium.Color.WHITE.clone();
}

function restoreEntity(entity) {
    if (!entity?.billboard || !entity.__warzoneLiveAssetHoverPulse) return;
    const original = entity.__warzoneLiveAssetHoverPulse.originalColor;
    entity.billboard.color = original ? Cesium.Color.clone(original) : undefined;
    entity.__warzoneLiveAssetHoverPulse = null;
}

function stopFrame() {
    unregisterAnimationTask(HOVER_PULSE_ANIMATION_TASK_KEY);
    __pulseState.frame = 0;
}

function tick(now) {
    const entity = __pulseState.entity;
    const viewer = __pulseState.viewer;
    if (!entity?.billboard || entity.show === false) {
        stopLiveAssetHoverPulse(entity);
        return false;
    }
    const config = __pulseState.config || readConfig();
    const elapsed = Math.max(0, now - __pulseState.startedAt);
    const wave = (Math.sin((elapsed / config.durationMs) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    const alpha = config.minOpacity + ((config.maxOpacity - config.minOpacity) * wave);
    const base = entity.__warzoneLiveAssetHoverPulse?.baseColor || resolveBillboardColor(entity);
    entity.billboard.color = Cesium.Color.clone(base).withAlpha(alpha);
    __hoverPulseUpdates += 1;
    return true;
}

export function startLiveAssetHoverPulse(viewer, entity) {
    if (!viewer || !entity?.billboard || entity.model || entity.point) {
        stopLiveAssetHoverPulse();
        return false;
    }
    if (__pulseState.entity === entity && __pulseState.frame) return true;
    stopLiveAssetHoverPulse();
    const originalColor = resolveBillboardColor(entity);
    entity.__warzoneLiveAssetHoverPulse = {
        originalColor,
        baseColor: Cesium.Color.clone(originalColor),
    };
    __pulseState.viewer = viewer;
    __pulseState.entity = entity;
    __pulseState.config = readConfig();
    __pulseState.startedAt = performance.now();
    __pulseState.frame = registerAnimationTask(
        HOVER_PULSE_ANIMATION_TASK_KEY,
        tick,
        { hz: HOVER_PULSE_TARGET_HZ }
    );
    return true;
}

export function stopLiveAssetHoverPulse(entity = null) {
    const target = entity || __pulseState.entity;
    restoreEntity(target);
    if (!entity || entity === __pulseState.entity) {
        stopFrame();
        __pulseState.viewer = null;
        __pulseState.entity = null;
        __pulseState.config = null;
        __pulseState.startedAt = 0;
    }
    requestSharedSceneRender();
    return true;
}

export function getLiveAssetHoverPulseDiagnostics() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedSeconds = Math.max(0.001, (now - __hoverPulseStartedAt) / 1000);
    return Object.freeze({
        active: Boolean(__pulseState.frame && __pulseState.entity),
        targetUpdatesPerSecond: HOVER_PULSE_TARGET_HZ,
        updates: __hoverPulseUpdates,
        updatesPerSecond: Number((__hoverPulseUpdates / elapsedSeconds).toFixed(2)),
    });
}

if (typeof window !== "undefined") {
    window.__warzoneHoverPulseDiagnostics = getLiveAssetHoverPulseDiagnostics;
}
