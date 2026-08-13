const STARTUP_BACKGROUND_FADE_MS = 1000;

let exitState = null;
let releasePromise = null;
let resourcesReleased = false;

function releaseVideoResources(layer, video) {
    resourcesReleased = true;
    try { video?.pause?.(); } catch { }
    if (video) {
        video.removeAttribute("src");
        video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
        try { video.load?.(); } catch { }
    }
    layer?.remove();
    document.body.classList.add("is-startup-background-released");
}

export function initStartupBackground() {
    const layer = document.getElementById("wz-startup-background");
    const video = document.getElementById("wz-startup-video");
    if (!layer || !video) return null;

    video.muted = true;
    video.defaultMuted = true;
    video.controls = false;

    const markUnavailable = () => {
        layer.classList.add("is-video-unavailable");
    };
    video.addEventListener("error", markUnavailable, { once: true });
    video.querySelector("source")?.addEventListener("error", markUnavailable, { once: true });
    const playPromise = video.play?.();
    if (playPromise?.catch) {
        playPromise.catch(markUnavailable);
    }

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
        state.fallbackTimer = window.setTimeout(finish, STARTUP_BACKGROUND_FADE_MS + 120);
        exitState = state;
        layer.addEventListener("transitionend", state.onTransitionEnd);
        layer.classList.add("is-leaving");
        document.body.classList.remove("is-pre-entry");
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
