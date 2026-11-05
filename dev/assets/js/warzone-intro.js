import "../css/root.css";
import "../css/warzone-map.css";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { initWarzoneIntroGlobe } from "./warzone-globe.js";
import { initWarzoneStartupDemoAssets, setWarzoneStartupDemoAssetsEnabled } from "./warzone-startup-demo-assets.js";
import { initWarzoneStartupMilSats, setWarzoneStartupMilSatsDemoEnabled } from "./warzone-startup-mil-sats.js";
import { initIntroStartupSceneTuner, destroyIntroStartupSceneTuner } from "./warzone-startup-scene-tuner.js";
import { initIntroGnssCoverage, destroyIntroGnssCoverage } from "./warzone-intro-gnss.js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
let viewer = null;
let cleanedUp = false;
let tunerPanel = null;
let tunerStyle = null;

async function mountOriginalTuner() {
    const [panelResponse, stylesResponse] = await Promise.all([
        fetch("/partials/entry-scene-tuner.html", { cache: "no-store" }),
        fetch("/partials/pre-entry-showcase.html", { cache: "no-store" }),
    ]);
    if (!panelResponse.ok || !stylesResponse.ok) throw new Error("Original startup tuner partials are unavailable");
    const [panelHtml, stylesHtml] = await Promise.all([panelResponse.text(), stylesResponse.text()]);
    const panel = new DOMParser().parseFromString(panelHtml, "text/html").querySelector("#wz-intro-startup-scene-tuner");
    const originalStyles = new DOMParser().parseFromString(stylesHtml, "text/html").querySelector("style");
    if (!panel || !originalStyles) throw new Error("Original startup tuner markup or styles are missing");
    if (cleanedUp) return;
    const style = document.createElement("style");
    style.textContent = originalStyles.textContent;
    document.head.appendChild(style);
    tunerStyle = style;
    tunerPanel = document.importNode(panel, true);
    document.body.appendChild(tunerPanel);
}

function handleTunerShortcut(event) {
    if (event.key.toLowerCase() !== "t" || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const panel = document.getElementById("wz-intro-startup-scene-tuner");
    if (!panel) return;
    event.preventDefault();
    panel.hidden = !panel.hidden;
}

function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener("pagehide", cleanup);
    document.removeEventListener("keydown", handleTunerShortcut);
    destroyIntroStartupSceneTuner();
    tunerPanel?.remove();
    tunerStyle?.remove();
    tunerPanel = null;
    tunerStyle = null;
    setWarzoneStartupDemoAssetsEnabled(false);
    setWarzoneStartupMilSatsDemoEnabled(false);
    destroyIntroGnssCoverage();
    viewer?.__warzone?.stopStartupRotation?.();
    if (viewer && !viewer.isDestroyed()) viewer.destroy();
    window.__warzoneViewer = null;
    viewer = null;
    if (window.__warzoneIntroCleanup === cleanup) window.__warzoneIntroCleanup = null;
}

async function start() {
    if (!localHosts.has(window.location.hostname)) return;
    window.__stratopsConfig = {
        basemap: {
            provider: STRATOPS_BASEMAP_PROVIDER,
            enableGoogle: STRATOPS_ENABLE_GOOGLE_MAP === true,
            enableTactical: STRATOPS_ENABLE_TACTICAL_MAP === true,
            google: { apiKey: STRATOPS_GOOGLE_MAPS_API_KEY },
            selfhosted: { baseUrl: STRATOPS_MAP_BASE_URL },
            tactical: { baseUrl: STRATOPS_TACTICAL_MAP_BASE_URL },
        },
        terrain: {
            provider: STRATOPS_TERRAIN_PROVIDER,
            selfhosted: { baseUrl: STRATOPS_TERRAIN_BASE_URL },
        },
        milSatsRotation: true,
        milSatsRotationSpeed: 5,
    };

    viewer = initWarzoneIntroGlobe();
    if (!viewer) throw new Error("Startup Cesium globe container is unavailable");
    window.__warzoneViewer = viewer;

    await mountOriginalTuner();
    if (cleanedUp) return;
    const show = (name, fallback = 1) => {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const value = raw ? Number(raw) : fallback;
        return (Number.isFinite(value) ? value : fallback) !== 0;
    };
    await viewer.__warzone.setBorderLayersVisible(show("--wz-entry-show-borders", 0), { immediate: true });
    if (cleanedUp) return;
    initWarzoneStartupMilSats(viewer);
    initWarzoneStartupDemoAssets(viewer);
    initIntroGnssCoverage(viewer);
    initIntroStartupSceneTuner();
    viewer.__warzone.startStartupRotation();
    document.addEventListener("keydown", handleTunerShortcut);
    viewer.scene.requestRender();
}

window.__warzoneIntroCleanup?.();
window.__warzoneIntroCleanup = cleanup;
window.addEventListener("pagehide", cleanup, { once: true });
start().catch((error) => {
    console.error("Startup recording scene failed:", error);
    cleanup();
    const status = document.getElementById("intro-error");
    if (status) {
        status.textContent = error.message || "Startup scene failed";
        status.hidden = false;
    }
});
