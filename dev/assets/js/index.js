// File Path: /assets/js/index.js
import "../css/style.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
    applyStratOpsFeatureVisibility,
    isStratOpsFeatureEnabled,
} from "./stratops-feature-config.js";
import "./warzone-boot.js";
import {
    initBoot, initWarzoneApp, initAudio, startEventPollingFallback,
    initStratopsIntro, initStratopsAuth, schedulePostEntryActions
} from "./essential.js";
import {
    applyCountryBorderLayerVisibility,
    getActiveRegion,
    getStartupRegionJourneyCamera,
    initRegionSelector,
    playStartupRegionJourney,
    prepareStartupRegionJourney,
    waitForStartupRegionJourneyStart,
} from "./warzone-region-selector.js";
import { initStratopsBilling } from "./warzone-billing.js";
import { isLayerEnabled } from "./warzone-layers.js";
import { initStartupBackground } from "./warzone-startup-background.js";

const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "[::1]";
const STRATOPS_API_BASE = isLocalDevHost ? "/api" : "https://api.battlespacex.com";

window.__stratopsConfig = {
    apiBase: STRATOPS_API_BASE,
    supportApiBase: STRATOPS_API_BASE,
    enableIntelWireMedia: isStratOpsFeatureEnabled("system.intelWireMedia"),
    // Localhost uses a same-origin cached proxy for live aircraft polling so
    // we keep the old smooth movement path without direct third-party CORS calls.
    enablePublicAirFallback: isStratOpsFeatureEnabled("tracking.publicAircraftFallback"),
    allowLocalhostPublicAirFallback: true,
    enableHighValueAssetDetection: false && isStratOpsFeatureEnabled("tracking.highValueAssetDetection"),
    useAircraftBillboards: true,
    useNavalBillboards: true,
    aircraftVisualPolicy: {
        // Use PNG aircraft assets in overview; keep GLB for the selected/focused aircraft.
        defaultMode: "img",
        focusedMode: "model",
        modelZoomHeight: 280000,
        modelMaxActive: 6,
        charFallbackCount: 90,
        zoomModel: false,
    },
    navalVisualPolicy: {
        modelZoomHeight: 280000,
        modelMaxActive: 14,
        charFallbackCount: 80,
        zoomModel: false,
    },
    autoContourOnAircraftFocus: false,
    enableFocusedContextModels: false,
    autoTerrainOnAircraftFocus: false,
    focusedTerrainProvider: "arcgis",
    focusedTerrainArcGisUrl: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
    optimizeBackgroundOnAircraftFocus: true,
    enableMilSatsLayer: isStratOpsFeatureEnabled("system.milSatOrbit")
        && isStratOpsFeatureEnabled("tracking.strategicSatellites"),
    strategicSatellites: {
        enabled: isStratOpsFeatureEnabled("system.milSatOrbit")
            && isStratOpsFeatureEnabled("tracking.strategicSatellites"),
        apiPath: `${STRATOPS_API_BASE}/satellites/military`,
        maximumVisibleSatellites: 160,
        sampleIntervalSeconds: 120,
        pastOrbitMinutes: 45,
        futureOrbitMinutes: 60,
        positionRefreshIntervalMs: 30000,
        focusedModelCount: 1,
        showOrbitPath: true,
        showGroundTrack: true,
        showNadirLine: true,
        showTheoreticalFootprint: true,
        showLabels: false,
        minimumClassificationConfidence: "unconfirmed",
    },
    milSatsRotation: true,
    milSatsRotationSpeed: 5, 
    startupMilSatsDemo: true,
    billing: {
        enabled: false,
    },
};

const INITIAL_THEATER_WARMUP_TIMEOUT_MS = 1400;
const INITIAL_THEATER_WARMUP_KEEP_MS = 5000;
const OPERATIONAL_SCENE_READY_BUDGET_MS = 2800;
const OPERATIONAL_LOADER_ENTRY_DELAY_MS = 600;
const OPERATIONAL_LOADER_FADE_IN_MS = 600;
const INITIAL_THEATER_CRITICAL_ASSETS = Object.freeze([
    "/assets/images/bases/airbase-1.png",
    "/assets/images/bases/naval-1.png",
    "/assets/images/bases/radar-1.png",
    "/assets/images/bases/missile-1.png",
    "/assets/images/models/air/Bomber-B2.glb",
    "/assets/images/models/air/Bomber-B1.glb",
    "/assets/images/models/air/Bomber-B52.glb",
    "/assets/images/models/air/Fighter-F35.glb",
    "/assets/images/models/air/AWACS-E3.glb",
    "/assets/images/models/air/Tanker-KC135.glb",
    "/assets/images/models/air/ISR-P8.glb",
]);
const INITIAL_THEATER_BACKGROUND_ASSETS = Object.freeze([
    "/assets/images/models/air/Fighter-F16.glb",
    "/assets/images/models/air/Fighter-F22.glb",
    "/assets/images/models/air/Fighter-F15.glb",
    "/assets/images/models/air/Fighter-F18.glb",
    "/assets/images/models/air/Transport-C17.glb",
    "/assets/images/models/air/Transport-C130.glb",
    "/assets/images/models/air/Drone-MQ9.glb",
    "/assets/images/models/air/Drone-Globalhawk.glb",
    "/assets/images/models/air/Heli-KA50.glb",
    "/assets/images/models/air/Heli-CH53.glb",
]);

function wait(ms = 0) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function preloadImageAsset(url = "") {
    return new Promise((resolve) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = resolve;
        img.onerror = resolve;
        img.src = url;
        if (img.complete) resolve();
    });
}
function preloadStaticAsset(url = "") {
    const assetUrl = String(url || "").trim();
    if (!assetUrl) return Promise.resolve();
    if (/\.(png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(assetUrl)) {
        return preloadImageAsset(assetUrl);
    }
    return fetch(assetUrl, { cache: "force-cache" }).catch(() => null);
}
function installDeferredMilitaryBasesLayer(viewer) {
    let basesModulePromise = null;
    let basesModule = null;
    let initialized = false;
    let requestedVisible = false;

    const loadBasesModule = () => {
        if (!basesModulePromise) {
            basesModulePromise = import("./warzone-military-bases.js")
                .then((module) => {
                    basesModule = module;
                    if (!initialized) {
                        initialized = true;
                        module.initWarzoneMilitaryBases?.(viewer);
                    }
                    module.setWarzoneMilitaryBasesVisible?.(requestedVisible);
                    return module;
                })
                .catch((error) => {
                    basesModulePromise = null;
                    console.warn("Military bases layer failed to load:", error);
                    return null;
                });
        }
        return basesModulePromise;
    };

    window.__setWarzoneMilitaryBasesVisible = (visible) => {
        requestedVisible = Boolean(visible);
        if (basesModule) {
            basesModule.setWarzoneMilitaryBasesVisible?.(requestedVisible);
            return;
        }
        if (requestedVisible) {
            loadBasesModule();
        }
    };
}
async function warmupInitialTheater(viewer, options = {}) {
    const showLoader = options?.showLoader !== false;
    if (showLoader) {
        window.__wzKeepSiteLoaderVisible = true;
        window.__wzKeepSiteLoaderVisibleUntil = Date.now() + INITIAL_THEATER_WARMUP_KEEP_MS;
        window.SiteLoader?.start?.();
    }
    try {
        viewer?.scene?.requestRender?.();
        const criticalImages = INITIAL_THEATER_CRITICAL_ASSETS.filter((url) => /\.(png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(url));
        const criticalModels = INITIAL_THEATER_CRITICAL_ASSETS.filter((url) => !criticalImages.includes(url));
        await Promise.race([
            Promise.allSettled(criticalImages.map(preloadStaticAsset)),
            wait(INITIAL_THEATER_WARMUP_TIMEOUT_MS),
        ]);
        viewer?.scene?.requestRender?.();
        await nextFrame();
        await nextFrame();
        window.setTimeout(() => {
            criticalModels.forEach((url) => {
                preloadStaticAsset(url);
            });
        }, 8000);
    } finally {
        if (showLoader) {
            window.__wzKeepSiteLoaderVisible = false;
            window.__wzKeepSiteLoaderVisibleUntil = 0;
            window.SiteLoader?.stop?.();
        }
    }
    window.setTimeout(() => {
        INITIAL_THEATER_BACKGROUND_ASSETS.forEach((url) => {
            preloadStaticAsset(url);
        });
    }, 15000);
}

initBoot();

function resolveStartupAdaptiveQualityProfile() {
    const memoryGb = Number(navigator?.deviceMemory);
    const threads = Number(navigator?.hardwareConcurrency);
    if (
        (Number.isFinite(memoryGb) && memoryGb <= 4) ||
        (Number.isFinite(threads) && threads <= 4)
    ) {
        return "safe";
    }
    if (
        (Number.isFinite(memoryGb) && memoryGb <= 8) ||
        (Number.isFinite(threads) && threads <= 8)
    ) {
        return "balanced";
    }
    return "normal";
}

function waitForOperationalPostRender(viewer, timeoutMs = 1000) {
    const scene = viewer?.scene;
    if (!scene?.postRender) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        let removeListener = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (typeof removeListener === "function") removeListener();
            resolve();
        };
        removeListener = scene.postRender.addEventListener(finish);
        window.setTimeout(finish, timeoutMs);
        scene.requestRender?.();
    });
}

function waitForOperationalTiles(viewer, timeoutMs = 2200) {
    const globe = viewer?.scene?.globe;
    const progressEvent = globe?.tileLoadProgressEvent;
    if (!globe || globe.tilesLoaded || !progressEvent?.addEventListener) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        let removeListener = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (typeof removeListener === "function") removeListener();
            resolve();
        };
        const check = (pendingCount) => {
            if (Number(pendingCount) === 0 || globe.tilesLoaded) finish();
        };
        removeListener = progressEvent.addEventListener(check);
        window.setTimeout(finish, timeoutMs);
        viewer.scene?.requestRender?.();
    });
}

async function waitForOperationalScene(viewer) {
    await Promise.race([
        Promise.allSettled([
            Promise.resolve(viewer?.__warzoneImageryReadyPromise),
            waitForOperationalTiles(viewer),
            waitForOperationalPostRender(viewer),
        ]),
        wait(OPERATIONAL_SCENE_READY_BUDGET_MS),
    ]);
}

async function fadeOperationalEntryIntoApp() {
    document.body.classList.add("is-entry-exiting");
    try {
        await Promise.all([
            window.SiteLoader?.fadeIntoApp?.() || Promise.resolve(),
            window.__warzoneReleaseStartupBackground?.() || Promise.resolve(),
        ]);
    } finally {
        document.body.classList.remove("is-entry-exiting");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        initStartupBackground();
        applyStratOpsFeatureVisibility();
        if (isStratOpsFeatureEnabled("system.authentication") || isStratOpsFeatureEnabled("header.login")) {
            initStratopsAuth();
        }
        if (isStratOpsFeatureEnabled("system.billing")) {
            initStratopsBilling();
        }

        // Region storage and the startup selector are available without a Cesium viewer.
        initRegionSelector(null);

        let operationalBootPromise = null;
        let operationalBootCancelled = false;
        window.__warzoneStartDeferredApp = () => {
            if (operationalBootPromise) return operationalBootPromise;
            operationalBootPromise = (async () => {
                if (!isStratOpsFeatureEnabled("system.globe")) {
                    throw new Error("The operational globe feature is disabled");
                }

                document.body.classList.add("is-operational-booting", "is-dashboard-booting");
                window.__wzKeepSiteLoaderVisible = true;
                window.__wzKeepSiteLoaderVisibleUntil = Date.now() + 45000;
                const loaderRevealPromise = (async () => {
                    await wait(OPERATIONAL_LOADER_ENTRY_DELAY_MS);
                    if (operationalBootCancelled) return;
                    window.SiteLoader?.start?.();
                    await wait(OPERATIONAL_LOADER_FADE_IN_MS);
                })();

                const [
                    globeModule,
                    uiModule,
                    aoiModule,
                    captureModule,
                    realtimeModule,
                ] = await Promise.all([
                    import("./warzone-globe.js"),
                    import("./warzone-ui.js"),
                    import("./warzone-aoi-lens.js"),
                    import("./warzone-capture-shot.js"),
                    import("./warzone-realtime.js"),
                ]);

                const selectedRegion = getActiveRegion();
                const viewer = await globeModule.initWarzoneGlobe({
                    startStartupRotation: false,
                    initialCamera: getStartupRegionJourneyCamera(selectedRegion),
                });
                if (!viewer) throw new Error("Cesium viewer initialization failed");
                window.__warzoneViewer = viewer;
                viewer.__warzone?.setAdaptiveQualityProfile?.(resolveStartupAdaptiveQualityProfile());
                viewer.__warzone?.setPerformanceMode?.(0);
                // Begin scene readiness immediately so tile and imagery work overlaps
                // application/data initialization instead of extending the black loader.
                const operationalSceneReadyPromise = waitForOperationalScene(viewer);

                initRegionSelector(viewer, { applyLandingCamera: false });
                prepareStartupRegionJourney(viewer, selectedRegion);
                // Keep the initialized globe alive behind the entry video and loader.
                // The finite region journey stops this existing post-render rotation
                // before it takes ownership of the camera.
                viewer.__warzone?.startStartupRotation?.();
                uiModule.bindWarzoneUi();

                applyCountryBorderLayerVisibility(viewer, { animate: true, duration: 780 });

                if (isStratOpsFeatureEnabled("system.aoiLens") && isStratOpsFeatureEnabled("dock.aoiScan")) {
                    aoiModule.initWarzoneAoiLens(viewer);
                }
                if (isStratOpsFeatureEnabled("system.captureShot") && isStratOpsFeatureEnabled("header.captureShot")) {
                    captureModule.initWarzoneCaptureShot(viewer);
                }
                await initWarzoneApp();

                // Install the lazy hook AFTER initWarzoneApp so entity clears don't wipe bases.
                // The large bases dataset is loaded only when the layer is enabled.
                if (isStratOpsFeatureEnabled("tracking.militaryBases") && isStratOpsFeatureEnabled("mapLayers.militaryBases")) {
                    installDeferredMilitaryBasesLayer(viewer);
                    window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
                }

                const theaterWarmupPromise = warmupInitialTheater(viewer, { showLoader: false });

                if (isStratOpsFeatureEnabled("system.realtimeEvents")) {
                    void realtimeModule.subscribeToLiveEvents().catch((error) => {
                        console.warn("Realtime events subscription failed:", error);
                    });
                }
                if (isStratOpsFeatureEnabled("system.eventPolling")) {
                    startEventPollingFallback();
                }
                if (isStratOpsFeatureEnabled("alerts.sirenBroadcasts")) {
                    realtimeModule.subscribeToSirenBroadcast();
                }
                if (isStratOpsFeatureEnabled("system.audio")) {
                    initAudio();
                }

                await Promise.all([
                    operationalSceneReadyPromise,
                    theaterWarmupPromise,
                    loaderRevealPromise,
                ]);
                window.__warzonePrepareDashboardIntro?.();
                const introFlightPromise = selectedRegion
                    ? playStartupRegionJourney(viewer, selectedRegion)
                    : Promise.resolve(false);
                await waitForStartupRegionJourneyStart();
                await wait(280);
                window.__wzKeepSiteLoaderVisible = false;
                window.__wzKeepSiteLoaderVisibleUntil = 0;
                await nextFrame();
                await Promise.all([
                    introFlightPromise,
                    fadeOperationalEntryIntoApp(),
                ]);
                await window.__warzoneRevealDashboard?.();

                // Existing operational post-entry systems continue from the READY boundary.
                schedulePostEntryActions(viewer);
                return viewer;
            })().catch((error) => {
                operationalBootCancelled = true;
                window.__wzKeepSiteLoaderVisible = false;
                window.__wzKeepSiteLoaderVisibleUntil = 0;
                window.SiteLoader?.forceHide?.();
                window.__warzoneCancelDashboardIntro?.();
                window.__warzoneRestoreStartupBackground?.();
                console.error("Deferred app init failed:", error);
                throw error;
            });
            return operationalBootPromise;
        };

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });

        window.SiteLoader?.forceHide?.();

        if (isStratOpsFeatureEnabled("system.intro")) {
            initStratopsIntro();
        } else {
            window.__warzoneShowRegionModal?.();
        }

    } catch (error) {
        console.error("App init failed:", error);
    }
});
