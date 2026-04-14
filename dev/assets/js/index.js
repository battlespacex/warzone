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


window.__stratopsConfig = {
    enablePublicAirFallback: true,
    useAircraftBillboards: false,
    enableMilSatsLayer: false,
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
