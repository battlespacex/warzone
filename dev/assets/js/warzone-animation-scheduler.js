const __animationTasks = new Map();
let __animationFrame = 0;
let __renderFrame = 0;
const __schedulerStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let __taskUpdates = 0;
let __sceneRenderRequests = 0;
let __coalescedRenderRequests = 0;
let __lastSceneRenderFrameTime = -1;

function updateDiagnostics() {
    if (typeof window !== "undefined") {
        window.__warzoneAnimationTaskCount = __animationTasks.size;
    }
}

function elapsedSeconds() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return Math.max(0.001, (now - __schedulerStartedAt) / 1000);
}

function requestSceneRender(frameTime = -1) {
    if (frameTime >= 0 && __lastSceneRenderFrameTime === frameTime) {
        __coalescedRenderRequests += 1;
        return false;
    }
    if (typeof window === "undefined") return false;
    const requestRender = window.__warzoneViewer?.scene?.requestRender;
    if (typeof requestRender !== "function") return false;
    requestRender.call(window.__warzoneViewer.scene);
    __sceneRenderRequests += 1;
    __lastSceneRenderFrameTime = frameTime;
    return true;
}

function scheduleAnimationFrame() {
    if (__animationFrame || !__animationTasks.size ||
        (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
    __animationFrame = requestAnimationFrame(runAnimationFrame);
}

function runAnimationFrame(now) {
    __animationFrame = 0;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    let renderNeeded = false;
    for (const [key, task] of __animationTasks) {
        if (task.minIntervalMs > 0 && task.lastRunAt > 0 && (now - task.lastRunAt) < task.minIntervalMs) {
            continue;
        }
        try {
            task.lastRunAt = now;
            const keepRunning = task.callback(now) !== false;
            __taskUpdates += 1;
            renderNeeded = true;
            if (!keepRunning) {
                __animationTasks.delete(key);
            }
        } catch (error) {
            console.warn(`[animation] task ${key} stopped:`, error);
            __animationTasks.delete(key);
        }
    }
    updateDiagnostics();
    if (renderNeeded) {
        if (__renderFrame) {
            cancelAnimationFrame(__renderFrame);
            __renderFrame = 0;
            __coalescedRenderRequests += 1;
        }
        requestSceneRender(now);
    }
    scheduleAnimationFrame();
}

export function registerAnimationTask(key, callback, options = {}) {
    const taskKey = String(key || "").trim();
    if (!taskKey || typeof callback !== "function") return false;
    const hz = Number(options.hz || 0);
    __animationTasks.set(taskKey, {
        callback,
        minIntervalMs: Number.isFinite(hz) && hz > 0 ? 1000 / hz : 0,
        lastRunAt: 0,
    });
    updateDiagnostics();
    scheduleAnimationFrame();
    return true;
}

export function unregisterAnimationTask(key) {
    const removed = __animationTasks.delete(String(key || "").trim());
    updateDiagnostics();
    return removed;
}

export function requestSharedSceneRender() {
    if (__renderFrame) {
        __coalescedRenderRequests += 1;
        return;
    }
    __renderFrame = requestAnimationFrame((now) => {
        __renderFrame = 0;
        requestSceneRender(now);
    });
}

export function getAnimationSchedulerDiagnostics() {
    const seconds = elapsedSeconds();
    return Object.freeze({
        activeTasks: __animationTasks.size,
        taskKeys: Object.freeze(Array.from(__animationTasks.keys())),
        animationFrameActive: Boolean(__animationFrame),
        renderFramePending: Boolean(__renderFrame),
        taskUpdates: __taskUpdates,
        taskUpdatesPerSecond: Number((__taskUpdates / seconds).toFixed(2)),
        sceneRenderRequests: __sceneRenderRequests,
        sceneRenderRequestsPerSecond: Number((__sceneRenderRequests / seconds).toFixed(2)),
        coalescedRenderRequests: __coalescedRenderRequests,
    });
}

if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            if (__animationFrame) {
                cancelAnimationFrame(__animationFrame);
                __animationFrame = 0;
            }
            if (__renderFrame) {
                cancelAnimationFrame(__renderFrame);
                __renderFrame = 0;
            }
            return;
        }
        for (const task of __animationTasks.values()) task.lastRunAt = 0;
        scheduleAnimationFrame();
        if (__animationTasks.size) requestSharedSceneRender();
    }, { passive: true });
}
