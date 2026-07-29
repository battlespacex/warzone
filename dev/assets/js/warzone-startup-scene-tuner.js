import * as Cesium from "cesium";

const STARTUP_SCENE_CSS_FIELDS = [
    { key: "lon", cssVar: "--warzone-start-lon", min: -180, max: 180, step: 0.1, fallback: 40 },
    { key: "lat", cssVar: "--warzone-start-lat", min: -85, max: 85, step: 0.1, fallback: 26 },
    { key: "height", cssVar: "--warzone-start-height", min: 2000000, max: 15000000, step: 50000, fallback: 9200000 },
    { key: "pitch", cssVar: "--warzone-start-pitch", min: -89, max: -20, step: 1, fallback: -90 },
    { key: "rotation-speed", cssVar: "--warzone-startup-rotation-speed", min: 0.05, max: 2, step: 0.01, fallback: 0.4 },
    { key: "sat-scale", cssVar: "--warzone-mil-sat-scale", min: 10000, max: 500000, step: 1000, fallback: 200000 },
    { key: "sat-min-px", cssVar: "--warzone-mil-sat-min-px", min: 1, max: 120, step: 1, fallback: 20 },
    { key: "sat-max-scale", cssVar: "--warzone-mil-sat-max-scale", min: 10000, max: 600000, step: 1000, fallback: 320000 },
];

const STARTUP_SCENE_CONFIG_FIELDS = [
    { key: "rotation-multiplier", path: "startupRotationMultiplier", min: 0.1, max: 4, step: 0.01, fallback: 1 },
    { key: "sat-rotation-speed", path: "milSatsRotationSpeed", min: 0, max: 20, step: 0.1, fallback: 5 },
];

function getRootCssNumber(name, fallback) {
    const value = Number(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    return Number.isFinite(value) ? value : fallback;
}

function formatValue(value, def = {}) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(def.fallback ?? 0);
    if (String(def.step || "").includes(".")) {
        const decimals = String(def.step).split(".")[1]?.length || 0;
        return num.toFixed(decimals);
    }
    return String(Math.round(num));
}

function buildStartupSceneBlock(prefix = "wz-intro-startup") {
    const lines = [":root {"];
    STARTUP_SCENE_CSS_FIELDS.forEach((def) => {
        const value = document.getElementById(`${prefix}-${def.key}-input`)?.value;
        lines.push(`    ${def.cssVar}: ${formatValue(value, def)};`);
    });
    lines.push("}");
    lines.push("");
    STARTUP_SCENE_CONFIG_FIELDS.forEach((def) => {
        const value = document.getElementById(`${prefix}-${def.key}-input`)?.value;
        lines.push(`${def.path}: ${formatValue(value, def)},`);
    });
    return lines.join("\n");
}

function applyStartupSceneCamera() {
    const viewer = window.__warzoneViewer;
    if (!viewer?.camera) return;
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            getRootCssNumber("--warzone-start-lon", 40),
            getRootCssNumber("--warzone-start-lat", 26),
            getRootCssNumber("--warzone-start-height", 9200000)
        ),
        orientation: {
            heading: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-heading", 0)),
            pitch: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-pitch", -90)),
            roll: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-roll", 0)),
        },
    });
    viewer.scene?.requestRender?.();
}

function refreshStartupScenePreview() {
    const viewer = window.__warzoneViewer;
    if (viewer?.__warzoneStartupRotation) {
        const base = getRootCssNumber("--warzone-startup-rotation-speed", 0.4);
        const multiplier = Math.max(0.1, Math.min(Number(window.__stratopsConfig?.startupRotationMultiplier || 1), 4));
        viewer.__warzoneStartupRotation.speedDeg = Math.max(0.01, Math.min(base * multiplier, 0.5));
    }
    window.refreshWarzoneMilSatsScale?.();
    applyStartupSceneCamera();
}

export function initIntroStartupSceneTuner() {
    const prefix = "wz-intro-startup";
    const tunerRoot = document.getElementById("wz-intro-startup-scene-tuner");
    if (!tunerRoot || tunerRoot.dataset.bound === "1") return;
    tunerRoot.dataset.bound = "1";

    const root = document.documentElement;
    const output = document.getElementById("wz-intro-startup-scene-output");
    const controls = new Map();

    const updateOutput = () => {
        if (output) output.value = buildStartupSceneBlock(prefix);
    };

    const applyCssValue = (def, nextValue, source = "") => {
        const entry = controls.get(def.key);
        if (!entry) return;
        const formatted = formatValue(nextValue, def);
        if (source !== "range") entry.range.value = formatted;
        if (source !== "input") entry.input.value = formatted;
        root.style.setProperty(def.cssVar, formatted);
        updateOutput();
        refreshStartupScenePreview();
    };

    const applyConfigValue = (def, nextValue, source = "") => {
        const entry = controls.get(def.key);
        if (!entry) return;
        const formatted = formatValue(nextValue, def);
        if (source !== "range") entry.range.value = formatted;
        if (source !== "input") entry.input.value = formatted;
        window.__stratopsConfig = window.__stratopsConfig || {};
        window.__stratopsConfig[def.path] = Number(formatted);
        updateOutput();
        refreshStartupScenePreview();
    };

    const loadCurrentValues = () => {
        STARTUP_SCENE_CSS_FIELDS.forEach((def) => {
            applyCssValue(def, getRootCssNumber(def.cssVar, def.fallback));
        });
        STARTUP_SCENE_CONFIG_FIELDS.forEach((def) => {
            const current = Number(window.__stratopsConfig?.[def.path]);
            applyConfigValue(def, Number.isFinite(current) ? current : def.fallback);
        });
        updateOutput();
    };

    STARTUP_SCENE_CSS_FIELDS.forEach((def) => {
        const range = document.getElementById(`${prefix}-${def.key}-range`);
        const input = document.getElementById(`${prefix}-${def.key}-input`);
        if (!range || !input) return;
        controls.set(def.key, { range, input });
        range.addEventListener("input", () => applyCssValue(def, range.value, "range"));
        input.addEventListener("input", () => applyCssValue(def, input.value, "input"));
        input.addEventListener("change", () => applyCssValue(def, input.value, "input"));
    });

    STARTUP_SCENE_CONFIG_FIELDS.forEach((def) => {
        const range = document.getElementById(`${prefix}-${def.key}-range`);
        const input = document.getElementById(`${prefix}-${def.key}-input`);
        if (!range || !input) return;
        controls.set(def.key, { range, input });
        range.addEventListener("input", () => applyConfigValue(def, range.value, "range"));
        input.addEventListener("input", () => applyConfigValue(def, input.value, "input"));
        input.addEventListener("change", () => applyConfigValue(def, input.value, "input"));
    });

    document.getElementById("wz-intro-startup-scene-apply")?.addEventListener("click", refreshStartupScenePreview);
    document.getElementById("wz-intro-startup-scene-load-current")?.addEventListener("click", loadCurrentValues);
    document.getElementById("wz-intro-startup-scene-copy")?.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(output?.value || buildStartupSceneBlock(prefix));
        } catch {
            // no-op
        }
    });

    document.getElementById("wz-intro-startup-tuner-slot")?.removeAttribute("hidden");
    loadCurrentValues();
}
