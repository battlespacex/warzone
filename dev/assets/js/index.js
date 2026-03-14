// assets/js/index.js
import "../css/style.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./warzone-boot.js";

import { initBoot, initWarzoneApp } from "./essential.js";
import { initWarzoneGlobe } from "./warzone-globe.js";
import {
    subscribeToLiveEvents, subscribeToActiveAlerts,
    startActiveAlertsPollingFallback
} from "./warzone-realtime.js";
import { bindWarzoneUi } from "./warzone-ui.js";
import { initDevPanel } from "./warzone-dev-panel.js";

initBoot();

document.addEventListener("DOMContentLoaded", async () => {
    try {
        bindWarzoneUi();
        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;
        initDevPanel();
        await initWarzoneApp();
        await subscribeToLiveEvents();
        await subscribeToActiveAlerts();
        startActiveAlertsPollingFallback();
    } catch (error) {
        console.error("App init failed:", error);
    }
});