import "../css/warzone-formation-tuner.css";
import * as Cesium from "cesium";
import {
    clearLiveTrack,
    focusLiveTrack,
    upsertLiveTrack,
} from "./warzone-live-airforce.js";
import {
    clearNavalVessel,
    focusNavalVessel,
    upsertNavalVessel,
} from "./warzone-live-naval.js";
import { isLayerEnabled, setLayer } from "./warzone-layers.js";

const UPDATE_INTERVAL_MS = 250;
const KNOT_TO_METERS_PER_SECOND = 0.514444;
const FORMATION_SOURCE = "DEV FORMATION TUNER";

const FORMATION_PRESETS = Object.freeze({
    nevada: Object.freeze({
        label: "Bomber Formation",
        location: "Nevada, United States",
        domain: "air",
        speedKts: 480,
        start: Object.freeze({ lat: 36.31, lon: -116.44 }),
        end: Object.freeze({ lat: 37.08, lon: -113.74 }),
        headingDeg: 68,
        anchorAltitudeFt: 29500,
        focusMemberId: "b2-lead",
        members: Object.freeze([
            Object.freeze({ id: "b2-lead", title: "USAF B-2A Spirit Lead", assetKey: "Bomber-B2", subtype: "bomber", forwardM: 0, rightM: 0, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "b1-wing", title: "USAF B-1B Lancer", assetKey: "Bomber-B1", subtype: "bomber", forwardM: -1800, rightM: 2800, altitudeOffsetFt: 900 }),
            Object.freeze({ id: "b52-wing", title: "USAF B-52H Stratofortress", assetKey: "Bomber-B52", subtype: "bomber", forwardM: -3400, rightM: -3200, altitudeOffsetFt: 1400 }),
        ]),
    }),
    washington: Object.freeze({
        label: "VIP-VC25 Presidential Escort",
        location: "Washington, DC",
        domain: "air",
        speedKts: 410,
        start: Object.freeze({ lat: 38.86, lon: -77.05 }),
        end: Object.freeze({ lat: 39.42, lon: -75.18 }),
        headingDeg: 67,
        anchorAltitudeFt: 28000,
        focusMemberId: "vc25-primary",
        members: Object.freeze([
            Object.freeze({ id: "vc25-primary", title: "USAF VIP-VC25 Presidential Airlift", assetKey: "VIP-VC25", subtype: "vip", forwardM: 0, rightM: 0, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "f22-left-near", title: "USAF F-22 Raptor Left One", assetKey: "Fighter-F22", subtype: "fighter", forwardM: -1400, rightM: -2100, altitudeOffsetFt: -300 }),
            Object.freeze({ id: "f22-left-far", title: "USAF F-22 Raptor Left Two", assetKey: "Fighter-F22", subtype: "fighter", forwardM: -3000, rightM: -3800, altitudeOffsetFt: -600 }),
            Object.freeze({ id: "f35-right-near", title: "USAF F-35 Lightning II Right One", assetKey: "Fighter-F35", subtype: "fighter", forwardM: -1400, rightM: 2100, altitudeOffsetFt: -300 }),
            Object.freeze({ id: "f35-right-far", title: "USAF F-35 Lightning II Right Two", assetKey: "Fighter-F35", subtype: "fighter", forwardM: -3000, rightM: 3800, altitudeOffsetFt: -600 }),
        ]),
    }),
    california: Object.freeze({
        label: "B-2 Aerial Refueling + ISR",
        location: "California, United States",
        domain: "air",
        speedKts: 390,
        start: Object.freeze({ lat: 34.74, lon: -120.62 }),
        end: Object.freeze({ lat: 35.31, lon: -117.72 }),
        headingDeg: 75,
        anchorAltitudeFt: 26500,
        focusMemberId: "b2-refuel",
        members: Object.freeze([
            Object.freeze({ id: "b2-refuel", title: "USAF B-2 Spirit Refueling Position", assetKey: "Bomber-B2", subtype: "bomber", forwardM: 0, rightM: 0, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "kc135-lead", title: "USAF KC-135 Stratotanker Lead", assetKey: "Tanker-KC135", subtype: "tanker", forwardM: 520, rightM: 0, altitudeOffsetFt: 220, refuelingLink: true }),
            Object.freeze({ id: "b2-support", title: "USAF B-2 Spirit Support", assetKey: "Bomber-B2", subtype: "bomber", forwardM: -3000, rightM: 3600, altitudeOffsetFt: 900 }),
            Object.freeze({ id: "rc135-support", title: "USAF RC-135 Rivet Joint ISR", assetKey: "ISR-RC135", subtype: "recon", forwardM: -5000, rightM: -5000, altitudeOffsetFt: 1500 }),
        ]),
    }),
    hormuz: Object.freeze({
        label: "U.S. Naval Formation",
        location: "Strait of Hormuz",
        domain: "naval",
        speedKts: 18,
        focusRangeMeters: 52000,
        start: Object.freeze({ lat: 25.82, lon: 56.92 }),
        end: Object.freeze({ lat: 25.46, lon: 57.82 }),
        headingDeg: 116,
        anchorAltitudeFt: 0,
        focusMemberId: "carrier-primary",
        members: Object.freeze([
            Object.freeze({ id: "carrier-primary", title: "USS Gerald R. Ford Carrier Strike Group", assetKey: "Carrier-US", subtype: "carrier", forwardM: 0, rightM: 0, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "destroyer-forward-port", title: "USS Zumwalt Forward Port", assetKey: "Vessel-Zumwalt", subtype: "destroyer", forwardM: 7200, rightM: -4800, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "destroyer-forward-starboard", title: "USS Michael Monsoor Forward Starboard", assetKey: "Vessel-Zumwalt", subtype: "destroyer", forwardM: 7200, rightM: 4800, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "frigate-port", title: "U.S. Navy Frigate Port Screen", assetKey: "Vessel-Frigate", subtype: "frigate", forwardM: 800, rightM: -7600, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "frigate-starboard", title: "U.S. Navy Frigate Starboard Screen", assetKey: "Vessel-Frigate", subtype: "frigate", forwardM: 800, rightM: 7600, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "frigate-aft-port", title: "U.S. Navy Frigate Aft Port", assetKey: "Vessel-Frigate", subtype: "frigate", forwardM: -6500, rightM: -5200, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "frigate-aft-starboard", title: "U.S. Navy Frigate Aft Starboard", assetKey: "Vessel-Frigate", subtype: "frigate", forwardM: -6500, rightM: 5200, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "isr-surface", title: "U.S. Navy ISR Surface Support", assetKey: "Vessel-ISR", subtype: "intelligence", forwardM: 10500, rightM: 0, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "ssn-port", title: "U.S. Navy SSN Port Screen", assetKey: "Submarine-SSN", subtype: "ssn", forwardM: -9500, rightM: -8000, altitudeOffsetFt: 0 }),
            Object.freeze({ id: "ssn-starboard", title: "U.S. Navy SSN Starboard Screen", assetKey: "Submarine-SSN", subtype: "ssn", forwardM: -9500, rightM: 8000, altitudeOffsetFt: 0 }),
        ]),
    }),
});

const FORMATION_KEYS = Object.freeze(Object.keys(FORMATION_PRESETS));
const __formationRuntime = new Map();
const __ownedTrackerLayers = { air: false, naval: false };
let __selectedFormationKey = FORMATION_KEYS[0];
let __formationTimer = 0;
let __lastTickAt = 0;

function getTrackKey(formationKey, memberId) {
    return `dev-formation-${formationKey}-${memberId}`;
}

function createRuntimeState(formationKey) {
    const preset = FORMATION_PRESETS[formationKey];
    const start = Cesium.Cartographic.fromDegrees(preset.start.lon, preset.start.lat);
    const end = Cesium.Cartographic.fromDegrees(preset.end.lon, preset.end.lat);
    const geodesic = new Cesium.EllipsoidGeodesic(start, end);
    return {
        active: false,
        progress: 0,
        speedPercent: 100,
        spacingPercent: 100,
        targetSpacingPercent: 100,
        geodesic,
        routeDistanceMeters: Math.max(1, Number(geodesic.surfaceDistance || 1)),
    };
}

function getRuntimeState(formationKey) {
    if (!__formationRuntime.has(formationKey)) {
        __formationRuntime.set(formationKey, createRuntimeState(formationKey));
    }
    return __formationRuntime.get(formationKey);
}

function getAnchorPosition(preset, runtime) {
    const cartographic = runtime.geodesic.interpolateUsingFraction(runtime.progress);
    return {
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude),
    };
}

function applyFormationOffset(anchor, headingDeg, forwardMeters, rightMeters) {
    const heading = Cesium.Math.toRadians(headingDeg);
    const northMeters = (forwardMeters * Math.cos(heading)) - (rightMeters * Math.sin(heading));
    const eastMeters = (forwardMeters * Math.sin(heading)) + (rightMeters * Math.cos(heading));
    const earthRadiusMeters = 6378137;
    const latitudeRadians = Cesium.Math.toRadians(anchor.lat);
    const latitudeDelta = Cesium.Math.toDegrees(northMeters / earthRadiusMeters);
    const longitudeScale = Math.max(0.2, Math.cos(latitudeRadians));
    const longitudeDelta = Cesium.Math.toDegrees(eastMeters / (earthRadiusMeters * longitudeScale));
    return {
        lat: anchor.lat + latitudeDelta,
        lon: anchor.lon + longitudeDelta,
    };
}

function getMemberSpacingScale(member, groupScale) {
    if (member.refuelingLink !== true) return groupScale;
    if (groupScale <= 1) {
        return 0.75 + ((groupScale - 0.5) * 0.5);
    }
    return 1 + ((groupScale - 1) * 0.25);
}

function buildAirTrack(formationKey, preset, member, position, altitudeFt, speedKts, timestamp) {
    return {
        track_key: getTrackKey(formationKey, member.id),
        title: member.title,
        name: member.title,
        source_name: FORMATION_SOURCE,
        category: "military",
        subcategory: member.subtype,
        country: "USA",
        region: preset.location,
        operator: "United States Air Force",
        asset_key: member.assetKey,
        model_code: member.assetKey,
        render_mode: "glb",
        formation_key: formationKey,
        lat: position.lat,
        lon: position.lon,
        altitude_ft: Math.round(altitudeFt),
        heading_deg: preset.headingDeg,
        speed_kts: speedKts,
        active: true,
        status: "active",
        timestamp,
        last_seen_at: timestamp,
        metadata: {
            asset_key: member.assetKey,
            model_code: member.assetKey,
            model_name: member.title,
            render_mode: "glb",
            formation_key: formationKey,
            simulation: "formation-dev-tuner",
        },
    };
}

function buildNavalEvent(formationKey, preset, member, position, speedKts, timestamp) {
    const trackKey = getTrackKey(formationKey, member.id);
    return {
        id: trackKey,
        source_key: trackKey,
        dedupe_key: trackKey,
        source_name: FORMATION_SOURCE,
        category: "military",
        subcategory: member.subtype,
        title: member.title,
        lat: position.lat,
        lon: position.lon,
        heading_deg: preset.headingDeg,
        speed_kts: speedKts,
        occurred_at: new Date(timestamp).toISOString(),
        updated_at: new Date(timestamp).toISOString(),
        metadata: {
            track_key: trackKey,
            vessel_name: member.title,
            vessel_class: member.assetKey,
            model_code: member.assetKey,
            render_mode: "glb",
            country: "United States",
            operator: "United States Navy",
            ship_type: member.subtype,
            formation_key: formationKey,
            simulation: "formation-dev-tuner",
        },
    };
}

function renderFormation(formationKey, timestamp = Date.now()) {
    const preset = FORMATION_PRESETS[formationKey];
    const runtime = getRuntimeState(formationKey);
    if (!preset || !runtime.active) return;
    const anchor = getAnchorPosition(preset, runtime);
    const spacingScale = runtime.spacingPercent / 100;
    const speedKts = preset.speedKts * (runtime.speedPercent / 100);
    preset.members.forEach((member) => {
        const memberSpacingScale = getMemberSpacingScale(member, spacingScale);
        const position = applyFormationOffset(
            anchor,
            preset.headingDeg,
            member.forwardM * memberSpacingScale,
            member.rightM * memberSpacingScale
        );
        if (preset.domain === "air") {
            upsertLiveTrack(buildAirTrack(
                formationKey,
                preset,
                member,
                position,
                preset.anchorAltitudeFt + (member.altitudeOffsetFt * memberSpacingScale),
                speedKts,
                timestamp
            ));
            return;
        }
        upsertNavalVessel(buildNavalEvent(
            formationKey,
            preset,
            member,
            position,
            speedKts,
            timestamp
        ));
    });
    window.__warzoneViewer?.scene?.requestRender?.();
}

function hasActiveFormation(domain = "") {
    return FORMATION_KEYS.some((key) => {
        const preset = FORMATION_PRESETS[key];
        return (!domain || preset.domain === domain) && getRuntimeState(key).active;
    });
}

function syncSimulationTimer() {
    if (hasActiveFormation()) {
        if (__formationTimer) return;
        __lastTickAt = performance.now();
        __formationTimer = window.setInterval(tickFormations, UPDATE_INTERVAL_MS);
        return;
    }
    if (__formationTimer) window.clearInterval(__formationTimer);
    __formationTimer = 0;
    __lastTickAt = 0;
}

function tickFormations() {
    const now = performance.now();
    const elapsedSeconds = Math.min(1, Math.max(0, (now - __lastTickAt) / 1000));
    __lastTickAt = now;
    const timestamp = Date.now();
    FORMATION_KEYS.forEach((formationKey) => {
        const preset = FORMATION_PRESETS[formationKey];
        const runtime = getRuntimeState(formationKey);
        if (!runtime.active) return;
        const speedMetersPerSecond = preset.speedKts * (runtime.speedPercent / 100) * KNOT_TO_METERS_PER_SECOND;
        runtime.progress = (runtime.progress + ((speedMetersPerSecond * elapsedSeconds) / runtime.routeDistanceMeters)) % 1;
        const spacingDelta = runtime.targetSpacingPercent - runtime.spacingPercent;
        runtime.spacingPercent += spacingDelta * Math.min(1, elapsedSeconds * 6);
        if (Math.abs(spacingDelta) < 0.05) runtime.spacingPercent = runtime.targetSpacingPercent;
        renderFormation(formationKey, timestamp);
    });
}

function ensureTrackerLayer(domain) {
    const layerId = domain === "naval" ? "naval" : "aircraft";
    if (isLayerEnabled(layerId)) return;
    __ownedTrackerLayers[domain] = true;
    setLayer(layerId, true);
}

function releaseTrackerLayer(domain) {
    if (hasActiveFormation(domain) || !__ownedTrackerLayers[domain]) return;
    __ownedTrackerLayers[domain] = false;
    setLayer(domain === "naval" ? "naval" : "aircraft", false);
}

function focusFormation(formationKey = __selectedFormationKey) {
    const preset = FORMATION_PRESETS[formationKey];
    const runtime = getRuntimeState(formationKey);
    if (!preset || !runtime.active) return false;
    const trackKey = getTrackKey(formationKey, preset.focusMemberId);
    if (preset.domain === "naval") {
        return focusNavalVessel(trackKey, {
            rangeMeters: preset.focusRangeMeters,
            duration: 0.9,
        });
    }
    return focusLiveTrack(trackKey);
}

function activateFormation(formationKey = __selectedFormationKey) {
    const preset = FORMATION_PRESETS[formationKey];
    const runtime = getRuntimeState(formationKey);
    if (!preset) return;
    __selectedFormationKey = formationKey;
    ensureTrackerLayer(preset.domain);
    runtime.active = true;
    renderFormation(formationKey);
    syncSimulationTimer();
    syncPanel();
    window.setTimeout(() => focusFormation(formationKey), 160);
}

function clearFormation(formationKey = __selectedFormationKey) {
    const preset = FORMATION_PRESETS[formationKey];
    const runtime = getRuntimeState(formationKey);
    if (!preset) return;
    preset.members.forEach((member) => {
        const trackKey = getTrackKey(formationKey, member.id);
        if (preset.domain === "naval") {
            clearNavalVessel(trackKey);
        } else {
            clearLiveTrack(trackKey);
        }
    });
    runtime.active = false;
    runtime.progress = 0;
    runtime.spacingPercent = runtime.targetSpacingPercent;
    releaseTrackerLayer(preset.domain);
    syncSimulationTimer();
    syncPanel();
}

async function applyViewMode(mode) {
    const viewer = window.__warzoneViewer;
    const globe = viewer?.__warzone;
    if (!globe) return;
    const refocus = () => {
        if (getRuntimeState(__selectedFormationKey).active) focusFormation(__selectedFormationKey);
    };
    if (mode === "ter") {
        Promise.resolve(globe.setContourLayerVisible?.(false))
            .finally(() => {
                globe.setContourGridVisible?.(false);
                globe.restoreDefaultMapRender?.();
                globe.setTerrainVisible?.(true);
                window.setTimeout(refocus, 950);
            });
        return;
    }
    if (mode === "ctr") {
        const preset = FORMATION_PRESETS[__selectedFormationKey];
        const runtime = getRuntimeState(__selectedFormationKey);
        const anchor = getAnchorPosition(preset, runtime);
        globe.setContourFocusPosition?.({ lon: anchor.lon, lat: anchor.lat, height: 0 }, { force: true });
        globe.setContourGridVisible?.(true);
        Promise.resolve(globe.setContourLayerVisible?.(true))
            .finally(() => window.setTimeout(refocus, 950));
        return;
    }
    window.setTimeout(refocus, 950);
}

function buildPanelMarkup() {
    const formationButtons = FORMATION_KEYS.map((key) => {
        const preset = FORMATION_PRESETS[key];
        return `
            <button type="button" class="wz-formation-tuner__preset" data-formation-key="${key}">
                <span>${preset.label}</span>
                <small>${preset.location}</small>
            </button>
        `;
    }).join("");
    return `
        <button id="wz-formation-tuner-launcher" class="wz-formation-tuner__launcher" type="button" aria-controls="wz-formation-tuner" aria-expanded="false">
            FORMATION TUNER
        </button>
        <section id="wz-formation-tuner" class="wz-formation-tuner" aria-label="Formation development tuner" hidden>
            <header class="wz-formation-tuner__header">
                <div>
                    <span>LOCAL SIMULATION</span>
                    <h2>FORMATION DEV TUNER</h2>
                </div>
                <button type="button" data-formation-close aria-label="Close formation tuner">X</button>
            </header>
            <div class="wz-formation-tuner__presets" role="listbox" aria-label="Formation preset">
                ${formationButtons}
            </div>
            <div class="wz-formation-tuner__summary">
                <strong data-formation-name></strong>
                <span data-formation-location></span>
                <small data-formation-members></small>
            </div>
            <div class="wz-formation-tuner__actions">
                <button type="button" data-formation-action="activate">ACTIVATE</button>
                <button type="button" data-formation-action="focus">FOCUS</button>
                <button type="button" data-formation-action="clear">CLEAR</button>
            </div>
            <label class="wz-formation-tuner__control">
                <span>FORMATION SPEED <output data-formation-speed-output></output></span>
                <input type="range" min="25" max="200" step="5" value="100" data-formation-speed>
            </label>
            <label class="wz-formation-tuner__control">
                <span>FORMATION DISTANCE <output data-formation-distance-output></output></span>
                <input type="range" min="50" max="200" step="5" value="100" data-formation-distance>
            </label>
            <button type="button" class="wz-formation-tuner__reset" data-formation-distance-reset>RESET DISTANCE</button>
            <div class="wz-formation-tuner__mode" aria-label="Formation view mode">
                <span>MODE</span>
                <div>
                    <button type="button" data-formation-mode="3d">3D</button>
                    <button type="button" data-formation-mode="ter">TER</button>
                    <button type="button" data-formation-mode="ctr">CTR</button>
                </div>
            </div>
            <div class="wz-formation-tuner__status" data-formation-status></div>
        </section>
    `;
}

function syncPanel() {
    const panel = document.getElementById("wz-formation-tuner");
    if (!panel) return;
    const preset = FORMATION_PRESETS[__selectedFormationKey];
    const runtime = getRuntimeState(__selectedFormationKey);
    panel.querySelectorAll("[data-formation-key]").forEach((button) => {
        const key = button.dataset.formationKey;
        const active = getRuntimeState(key).active;
        button.classList.toggle("is-selected", key === __selectedFormationKey);
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", key === __selectedFormationKey ? "true" : "false");
    });
    const name = panel.querySelector("[data-formation-name]");
    const location = panel.querySelector("[data-formation-location]");
    const members = panel.querySelector("[data-formation-members]");
    const speed = panel.querySelector("[data-formation-speed]");
    const distance = panel.querySelector("[data-formation-distance]");
    const speedOutput = panel.querySelector("[data-formation-speed-output]");
    const distanceOutput = panel.querySelector("[data-formation-distance-output]");
    const status = panel.querySelector("[data-formation-status]");
    if (name) name.textContent = preset.label;
    if (location) location.textContent = preset.location;
    if (members) members.textContent = `${preset.members.length} REGISTERED 3D ASSETS | ${preset.domain.toUpperCase()}`;
    if (speed) speed.value = String(runtime.speedPercent);
    if (distance) distance.value = String(runtime.targetSpacingPercent);
    if (speedOutput) speedOutput.textContent = `${runtime.speedPercent}% | ${Math.round(preset.speedKts * runtime.speedPercent / 100)} KT`;
    if (distanceOutput) distanceOutput.textContent = `${runtime.targetSpacingPercent}%`;
    if (status) status.textContent = runtime.active
        ? "ACTIVE | GROUP MOVEMENT LOCKED"
        : "STANDBY | SELECT ACTIVATE";
    panel.dataset.active = runtime.active ? "1" : "0";
}

function bindPanel() {
    const panel = document.getElementById("wz-formation-tuner");
    const launcher = document.getElementById("wz-formation-tuner-launcher");
    if (!panel || !launcher) return;
    const setOpen = (open) => {
        panel.hidden = !open;
        launcher.hidden = open;
        launcher.setAttribute("aria-expanded", open ? "true" : "false");
    };
    launcher.addEventListener("click", () => setOpen(true));
    panel.querySelector("[data-formation-close]")?.addEventListener("click", () => setOpen(false));
    panel.querySelectorAll("[data-formation-key]").forEach((button) => {
        button.addEventListener("click", () => {
            __selectedFormationKey = button.dataset.formationKey;
            syncPanel();
        });
    });
    panel.querySelectorAll("[data-formation-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.formationAction;
            if (action === "activate") activateFormation();
            if (action === "focus") focusFormation();
            if (action === "clear") clearFormation();
        });
    });
    panel.querySelector("[data-formation-speed]")?.addEventListener("input", (event) => {
        getRuntimeState(__selectedFormationKey).speedPercent = Number(event.target.value);
        syncPanel();
    });
    panel.querySelector("[data-formation-distance]")?.addEventListener("input", (event) => {
        const runtime = getRuntimeState(__selectedFormationKey);
        runtime.targetSpacingPercent = Number(event.target.value);
        if (!runtime.active) runtime.spacingPercent = runtime.targetSpacingPercent;
        syncPanel();
    });
    panel.querySelector("[data-formation-distance-reset]")?.addEventListener("click", () => {
        const runtime = getRuntimeState(__selectedFormationKey);
        runtime.targetSpacingPercent = 100;
        if (!runtime.active) runtime.spacingPercent = 100;
        syncPanel();
    });
    panel.querySelectorAll("[data-formation-mode]").forEach((button) => {
        button.addEventListener("click", () => applyViewMode(button.dataset.formationMode));
    });
}

export function initFormationDevTuner(viewer = window.__warzoneViewer) {
    if (!viewer || document.getElementById("wz-formation-tuner")) return Boolean(viewer);
    document.body.insertAdjacentHTML("beforeend", buildPanelMarkup());
    FORMATION_KEYS.forEach(getRuntimeState);
    bindPanel();
    syncPanel();
    window.__warzoneFormationDevTuner = Object.freeze({
        activate: activateFormation,
        clear: clearFormation,
        focus: focusFormation,
        getPresetKeys: () => FORMATION_KEYS.slice(),
    });
    return true;
}
