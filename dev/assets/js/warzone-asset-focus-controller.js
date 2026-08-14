import * as Cesium from "cesium";

// Shared focus lifecycle and lightweight frame scheduler for focusable map assets.

export function resetWarzoneCameraReference(viewer = null, options = {}) {
    const targetViewer = viewer || (typeof window !== "undefined" ? window.__warzoneViewer : null);
    const camera = targetViewer?.camera;
    if (!targetViewer || !camera) return false;

    const preserveView = options?.preserveView !== false;
    const clearSelection = options?.clearSelection === true;
    const worldPosition = preserveView && camera.positionWC
        ? Cesium.Cartesian3.clone(camera.positionWC)
        : null;
    const worldDirection = preserveView && camera.directionWC
        ? Cesium.Cartesian3.clone(camera.directionWC)
        : null;
    const worldUp = preserveView && camera.upWC
        ? Cesium.Cartesian3.clone(camera.upWC)
        : null;

    try {
        camera.cancelFlight?.();
    } catch { }

    try {
        if (targetViewer.trackedEntity) targetViewer.trackedEntity = undefined;
        if (clearSelection) targetViewer.selectedEntity = undefined;
    } catch { }

    try {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        if (worldPosition && worldDirection && worldUp) {
            camera.setView({
                destination: worldPosition,
                orientation: {
                    direction: worldDirection,
                    up: worldUp,
                },
            });
        }
    } catch {
        try {
            camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        } catch { }
    }

    const cameraController = targetViewer.scene?.screenSpaceCameraController;
    if (cameraController) {
        cameraController.enableInputs = true;
        cameraController.enableRotate = true;
        cameraController.enableTranslate = true;
        cameraController.enableZoom = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
    }

    targetViewer.scene?.requestRender?.();
    return true;
}

const FOCUS_STATES = Object.freeze({
    INACTIVE: "inactive",
    ENTERING: "entering",
    ACTIVE: "active",
    SUSPENDED: "temporarily_suspended",
    UNAVAILABLE: "asset_unavailable",
    EXITING: "exiting",
});

let __assetFocusController = null;

function nowMs() {
    return (typeof performance !== "undefined" && performance.now)
        ? performance.now()
        : Date.now();
}

function safeDispatch(detail) {
    try {
        document.dispatchEvent(new CustomEvent("wz:asset-focus-changed", { detail }));
    } catch { }
}

function createDiagnostics(state, tasks) {
    return {
        state: state.state,
        assetType: state.assetType,
        assetId: state.assetId,
        mode: state.mode,
        generation: state.generation,
        frameCount: state.frameCount,
        lastFrameAt: state.lastFrameAt,
        hidden: typeof document !== "undefined" ? document.hidden === true : false,
        taskCount: tasks.size,
        tasks: Array.from(tasks.keys()),
    };
}

function createAssetFocusController() {
    const state = {
        state: FOCUS_STATES.INACTIVE,
        assetType: "",
        assetId: "",
        mode: "",
        generation: 0,
        abortController: null,
        cleanupCallbacks: [],
        raf: 0,
        frameCount: 0,
        lastFrameAt: 0,
        lastActiveState: FOCUS_STATES.INACTIVE,
    };
    const tasks = new Map();
    const publish = () => {
        window.__warzoneFocusDiagnostics = createDiagnostics(state, tasks);
        safeDispatch(window.__warzoneFocusDiagnostics);
    };
    const cancelRaf = () => {
        if (!state.raf) return;
        try { cancelAnimationFrame(state.raf); } catch { }
        state.raf = 0;
    };
    const runCleanups = () => {
        const callbacks = state.cleanupCallbacks.splice(0);
        callbacks.forEach((callback) => {
            try { callback(); } catch { }
        });
    };
    const abortActive = (reason = "replaced") => {
        try { state.abortController?.abort?.(reason); } catch { }
        state.abortController = null;
    };
    const tick = () => {
        state.raf = 0;
        if (state.state !== FOCUS_STATES.ACTIVE || document.hidden === true) return;
        const timestamp = nowMs();
        state.frameCount += 1;
        state.lastFrameAt = timestamp;
        tasks.forEach((task, key) => {
            const minInterval = Math.max(0, Number(task.minInterval || 0));
            if ((timestamp - Number(task.lastRunAt || 0)) < minInterval) return;
            task.lastRunAt = timestamp;
            try {
                task.fn({
                    timestamp,
                    generation: state.generation,
                    assetType: state.assetType,
                    assetId: state.assetId,
                    mode: state.mode,
                    key,
                    signal: state.abortController?.signal || null,
                });
            } catch (error) {
                console.warn("[asset-focus] scheduled task failed:", key, error);
            }
        });
        publish();
        if (state.state === FOCUS_STATES.ACTIVE && tasks.size > 0) {
            state.raf = requestAnimationFrame(tick);
        }
    };
    const requestFrame = () => {
        if (state.raf || state.state !== FOCUS_STATES.ACTIVE || document.hidden === true) return;
        state.raf = requestAnimationFrame(tick);
    };
    const controller = {
        FOCUS_STATES,
        canEnterFocus(options = {}) {
            if (state.state === FOCUS_STATES.INACTIVE) return true;
            return (
                state.state === FOCUS_STATES.ACTIVE &&
                state.assetType === String(options.assetType || "asset") &&
                state.assetId === String(options.assetId || "")
            );
        },
        enterFocus(options = {}) {
            if (!controller.canEnterFocus(options)) return false;
            abortActive("enter-focus");
            runCleanups();
            state.generation += 1;
            state.state = FOCUS_STATES.ENTERING;
            state.assetType = String(options.assetType || "asset");
            state.assetId = String(options.assetId || "");
            state.mode = String(options.mode || "focus");
            state.abortController = new AbortController();
            state.frameCount = 0;
            state.lastFrameAt = 0;
            publish();
            state.state = FOCUS_STATES.ACTIVE;
            publish();
            requestFrame();
            return {
                generation: state.generation,
                signal: state.abortController.signal,
            };
        },
        setMode(mode = "") {
            state.mode = String(mode || state.mode || "focus");
            publish();
        },
        markUnavailable(reason = "asset-unavailable") {
            state.state = FOCUS_STATES.UNAVAILABLE;
            abortActive(reason);
            cancelRaf();
            publish();
            controller.exitFocus(reason);
        },
        suspend(reason = "visibility") {
            if (state.state !== FOCUS_STATES.ACTIVE) return false;
            state.lastActiveState = state.state;
            state.state = FOCUS_STATES.SUSPENDED;
            abortActive(reason);
            cancelRaf();
            publish();
            return true;
        },
        resume(reason = "visibility") {
            if (state.state !== FOCUS_STATES.SUSPENDED) return false;
            state.state = FOCUS_STATES.ACTIVE;
            state.abortController = new AbortController();
            publish();
            requestFrame();
            return true;
        },
        exitFocus(reason = "exit") {
            if (state.state === FOCUS_STATES.INACTIVE) {
                resetWarzoneCameraReference();
                return false;
            }
            state.state = FOCUS_STATES.EXITING;
            abortActive(reason);
            cancelRaf();
            runCleanups();
            state.generation += 1;
            state.assetType = "";
            state.assetId = "";
            state.mode = "";
            state.state = FOCUS_STATES.INACTIVE;
            state.frameCount = 0;
            state.lastFrameAt = 0;
            resetWarzoneCameraReference();
            publish();
            return true;
        },
        registerCleanup(callback) {
            if (typeof callback !== "function") return false;
            state.cleanupCallbacks.push(callback);
            return true;
        },
        registerTask(key, fn, options = {}) {
            if (!key || typeof fn !== "function") return false;
            const hz = Math.max(0, Math.min(60, Number(options.hz || 0)));
            tasks.set(String(key), {
                fn,
                minInterval: hz > 0 ? 1000 / hz : 0,
                lastRunAt: 0,
            });
            requestFrame();
            publish();
            return true;
        },
        removeTask(key) {
            const removed = tasks.delete(String(key || ""));
            publish();
            return removed;
        },
        requestFrame,
        getState() {
            return { ...state, cleanupCallbacks: undefined, abortController: undefined, raf: undefined };
        },
        getGeneration() {
            return state.generation;
        },
        isCurrent(generation) {
            return Number(generation) === state.generation;
        },
        isActiveAsset(assetId, assetType = "") {
            return state.state !== FOCUS_STATES.INACTIVE
                && String(assetId || "") === state.assetId
                && (!assetType || String(assetType) === state.assetType);
        },
    };
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            if (document.hidden === true) {
                controller.suspend("document-hidden");
            } else if (state.state === FOCUS_STATES.SUSPENDED) {
                controller.resume("document-visible");
            }
        });
    }
    return controller;
}

export function getAssetFocusController() {
    if (!__assetFocusController) __assetFocusController = createAssetFocusController();
    return __assetFocusController;
}
