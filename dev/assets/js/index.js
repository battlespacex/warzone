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
} from "./warzone-region-selector.js";
import { initStratopsBilling } from "./warzone-billing.js";
import { isLayerEnabled } from "./warzone-layers.js";
import { initStartupBackground } from "./warzone-startup-background.js";
import { initPosterGenerator } from "./poster-generator.js";

const isPosterGeneratorPage = document.documentElement.classList.contains("poster-generator-document");

const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "[::1]";
const STRATOPS_API_BASE = isLocalDevHost ? "/api" : "https://api.battlespacex.com";
const compiledTacticalMapBaseUrl = typeof STRATOPS_TACTICAL_MAP_BASE_URL === "undefined" ? "" : STRATOPS_TACTICAL_MAP_BASE_URL;
const localTacticalMapBaseUrl = "/assets/map/tactical/v1";

window.__stratopsConfig = {
    apiBase: STRATOPS_API_BASE,
    supportApiBase: STRATOPS_API_BASE,
    basemap: {
        provider: STRATOPS_BASEMAP_PROVIDER,
        enableGoogle: STRATOPS_ENABLE_GOOGLE_MAP === true,
        enableTactical: STRATOPS_ENABLE_TACTICAL_MAP === true,
        google: {
            apiKey: STRATOPS_GOOGLE_MAPS_API_KEY,
        },
        selfhosted: {
            baseUrl: STRATOPS_MAP_BASE_URL,
        },
        tactical: {
            baseUrl: compiledTacticalMapBaseUrl ||
                (isLocalDevHost ? localTacticalMapBaseUrl : ""),
        },
    },
    terrain: {
        provider: STRATOPS_TERRAIN_PROVIDER,
        selfhosted: { baseUrl: STRATOPS_TERRAIN_BASE_URL },
    },
    performance: {
        emptyGlobe: STRATOPS_PERF_EMPTY_GLOBE === true,
    },
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
const FIRST_USABLE_CANVAS_TIMEOUT_MS = 3000;
const FIRST_USABLE_FRAME_TIMEOUT_MS = 3000;
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

function markStartupPerformance(name) {
    if (!name || typeof performance?.mark !== "function") return;
    try {
        if (!performance.getEntriesByName(name, "mark").length) {
            performance.mark(name);
        }
    } catch { }
}

function measureStartupPerformance(name, startMark, endMark) {
    if (!name || typeof performance?.measure !== "function") return;
    try {
        performance.clearMeasures(name);
        performance.measure(name, startMark, endMark);
    } catch { }
}

function reportStartupPerformance() {
    if (!isLocalDevHost && window.__stratopsConfig?.startupPerformanceDebug !== true) return;
    const names = [
        "stratops-navigation-to-first-usable-map",
        "stratops-region-to-first-usable-map",
        "stratops-cesium-import",
        "stratops-operational-data",
        "stratops-events-render",
        "stratops-hotspots",
    ];
    const rows = names
        .map((name) => performance.getEntriesByName(name, "measure").at(-1))
        .filter(Boolean)
        .map((entry) => ({ stage: entry.name, milliseconds: Math.round(entry.duration) }));
    if (rows.length) console.table(rows);
}

if (!isPosterGeneratorPage) markStartupPerformance("stratops-navigation-start");

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
    document.addEventListener("wz:contour-layer-changed", (event) => {
        if (event?.detail?.visible === true) {
            void loadBasesModule();
        }
    });
    if (viewer.__contourLayerVisible === true) {
        void loadBasesModule();
    }
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

if (!isPosterGeneratorPage) initBoot();

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

function waitForOperationalPostRender(viewer, timeoutMs = FIRST_USABLE_FRAME_TIMEOUT_MS) {
    const scene = viewer?.scene;
    if (!scene?.postRender) return Promise.resolve(false);
    return new Promise((resolve) => {
        let settled = false;
        let removeListener = null;
        const finish = (rendered = false) => {
            if (settled) return;
            settled = true;
            if (typeof removeListener === "function") removeListener();
            if (rendered) markStartupPerformance("stratops-first-frame");
            resolve(rendered);
        };
        removeListener = scene.postRender.addEventListener(() => finish(true));
        window.setTimeout(() => {
            finish(Number(scene.frameState?.frameNumber || 0) > 0);
        }, timeoutMs);
        scene.requestRender?.();
    });
}

function hasValidOperationalCanvas(viewer) {
    const scene = viewer?.scene;
    const canvas = scene?.canvas || viewer?.canvas;
    if (!canvas) return false;
    const width = Number(scene?.drawingBufferWidth || canvas.width || canvas.clientWidth || 0);
    const height = Number(scene?.drawingBufferHeight || canvas.height || canvas.clientHeight || 0);
    return width > 0 && height > 0 && Number(canvas.clientWidth || width) > 0 && Number(canvas.clientHeight || height) > 0;
}

function waitForValidOperationalCanvas(viewer, timeoutMs = FIRST_USABLE_CANVAS_TIMEOUT_MS) {
    if (hasValidOperationalCanvas(viewer)) return Promise.resolve(true);
    return new Promise((resolve) => {
        let settled = false;
        let retryTimer = 0;
        const startedAt = performance.now();
        const finish = (ready) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(retryTimer);
            resolve(ready);
        };
        const check = () => {
            viewer?.resize?.();
            viewer?.scene?.requestRender?.();
            if (hasValidOperationalCanvas(viewer)) {
                finish(true);
                return;
            }
            if ((performance.now() - startedAt) >= timeoutMs) {
                finish(false);
                return;
            }
            retryTimer = window.setTimeout(check, 32);
        };
        check();
    });
}

async function waitForFirstUsableMap(viewer) {
    const canvasReady = await waitForValidOperationalCanvas(viewer);
    if (!canvasReady) throw new Error("Cesium canvas did not reach a valid drawable size");

    const imageryReady = await Promise.resolve(viewer?.__warzoneImageryReadyPromise);
    const imageryRequired = viewer?.__warzoneEntryMapImageryVisible !== false;
    if (imageryRequired && viewer?.__warzoneBasemapDeferred !== true &&
        (imageryReady !== true || !viewer?.__imageryBase || viewer.imageryLayers?.length < 1)) {
        throw new Error("Base imagery provider did not initialize");
    }

    const rendered = await waitForOperationalPostRender(viewer);
    if (!rendered) throw new Error("Cesium did not render a valid first frame");

    const controller = viewer?.scene?.screenSpaceCameraController;
    if (controller) controller.enableInputs = true;
    if (controller?.enableInputs === false) throw new Error("Cesium camera input could not be enabled");
    markStartupPerformance("stratops-camera-enabled");
    markStartupPerformance("stratops-first-usable-map");
    measureStartupPerformance(
        "stratops-navigation-to-first-usable-map",
        "stratops-navigation-start",
        "stratops-first-usable-map"
    );
    measureStartupPerformance(
        "stratops-region-to-first-usable-map",
        "stratops-region-confirmed",
        "stratops-first-usable-map"
    );
    return viewer;
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

async function initializeOperationalDataAfterMap(viewer) {
    markStartupPerformance("stratops-operational-data-start");
    try {
        const [uiModule, aoiModule, captureModule, realtimeModule] = await Promise.all([
            import("./warzone-ui.js"),
            import("./warzone-aoi-lens.js"),
            import("./warzone-capture-shot.js"),
            import("./warzone-realtime.js"),
        ]);

        uiModule.bindWarzoneUi();
        applyCountryBorderLayerVisibility(viewer, { animate: true, duration: 780 });

        if (isStratOpsFeatureEnabled("system.aoiLens") && isStratOpsFeatureEnabled("dock.aoiScan")) {
            aoiModule.initWarzoneAoiLens(viewer);
        }
        if (isStratOpsFeatureEnabled("system.captureShot") && isStratOpsFeatureEnabled("header.captureShot")) {
            captureModule.initWarzoneCaptureShot(viewer);
        }

        await initWarzoneApp();

        // Install the lazy hook after event initialization so entity clears cannot wipe bases.
        if (isStratOpsFeatureEnabled("tracking.militaryBases") && isStratOpsFeatureEnabled("mapLayers.militaryBases")) {
            installDeferredMilitaryBasesLayer(viewer);
            window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
        }

        void warmupInitialTheater(viewer, { showLoader: false }).catch((error) => {
            console.warn("Initial theater background warm-up failed:", error);
        });

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
    } finally {
        markStartupPerformance("stratops-operational-ready");
        measureStartupPerformance(
            "stratops-operational-data",
            "stratops-operational-data-start",
            "stratops-operational-ready"
        );
        reportStartupPerformance();
    }
}

function getEmptyGlobeDiagnosticOptions() {
    const enabled = window.__stratopsConfig?.performance?.emptyGlobe === true;
    if (!enabled) return { enabled: false };
    const params = new URLSearchParams(window.location.search);
    return {
        enabled: true,
        adaptiveQuality: params.get("perfAdaptive") !== "off",
        requestRenderMode: params.get("perfRender") !== "continuous",
    };
}

if (isPosterGeneratorPage) {
    document.addEventListener("DOMContentLoaded", () => {
        initPosterGenerator();
    }, { once: true });
} else document.addEventListener("DOMContentLoaded", async () => {
    try {
        if (window.__stratopsConfig.basemap.provider === "selfhosted") {
            const basemapCredit = document.getElementById("wz-basemap-provider-credit");
            if (basemapCredit) basemapCredit.textContent = "Built with CesiumJS, using self-hosted Natural Earth relief.";
        }
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
        let firstUsableMapReached = false;
        window.__warzoneStartDeferredApp = () => {
            if (operationalBootPromise) return operationalBootPromise;
            operationalBootPromise = (async () => {
                if (!isStratOpsFeatureEnabled("system.globe")) {
                    throw new Error("The operational globe feature is disabled");
                }

                markStartupPerformance("stratops-region-confirmed");
                document.body.classList.add("is-operational-booting", "is-dashboard-booting");
                window.__wzKeepSiteLoaderVisible = true;
                window.__wzKeepSiteLoaderVisibleUntil = Date.now() + 45000;
                void (async () => {
                    await wait(OPERATIONAL_LOADER_ENTRY_DELAY_MS);
                    if (operationalBootCancelled || firstUsableMapReached) return;
                    window.SiteLoader?.start?.();
                    await wait(OPERATIONAL_LOADER_FADE_IN_MS);
                })();

                markStartupPerformance("stratops-cesium-import-start");
                const globeModule = await import("./warzone-globe.js");
                markStartupPerformance("stratops-cesium-import-end");
                measureStartupPerformance(
                    "stratops-cesium-import",
                    "stratops-cesium-import-start",
                    "stratops-cesium-import-end"
                );

                const selectedRegion = getActiveRegion();
                const emptyGlobeDiagnostics = getEmptyGlobeDiagnosticOptions();
                const viewer = await globeModule.initWarzoneGlobe({
                    startStartupRotation: false,
                    initialCamera: getStartupRegionJourneyCamera(selectedRegion),
                    performanceEmptyGlobe: emptyGlobeDiagnostics,
                });
                if (!viewer) throw new Error("Cesium viewer initialization failed");
                window.__warzoneViewer = viewer;
                markStartupPerformance("stratops-viewer-created");
                if (emptyGlobeDiagnostics.adaptiveQuality !== false) {
                    viewer.__warzone?.setAdaptiveQualityProfile?.(resolveStartupAdaptiveQualityProfile());
                    viewer.__warzone?.setPerformanceMode?.(0);
                }
                if (emptyGlobeDiagnostics.requestRenderMode === false) {
                    viewer.scene.requestRenderMode = false;
                }

                if (!emptyGlobeDiagnostics.enabled) {
                    initRegionSelector(viewer, { applyLandingCamera: false });
                }
                window.__warzonePrepareDashboardIntro?.();
                if (selectedRegion) {
                    await playStartupRegionJourney(viewer, selectedRegion, { instant: true });
                } else {
                    viewer.__warzone?.stopStartupRotation?.();
                }
                await waitForFirstUsableMap(viewer);
                firstUsableMapReached = true;
                window.__wzKeepSiteLoaderVisible = false;
                window.__wzKeepSiteLoaderVisibleUntil = 0;
                window.__warzoneEnterApp?.();

                const entryFadePromise = fadeOperationalEntryIntoApp();
                const dashboardRevealPromise = Promise.resolve(window.__warzoneRevealDashboard?.())
                    .catch((error) => console.warn("Dashboard reveal failed:", error));
                const operationalDataPromise = emptyGlobeDiagnostics.enabled
                    ? Promise.resolve([])
                    : initializeOperationalDataAfterMap(viewer)
                        .catch((error) => {
                            console.error("Operational data initialization failed after first usable map:", error);
                            return [];
                        });
                window.__warzoneOperationalDataPromise = operationalDataPromise;
                window.__stratopsPerfEmptyGlobeReady = emptyGlobeDiagnostics.enabled;

                void Promise.allSettled([
                    entryFadePromise,
                    dashboardRevealPromise,
                    operationalDataPromise,
                ]).then(() => {
                    if (!emptyGlobeDiagnostics.enabled) schedulePostEntryActions(viewer);
                });
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
