const PRE_ENTRY_SHOWCASE_TRANSITION_MS = 240;
const PRE_ENTRY_VIEWER_WAIT_MS = 8000;

let activeSceneSession = null;

function getEntryCssFlag(name, fallback = 1) {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const value = Number(raw);
        return Number.isFinite(value) ? value !== 0 : fallback !== 0;
    } catch {
        return fallback !== 0;
    }
}

function waitForWarzoneViewer(timeoutMs = PRE_ENTRY_VIEWER_WAIT_MS) {
    if (window.__warzoneViewer) return Promise.resolve(window.__warzoneViewer);
    return new Promise((resolve) => {
        const startedAt = performance.now();
        const check = () => {
            if (window.__warzoneViewer) {
                resolve(window.__warzoneViewer);
                return;
            }
            if (performance.now() - startedAt >= timeoutMs) {
                resolve(null);
                return;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

function stopPreEntrySceneSession() {
    const session = activeSceneSession;
    if (!session) return;
    activeSceneSession = null;
    session.cancelled = true;
    document.removeEventListener("wz:app-entered", session.handleAppEntered);
    try { session.tunerModule?.destroyIntroStartupSceneTuner?.(); } catch { }
    try { session.assetsModule?.setWarzoneStartupDemoAssetsEnabled?.(false); } catch { }
    try { session.satellitesModule?.setWarzoneStartupMilSatsDemoEnabled?.(false); } catch { }
}

async function startPreEntrySceneSession(overlay) {
    stopPreEntrySceneSession();

    const session = {
        overlay,
        cancelled: false,
        satellitesModule: null,
        assetsModule: null,
        tunerModule: null,
        handleAppEntered: () => stopPreEntrySceneSession(),
    };

    activeSceneSession = session;
    document.addEventListener("wz:app-entered", session.handleAppEntered, { once: true });

    try {
        const isLocalDev =
            import.meta.env?.DEV === true ||
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1";

        const [viewer, satellitesModule, assetsModule, tunerModule] = await Promise.all([
            waitForWarzoneViewer(),
            import("./warzone-startup-mil-sats.js"),
            import("./warzone-startup-demo-assets.js"),
            isLocalDev
                ? import("./warzone-startup-scene-tuner.js")
                : Promise.resolve(null),
        ]);

        session.satellitesModule = satellitesModule;
        session.assetsModule = assetsModule;
        session.tunerModule = tunerModule;

        const stillActive = activeSceneSession === session
            && !session.cancelled
            && overlay?.isConnected
            && document.body.classList.contains("wz-pre-entry-active");

        if (!stillActive || !viewer) {
            stopPreEntrySceneSession();
            return;
        }

        const warzoneApi = viewer.__warzone || window.__warzoneViewer?.__warzone || window.__warzone || null;

        const showMapImagery = getEntryCssFlag("--wz-entry-show-map-imagery", 1);
        const showBorders = getEntryCssFlag("--wz-entry-show-borders", 0);
        const showSatellites = getEntryCssFlag("--wz-entry-show-satellites", 1);
        const showNaval = getEntryCssFlag("--wz-entry-show-naval-assets", 1);
        const showAir = getEntryCssFlag("--wz-entry-show-air-assets", 1);

        document.body.classList.add("show-loader");
        warzoneApi?.stopStartupRotation?.();

        await Promise.all([
            warzoneApi?.setEntryMapImageryVisible?.(showMapImagery) ?? Promise.resolve(false),
            warzoneApi?.setBorderLayersVisible?.(showBorders, { immediate: true }) ?? Promise.resolve(false),
        ]);

        const stillReady = activeSceneSession === session
            && !session.cancelled
            && overlay?.isConnected
            && document.body.classList.contains("wz-pre-entry-active");

        if (!stillReady) {
            stopPreEntrySceneSession();
            return;
        }

        satellitesModule.initWarzoneStartupMilSats?.(viewer);
        satellitesModule.setWarzoneStartupMilSatsDemoEnabled?.(showSatellites);

        assetsModule.initWarzoneStartupDemoAssets?.(viewer);
        assetsModule.setWarzoneStartupDemoAssetsEnabled?.(showNaval || showAir);

    tunerModule?.initIntroStartupSceneTuner?.();

        warzoneApi?.startStartupRotation?.();
        viewer.scene?.requestRender?.();
    } catch (error) {
        console.warn("Pre-entry scene assets failed to initialize:", error);
        stopPreEntrySceneSession();
    } finally {
        document.body.classList.remove("show-loader");
    }
}

export function initPreEntryShowcase({ onEnter } = {}) {
    const template = document.getElementById("tpl-wz-pre-entry-showcase");
    if (!template?.content || typeof onEnter !== "function") {
        onEnter?.();
        return null;
    }

    stopPreEntrySceneSession();
    document.getElementById("wz-pre-entry-showcase")?.remove();

    const fragment = template.content.cloneNode(true);
    const overlay = fragment.querySelector("#wz-pre-entry-showcase");
    const enterButton = fragment.querySelector("#wz-pre-entry-enter");
    const mount = document.querySelector("#warzone-app")
        || document.getElementById("warzone-gate-layer")
        || document.getElementById("warzone-app")
        || document.body;

    if (!overlay || !enterButton || !mount) {
        onEnter();
        return null;
    }

    let entered = false;
    const finish = () => {
        stopPreEntrySceneSession();
        overlay.remove();
        document.body.classList.remove("wz-pre-entry-active");
        document.body.classList.add("wz-pre-entry-complete");
        onEnter();
    };

    const handleEnter = () => {
        if (entered) return;
        entered = true;
        enterButton.disabled = true;
        enterButton.setAttribute("aria-disabled", "true");
        overlay.classList.add("is-leaving");
        overlay.setAttribute("aria-hidden", "true");
        window.setTimeout(finish, PRE_ENTRY_SHOWCASE_TRANSITION_MS);
    };

    enterButton.addEventListener("click", handleEnter);
    overlay.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        if (event.target && event.target !== enterButton) return;
        event.preventDefault();
        handleEnter();
    });

    document.body.classList.add("wz-pre-entry-active");
    document.body.classList.remove("wz-pre-entry-complete");
    mount.prepend(fragment);
    requestAnimationFrame(() => {
        overlay.classList.add("is-visible");
        enterButton.focus({ preventScroll: true });
        void startPreEntrySceneSession(overlay);
    });

    return overlay;
}
