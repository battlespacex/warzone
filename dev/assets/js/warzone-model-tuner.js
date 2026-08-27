import * as Cesium from "cesium";
import "../css/warzone-model-tuner.css";
import { getAssetFocusController } from "./warzone-asset-focus-controller.js";
import {
    getAircraftFocusedModelScaleForTuner,
    getAircraftModelTunerCategories,
    getAircraftModelTunerFocusConfig,
} from "./warzone-live-airforce.js";
import {
    getNavalFocusedModelScaleForTuner,
    getNavalModelTunerCategories,
    getNavalModelTunerFocusConfig,
} from "./warzone-live-naval.js";

const TUNER_ROOT_ID = "wz-model-tuner";
const TUNER_ENTITY_PREFIX = "wz-model-tuner-preview";
const TUNER_FOCUS_TYPE = "model-tuner";
const AIRCRAFT_ANCHOR = Object.freeze({ lon: 55.22565, lat: 25.18395, altitude: 4200 });
const NAVAL_ANCHOR = Object.freeze({ lon: 55.22295, lat: 25.18610, altitude: 3 });
const GROUP_SPACING_MIN_METERS = 500;
const GROUP_SPACING_MAX_METERS = 3000;
const GROUP_SPACING_DEFAULT_METERS = 1500;
const FOCUS_WHEEL_DELTA_REFERENCE_PX = 100;
const FOCUS_WHEEL_LINE_HEIGHT_PX = 16;
const FOCUS_ZOOM_EPSILON_METERS = 20;
const MODEL_SIZE_FIELDS = Object.freeze([
    Object.freeze({ key: "focused", label: "Focused Size", suffix: "focused-size" }),
]);
const MODEL_CONSTRAINT_FIELDS = Object.freeze({
    aircraft: Object.freeze([
        Object.freeze({
            key: "focusedMinPixelSize",
            label: "Global Focused Min Pixel Size",
            variableName: "--warzone-live-aircraft-model-focused-min-pixel-size",
            fallback: 0,
            min: 0,
            max: 600,
            step: 1,
        }),
        Object.freeze({
            key: "maximumScale",
            label: "Global Maximum Scale",
            variableName: "--warzone-live-aircraft-model-max-scale",
            fallback: 1200,
            min: 1,
            max: 5000,
            step: 1,
        }),
    ]),
    naval: Object.freeze([
        Object.freeze({
            key: "focusedMinPixelSize",
            label: "Global Focused Min Pixel Size",
            variableName: "--warzone-live-naval-model-focused-min-pixel-size",
            fallback: 0,
            min: 0,
            max: 600,
            step: 1,
        }),
        Object.freeze({
            key: "maximumScale",
            label: "Global Focused Maximum Scale",
            variableName: "--warzone-live-naval-model-max-scale-focused",
            fallback: 220,
            min: 1,
            max: 5000,
            step: 1,
        }),
    ]),
});
const CAMERA_FIELDS = Object.freeze({
    aircraft: Object.freeze([
        Object.freeze({
            key: "focusedAltitudeOffsetFt",
            label: "Global Focused Altitude Offset",
            variableName: "--warzone-live-aircraft-focus-altitude-offset-ft",
            fallback: 7000,
            min: 1000,
            max: 50000,
            step: 250,
            unit: "ft",
            resetsInitialRange: true,
        }),
        Object.freeze({
            key: "focusedMaxZoomOut",
            label: "Global Maximum Focused Distance",
            variableName: "--warzone-live-aircraft-focused-max-zoom-out",
            fallback: 220000,
            min: 6000,
            max: 3200000,
            step: 1000,
            unit: "m",
        }),
    ]),
    naval: Object.freeze([
        Object.freeze({
            key: "focusedDistance",
            label: "Global Focused Distance",
            variableName: "--warzone-live-naval-focused-distance",
            fallback: 2516,
            min: 500,
            max: 3200000,
            step: 100,
            unit: "m",
            resetsInitialRange: true,
        }),
        Object.freeze({
            key: "focusedMaxZoomOut",
            label: "Global Maximum Focused Distance",
            variableName: "--warzone-live-naval-focused-max-zoom-out",
            fallback: 160000,
            min: 6000,
            max: 3200000,
            step: 1000,
            unit: "m",
        }),
    ]),
});

const state = {
    viewer: null,
    root: null,
    enabled: false,
    focusedKey: "",
    entities: new Map(),
    values: new Map(),
    modelConstraintValues: new Map(),
    cameraValues: new Map(),
    restoredInlineValues: new Map(),
    focusWheelHandler: null,
    focusConfig: null,
    focusRange: Number.NaN,
    focusTargetRange: Number.NaN,
    previousEnableZoom: null,
    spacing: {
        aircraft: GROUP_SPACING_DEFAULT_METERS,
        naval: GROUP_SPACING_DEFAULT_METERS,
    },
    categories: [],
};

function getCssNumber(varName, fallback = 1) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getCategoryKey(assetType, category) {
    return `${assetType}:${category}`;
}

function getCssVariableName(definition, field) {
    return `--warzone-live-${definition.assetType}-model-${field.suffix}-${definition.category}`;
}

function getDefaultFieldValue(definition, field) {
    const sharedName = `--warzone-live-${definition.assetType}-model-${field.suffix}`;
    return getCssNumber(getCssVariableName(definition, field), getCssNumber(sharedName, 1));
}

function getCategoryValues(definition) {
    const key = getCategoryKey(definition.assetType, definition.category);
    if (!state.values.has(key)) {
        state.values.set(key, Object.fromEntries(
            MODEL_SIZE_FIELDS.map((field) => [field.key, getDefaultFieldValue(definition, field)])
        ));
    }
    return state.values.get(key);
}

function getCameraFields(assetType) {
    return CAMERA_FIELDS[assetType] || [];
}

function getModelConstraintFields(assetType) {
    return MODEL_CONSTRAINT_FIELDS[assetType] || [];
}

function getModelConstraintValues(assetType) {
    if (!state.modelConstraintValues.has(assetType)) {
        state.modelConstraintValues.set(assetType, Object.fromEntries(
            getModelConstraintFields(assetType).map((field) => [
                field.key,
                getCssNumber(field.variableName, field.fallback),
            ])
        ));
    }
    return state.modelConstraintValues.get(assetType);
}

function getCameraValues(assetType) {
    if (!state.cameraValues.has(assetType)) {
        state.cameraValues.set(assetType, Object.fromEntries(
            getCameraFields(assetType).map((field) => [
                field.key,
                getCssNumber(field.variableName, field.fallback),
            ])
        ));
    }
    return state.cameraValues.get(assetType);
}

function getSelectedDefinition() {
    const select = state.root?.querySelector("[data-model-tuner-category]");
    const selectedKey = String(select?.value || "");
    return state.categories.find((definition) => (
        getCategoryKey(definition.assetType, definition.category) === selectedKey
    )) || null;
}

function formatValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "1";
    return String(Number(numeric.toFixed(3)));
}

function buildCssOutput(definition) {
    if (!definition) return "Select one aircraft or naval category.";
    const values = getCategoryValues(definition);
    const modelLines = MODEL_SIZE_FIELDS.map((field) => (
        `${getCssVariableName(definition, field)}: ${formatValue(values[field.key])};`
    ));
    const constraintValues = getModelConstraintValues(definition.assetType);
    const constraintLines = getModelConstraintFields(definition.assetType).map((field) => (
        `${field.variableName}: ${formatValue(constraintValues[field.key])};`
    ));
    const cameraValues = getCameraValues(definition.assetType);
    const cameraLines = getCameraFields(definition.assetType).map((field) => (
        `${field.variableName}: ${formatValue(cameraValues[field.key])};`
    ));
    return [...modelLines, ...constraintLines, ...cameraLines].join("\n");
}

function setStatus(message, tone = "") {
    const status = state.root?.querySelector("[data-model-tuner-status]");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
}

function syncOutput() {
    const definition = getSelectedDefinition();
    const output = state.root?.querySelector("[data-model-tuner-output]");
    if (output) output.value = buildCssOutput(definition);
}

function syncControls() {
    const definition = getSelectedDefinition();
    const isFocused = Boolean(definition && state.focusedKey === getCategoryKey(definition.assetType, definition.category));
    const fields = state.root?.querySelector("[data-model-tuner-fields]");
    const focusButton = state.root?.querySelector("[data-model-tuner-focus]");
    const unfocusButton = state.root?.querySelector("[data-model-tuner-unfocus]");
    const copyButton = state.root?.querySelector("[data-model-tuner-copy]");
    const select = state.root?.querySelector("[data-model-tuner-category]");
    if (fields) fields.hidden = !isFocused;
    if (focusButton) focusButton.disabled = !state.enabled || !definition || Boolean(state.focusedKey);
    if (unfocusButton) unfocusButton.disabled = !isFocused;
    if (copyButton) copyButton.disabled = !isFocused;
    if (select) select.disabled = Boolean(state.focusedKey);
    ["aircraft", "naval"].forEach((assetType) => {
        const input = state.root?.querySelector(`[data-model-tuner-spacing="${assetType}"]`);
        const output = state.root?.querySelector(`[data-model-tuner-spacing-output="${assetType}"]`);
        if (input) input.value = String(state.spacing[assetType]);
        if (output) output.textContent = `${Math.round(state.spacing[assetType])} m`;
    });
    if (definition) {
        const values = getCategoryValues(definition);
        const selectedName = state.root.querySelector("[data-model-tuner-selected-name]");
        if (selectedName) selectedName.textContent = definition.label;
        MODEL_SIZE_FIELDS.forEach((field) => {
            const input = state.root.querySelector(`[data-model-tuner-value="${field.key}"]`);
            if (input) input.value = formatValue(values[field.key]);
        });
        const constraintValues = getModelConstraintValues(definition.assetType);
        getModelConstraintFields(definition.assetType).forEach((field) => {
            const input = state.root.querySelector(`[data-model-tuner-constraint-asset="${definition.assetType}"][data-model-tuner-constraint-value="${field.key}"]`);
            if (!input) return;
            input.value = formatValue(constraintValues[field.key]);
            input.closest("label").hidden = false;
        });
        state.root.querySelectorAll("[data-model-tuner-constraint-value]").forEach((input) => {
            input.closest("label").hidden = input.dataset.modelTunerConstraintAsset !== definition.assetType;
        });
        const cameraValues = getCameraValues(definition.assetType);
        getCameraFields(definition.assetType).forEach((field) => {
            const input = state.root.querySelector(`[data-model-tuner-camera-asset="${definition.assetType}"][data-model-tuner-camera-value="${field.key}"]`);
            if (!input) return;
            input.value = formatValue(cameraValues[field.key]);
            input.closest("label").hidden = false;
        });
        state.root.querySelectorAll("[data-model-tuner-camera-value]").forEach((input) => {
            const matchesAsset = input.dataset.modelTunerCameraAsset === definition.assetType;
            if (!matchesAsset) input.closest("label").hidden = true;
        });
    }
    syncOutput();
}

function makeGridOffset(index, count, assetType, spacing = GROUP_SPACING_DEFAULT_METERS) {
    const columns = Math.min(count, assetType === "aircraft" ? 5 : 9);
    const rows = Math.max(1, Math.ceil(count / columns));
    const column = index % columns;
    const row = Math.floor(index / columns);
    const alongShore = (column - ((columns - 1) / 2)) * spacing;
    const acrossShore = (((rows - 1) / 2) - row) * spacing;
    const diagonal = Math.SQRT1_2;
    return {
        east: (alongShore + acrossShore) * diagonal,
        north: (alongShore - acrossShore) * diagonal,
    };
}

function positionFromAnchor(anchor, offset) {
    const origin = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.altitude);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    return Cesium.Matrix4.multiplyByPoint(
        transform,
        new Cesium.Cartesian3(offset.east, offset.north, 0),
        new Cesium.Cartesian3()
    );
}

function buildOrientation(position, headingDegrees) {
    return Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDegrees), 0, 0)
    );
}

function getPreviewFocusedSize(definition) {
    return Math.max(0.01, Math.min(4000, Number(getCategoryValues(definition).focused) || 1));
}

function addPreviewEntity(definition, index, groupCount) {
    const anchor = definition.assetType === "aircraft" ? AIRCRAFT_ANCHOR : NAVAL_ANCHOR;
    const position = positionFromAnchor(
        anchor,
        makeGridOffset(index, groupCount, definition.assetType, state.spacing[definition.assetType])
    );
    const entity = state.viewer.entities.add({
        id: `${TUNER_ENTITY_PREFIX}-${definition.assetType}-${definition.category}`,
        name: `${definition.label} model tuner preview`,
        position,
        orientation: buildOrientation(position, definition.assetType === "aircraft" ? 55 : 35),
        model: {
            uri: definition.modelUri,
            scale: getPreviewFocusedSize(definition),
            minimumPixelSize: 0,
            maximumScale: 4000,
            color: Cesium.Color.WHITE,
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0,
            runAnimations: false,
            clampAnimations: false,
        },
        label: {
            text: definition.label.toUpperCase(),
            font: "600 12px Rajdhani, sans-serif",
            fillColor: Cesium.Color.fromCssColorString("#b9f7ff"),
            outlineColor: Cesium.Color.fromCssColorString("#061018"),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 32),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scale: 0.9,
        },
    });
    entity.__wzModelTunerPreview = true;
    state.entities.set(getCategoryKey(definition.assetType, definition.category), entity);
}

function showAllPreviewEntities() {
    state.entities.forEach((entity, key) => {
        const definition = state.categories.find((item) => (
            getCategoryKey(item.assetType, item.category) === key
        ));
        entity.show = true;
        if (entity.model) {
            if (definition) entity.model.scale = getPreviewFocusedSize(definition);
            entity.model.minimumPixelSize = 0;
            entity.model.maximumScale = 4000;
        }
        if (entity.label) entity.label.show = true;
    });
}

function updatePreviewPositions(assetType) {
    const definitions = state.categories.filter((definition) => definition.assetType === assetType);
    const anchor = assetType === "aircraft" ? AIRCRAFT_ANCHOR : NAVAL_ANCHOR;
    definitions.forEach((definition, index) => {
        const key = getCategoryKey(definition.assetType, definition.category);
        const entity = state.entities.get(key);
        if (!entity) return;
        const position = positionFromAnchor(
            anchor,
            makeGridOffset(index, definitions.length, assetType, state.spacing[assetType])
        );
        entity.position = position;
        entity.orientation = buildOrientation(position, assetType === "aircraft" ? 55 : 35);
    });
    syncFocusedPreviewCamera();
    state.viewer?.scene?.requestRender?.();
}

function flyToPreviewGroup() {
    const positions = [...state.entities.values()]
        .map((entity) => entity.position?.getValue?.(Cesium.JulianDate.now()))
        .filter(Boolean);
    if (!positions.length) return;
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    state.viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(28),
            Cesium.Math.toRadians(-52),
            Math.max(50000, sphere.radius * 5)
        ),
    });
}

function spawnPreviewEntities() {
    const activeFocus = getAssetFocusController().getState();
    if (activeFocus.state !== getAssetFocusController().FOCUS_STATES.INACTIVE) {
        setStatus("Unfocus the active live asset before enabling the preview group.", "warning");
        return false;
    }
    const aircraft = state.categories.filter((definition) => definition.assetType === "aircraft");
    const naval = state.categories.filter((definition) => definition.assetType === "naval");
    aircraft.forEach((definition, index) => addPreviewEntity(definition, index, aircraft.length));
    naval.forEach((definition, index) => addPreviewEntity(definition, index, naval.length));
    state.enabled = true;
    state.viewer.scene?.requestRender?.();
    flyToPreviewGroup();
    setStatus("All preview models are visible at their category Focused Size.", "ok");
    syncControls();
    return true;
}

function rememberAndApplyFocusedValues(definition) {
    const rootStyle = document.documentElement.style;
    const values = getCategoryValues(definition);
    const rememberAndSet = (variableName, value) => {
        if (!state.restoredInlineValues.has(variableName)) {
            state.restoredInlineValues.set(variableName, {
                value: rootStyle.getPropertyValue(variableName),
                priority: rootStyle.getPropertyPriority(variableName),
            });
        }
        rootStyle.setProperty(variableName, formatValue(value));
    };
    MODEL_SIZE_FIELDS.forEach((field) => {
        rememberAndSet(getCssVariableName(definition, field), values[field.key]);
    });
    const constraintValues = getModelConstraintValues(definition.assetType);
    getModelConstraintFields(definition.assetType).forEach((field) => {
        rememberAndSet(field.variableName, constraintValues[field.key]);
    });
    const cameraValues = getCameraValues(definition.assetType);
    getCameraFields(definition.assetType).forEach((field) => {
        rememberAndSet(field.variableName, cameraValues[field.key]);
    });
}

function restoreFocusedValues() {
    const rootStyle = document.documentElement.style;
    state.restoredInlineValues.forEach((previous, variableName) => {
        if (previous.value) rootStyle.setProperty(variableName, previous.value, previous.priority);
        else rootStyle.removeProperty(variableName);
    });
    state.restoredInlineValues.clear();
}

function getFocusedDefinition() {
    return state.categories.find((item) => (
        getCategoryKey(item.assetType, item.category) === state.focusedKey
    )) || null;
}

function getFocusConfig(definition) {
    return definition?.assetType === "aircraft"
        ? getAircraftModelTunerFocusConfig(AIRCRAFT_ANCHOR.altitude / 0.3048)
        : getNavalModelTunerFocusConfig();
}

function updateFocusedPreviewScale() {
    if (!state.focusedKey) return;
    const definition = getFocusedDefinition();
    const entity = state.entities.get(state.focusedKey);
    if (!definition || !entity?.model) return;
    entity.model.scale = definition.assetType === "aircraft"
        ? getAircraftFocusedModelScaleForTuner(definition.category)
        : getNavalFocusedModelScaleForTuner(definition.category);
    const constraints = getModelConstraintValues(definition.assetType);
    entity.model.minimumPixelSize = constraints.focusedMinPixelSize;
    entity.model.maximumScale = Math.max(
        constraints.maximumScale,
        Number(entity.model.scale?.getValue?.(Cesium.JulianDate.now()) || entity.model.scale || 0)
    );
    state.viewer.scene?.requestRender?.();
}

function syncFocusedPreviewCamera() {
    if (!state.focusedKey || !state.focusConfig) return;
    const entity = state.entities.get(state.focusedKey);
    const position = entity?.position?.getValue?.(Cesium.JulianDate.now());
    if (!position || !Number.isFinite(state.focusRange)) return;
    state.viewer.camera.lookAt(
        position,
        new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(20),
            Cesium.Math.toRadians(state.focusConfig.pitchDegrees),
            state.focusRange
        )
    );
}

function startFocusedPreviewZoom() {
    const controller = getAssetFocusController();
    controller.registerTask("model-tuner-camera-zoom", () => {
        if (!state.focusedKey || !state.focusConfig) {
            controller.removeTask("model-tuner-camera-zoom");
            return;
        }
        const delta = state.focusTargetRange - state.focusRange;
        if (Math.abs(delta) <= FOCUS_ZOOM_EPSILON_METERS) {
            state.focusRange = state.focusTargetRange;
            syncFocusedPreviewCamera();
            controller.removeTask("model-tuner-camera-zoom");
            return;
        }
        state.focusRange += delta * state.focusConfig.wheelEase;
        syncFocusedPreviewCamera();
    }, { hz: 60 });
    controller.requestFrame();
}

function bindFocusedPreviewWheel() {
    const canvas = state.viewer?.scene?.canvas;
    if (!canvas || state.focusWheelHandler) return;
    state.focusWheelHandler = (event) => {
        if (!state.focusedKey || !state.focusConfig) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        let deltaY = Number(event.deltaY || 0);
        if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return;
        if (Number(event.deltaMode || 0) === 1) {
            deltaY *= FOCUS_WHEEL_LINE_HEIGHT_PX;
        } else if (Number(event.deltaMode || 0) === 2) {
            deltaY *= Math.max(1, Number(window.innerHeight || 800));
        }
        const factor = Math.max(-1, Math.min(1, deltaY / FOCUS_WHEEL_DELTA_REFERENCE_PX));
        state.focusTargetRange = Math.max(
            state.focusConfig.minRange,
            Math.min(
                state.focusConfig.maxRange,
                state.focusTargetRange + (state.focusConfig.wheelStep * factor)
            )
        );
        startFocusedPreviewZoom();
    };
    canvas.addEventListener("wheel", state.focusWheelHandler, { passive: false, capture: true });
}

function clearCameraListener() {
    getAssetFocusController().removeTask("model-tuner-camera-zoom");
    const canvas = state.viewer?.scene?.canvas;
    if (canvas && state.focusWheelHandler) {
        canvas.removeEventListener("wheel", state.focusWheelHandler, { capture: true });
    }
    state.focusWheelHandler = null;
    const cameraController = state.viewer?.scene?.screenSpaceCameraController;
    if (cameraController && state.previousEnableZoom !== null) {
        cameraController.enableZoom = state.previousEnableZoom;
    }
    state.previousEnableZoom = null;
    state.focusConfig = null;
    state.focusRange = Number.NaN;
    state.focusTargetRange = Number.NaN;
}

function releasePreviewFocus({ fromController = false, flyToGroup = true } = {}) {
    if (!state.focusedKey) return;
    clearCameraListener();
    restoreFocusedValues();
    state.focusedKey = "";
    showAllPreviewEntities();
    if (!fromController) {
        const controller = getAssetFocusController();
        if (controller.getState().assetType === TUNER_FOCUS_TYPE) controller.exitFocus("model-tuner-unfocus");
    }
    if (flyToGroup && state.enabled) flyToPreviewGroup();
    setStatus("Preview focus released. Select the next category.", "ok");
    syncControls();
}

function focusSelected() {
    const definition = getSelectedDefinition();
    if (!state.enabled || !definition) return;
    const key = getCategoryKey(definition.assetType, definition.category);
    const entity = state.entities.get(key);
    const position = entity?.position?.getValue?.(Cesium.JulianDate.now());
    if (!entity || !position) return;
    const controller = getAssetFocusController();
    const token = controller.enterFocus({ assetType: TUNER_FOCUS_TYPE, assetId: key, mode: "model-tuning" });
    if (!token) {
        setStatus("Unfocus the active live asset before using the model tuner.", "warning");
        return;
    }
    state.focusedKey = key;
    showAllPreviewEntities();
    if (entity.label) entity.label.show = false;
    rememberAndApplyFocusedValues(definition);
    updateFocusedPreviewScale();
    state.focusConfig = getFocusConfig(definition);
    state.focusRange = state.focusConfig.initialRange;
    state.focusTargetRange = state.focusRange;
    const cameraController = state.viewer.scene?.screenSpaceCameraController;
    if (cameraController) {
        state.previousEnableZoom = cameraController.enableZoom;
        cameraController.enableZoom = false;
    }
    bindFocusedPreviewWheel();
    controller.registerCleanup(() => releasePreviewFocus({ fromController: true, flyToGroup: false }));
    state.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 1), {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(20),
            Cesium.Math.toRadians(state.focusConfig.pitchDegrees),
            state.focusRange
        ),
        complete: () => {
            syncFocusedPreviewCamera();
        },
    });
    setStatus(
        `Focused ${definition.label}; zoom is limited to ${Math.round(state.focusConfig.minRange / 1000)}–${Math.round(state.focusConfig.maxRange / 1000)} km.`,
        "ok"
    );
    syncControls();
}

function removePreviewEntities() {
    releasePreviewFocus({ flyToGroup: false });
    state.entities.forEach((entity) => state.viewer?.entities?.remove?.(entity));
    state.entities.clear();
    state.enabled = false;
    state.viewer?.scene?.requestRender?.();
    setStatus("Temporary model previews removed.");
    syncControls();
}

function handleEnableChange(event) {
    if (event.currentTarget.checked) {
        if (!spawnPreviewEntities()) event.currentTarget.checked = false;
    } else {
        removePreviewEntities();
    }
}

function handleSpacingInput(event) {
    const assetType = String(event.currentTarget.dataset.modelTunerSpacing || "");
    if (!Object.prototype.hasOwnProperty.call(state.spacing, assetType)) return;
    const spacing = Math.max(
        GROUP_SPACING_MIN_METERS,
        Math.min(GROUP_SPACING_MAX_METERS, Number(event.currentTarget.value))
    );
    if (!Number.isFinite(spacing)) return;
    state.spacing[assetType] = spacing;
    const output = state.root?.querySelector(`[data-model-tuner-spacing-output="${assetType}"]`);
    if (output) output.textContent = `${Math.round(spacing)} m`;
    if (state.enabled) updatePreviewPositions(assetType);
}

function handleValueInput(event) {
    const definition = getSelectedDefinition();
    if (!definition || !state.focusedKey) return;
    const fieldKey = String(event.currentTarget.dataset.modelTunerValue || "");
    const value = Math.max(0.01, Math.min(4000, Number(event.currentTarget.value)));
    if (!Number.isFinite(value)) return;
    getCategoryValues(definition)[fieldKey] = value;
    rememberAndApplyFocusedValues(definition);
    updateFocusedPreviewScale();
    syncOutput();
}

function handleConstraintValueInput(event) {
    const definition = getSelectedDefinition();
    if (!definition || !state.focusedKey) return;
    const assetType = String(event.currentTarget.dataset.modelTunerConstraintAsset || "");
    if (assetType !== definition.assetType) return;
    const fieldKey = String(event.currentTarget.dataset.modelTunerConstraintValue || "");
    const field = getModelConstraintFields(assetType).find((item) => item.key === fieldKey);
    if (!field) return;
    const value = Math.max(field.min, Math.min(field.max, Number(event.currentTarget.value)));
    if (!Number.isFinite(value)) return;
    getModelConstraintValues(assetType)[field.key] = value;
    rememberAndApplyFocusedValues(definition);
    updateFocusedPreviewScale();
    syncOutput();
}

function handleCameraValueInput(event) {
    const definition = getSelectedDefinition();
    if (!definition || !state.focusedKey) return;
    const assetType = String(event.currentTarget.dataset.modelTunerCameraAsset || "");
    if (assetType !== definition.assetType) return;
    const fieldKey = String(event.currentTarget.dataset.modelTunerCameraValue || "");
    const field = getCameraFields(assetType).find((item) => item.key === fieldKey);
    if (!field) return;
    const value = Math.max(field.min, Math.min(field.max, Number(event.currentTarget.value)));
    if (!Number.isFinite(value)) return;
    getCameraValues(assetType)[field.key] = value;
    rememberAndApplyFocusedValues(definition);
    state.focusConfig = getFocusConfig(definition);
    if (field.resetsInitialRange) {
        state.focusRange = state.focusConfig.initialRange;
        state.focusTargetRange = state.focusRange;
    } else {
        state.focusRange = Math.max(state.focusConfig.minRange, Math.min(state.focusConfig.maxRange, state.focusRange));
        state.focusTargetRange = Math.max(state.focusConfig.minRange, Math.min(state.focusConfig.maxRange, state.focusTargetRange));
    }
    syncFocusedPreviewCamera();
    syncOutput();
}

async function copyValues() {
    const definition = getSelectedDefinition();
    if (!definition) return;
    const text = buildCssOutput(definition);
    try {
        await navigator.clipboard.writeText(text);
        setStatus(`Copied the model and camera values for ${definition.label}.`, "ok");
    } catch {
        const output = state.root?.querySelector("[data-model-tuner-output]");
        output?.select?.();
        document.execCommand?.("copy");
        setStatus(`Selected the model and camera values for ${definition.label}.`, "warning");
    }
}

function buildCategoryOptions(categories) {
    const aircraft = categories.filter((item) => item.assetType === "aircraft");
    const naval = categories.filter((item) => item.assetType === "naval");
    const renderGroup = (label, items) => `<optgroup label="${label}">${items.map((item) => (
        `<option value="${getCategoryKey(item.assetType, item.category)}">${item.label}</option>`
    )).join("")}</optgroup>`;
    return `<option value="">All Models (group only)</option>${renderGroup("Aircraft", aircraft)}${renderGroup("Naval", naval)}`;
}

function buildPanel() {
    const root = document.createElement("aside");
    root.id = TUNER_ROOT_ID;
    root.className = "wz-model-tuner";
    root.setAttribute("aria-label", "Aircraft and naval model tuner");
    root.innerHTML = `
        <div class="wz-model-tuner__header">
            <div><span>DEV TOOL</span><strong>Aircraft &amp; Naval Model Tuner</strong></div>
            <button type="button" data-model-tuner-close aria-label="Close model tuner">×</button>
        </div>
        <label class="wz-model-tuner__enable">
            <input type="checkbox" data-model-tuner-enable>
            <span>Enable Model Preview</span>
        </label>
        <div class="wz-model-tuner__spacing">
            <label class="wz-model-tuner__field">
                <span>Aircraft Spacing</span>
                <span class="wz-model-tuner__range-row">
                    <input type="range" min="${GROUP_SPACING_MIN_METERS}" max="${GROUP_SPACING_MAX_METERS}" step="5" value="${GROUP_SPACING_DEFAULT_METERS}" data-model-tuner-spacing="aircraft">
                    <output data-model-tuner-spacing-output="aircraft">${GROUP_SPACING_DEFAULT_METERS} m</output>
                </span>
            </label>
            <label class="wz-model-tuner__field">
                <span>Naval Spacing</span>
                <span class="wz-model-tuner__range-row">
                    <input type="range" min="${GROUP_SPACING_MIN_METERS}" max="${GROUP_SPACING_MAX_METERS}" step="5" value="${GROUP_SPACING_DEFAULT_METERS}" data-model-tuner-spacing="naval">
                    <output data-model-tuner-spacing-output="naval">${GROUP_SPACING_DEFAULT_METERS} m</output>
                </span>
            </label>
        </div>
        <label class="wz-model-tuner__field">
            <span>Model category</span>
            <select data-model-tuner-category>${buildCategoryOptions(state.categories)}</select>
        </label>
        <div class="wz-model-tuner__actions">
            <button type="button" data-model-tuner-focus disabled>Focus Selected</button>
            <button type="button" data-model-tuner-unfocus disabled>Unfocus</button>
        </div>
        <div class="wz-model-tuner__settings" data-model-tuner-fields hidden>
            <strong class="wz-model-tuner__settings-title">Selected Model Settings</strong>
            <span class="wz-model-tuner__selected">Category: <b data-model-tuner-selected-name></b></span>
            <strong class="wz-model-tuner__settings-title">Model Size Values</strong>
            ${MODEL_SIZE_FIELDS.map((field) => `
                <label class="wz-model-tuner__field">
                    <span>${field.label}</span>
                    <input type="number" min="0.01" max="4000" step="1" data-model-tuner-value="${field.key}">
                </label>
            `).join("")}
            <strong class="wz-model-tuner__settings-title">Global Model Constraints</strong>
            ${Object.entries(MODEL_CONSTRAINT_FIELDS).flatMap(([assetType, fields]) => fields.map((field) => `
                <label class="wz-model-tuner__field" hidden>
                    <span>${field.label}</span>
                    <input type="number" min="${field.min}" max="${field.max}" step="${field.step}" data-model-tuner-constraint-asset="${assetType}" data-model-tuner-constraint-value="${field.key}">
                </label>
            `)).join("")}
            <strong class="wz-model-tuner__settings-title">Camera Values</strong>
            ${Object.entries(CAMERA_FIELDS).flatMap(([assetType, fields]) => fields.map((field) => `
                <label class="wz-model-tuner__field" hidden>
                    <span>${field.label} (${field.unit})</span>
                    <input type="number" min="${field.min}" max="${field.max}" step="${field.step}" data-model-tuner-camera-asset="${assetType}" data-model-tuner-camera-value="${field.key}">
                </label>
            `)).join("")}
            <label class="wz-model-tuner__field wz-model-tuner__current-values">
                <span>Current Values</span>
                <textarea rows="7" readonly data-model-tuner-output></textarea>
            </label>
            <button type="button" class="wz-model-tuner__copy" data-model-tuner-copy>Copy Values</button>
        </div>
        <p class="wz-model-tuner__status" data-model-tuner-status>Preview is disabled.</p>
    `;
    document.body.appendChild(root);
    return root;
}

function bindPanel() {
    state.root.querySelector("[data-model-tuner-enable]").addEventListener("change", handleEnableChange);
    state.root.querySelector("[data-model-tuner-category]").addEventListener("change", syncControls);
    state.root.querySelector("[data-model-tuner-focus]").addEventListener("click", focusSelected);
    state.root.querySelector("[data-model-tuner-unfocus]").addEventListener("click", () => releasePreviewFocus());
    state.root.querySelector("[data-model-tuner-copy]").addEventListener("click", copyValues);
    state.root.querySelectorAll("[data-model-tuner-spacing]").forEach((input) => {
        input.addEventListener("input", handleSpacingInput);
    });
    state.root.querySelector("[data-model-tuner-close]").addEventListener("click", () => {
        removePreviewEntities();
        state.root.remove();
        state.root = null;
        const launcher = document.getElementById("wz-model-tuner-launcher");
        if (launcher) launcher.hidden = false;
    });
    MODEL_SIZE_FIELDS.forEach((field) => {
        state.root.querySelector(`[data-model-tuner-value="${field.key}"]`).addEventListener("input", handleValueInput);
    });
    state.root.querySelectorAll("[data-model-tuner-constraint-value]").forEach((input) => {
        input.addEventListener("input", handleConstraintValueInput);
    });
    state.root.querySelectorAll("[data-model-tuner-camera-value]").forEach((input) => {
        input.addEventListener("input", handleCameraValueInput);
    });
}

export function initAircraftNavalModelTuner(viewer = window.__warzoneViewer) {
    if (!viewer) return false;
    if (state.root || document.getElementById(TUNER_ROOT_ID)) return true;
    state.viewer = viewer;
    state.categories = [
        ...getAircraftModelTunerCategories(),
        ...getNavalModelTunerCategories(),
    ];
    state.root = buildPanel();
    const launcher = document.getElementById("wz-model-tuner-launcher");
    if (launcher) launcher.hidden = true;
    bindPanel();
    syncControls();
    window.addEventListener("pagehide", removePreviewEntities, { once: true });
    return true;
}
