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
import { initWarzoneGlobe } from "./warzone-globe.js";
import { initRegionSelector } from "./warzone-region-selector.js";
import {
    subscribeToLiveEvents,
    subscribeToSirenBroadcast,
} from "./warzone-realtime.js";
import { bindWarzoneUi } from "./warzone-ui.js";
import { initStratopsBilling } from "./warzone-billing.js";
import { isLayerEnabled } from "./warzone-layers.js";
import { initWarzoneAoiLens } from "./warzone-aoi-lens.js";
import { initWarzoneCaptureShot } from "./warzone-capture-shot.js";

const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "[::1]";

window.__stratopsConfig = {
    apiBase: isLocalDevHost ? "/api" : "https://api.battlespacex.com",
    supportApiBase: isLocalDevHost ? "/api" : "https://api.battlespacex.com",
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
    enableFocusedContextModels: isStratOpsFeatureEnabled("tracking.focusedContextModels"),
    autoTerrainOnAircraftFocus: false,
    focusedTerrainProvider: "arcgis",
    focusedTerrainArcGisUrl: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
    optimizeBackgroundOnAircraftFocus: true,
    enableMilSatsLayer: isStratOpsFeatureEnabled("system.milSatOrbit")
        && isStratOpsFeatureEnabled("tracking.strategicSatellites"),
    strategicSatellites: {
        enabled: isStratOpsFeatureEnabled("system.milSatOrbit")
            && isStratOpsFeatureEnabled("tracking.strategicSatellites"),
        apiPath: "/api/satellites/military",
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
async function warmupInitialTheater(viewer) {
    window.__wzKeepSiteLoaderVisible = true;
    window.__wzKeepSiteLoaderVisibleUntil = Date.now() + INITIAL_THEATER_WARMUP_KEEP_MS;
    window.SiteLoader?.start?.();
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
        window.__wzKeepSiteLoaderVisible = false;
        window.__wzKeepSiteLoaderVisibleUntil = 0;
        window.SiteLoader?.stop?.();
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

document.addEventListener("DOMContentLoaded", async () => {
    try {
        applyStratOpsFeatureVisibility();
        bindWarzoneUi();
        if (isStratOpsFeatureEnabled("system.authentication") || isStratOpsFeatureEnabled("header.login")) {
            initStratopsAuth();
        }
        if (isStratOpsFeatureEnabled("system.billing")) {
            initStratopsBilling();
        }

        let pendingRegionModal = null;
        window.__warzoneShowRegionModal = (instant = false) => {
            pendingRegionModal = { instant: !!instant };
        };

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });

        if (!isStratOpsFeatureEnabled("system.globe")) {
            window.SiteLoader?.forceHide?.();
            return;
        }

        let devPanelModulePromise = null;
        let startupMilSatsModulePromise = null;
        const loadDevPanelModule = () => {
            if (!devPanelModulePromise) {
                devPanelModulePromise = import("./warzone-dev-panel.js")
                    .catch((error) => {
                        console.warn("Dev panel failed to load:", error);
                        return null;
                    });
            }
            return devPanelModulePromise;
        };
        const loadStartupMilSatsModule = () => {
            if (!startupMilSatsModulePromise) {
                startupMilSatsModulePromise = import("./warzone-startup-mil-sats.js")
                    .catch((error) => {
                        console.warn("Startup mil-sat demo failed to load:", error);
                        return null;
                    });
            }
            return startupMilSatsModulePromise;
        };

        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;
        viewer?.__warzone?.setAdaptiveQualityProfile?.("safe");
        viewer?.__warzone?.setPerformanceMode?.(0);
        let started = false;
        window.SiteLoader?.forceHide?.();

        if (window.__stratopsConfig?.startupMilSatsDemo !== false) {
            setTimeout(async () => {
                const startupMilSatsModule = await loadStartupMilSatsModule();
                if (started) {
                    startupMilSatsModule?.setWarzoneStartupMilSatsDemoEnabled?.(false);
                    return;
                }
                startupMilSatsModule?.initWarzoneStartupMilSats?.(viewer);
                startupMilSatsModule?.setWarzoneStartupMilSatsDemoEnabled?.(true);
                try { window.refreshWarzoneMilSatsScale?.(); }
                catch { }
            }, 0);
        }

        if (isStratOpsFeatureEnabled("system.regionSelection") && isStratOpsFeatureEnabled("header.regionSelector")) {
            initRegionSelector(viewer);
        }
        if (pendingRegionModal) {
            const { instant } = pendingRegionModal;
            pendingRegionModal = null;
            window.__warzoneShowRegionModal?.(instant);
        }

        if (isStratOpsFeatureEnabled("system.intro")) {
            initStratopsIntro();
        }

        window.__warzoneStartDeferredApp = async () => {
            if (started) return;
            started = true;
            try {
                if (startupMilSatsModulePromise) {
                    const startupMilSatsModule = await loadStartupMilSatsModule();
                    startupMilSatsModule?.setWarzoneStartupMilSatsDemoEnabled?.(false);
                }
                viewer?.__warzone?.stopStartupRotation?.();
                viewer?.__warzone?.setAdaptiveQualityProfile?.(resolveStartupAdaptiveQualityProfile());
                viewer?.__warzone?.setPerformanceMode?.(0);
                if (isStratOpsFeatureEnabled("system.aoiLens") && isStratOpsFeatureEnabled("dock.aoiScan")) {
                    initWarzoneAoiLens(viewer);
                }
                if (isStratOpsFeatureEnabled("system.captureShot") && isStratOpsFeatureEnabled("header.captureShot")) {
                    initWarzoneCaptureShot(viewer);
                }
                const shouldLoadFullDevPanelAfterEntry = (
                    isLocalDevHost &&
                    isStratOpsFeatureEnabled("system.devPanel") &&
                    window.location.search.includes("devpanel=1")
                );
                if (shouldLoadFullDevPanelAfterEntry) {
                    const devPanelModule = await loadDevPanelModule();
                    devPanelModule?.initDevPanel?.();
                    devPanelModule?.showFullDevPanel?.();
                }
                await initWarzoneApp();

                // Install the lazy hook AFTER initWarzoneApp so entity clears don't wipe bases.
                // The large bases dataset is loaded only when the layer is enabled.
                if (isStratOpsFeatureEnabled("tracking.militaryBases") && isStratOpsFeatureEnabled("mapLayers.militaryBases")) {
                    installDeferredMilitaryBasesLayer(viewer);
                    window.__setWarzoneMilitaryBasesVisible?.(isLayerEnabled("military-bases"));
                }

                await warmupInitialTheater(viewer);

                if (isStratOpsFeatureEnabled("system.realtimeEvents")) {
                    await subscribeToLiveEvents();
                }
                if (isStratOpsFeatureEnabled("system.eventPolling")) {
                    startEventPollingFallback();
                }
                if (isStratOpsFeatureEnabled("alerts.sirenBroadcasts")) {
                    subscribeToSirenBroadcast();
                }
                if (isStratOpsFeatureEnabled("system.audio")) {
                    initAudio();
                }
                window.__warzoneEnterApp?.();

                // After app is fully running: globe rotation, delayed popups, nav button
                schedulePostEntryActions(viewer);
            } catch (error) {
                console.error("Deferred app init failed:", error);
            }
        };

    } catch (error) {
        console.error("App init failed:", error);
    }
});
