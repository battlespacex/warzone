import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
import { readGlbSizing, applyGlbDistanceSizing } from "../../../dev/assets/js/warzone-glb-distance-sizing.js";
import { resolveNavalIdentity, selectVerifiedNavalModel } from "../../shared/naval-identity.js";
import { getNavalContactStatus } from "../../shared/naval-contact-lifecycle.js";

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
class Signal {
    listeners = new Set();
    addEventListener(fn) { this.listeners.add(fn); }
    removeEventListener(fn) { this.listeners.delete(fn); }
    fire(...args) { for (const fn of [...this.listeners]) fn(...args); }
}
class Events {
    events = new Map();
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, new Signal()); this.events.get(name).addEventListener(fn); }
    removeEventListener(name, fn) { this.events.get(name)?.removeEventListener(fn); }
    fire(name, value) { this.events.get(name)?.fire(value); }
    dispatchEvent(event) { this.fire(event.type, event); }
}

function harness() {
    const frames = new Map(), animations = new Map(), tasks = new Map(), warnings = [], flights = [];
    let frameId = 0, generation = 0, selected = "", renderRequests = 0, styleReads = 0;
    let region = { id: "test", bounds: { minLat: 20, maxLat: 40, minLon: 40, maxLon: 60 } };
    const css = new Map(Object.entries({
        "--warzone-live-naval-model-max-active": "6", "--warzone-live-naval-model-scale": "1.2",
        "--warzone-live-naval-model-focused-size": "6.5", "--warzone-live-naval-model-min-pixel-size": "82",
        "--warzone-live-naval-model-focused-min-pixel-size": "82", "--warzone-live-naval-model-max-scale": "160",
        "--warzone-live-naval-model-max-scale-focused": "220",
        "--warzone-live-naval-focused-distance": "2216",
        "--warzone-live-naval-focus-initial-distance": "12216",
    }));
    const style = { getPropertyValue: (name) => { styleReads++; return css.get(name) || ""; } };
    const camera = { positionWC: Cesium.Cartesian3.fromDegrees(50, 30, 500000),
        directionWC: new Cesium.Cartesian3(0, 1, 0), upWC: new Cesium.Cartesian3(0, 0, 1),
        positionCartographic: { height: 500000 }, moveStart: new Signal(), moveEnd: new Signal(), changed: new Signal(),
        cancelFlight() {}, lookAtTransform() {}, flyTo(options) { flights.push(options); },
        flyToBoundingSphere(sphere, options) { flights.push({ sphere, ...options }); } };
    const viewer = { camera, entities: new Cesium.EntityCollection(), isDestroyed: () => false,
        scene: { mode: Cesium.SceneMode.SCENE3D, preRender: new Signal(), postRender: new Signal(),
            requestRender() { renderRequests++; } }, __warzone: {}, container: { style: {} } };
    const window = Object.assign(new Events(), { __warzoneViewer: viewer, getComputedStyle: () => style });
    const status = { hidden: true, textContent: "" };
    const document = Object.assign(new Events(), { documentElement: {},
        body: { classList: { contains: () => false } },
        getElementById: (id) => id === "wz-naval-render-status" ? status : null,
        createElement: () => { throw new Error("GLB rendering must not create a canvas or billboard DOM"); } });
    const controller = { getState: () => ({ state: selected ? "active" : "inactive", assetType: selected ? "naval" : "", assetId: selected }),
        getGeneration: () => generation, isCurrent: (value) => generation === value,
        canEnterFocus: () => true, isActiveAsset: (id, type) => selected === id && type === "naval",
        enterFocus({ assetId }) { selected = assetId; generation++; return true; },
        exitFocus() { selected = ""; generation++; }, requestFrame() {},
        registerTask(name, fn) { tasks.set(name, fn); }, removeTask(name) { tasks.delete(name); } };
    const context = vm.createContext({ Cesium, readGlbSizing, applyGlbDistanceSizing, resolveNavalIdentity, selectVerifiedNavalModel, getNavalContactStatus,
        window, document, getComputedStyle: () => style, performance,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        getActiveRegion: () => region, flyToRegion: (_viewer, target) => { flights.push({ region: target.id }); return Promise.resolve(true); },
        getAssetFocusController: () => controller, closeFocusDriftWarningModal() {},
        requestSharedSceneRender: () => viewer.scene.requestRender(),
        registerAnimationTask: (key, fn) => animations.set(key, fn), unregisterAnimationTask: (key) => animations.delete(key),
        requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; },
        cancelAnimationFrame: (id) => frames.delete(id), console: { warn: (...args) => warnings.push(args) },
    });
    vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), context);
    // UI mounting/picking are separate browser concerns. Keep the real render,
    // admission, camera event ownership and Entity/ModelGraphics functions.
    vm.runInContext(`ensureNavalOverlayRoot=()=>{};bindNavalFocusInteraction=()=>{};bindNavalPicking=()=>{};
        syncNavalOverlay=()=>{};checkNavalFocusRangeWarning=()=>{};hideNavalHoverLabel=()=>{};
        hideNavalHoverGuide=()=>{};clearNavalHoverLabel=()=>{};syncNavalWidgetHighlight=()=>{};
        syncNavalContourCenter=()=>{};syncFocusedNavalCamera=()=>{};setNavalFocusedZoomLock=()=>{};`, context);
    function drain() {
        let calls = 0;
        while (frames.size) {
            assert.ok(calls++ < 1000, "no self-sustaining visual loop");
            const [id, fn] = frames.entries().next().value; frames.delete(id); fn();
        }
        return calls;
    }
    function add(index, lon = 49 + index * .01, lat = 30, metadata = {}) {
        return context.upsertNavalVessel({ dedupe_key: `ais-${index}`, title: `CONTACT ${index}`, lat, lon,
            source_name: "AIS fixture", occurred_at: "2026-11-10T12:00:00Z",
            metadata: { mmsi: `999${String(index).padStart(6, "0")}`, ship_type: 35, vessel_name: `CONTACT ${index}`,
                sources: [{ provider: "aisstream" }], ...metadata } });
    }
    return { context, viewer, window, document, css, frames, animations, tasks, warnings, flights, status, add, drain,
        get renderRequests() { return renderRequests; }, region(value) { region = value; },
        get styleReads() { return styleReads; }, resetStyleReads() { styleReads = 0; },
        state: vm.runInContext("__navalState", context) };
}

test("every eligible overview and focused contact has ModelGraphics without an omission budget", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    for (let i = 0; i < 12; i++) h.add(i);
    h.drain();
    assert.equal(h.viewer.entities.values.length, 12);
    assert.equal(h.state.vessels.size, 12);
    for (const entity of h.viewer.entities.values) {
        assert.ok(entity.model instanceof Cesium.ModelGraphics); assert.equal(entity.billboard, undefined);
        assert.ok(entity.model.uri.getValue().url.endsWith("/assets/images/models/sea/Vessel-Frigate.glb"));
        assert.equal(entity.model.scale.getValue(), 1.2); assert.equal(entity.model.minimumPixelSize.getValue(), 82);
        assert.equal(entity.model.maximumScale.getValue(), 160);
        assert.equal(entity.model.heightReference.getValue(), Cesium.HeightReference.NONE);
        assert.equal(entity.__navalData.military_status, "unknown"); assert.equal(entity.__navalData.vessel_class, "");
    }
    assert.equal(h.status.hidden, true); assert.match(h.status.textContent, /12 of 12/);
    assert.equal(h.context.focusNavalVessel("ais-0"), true);
    assert.equal(h.viewer.entities.values.length, 12);
    const focused = h.state.vessels.get("ais-0").entity;
    assert.ok(focused.model); assert.equal(focused.billboard, undefined);
    assert.equal(focused.model.scale.getValue(), 6.5); assert.equal(focused.model.minimumPixelSize.getValue(), 82);
    assert.equal(focused.model.maximumScale.getValue(), 220);
    assert.equal(h.flights.at(-1).offset.range, 12216);
    assert.equal(h.context.getNavalModelTunerFocusConfig().minRange, 2216);
    h.css.set("--warzone-live-naval-model-max-active", "0");
    h.viewer.camera.changed.fire(); h.drain();
    assert.equal(h.viewer.entities.values.length, 12, "legacy budget cannot omit regional models");
    assert.equal(h.state.vessels.get("ais-0").entity, focused);
});

test("active distance CSS reaches naval ModelGraphics through normal, Focus and Unfocus paths", () => {
    const h = harness();
    h.css.set("--warzone-live-naval-model-scale-min", "3");
    h.css.set("--warzone-live-naval-model-scale-max", "7");
    h.css.set("--warzone-live-naval-model-min-pixel-size", "16");
    h.css.set("--warzone-live-glb-scale-transition-ms", "0");
    h.css.set("--warzone-live-naval-model-focused-size", "20");
    h.context.setNavalLayerVisible(true); h.add(0); h.drain();
    const entity = h.state.vessels.get("ais-0").entity, time = Cesium.JulianDate.now();
    const property = entity.model.scale;
    const position = entity.position.getValue(time);
    Cesium.Cartesian3.add(position, new Cesium.Cartesian3(2500,0,0), h.viewer.camera.positionWC);
    assert.ok(Math.abs(property.getValue(time)-7/3)<1e-9);
    h.context.focusNavalVessel("ais-0"); h.drain();
    assert.equal(entity.model.scale, property);
    assert.ok(Math.abs(property.getValue(time)-7/3)<1e-9);
    h.context.clearNavalSelection(); h.drain();
    assert.equal(entity.model.scale, property);
    Cesium.Cartesian3.add(position, new Cesium.Cartesian3(160000,0,0), h.viewer.camera.positionWC);
    assert.equal(property.getValue(time), 1);
});

test("explicit style refresh cannot restore the obsolete GLB omission budget", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    for (let i = 0; i < 10; i++) h.add(i);
    h.drain(); assert.equal(h.viewer.entities.values.length, 10);
    h.css.set("--warzone-live-naval-model-max-active", "9");
    h.context.refreshNavalVisualStyles(); h.drain();
    assert.equal(h.viewer.entities.values.length, 10);
    assert.equal(h.state.vessels.size, 10);
    assert.ok(h.viewer.entities.values.every((entity) => entity.model && !entity.billboard));
});

test("verified model assignments and generic placeholders remain separate from actual vessel classification", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    for (const [index, category, shipClass, expected] of [
        [1, "carrier", "Fixture carrier", "Carrier-US"], [2, "destroyer", "Zumwalt class", "Vessel-Zumwalt"],
        [3, "patrol", "", "Neutral"], [4, "cruiser", "Fixture cruiser", "Neutral"],
    ]) {
        const mmsi = `999${String(index).padStart(6, "0")}`;
        h.context.upsertNavalVessel({ dedupe_key: `ais-${index}`, lat: 30, lon: 50, occurred_at: "2026-11-10T12:00:00Z",
            metadata: { mmsi, ship_type: 35, identity_verification: { status: "verified", source: "isolated fixture registry",
                verified_at: "2026-11-01", identifiers: { mmsi }, military_status: "military",
                naval_force: "US Navy", category, ship_class: shipClass, length_m: 180 } } });
        h.drain();
        const entry = h.state.vessels.get(`ais-${index}`);
        assert.equal(entry.data.subcategory, category);
        assert.equal(entry.data.verification_status, "verified");
        assert.equal(h.context.resolveNavalAssetKey(entry.data), expected);
        assert.ok(entry.entity.model && !entry.entity.billboard);
        if (expected === "Neutral") {
            assert.equal(h.context.getNavalModelDescriptor(entry.data).representation, "generic-vessel-placeholder");
            assert.notEqual(entry.data.subcategory, "frigate");
        }
    }
});

test("zoom, pan and CSS resize update without map clicks, duplicate listeners or unchanged-entity replacement", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    for (let i = 0; i < 10; i++) h.add(i, 48 + i * .4);
    h.drain();
    const original = [...h.viewer.entities.values];
    const created = h.state.createdCount;
    h.resetStyleReads();
    h.viewer.camera.positionCartographic.height = 12000000;
    for (let i = 0; i < 20; i++) h.viewer.camera.changed.fire();
    assert.equal(h.frames.size, 0, "camera movement delegates distance sizing to Cesium without a fleet scan");
    assert.equal(h.styleReads, 0);
    h.drain();
    assert.deepEqual(h.viewer.entities.values, original); assert.equal(h.state.createdCount, created);
    h.css.set("--warzone-live-naval-model-scale", "2.3"); h.css.set("--warzone-live-naval-model-min-pixel-size", "96");
    h.window.fire("resize"); h.drain();
    for (const entity of h.viewer.entities.values) {
        assert.equal(entity.model.scale.getValue(), 2.3); assert.equal(entity.model.minimumPixelSize.getValue(), 96);
    }
    h.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(48, 30, 10000);
    h.viewer.camera.moveStart.fire(); h.viewer.camera.changed.fire(); h.viewer.camera.moveEnd.fire(); h.drain();
    assert.equal(h.viewer.entities.values.length, 10);
    assert.ok(h.state.admittedKeys.has("ais-0"), "panning retains geographically eligible contacts");
    assert.ok(h.viewer.entities.values.every((entity) => entity.model && !entity.billboard));
    assert.equal(h.viewer.camera.changed.listeners.size, 1);
    assert.equal(h.window.events.get("resize").listeners.size, 1);
    h.context.setNavalLayerVisible(false); h.drain();
    assert.equal(h.viewer.entities.values.length, 0); assert.equal(h.state.vessels.size, 10);
    assert.equal(h.viewer.camera.changed.listeners.size, 0); assert.equal(h.animations.size, 0);
    assert.equal(h.tasks.size, 0); assert.equal(h.frames.size, 0);
    assert.equal(h.context.focusNavalVessel("ais-0"), false, "cached rows cannot bypass layer OFF");
    assert.equal(h.viewer.entities.values.length, 0);
    h.context.setNavalLayerVisible(true); h.drain();
    assert.equal(h.viewer.entities.values.length, 10); assert.equal(h.viewer.camera.changed.listeners.size, 1);
});

test("region changes remove only rendering/focus, keep observations and enforce date-line bounds", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(1); h.add(2, 70); h.drain();
    assert.equal(h.viewer.entities.values.length, 1);
    assert.equal(h.context.focusNavalVessel("ais-2"), false);
    assert.equal(h.context.focusNavalVessel("ais-1"), true);
    const flights = h.flights.length;
    h.region({ id: "other", bounds: { minLat: 20, maxLat: 40, minLon: 65, maxLon: 80 } });
    h.document.fire("wz:region-camera-settled"); h.drain();
    assert.equal(h.state.selectedKey, null); assert.equal(h.flights.length, flights, "region cleanup does not fly out");
    assert.equal(h.viewer.entities.values.length, 1); assert.ok(h.state.vessels.get("ais-2").entity);
    assert.equal(h.state.vessels.size, 2);
    h.region({ id: "date-line", bounds: { minLat: -10, maxLat: 10, minLon: 170, maxLon: -170 } });
    assert.equal(h.context.isNavalInSelectedRegion({ lat: 0, lon: 175 }), true);
    assert.equal(h.context.isNavalInSelectedRegion({ lat: 0, lon: -175 }), true);
    assert.equal(h.context.isNavalInSelectedRegion({ lat: 0, lon: 0 }), false);
    h.region(null); assert.equal(h.context.isNavalInSelectedRegion({ lat: 0, lon: 175 }), false);
});

test("CSS minimum pixels account for the real drawing-buffer ratio without changing model scale", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(1); h.drain();
    const entity = h.viewer.entities.values[0];
    h.viewer.scene.canvas = { clientWidth: 800 };
    h.viewer.scene.drawingBufferWidth = 1600;
    h.window.fire("resize"); h.drain();
    assert.equal(entity.model.minimumPixelSize.getValue(), 164);
    assert.equal(entity.model.scale.getValue(), 1.2);
    h.viewer.scene.drawingBufferWidth = 800;
    h.window.fire("resize"); h.drain();
    assert.equal(entity.model.minimumPixelSize.getValue(), 82);
    assert.equal(h.viewer.entities.values[0], entity);
});

test("failed model request diagnostics identify the exact GLB and never add a retry or billboard", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(1); h.drain();
    const model = h.viewer.entities.values[0].model;
    const resource = model.uri.getValue();
    assert.equal(resource.retryCallback(resource, { message: "HTTP 404", statusCode: 404 }), false);
    const failure = h.context.getNavalDiagnostics().modelFailures[0];
    assert.ok(failure.uri.endsWith("Vessel-Frigate.glb")); assert.equal(failure.status, 404);
    assert.equal(h.warnings.length, 1); assert.equal(h.viewer.entities.values[0].model, model);
    assert.equal(h.status.hidden, false); assert.match(h.status.textContent, /request failure/);
    assert.equal(h.viewer.entities.values[0].billboard, undefined);
});

test("146 fixture inputs reconcile to 144 valid records and all 140 regional GLBs, including stationary contacts", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    for (let i = 0; i < 140; i++) h.add(i, 49 + i * .01, 30, { speed_knots: 0, heading_deg: 90 });
    for (let i = 140; i < 144; i++) h.add(i, 70);
    h.add(144, 200); h.add(145, 50, 95); h.drain();
    const diagnostics = h.context.getNavalDiagnostics();
    assert.equal(h.state.vessels.size, 144);
    assert.equal(diagnostics.regionalEligibleContacts, 140);
    assert.equal(diagnostics.assignedGlbEntities, 140);
    assert.equal(diagnostics.budgetOmittedContacts, 0);
    assert.equal(diagnostics.loadedGlbModels, null, "ModelGraphics is not proof of GPU readiness");
    assert.equal(h.viewer.entities.values.length, 140);
    for (let i = 0; i < 140; i++) {
        const entry = h.state.vessels.get(`ais-${i}`);
        assert.equal(entry.data.speed_kts, 0);
        assert.equal(entry.data.heading_deg, 90);
        assert.ok(entry.entity.show && entry.entity.model.show.getValue());
        assert.ok(entry.entity.model.uri.getValue().url.endsWith(".glb"));
        const location = Cesium.Cartographic.fromCartesian(entry.entity.position.getValue(Cesium.JulianDate.now()));
        assert.ok(Math.abs(Cesium.Math.toDegrees(location.longitude) - (49 + i * .01)) < 1e-9);
        assert.ok(Math.abs(Cesium.Math.toDegrees(location.latitude) - 30) < 1e-9);
    }
    h.region({ id: "global" });
    assert.equal(h.context.isNavalInSelectedRegion({ lat: null, lon: null }), false);
    assert.equal(h.context.isNavalInSelectedRegion({ lat: 95, lon: 50 }), false);
    h.context.setNavalLayerVisible(false); h.drain();
    assert.equal(h.viewer.entities.values.length, 0); assert.equal(h.frames.size, 0);
});

test("tab return and repeated ON synchronization preserve the focused entity/model and camera ownership", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(0); h.add(1); h.drain();
    h.context.focusNavalVessel("ais-0"); h.drain();
    const entry = h.state.vessels.get("ais-0"), entity = entry.entity, model = entity.model;
    const created = h.state.createdCount, flights = h.flights.length;
    const camera = Cesium.Cartesian3.clone(h.viewer.camera.positionWC);
    h.document.hidden = true; h.document.fire("visibilitychange");
    assert.equal(h.frames.size, 0);
    h.document.hidden = false; h.document.fire("visibilitychange"); h.drain();
    for (let i = 0; i < 5; i++) { h.context.setNavalLayerVisible(true); h.drain(); }
    assert.equal(entry.entity, entity); assert.equal(entity.model, model); assert.equal(entity.show, true);
    assert.equal(h.state.selectedKey, "ais-0"); assert.equal(h.state.createdCount, created);
    assert.equal(h.state.destroyedCount, 0); assert.equal(h.flights.length, flights);
    assert.deepEqual(h.viewer.camera.positionWC, camera);
    assert.equal(h.document.events.get("visibilitychange").listeners.size, 1);
    h.viewer.useDefaultRenderLoop = false;
    h.document.fire("visibilitychange"); h.drain();
    assert.equal(h.viewer.useDefaultRenderLoop, false, "a fatal loop is never force-restarted");
    h.context.setNavalLayerVisible(false); h.drain();
    assert.equal(h.document.events.get("visibilitychange").listeners.size, 0);
});

test("tab recovery repairs only missing GLBs and restores hidden entities without replacing healthy models", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(0); h.add(1); h.drain();
    const healthy = h.state.vessels.get("ais-0").entity;
    const missing = h.state.vessels.get("ais-1").entity;
    healthy.show = false; h.viewer.entities.remove(missing);
    const created = h.state.createdCount;
    h.document.fire("visibilitychange"); h.drain();
    assert.equal(h.state.vessels.get("ais-0").entity, healthy); assert.equal(healthy.show, true);
    assert.notEqual(h.state.vessels.get("ais-1").entity, missing);
    assert.equal(h.state.createdCount, created + 1); assert.equal(h.viewer.entities.values.length, 2);
});

test("rapid focus switching and Unfocus restore normal sizes without losing entities", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(0); h.add(1); h.drain();
    const first = h.state.vessels.get("ais-0").entity, second = h.state.vessels.get("ais-1").entity;
    h.context.focusNavalVessel("ais-0");
    assert.equal(first.model.scale.getValue(), 6.5);
    h.context.focusNavalVessel("ais-1");
    assert.equal(first.model.scale.getValue(), 1.2); assert.equal(second.model.scale.getValue(), 6.5);
    assert.equal(first.model.minimumPixelSize.getValue(), second.model.minimumPixelSize.getValue());
    h.context.clearNavalSelection(); h.drain();
    assert.equal(second.model.scale.getValue(), 1.2); assert.equal(first.show && second.show, true);
    assert.equal(h.viewer.entities.values.length, 2);
});

test("legitimate moving observations reuse the focused GLB and preserve heading interpolation", () => {
    const h = harness(); h.context.setNavalLayerVisible(true);
    h.viewer.camera.positionCartographic.height = 1000;
    h.add(0, 50, 30, { heading_deg: 90, speed_kts: 10 }); h.drain();
    h.context.focusNavalVessel("ais-0"); h.drain();
    const entity = h.state.vessels.get("ais-0").entity, model = entity.model;
    h.context.upsertNavalVessel({ dedupe_key: "ais-0", lat: 30, lon: 50.002,
        source_name: "AIS fixture", occurred_at: "2026-11-10T12:02:00Z",
        metadata: { mmsi: "999000000", ship_type: 35, heading_deg: 110, speed_kts: 10,
            vessel_name: "CONTACT 0", sources: [{ provider: "aisstream" }] } });
    h.drain();
    assert.equal(h.state.vessels.get("ais-0").entity, entity);
    assert.equal(entity.model, model); assert.equal(h.viewer.entities.values.length, 1);
    const motion = entity.__navalMotionState;
    assert.ok(motion); assert.equal(h.animations.size, 1);
    const tick = h.animations.get("naval:ais-0");
    assert.equal(tick(motion.startTime + motion.duration / 2), true);
    assert.ok(Math.abs(entity.__navalHeadingDeg - 100) < 1e-9);
    assert.equal(tick(motion.startTime + motion.duration), false);
    h.animations.delete("naval:ais-0"); // Shared scheduler removes completed tasks.
    const position = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
    assert.ok(Math.abs(Cesium.Math.toDegrees(position.longitude) - 50.002) < 1e-9);
    assert.ok(Math.abs(Cesium.Math.toDegrees(position.latitude) - 30) < 1e-9);
    assert.equal(entity.__navalHeadingDeg, 110);
    assert.equal(h.state.selectedKey, "ais-0"); assert.equal(entity.show, true);
    h.context.setNavalLayerVisible(false); h.drain();
    assert.equal(h.animations.size, 0); assert.equal(h.tasks.size, 0);
});

test("existing widget hide/show controls preserve naval GLBs and focus", () => {
    const h = harness(); h.context.setNavalLayerVisible(true); h.add(0); h.drain();
    h.context.focusNavalVessel("ais-0"); h.drain();
    const entity = h.state.vessels.get("ais-0").entity, model = entity.model, flights = h.flights.length;
    const boot = fs.readFileSync(new URL("../../../dev/assets/js/warzone-boot.js", import.meta.url), "utf8");
    vm.runInContext("isMobileLayout=()=>false;updateBackdrop=()=>{};", h.context);
    for (const name of ["hideWidget", "showWidget"]) {
        const start = boot.indexOf(`    function ${name}(`);
        assert.ok(start >= 0);
        vm.runInContext(boot.slice(start, boot.indexOf("\n    function ", start + 1)), h.context);
    }
    const classes = new Set();
    const widget = { dataset: { widgetId: "naval" }, querySelector: () => null,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
    h.context.hideWidget(widget); assert.equal(classes.has("wz-is-hidden"), true);
    h.context.showWidget(widget); h.drain(); assert.equal(classes.has("wz-is-hidden"), false);
    assert.equal(h.state.vessels.get("ais-0").entity, entity); assert.equal(entity.model, model);
    assert.equal(entity.show, true); assert.equal(h.state.selectedKey, "ais-0");
    assert.equal(h.flights.length, flights); assert.equal(h.viewer.entities.values.length, 1);
});

test("initial region selection cannot be dismissed; later cancellation preserves the selected region", () => {
    const regionSource = fs.readFileSync(new URL("../../../dev/assets/js/warzone-region-selector.js", import.meta.url), "utf8");
    const start = regionSource.indexOf("function showRegionModal(");
    const fn = regionSource.slice(start, regionSource.indexOf("\n}", start) + 2);
    const elements = new Map(); let active = false, closes = 0, cancels = 0, selections = 0;
    class Element {
        constructor(id) { this.id = id; this.hidden = true; this.style = {}; this.attrs = {}; this.handlers = new Map();
            this.classes = new Set(); this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name),
                toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), contains: (name) => this.classes.has(name) }; }
        cloneNode() { return new Element(this.id); }
        replaceWith(value) { elements.set(this.id, value); }
        setAttribute(name, value) { this.attrs[name] = value; }
        querySelectorAll() { return []; }
        addEventListener(name, callback) { this.handlers.set(name, callback); }
    }
    for (const id of ["wz-region-modal", "wz-region-modal-grid", "wz-region-confirm", "wz-region-back", "wz-region-close"]) {
        elements.set(id, new Element(id));
    }
    const selectedRegion = { id: "north-america" };
    const context = vm.createContext({ __activeRegion: selectedRegion, __activeLens: "all", REGIONS: [],
        REGION_SELECTOR_GLOBAL_VIEW_ENABLED: true, getRegionsForLens: () => [], getRegionLabelForLens: (region) => region.id,
        document: { getElementById: (id) => elements.get(id) || null, body: { classList: { contains: () => active } } }, window: {},
        closeRegionModal: (overlay) => { closes++; overlay.hidden = true; }, selectRegion: () => selections++ });
    vm.runInContext(fn, context);
    context.showRegionModal({}, true, { mode: "startup" });
    assert.equal(elements.get("wz-region-close").hidden, true);
    assert.equal(elements.get("wz-region-confirm").disabled, true);
    elements.get("wz-region-close").onclick(); assert.equal(closes, 0);
    active = true;
    context.showRegionModal({}, true, { mode: "manual", onCancel: () => cancels++ });
    const close = elements.get("wz-region-close");
    assert.equal(close.hidden, false); assert.equal(close.attrs["aria-hidden"], "false");
    close.onclick(); assert.equal(closes, 1); assert.equal(cancels, 1); assert.equal(selections, 0);
    assert.equal(context.__activeRegion, selectedRegion);
});
