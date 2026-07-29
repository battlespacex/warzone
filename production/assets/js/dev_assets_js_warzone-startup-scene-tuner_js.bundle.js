"use strict";
(self["webpackChunkwarzone_frontend"] = self["webpackChunkwarzone_frontend"] || []).push([["dev_assets_js_warzone-startup-scene-tuner_js"],{

/***/ "./dev/assets/js/warzone-startup-scene-tuner.js":
/*!******************************************************!*\
  !*** ./dev/assets/js/warzone-startup-scene-tuner.js ***!
  \******************************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   initStartupSceneTuner: function() { return /* binding */ initStartupSceneTuner; }
/* harmony export */ });
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/Cartesian3.js");
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/Math.js");

const CSS_FIELDS = [{
  key: "lon",
  cssVar: "--warzone-start-lon",
  fallback: 40,
  step: 0.1
}, {
  key: "lat",
  cssVar: "--warzone-start-lat",
  fallback: 26,
  step: 0.1
}, {
  key: "height",
  cssVar: "--warzone-start-height",
  fallback: 9200000,
  step: 50000
}, {
  key: "pitch",
  cssVar: "--warzone-start-pitch",
  fallback: -90,
  step: 1
}, {
  key: "rotation-speed",
  cssVar: "--warzone-startup-rotation-speed",
  fallback: 0.06,
  step: 0.01
}, {
  key: "sat-scale",
  cssVar: "--warzone-mil-sat-scale",
  fallback: 200000,
  step: 1000
}, {
  key: "sat-min-px",
  cssVar: "--warzone-mil-sat-min-px",
  fallback: 20,
  step: 1
}, {
  key: "sat-max-scale",
  cssVar: "--warzone-mil-sat-max-scale",
  fallback: 320000,
  step: 1000
}];
const CONFIG_FIELDS = [{
  key: "rotation-multiplier",
  path: "startupRotationMultiplier",
  fallback: 1.5,
  step: 0.01
}, {
  key: "sat-rotation-speed",
  path: "milSatsRotationSpeed",
  fallback: 5,
  step: 0.1
}];
function getCssNumber(name, fallback = 0) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}
function formatValue(value, step = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  if (!Number.isFinite(step) || step >= 1) return String(Math.round(num));
  const decimals = String(step).split(".")[1]?.length || 0;
  return num.toFixed(decimals);
}
function buildOutput(prefix = "wz-intro-startup") {
  const lines = [":root {"];
  CSS_FIELDS.forEach(def => {
    const value = document.getElementById(`${prefix}-${def.key}-input`)?.value;
    lines.push(`    ${def.cssVar}: ${formatValue(value, def.step)};`);
  });
  lines.push("}");
  lines.push("");
  CONFIG_FIELDS.forEach(def => {
    const value = document.getElementById(`${prefix}-${def.key}-input`)?.value;
    lines.push(`${def.path}: ${formatValue(value, def.step)},`);
  });
  return lines.join("\n");
}
function applyCamera() {
  const viewer = window.__warzoneViewer;
  if (!viewer?.camera) return;
  viewer.camera.setView({
    destination: cesium__WEBPACK_IMPORTED_MODULE_0__["default"].fromDegrees(getCssNumber("--warzone-start-lon", 40), getCssNumber("--warzone-start-lat", 26), getCssNumber("--warzone-start-height", 9200000)),
    orientation: {
      heading: cesium__WEBPACK_IMPORTED_MODULE_1__["default"].toRadians(getCssNumber("--warzone-start-heading", 0)),
      pitch: cesium__WEBPACK_IMPORTED_MODULE_1__["default"].toRadians(getCssNumber("--warzone-start-pitch", -90)),
      roll: cesium__WEBPACK_IMPORTED_MODULE_1__["default"].toRadians(getCssNumber("--warzone-start-roll", 0))
    }
  });
  viewer.scene?.requestRender?.();
}
function refreshPreview() {
  const viewer = window.__warzoneViewer;
  if (viewer?.__warzoneStartupRotation) {
    const base = getCssNumber("--warzone-startup-rotation-speed", 0.06);
    const multiplier = Math.max(0.1, Math.min(Number(window.__stratopsConfig?.startupRotationMultiplier || 1), 4));
    viewer.__warzoneStartupRotation.speedDeg = Math.max(0.01, Math.min(base * multiplier, 0.5));
  }
  window.refreshWarzoneMilSatsScale?.();
  applyCamera();
}
function initStartupSceneTuner() {
  const slot = document.getElementById("wz-intro-startup-tuner-slot");
  const tuner = document.getElementById("wz-intro-startup-scene-tuner");
  if (!slot || !tuner || tuner.dataset.bound === "1") return;
  tuner.dataset.bound = "1";
  slot.hidden = false;
  const output = document.getElementById("wz-intro-startup-scene-output");
  const updateOutput = () => {
    if (output) output.value = buildOutput();
  };
  const syncControlValues = () => {
    CSS_FIELDS.forEach(def => {
      const range = document.getElementById(`wz-intro-startup-${def.key}-range`);
      const input = document.getElementById(`wz-intro-startup-${def.key}-input`);
      const value = formatValue(getCssNumber(def.cssVar, def.fallback), def.step);
      if (range) range.value = value;
      if (input) input.value = value;
    });
    CONFIG_FIELDS.forEach(def => {
      const range = document.getElementById(`wz-intro-startup-${def.key}-range`);
      const input = document.getElementById(`wz-intro-startup-${def.key}-input`);
      const current = Number(window.__stratopsConfig?.[def.path]);
      const value = formatValue(Number.isFinite(current) ? current : def.fallback, def.step);
      if (range) range.value = value;
      if (input) input.value = value;
    });
    updateOutput();
  };
  const bindPair = (def, applyFn) => {
    const range = document.getElementById(`wz-intro-startup-${def.key}-range`);
    const input = document.getElementById(`wz-intro-startup-${def.key}-input`);
    if (!range || !input) return;
    const apply = (nextValue, source = "") => {
      const formatted = formatValue(nextValue, def.step);
      if (source !== "range") range.value = formatted;
      if (source !== "input") input.value = formatted;
      applyFn(formatted);
      updateOutput();
      refreshPreview();
    };
    range.addEventListener("input", () => apply(range.value, "range"));
    input.addEventListener("input", () => apply(input.value, "input"));
    input.addEventListener("change", () => apply(input.value, "input"));
  };
  CSS_FIELDS.forEach(def => {
    bindPair(def, value => document.documentElement.style.setProperty(def.cssVar, value));
  });
  CONFIG_FIELDS.forEach(def => {
    bindPair(def, value => {
      window.__stratopsConfig = window.__stratopsConfig || {};
      window.__stratopsConfig[def.path] = Number(value);
    });
  });
  document.getElementById("wz-intro-startup-scene-apply")?.addEventListener("click", refreshPreview);
  document.getElementById("wz-intro-startup-scene-load-current")?.addEventListener("click", syncControlValues);
  document.getElementById("wz-intro-startup-scene-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output?.value || buildOutput());
    } catch {
      /* noop */
    }
  });
  syncControlValues();
}

/***/ })

}]);