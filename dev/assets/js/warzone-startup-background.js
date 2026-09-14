const STARTUP_BACKGROUND_EXIT_FALLBACK_MS = 1200;
const STARTUP_VIDEO_IDLE_TIMEOUT_MS = 1800;

function markIntroVideoPerformance(name) {
    if (!name || typeof performance?.mark !== "function") return;
    try {
        if (!performance.getEntriesByName(name, "mark").length) {
            performance.mark(name);
        }
    } catch { }
}

function parseCssTimeMs(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized.endsWith("ms")) {
        return Number.parseFloat(normalized) || 0;
    }
    if (normalized.endsWith("s")) {
        return (Number.parseFloat(normalized) || 0) * 1000;
    }
    return Number.NaN;
}

function getStartupBackgroundExitMs(layer) {
    try {
        const style = window.getComputedStyle(layer);
        const durationMs = parseCssTimeMs(style.transitionDuration.split(",")[0]);
        const delayMs = parseCssTimeMs(style.transitionDelay.split(",")[0]);
        const totalMs = durationMs + delayMs;
        return Number.isFinite(totalMs)
            ? Math.max(totalMs, 0)
            : STARTUP_BACKGROUND_EXIT_FALLBACK_MS;
    } catch {
        return STARTUP_BACKGROUND_EXIT_FALLBACK_MS;
    }
}

let exitState = null;
let releasePromise = null;
let resourcesReleased = false;

function releaseVideoResources(layer, video) {
    resourcesReleased = true;
    try { video?.pause?.(); } catch { }
    markIntroVideoPerformance("stratops-intro-video-paused-after-entry");
    if (video) {
        video.removeAttribute("src");
        video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
        try { video.load?.(); } catch { }
    }
    layer?.remove();
    document.body.classList.remove("is-pre-entry");
    document.body.classList.add("is-startup-background-released");
}

function startDeferredVideo(layer, video, markUnavailable) {
    if (
        resourcesReleased
        || !layer?.isConnected
        || layer.classList.contains("is-leaving")
        || video.dataset.sourceAttached === "true"
    ) {
        return false;
    }

    const source = video.querySelector("source[data-src]");
    const sourceUrl = String(source?.dataset?.src || "").trim();
    if (!source || !sourceUrl) {
        markUnavailable();
        return false;
    }

    video.dataset.sourceAttached = "true";
    markIntroVideoPerformance("stratops-intro-video-request-start");
    source.setAttribute("src", sourceUrl);
    try { video.load?.(); } catch { }

    const playPromise = video.play?.();
    playPromise?.catch?.(() => {
        // The solid background remains visible if browser autoplay policy blocks playback.
    });
    return true;
}

function scheduleDeferredVideoStart(layer, video, markUnavailable) {
    let scheduled = false;
    const scheduleWhenIdle = () => {
        if (scheduled) return;
        scheduled = true;
        const start = () => startDeferredVideo(layer, video, markUnavailable);
        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(start, { timeout: STARTUP_VIDEO_IDLE_TIMEOUT_MS });
        } else {
            window.setTimeout(start, 0);
        }
    };

    if (document.readyState === "complete") {
        scheduleWhenIdle();
    } else {
        window.addEventListener("load", scheduleWhenIdle, { once: true });
    }
}

export function initStartupBackground() {
    const layer = document.getElementById("wz-startup-background");
    const video = document.getElementById("wz-startup-video");
    if (!layer || !video) return null;

    video.muted = true;
    video.defaultMuted = true;
    video.controls = false;

    const markUnavailable = () => {
        video.classList.remove("is-video-ready");
        layer.classList.add("is-video-unavailable");
    };
    video.addEventListener("loadedmetadata", () => {
        markIntroVideoPerformance("stratops-intro-video-metadata");
    }, { once: true });
    video.addEventListener("loadeddata", () => {
        const markFirstFrame = () => {
            markIntroVideoPerformance("stratops-intro-video-first-frame");
            video.classList.add("is-video-ready");
        };
        if (typeof video.requestVideoFrameCallback === "function") {
            video.requestVideoFrameCallback(markFirstFrame);
        } else {
            markFirstFrame();
        }
    }, { once: true });
    video.addEventListener("error", markUnavailable, { once: true });
    video.querySelector("source")?.addEventListener("error", markUnavailable, { once: true });
    scheduleDeferredVideoStart(layer, video, markUnavailable);

    const beginExit = () => {
        if (exitState?.promise) return exitState.promise;
        let resolveExit = null;
        const state = {
            completed: false,
            fallbackTimer: 0,
            onTransitionEnd: null,
            promise: new Promise((resolve) => {
                resolveExit = resolve;
            }),
        };
        const finish = () => {
            if (state.completed) return;
            state.completed = true;
            layer.removeEventListener("transitionend", state.onTransitionEnd);
            window.clearTimeout(state.fallbackTimer);
            resolveExit?.();
        };
        state.onTransitionEnd = (event) => {
            if (event.target === layer && event.propertyName === "opacity") finish();
        };
        state.fallbackTimer = window.setTimeout(finish, getStartupBackgroundExitMs(layer) + 120);
        exitState = state;
        layer.addEventListener("transitionend", state.onTransitionEnd);
        layer.classList.add("is-leaving");
        return state.promise;
    };

    window.__warzoneBeginStartupBackgroundExit = beginExit;
    window.__warzoneRestoreStartupBackground = () => {
        if (resourcesReleased || !layer.isConnected) return false;
        const state = exitState;
        if (state) {
            layer.removeEventListener("transitionend", state.onTransitionEnd);
            window.clearTimeout(state.fallbackTimer);
        }
        exitState = null;
        releasePromise = null;
        layer.classList.remove("is-leaving");
        document.body.classList.remove("is-entry-exiting");
        document.body.classList.add("is-pre-entry");
        const retryPlay = video.play?.();
        retryPlay?.catch?.(markUnavailable);
        return true;
    };
    window.__warzoneReleaseStartupBackground = () => {
        if (releasePromise) return releasePromise;
        releasePromise = beginExit().then(() => {
            releaseVideoResources(layer, video);
        });
        return releasePromise;
    };

    return layer;
}
