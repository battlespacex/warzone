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


const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "[::1]";

window.__stratopsConfig = {
    // Localhost uses a same-origin cached proxy for live aircraft polling so
    // we keep the old smooth movement path without direct third-party CORS calls.
    enablePublicAirFallback: true,
    allowLocalhostPublicAirFallback: true,
    useAircraftBillboards: true,
    useNavalBillboards: true,
    aircraftVisualPolicy: {
        // PNG default, model only when focused/close detail, char fallback for heavy counts
        modelZoomHeight: 280000,
        modelMaxActive: 16,
        charFallbackCount: 90,
        zoomModel: true,
    },
    navalVisualPolicy: {
        modelZoomHeight: 280000,
        modelMaxActive: 14,
        charFallbackCount: 80,
        zoomModel: true,
    },
    enableMilSatsLayer: true,
    milSatsRotation: false, 
    milSatsRotationSpeed: 5, 
};

initBoot();

document.addEventListener("DOMContentLoaded", async () => {
    try {
        bindWarzoneUi();
        initStratopsAuth();

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
