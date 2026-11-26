import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
import { parseExpressionAt } from "acorn";
import { getAircraftTelemetry } from "../../../dev/assets/js/warzone-aircraft-telemetry.js";

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-formation-tuner.js", import.meta.url), "utf8");
const key = "hormuz-air-patrol";
const cartographic = point => Cesium.Cartographic.fromDegrees(point.lon, point.lat);
const distance = (a, b) => new Cesium.EllipsoidGeodesic(cartographic(a), cartographic(b)).surfaceDistance;
const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;

function element() {
    return { dataset: {}, hidden: false, listeners: {}, value: "", textContent: "",
        classList: { toggle() {} }, setAttribute() {},
        addEventListener(name, handler) { assert.equal(this.listeners[name], undefined); this.listeners[name] = handler; },
        fire(name, value) { if (value != null) this.value = String(value); return this.listeners[name]?.({ target: this }); } };
}
function harness() {
    const elements = new Map(), tracks = new Map(), focused = [], intervals = new Map();
    const panel = element(), launcher = element();
    for (const name of ["close", "speed", "distance", "distance-reset", "name", "location", "members", "speed-output", "distance-output", "status"]) {
        elements.set(`[data-formation-${name}]`, element());
    }
    panel.querySelector = selector => elements.get(selector);
    panel.querySelectorAll = () => [];
    let now = 0, starts = 0;
    const epoch = Date.now();
    const view = { setContourFocusPosition: position => { view.contour = position; },
        setContourGridVisible() {}, setContourLayerVisible: () => Promise.resolve(),
        restoreDefaultMapRender() {}, setTerrainVisible() {} };
    const c = vm.createContext({ Cesium, console, Date: class extends Date { static now() { return epoch + now; } },
        window: { __warzoneViewer: { __warzone: view, scene: { requestRender() {} } },
            setInterval(fn) { intervals.set(++starts, fn); return starts; }, clearInterval: id => intervals.delete(id),
            setTimeout: fn => { fn(); return 1; } },
        document: { getElementById: id => id === "wz-formation-tuner" ? panel : id === "wz-formation-tuner-launcher" ? launcher : null },
        performance: { now: () => now }, isLayerEnabled: () => true, setLayer() {},
        upsertLiveTrack: track => tracks.set(track.track_key, track), clearLiveTrack: id => tracks.delete(id),
        focusLiveTrack: id => { focused.push(id); return true; },
    });
    vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), c);
    c.bindPanel();
    const preset = vm.runInContext(`FORMATION_PRESETS["${key}"]`, c);
    const runtime = c.getRuntimeState(key);
    function tick(seconds = .25) { now += seconds * 1000; for (const fn of intervals.values()) fn(); }
    return { c, preset, runtime, tracks, focused, intervals, panel, launcher, view, elements, tick,
        track: () => tracks.get(c.getTrackKey(key, preset.members[0].id)) };
}

test("patrol follows the naval preset, uses the registered E3 GLB and fully populated local telemetry", () => {
    const h = harness();
    const keys = vm.runInContext("FORMATION_KEYS", h.c);
    assert.equal(keys.indexOf(key), keys.indexOf("hormuz") + 1);
    assert.equal(h.preset.members.length, 1);
    const model = fs.readFileSync(new URL("../../../dev/assets/images/models/air/AWACS-E3.glb", import.meta.url));
    assert.equal(model.subarray(0, 4).toString(), "glTF");
    const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString());
    assert.ok(gltf.meshes.length > 0);
    h.c.activateFormation(key);
    const track = h.track(), telemetry = getAircraftTelemetry(track);
    assert.equal(track.model_code, "AWACS-E3");
    assert.equal(track.type_code, "E3CF");
    assert.match(track.icao24, /^[A-F0-9]{6}$/);
    assert.notEqual(track.simulation_id, track.icao24);
    assert.match(track.simulation_id, /^dev-formation-/);
    assert.equal(telemetry.country, "United Arab Emirates");
    assert.equal(track.lat, h.preset.start.lat); assert.equal(track.lon, h.preset.start.lon);
    assert.equal(track.source_name, "LOCAL SIMULATION");
    assert.equal(track.metadata.simulation, "formation-dev-tuner");
    for (const [name, value] of telemetry.fields) {
        if (["Last received (UTC)", "Record updated (UTC)"].includes(name)) continue; // Supplemental registry fields, not source telemetry.
        assert.doesNotMatch(value, /N\/A|Unavailable/, name);
    }
    assert.equal(h.focused.at(-1), track.track_key);
    assert.equal(h.tracks.size, 1);
});

test("two hours of flight merge into repeated clockwise orbits without resets or heading/position jumps", () => {
    const h = harness(); h.c.activateFormation(key);
    let winding = 0, previousBearing;
    for (let step = 0; step < 2 * 3600 * 4; step++) {
        const previous = { ...h.runtime.patrol };
        h.tick();
        const state = h.runtime.patrol;
        assert.ok(distance(previous, state) <= state.speedMps * .25 + .01);
        assert.ok(Math.abs(angleDelta(state.headingDeg, previous.headingDeg)) <= .750001);
        assert.equal(h.track().altitude_ft, 22000);
        if (step === 240) assert.ok(state.lon > h.preset.start.lon, "departure flies east toward the sea");
        if (step > 3600 * 4) {
            const radius = distance(state, h.preset.patrol.orbitCenter);
            assert.ok(Math.abs(radius - 18000) < 150, `settled radius ${radius}`);
            assert.ok(distance(state, h.preset.start) > 15000, "no return to departure");
            const bearing = Cesium.Math.toDegrees(new Cesium.EllipsoidGeodesic(cartographic(h.preset.patrol.orbitCenter), cartographic(state)).startHeading);
            if (previousBearing != null) winding += angleDelta(bearing, previousBearing);
            previousBearing = bearing;
        }
    }
    assert.ok(winding > 3 * 360, `clockwise revolutions: ${winding / 360}`);
    assert.equal(h.tracks.size, 1); assert.equal(h.intervals.size, 1);
    const observation = h.track().metadata.telemetry.observed_at;
    h.c.renderFormation(key, Date.parse(observation) + 250);
    assert.notEqual(h.track().metadata.telemetry.observed_at, observation);
});

test("existing speed/radius/reset controls steer gradually, and close/reopen and view modes preserve flight", async () => {
    const h = harness(); h.c.activateFormation(key);
    for (let i = 0; i < 4000; i++) h.tick();
    h.elements.get("[data-formation-speed]").fire("input", 200);
    h.elements.get("[data-formation-distance]").fire("input", 50);
    assert.equal(h.runtime.speedPercent, 200); assert.equal(h.runtime.targetSpacingPercent, 50);
    for (let i = 0; i < 1000; i++) {
        const previous = { ...h.runtime.patrol }; h.tick();
        assert.ok(Math.abs(h.runtime.patrol.speedMps - previous.speedMps) <= .750001);
        assert.ok(Math.abs(h.runtime.patrol.radiusMeters - previous.radiusMeters) <= 12.500001);
        assert.ok(distance(previous, h.runtime.patrol) <= h.runtime.patrol.speedMps * .25 + .01);
        assert.ok(Math.abs(angleDelta(h.runtime.patrol.headingDeg, previous.headingDeg)) <= .750001);
    }
    assert.equal(h.runtime.patrol.radiusMeters, 9000);
    h.elements.get("[data-formation-distance-reset]").fire("click");
    assert.equal(h.runtime.targetSpacingPercent, 100); assert.equal(h.runtime.patrol.radiusMeters, 9000);
    const before = { ...h.runtime.patrol };
    h.elements.get("[data-formation-close]").fire("click");
    assert.equal(h.panel.hidden, true); assert.equal(h.runtime.active, true);
    h.tick(); assert.ok(distance(before, h.runtime.patrol) > 0);
    h.launcher.fire("click"); assert.equal(h.panel.hidden, false);
    assert.equal(h.elements.get("[data-formation-speed]").value, "200");
    for (const mode of ["3d", "ter", "ctr", "ter", "3d"]) {
        const position = JSON.stringify(h.runtime.patrol);
        await h.c.applyViewMode(mode); await Promise.resolve();
        assert.equal(JSON.stringify(h.runtime.patrol), position);
    }
    assert.equal(h.view.contour.lon, h.runtime.patrol.lon);
    assert.equal(h.view.contour.lat, h.runtime.patrol.lat);
    h.c.activateFormation(key); assert.equal(h.intervals.size, 1);
    assert.ok(distance(h.runtime.patrol, h.preset.start) > 1000, "reactivation does not reset active flight");
    h.c.clearFormation(key);
    assert.equal(h.tracks.size, 0); assert.equal(h.intervals.size, 0); assert.equal(h.runtime.patrol, null);
    h.c.activateFormation(key);
    assert.equal(h.track().lat, h.preset.start.lat); assert.equal(h.track().lon, h.preset.start.lon);
});

test("counterclockwise preset configuration is supported without changing other formations", () => {
    const h = harness(), preset = { ...h.preset, patrol: { ...h.preset.patrol, clockwise: false } };
    const runtime = { speedPercent: 100, targetSpacingPercent: 100 };
    h.c.initializePatrol(preset, runtime);
    let previous, winding = 0;
    for (let step = 0; step < 7200 * 4; step++) {
        h.c.advancePatrol(preset, runtime, .25);
        if (step > 3600 * 4) {
            const bearing = Cesium.Math.toDegrees(new Cesium.EllipsoidGeodesic(cartographic(preset.patrol.orbitCenter), cartographic(runtime.patrol)).startHeading);
            if (previous != null) winding += angleDelta(bearing, previous);
            previous = bearing;
        }
    }
    assert.ok(winding < -3 * 360);
    h.c.activateFormation("nevada"); h.tick();
    assert.ok(h.c.getRuntimeState("nevada").progress > 0);
    assert.equal(h.c.getRuntimeState("nevada").patrol, undefined);
});

test("all speed/radius slider extremes converge to the requested circle", () => {
    const h = harness();
    for (const speedPercent of [25, 200]) for (const targetSpacingPercent of [50, 200]) {
        const runtime = { speedPercent, targetSpacingPercent };
        for (let step = 0; step < 2 * 3600 * 4; step++) h.c.advancePatrol(h.preset, runtime, .25);
        const radius = distance(runtime.patrol, h.preset.patrol.orbitCenter);
        const target = h.preset.patrol.orbitRadiusMeters * targetSpacingPercent / 100;
        assert.ok(Math.abs(radius - target) < 200, `${speedPercent}% speed, ${targetSpacingPercent}% radius: ${radius}`);
    }
});

test("repository country geometry places departure in UAE land and the default circle offshore", () => {
    const h = harness();
    const countries = JSON.parse(fs.readFileSync(new URL("../../../dev/assets/data/ne_110m_admin_0_countries.geojson", import.meta.url), "utf8"));
    function inside(point, ring) {
        let result = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [x, y] = ring[i], [u, v] = ring[j];
            if ((y > point.lat) !== (v > point.lat) && point.lon < (u - x) * (point.lat - y) / (v - y) + x) result = !result;
        }
        return result;
    }
    function land(point) {
        return countries.features.filter(feature => (feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates])
            .some(polygon => inside(point, polygon[0]) && !polygon.slice(1).some(ring => inside(point, ring))));
    }
    assert.equal(land(h.preset.start)[0].properties.ADMIN, "United Arab Emirates");
    for (let angle = 0; angle < 360; angle += 10) {
        const point = Cesium.EllipsoidRhumbLine.fromStartHeadingDistance(cartographic(h.preset.patrol.orbitCenter), Cesium.Math.toRadians(angle), 18000).end;
        assert.equal(land({ lat: Cesium.Math.toDegrees(point.latitude), lon: Cesium.Math.toDegrees(point.longitude) }).length, 0);
    }
});

test("shared tracker admits the local patrol and banks its quarter-second fixes without changing live-data guards", () => {
    const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
    let layer = true;
    const c = vm.createContext({
        __liveTrackVisualState: new Map(), __liveTrackLastPositions: new Map(),
        LIVE_TRACK_HEADING_SPIKE_MIN_DEG: 90, LIVE_TRACK_HEADING_CONFIRMATION_DEG: 20,
        LIVE_TRACK_MIN_PREDICTION_SPEED_KTS: 15,
        normalizeDegrees: value => (value + 360) % 360,
        getShortestAngleDeltaDeg: (a, b) => angleDelta(b, a),
        getCssNumber: (name, fallback) => name === "--warzone-live-aircraft-model-dynamic-bank-enabled" ? 1 : fallback,
        getSubtypeCssNumber: () => 18, resolveTrackSubtype: track => track.subcategory,
        getTrackSourceTimestamp: track => track.timestamp, getTrackDerivedBearing: () => null,
        clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
        isLayerEnabled: () => layer, matchesLiveTrackVisibilityFilter: () => false, shouldShowTrackInFocusMode: () => false,
    });
    for (const name of ["getTrackMetadata", "getFormationDevGroupKey", "isLocalAirPatrolTrack", "shouldRenderLiveTrackDataState", "getTrackVisualState", "getTrackAttitude"]) {
        const start = air.indexOf(`function ${name}(`);
        vm.runInContext(air.slice(start, parseExpressionAt(air, start, { ecmaVersion: "latest" }).end), c);
    }
    const h = harness(); h.c.activateFormation(key);
    const local = h.track(), live = { ...local, track_key: "live", metadata: {} };
    assert.equal(c.shouldRenderLiveTrackDataState(local.track_key, local), true, "local asset survives regional/focus filters");
    assert.equal(c.shouldRenderLiveTrackDataState(live.track_key, live), false, "live filters unchanged");
    assert.equal(c.shouldRenderLiveTrackDataState(local.track_key, { ...local, active: false }), false);
    layer = false; assert.equal(c.shouldRenderLiveTrackDataState(local.track_key, local), false); layer = true;
    c.getTrackAttitude(local, 0); c.getTrackAttitude(live, 0);
    let localBank = 0;
    for (let step = 1; step <= 100; step++) {
        const timestamp = local.timestamp + step * 250;
        localBank = c.getTrackAttitude({ ...local, timestamp }, step * .13).rollDeg;
        assert.equal(c.getTrackAttitude({ ...live, timestamp }, step * .13).rollDeg, 0);
    }
    assert.ok(localBank < -5 && localBank >= -18, `continuous clockwise bank ${localBank}`);
    const level = c.getTrackAttitude({ ...local, timestamp: local.timestamp + 25250 }, 13).rollDeg;
    assert.ok(Math.abs(level) < Math.abs(localBank), "bank eases back on straight flight");
});
