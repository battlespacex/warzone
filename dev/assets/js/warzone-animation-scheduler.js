const __animationTasks = new Map();
let __animationFrame = 0;
let __renderFrame = 0;

function updateDiagnostics() {
    window.__warzoneAnimationTaskCount = __animationTasks.size;
}

function requestSceneRender() {
    window.__warzoneViewer?.scene?.requestRender?.();
}

function scheduleAnimationFrame() {
    if (__animationFrame || !__animationTasks.size || document.visibilityState === "hidden") return;
    __animationFrame = requestAnimationFrame(runAnimationFrame);
}

function runAnimationFrame(now) {
    __animationFrame = 0;
    if (document.visibilityState === "hidden") return;
    let renderNeeded = false;
    for (const [key, callback] of __animationTasks) {
        try {
            const keepRunning = callback(now) !== false;
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
    if (renderNeeded) requestSceneRender();
    scheduleAnimationFrame();
}

export function registerAnimationTask(key, callback) {
    const taskKey = String(key || "").trim();
    if (!taskKey || typeof callback !== "function") return false;
    __animationTasks.set(taskKey, callback);
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
    if (__renderFrame) return;
    __renderFrame = requestAnimationFrame(() => {
        __renderFrame = 0;
        requestSceneRender();
    });
}

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
    scheduleAnimationFrame();
    if (__animationTasks.size) requestSharedSceneRender();
}, { passive: true });
