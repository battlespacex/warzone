import "../css/style.css";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { initBoot, initWarzoneApp } from "./essential.js";
import { initWarzoneGlobe } from "./warzone-globe.js";
import { subscribeToLiveEvents } from "./warzone-realtime.js";
import { bindWarzoneUi } from "./warzone-ui.js";
import { bindMissileDemoButton } from "./warzone-demo.js";

initBoot();

document.addEventListener("DOMContentLoaded", async () => {
    try {

        bindWarzoneUi();
        bindMissileDemoButton();

        const viewer = await initWarzoneGlobe();
        window.__warzoneViewer = viewer;

        await initWarzoneApp();
        await subscribeToLiveEvents();

    } catch (error) {
        console.error("App init failed:", error);
    }
});