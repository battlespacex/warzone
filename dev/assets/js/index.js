// File Path: /assets/js/index.js
import "../css/style.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./warzone-boot.js";
import {
    initBoot, initWarzoneApp, initAudio, startEventPollingFallback,
    initStratopsIntro, initStratopsAuth, schedulePostEntryActions
} from "./essential.js";
import { initWarzoneMilitaryBases, setWarzoneMilitaryBasesVisible } from "./warzone-military-bases.js";
import { initWarzoneGlobe } from "./warzone-globe.js";
import { initRegionSelector } from "./warzone-region-selector.js";
import {
    subscribeToLiveEvents,
    subscribeToSirenBroadcast,
} from "./warzone-realtime.js";
import { initDevPanel } from "./warzone-dev-panel.js";
import { bindWarzoneUi } from "./warzone-ui.js";
import { initWarzoneMilSats } from "./warzone-mil-sats.js";
import { initStratopsBilling } from "./warzone-billing.js";


const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]";

window.__stratopsConfig = {
    enableIntelWireMedia: true,
    // Localhost uses a same-origin cached proxy for live aircraft polling so
    // we keep the old smooth movement path without direct third-party CORS calls.
    enablePublicAirFallback: true,
    allowLocalhostPublicAirFallback: true,
    enableHighValueAssetDetection: false,
    useAircraftBillboards: true,
    useNavalBillboards: true,
    aircraftVisualPolicy: {
        // PNG default, model only when focused/close detail, char fallback for heavy counts
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
    autoContourOnAircraftFocus: true,
    enableFocusedContextModels: false,
    autoTerrainOnAircraftFocus: false,
    focusedTerrainProvider: "arcgis",
    focusedTerrainArcGisUrl: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
    enableMilSatsLayer: true,
    milSatsRotation: false, 
    milSatsRotationSpeed: 5, 
    billing: {
        enabled: isLocalDevHost,
    },
};

const INITIAL_THEATER_WARMUP_TIMEOUT_MS = 1400;
const INITIAL_THEATER_WARMUP_KEEP_MS = 5000;
const INITIAL_THEATER_CRITICAL_ASSETS = Object.freeze([
    "/assets/images/live/live-aircraft-bb-1.png",
    "/assets/images/live/live-aircraft-bb-2.png",
    "/assets/images/live/live-aircraft-ff-5.png",
    "/assets/images/live/live-aircraft-rr-1.png",
    "/assets/images/live/live-aircraft-tn-1.png",
    "/assets/images/live/live-aircraft-tp-2.png",
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
    "/assets/images/live/live-aircraft-aw-1.png",
    "/assets/images/live/live-aircraft-aw-2.png",
    "/assets/images/live/live-aircraft-dd-1.png",
    "/assets/images/live/live-aircraft-ff-1.png",
    "/assets/images/live/live-aircraft-ff-2.png",
    "/assets/images/live/live-aircraft-ff-3.png",
    "/assets/images/live/live-aircraft-ff-4.png",
    "/assets/images/live/live-aircraft-hh-1.png",
    "/assets/images/live/live-aircraft-hh-2.png",
    "/assets/images/live/live-aircraft-tp-1.png",
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
async function warmupInitialTheater(viewer) {
    window.__wzKeepSiteLoaderVisible = true;
    window.__wzKeepSiteLoaderVisibleUntil = Date.now() + INITIAL_THEATER_WARMUP_KEEP_MS;
    window.SiteLoader?.start?.();
    try {
        viewer?.scene?.requestRender?.();
        await Promise.race([
            Promise.allSettled(INITIAL_THEATER_CRITICAL_ASSETS.map(preloadStaticAsset)),
            wait(INITIAL_THEATER_WARMUP_TIMEOUT_MS),
        ]);
        viewer?.scene?.requestRender?.();
        await nextFrame();
        await nextFrame();
    } finally {
        window.__wzKeepSiteLoaderVisible = false;
        window.__wzKeepSiteLoaderVisibleUntil = 0;
        window.SiteLoader?.stop?.();
    }
    window.setTimeout(() => {
        INITIAL_THEATER_BACKGROUND_ASSETS.forEach((url) => {
            preloadStaticAsset(url);
        });
    }, 250);
}

initBoot();

document.addEventListener("DOMContentLoaded", async () => {
    try {
        bindWarzoneUi();
        initStratopsAuth();
        initStratopsBilling();

        let pendingRegionModal = null;
        window.__warzoneShowRegionModal = (instant = false) => {
            pendingRegionModal = { instant: !!instant };
        };

        initStratopsIntro();

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });

        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;

        if (window.__stratopsConfig?.enableMilSatsLayer !== false) {
            initWarzoneMilSats(viewer);
        }
        initRegionSelector(viewer);
        if (pendingRegionModal) {
            const { instant } = pendingRegionModal;
            pendingRegionModal = null;
            window.__warzoneShowRegionModal?.(instant);
        }

        if (window.__stratopsConfig?.enableMilSatsLayer !== false) {
            setTimeout(() => {
                try { window.refreshWarzoneMilSatsScale?.(); }
                catch { }
            }, 150);
        }

        let started = false;
        window.__warzoneStartDeferredApp = async () => {
            if (started) return;
            started = true;
            try {
                initDevPanel();
                await initWarzoneApp();

                // Init bases AFTER initWarzoneApp so entity clears don't wipe them
                initWarzoneMilitaryBases(viewer);
                window.__setWarzoneMilitaryBasesVisible = setWarzoneMilitaryBasesVisible;

                await warmupInitialTheater(viewer);

                await subscribeToLiveEvents();
                startEventPollingFallback();
                subscribeToSirenBroadcast();
                initAudio();
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
