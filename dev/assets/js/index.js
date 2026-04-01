// File Path: /assets/js/index.js
import "../css/style.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./warzone-boot.js";
import { initBoot, initWarzoneApp, initAudio, startEventPollingFallback } from "./essential.js";
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
initBoot();
document.addEventListener("DOMContentLoaded", async () => {
    try {
        bindWarzoneUi();
        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;
        initWarzoneMilSats(viewer);
        initRegionSelector(viewer);
        setTimeout(() => {
            try {
                window.refreshWarzoneMilSatsScale?.();
            } catch (error) {
                console.warn("[warzone-mil-sats] scale refresh failed:", error);
            }
        }, 150);
        let started = false;
        window.__warzoneStartDeferredApp = async () => {
            if (started) return;
            started = true;
            try {
                initDevPanel();
                await initWarzoneApp();
                await subscribeToLiveEvents();
                await subscribeToActiveAlerts();
                startActiveAlertsPollingFallback();
                startEventPollingFallback();
                subscribeToSirenBroadcast();
                initAudio();
            } catch (error) {
                console.error("Deferred app init failed:", error);
            }
        };
    } catch (error) {
        console.error("App init failed:", error);
    }
});
