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
    subscribeToActiveAlerts,
    startActiveAlertsPollingFallback,
    subscribeToSirenBroadcast,
} from "./warzone-realtime.js";
import { initDevPanel } from "./warzone-dev-panel.js";
import { bindWarzoneUi } from "./warzone-ui.js";
import { initWarzoneMilSats } from "./warzone-mil-sats.js";


window.__stratopsConfig = {
    milSatsRotation: false, 
    milSatsRotationSpeed: 5, 
};

initBoot();

document.addEventListener("DOMContentLoaded", async () => {
    try {
        bindWarzoneUi();

        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;

        initWarzoneMilSats(viewer);
        initRegionSelector(viewer);

        setTimeout(() => {
            try { window.refreshWarzoneMilSatsScale?.(); }
            catch (e) { console.warn("[warzone-mil-sats] scale refresh failed:", e); }
        }, 150);

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
                await subscribeToActiveAlerts();
                startActiveAlertsPollingFallback();
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

        // Wire login modal events (X button, submit, etc.)
        initStratopsAuth();

        // Show intro modal with disclaimer checkbox — no auth check needed to enter
        initStratopsIntro();

    } catch (error) {
        console.error("App init failed:", error);
    }
});
