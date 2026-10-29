import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function fn(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("Focus follows every rendered displacement in the camera's local frame without changing orientation", () => {
    const anchor = Cesium.Cartesian3.fromDegrees(50, 26, 7620);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(anchor);
    const inverseTransform = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
    const camera = { inverseTransform, position: new Cesium.Cartesian3(0, -1200, 2000),
        direction: new Cesium.Cartesian3(0, 1, -1), up: new Cesium.Cartesian3(0, 1, 1) };
    const startWorld = Cesium.Matrix4.multiplyByPoint(transform, camera.position, new Cesium.Cartesian3());
    const direction = Cesium.Cartesian3.clone(camera.direction), up = Cesium.Cartesian3.clone(camera.up);
    const context = vm.createContext({ Cesium, __liveTrackFocusMotionAnchor: Cesium.Cartesian3.clone(anchor),
        __liveTrackFocusSmoothedTarget: Cesium.Cartesian3.clone(anchor),
        __liveTrackFocusWorldDelta: new Cesium.Cartesian3(), __liveTrackFocusLocalDelta: new Cesium.Cartesian3() });
    vm.runInContext(fn("translateFocusedTrackCamera"), context);
    for (let i = 1; i <= 600; i++) {
        const position = Cesium.Cartesian3.fromDegrees(50 + i * .00001, 26, 7620);
        context.translateFocusedTrackCamera({ camera }, position);
        const cameraWorld = Cesium.Matrix4.multiplyByPoint(transform, camera.position, new Cesium.Cartesian3());
        const expected = Cesium.Cartesian3.add(startWorld,
            Cesium.Cartesian3.subtract(position, anchor, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        assert.ok(Cesium.Cartesian3.distance(cameraWorld, expected) < 1e-7);
        assert.ok(Cesium.Cartesian3.distance(context.__liveTrackFocusSmoothedTarget, position) < 1e-7);
        const before = Cesium.Cartesian3.clone(camera.position);
        context.translateFocusedTrackCamera({ camera }, position);
        assert.deepEqual(camera.position, before, "repeated frame must not accumulate displacement");
    }
    assert.deepEqual(camera.direction, direction);
    assert.deepEqual(camera.up, up);
    context.__liveTrackFocusMotionAnchor = null;
    const before = Cesium.Cartesian3.clone(camera.position);
    context.translateFocusedTrackCamera({ camera }, anchor);
    assert.deepEqual(camera.position, before, "cleared/new Focus waits for its first full camera sync");
});

test("duplicate positional heartbeats preserve predicted motion and its original expiry; stale telemetry is rejected", () => {
    const track = { track_key: "KC135", track_type: "aircraft", lon: 50, lat: 26,
        altitude_ft: 25000, heading_deg: 90, speed_kts: 420 };
    const prediction = { receivedAt: 1000, durationMs: 10000 };
    const motion = { phase: "prediction", prediction };
    const entity = { __lastSourceTimestamp: 1000, __lastReportedHeadingDeg: 90, __lastReportedSpeedKts: 420,
        __liveTrackMotionState: motion, position: { untouched: true } };
    const registry = new Map([["KC135", { ...track, source_timestamp: 1000 }]]);
    const results = [];
    const context = vm.createContext({
        Cesium,
        window: { __warzoneViewer: { __warzone: {}, entities: { getById: () => entity } } },
        __liveTrackRegistry: registry, __liveTrackLastPositions: new Map([["KC135", track]]),
        resolveTrackSubtype: () => "tanker", getFormationDevGroupKey: () => "", findDuplicateLiveTrackKey: () => "",
        measureRealtimeStage: (_name, callback) => callback(), getTrackRenderAltitudeMeters: () => 7620,
        getTrackSourceTimestamp: record => record.timestamp, getTrackResolvedAltitudeFt: record => record.altitude_ft,
        normalizeDegrees: n => (n % 360 + 360) % 360, getShortestAngleDeltaDeg: (a, b) => b - a,
        LIVE_TRACK_INSIGNIFICANT_DISTANCE_METERS: 8, LIVE_TRACK_INSIGNIFICANT_ALTITUDE_FEET: 20,
        LIVE_TRACK_INSIGNIFICANT_HEADING_DEG: .75, LIVE_TRACK_INSIGNIFICANT_SPEED_KTS: 1.5,
        restoreLiveTrackLiveness: () => {}, isLiveTrackDiagnosticsEnabled: () => false,
        getTrackResolvedHeading: () => { throw new Error("duplicate must not enter reconciliation/model work"); },
    });
    vm.runInContext(["getLonLatDistanceMeters", "classifyLiveTrackTelemetryUpdate", "refreshLiveTrackLiveness", "applyLiveTrackUpdate"].map(fn).join("\n"), context);
    for (const timestamp of [1000, 2000, 3000, 3000, 4000]) {
        context.applyLiveTrackUpdate({ ...track, timestamp }, { onTelemetryResult: result => results.push(result.status) });
        assert.equal(entity.__liveTrackMotionState, motion);
        assert.equal(motion.prediction, prediction);
        assert.equal(prediction.receivedAt + prediction.durationMs, 11000, "heartbeats cannot extend prediction indefinitely");
    }
    assert.deepEqual(results, Array(5).fill("insignificant"));
    assert.equal(entity.__lastSourceTimestamp, 4000);
    context.applyLiveTrackUpdate({ ...track, lon: 49, timestamp: 2000 }, { onTelemetryResult: result => results.push(result.status) });
    assert.equal(results.at(-1), "stale");
    assert.equal(entity.__lastSourceTimestamp, 4000);
    assert.equal(context.classifyLiveTrackTelemetryUpdate(entity, { ...track, lon: 50.01 }, 5000), "accept", "real movement still enters the existing interpolation path");
    assert.equal(context.classifyLiveTrackTelemetryUpdate(entity, { ...track, heading_deg: 100 }, 5000), "accept");
});

test("per-frame camera translation respects unlock, manual input, flight and scene guards", () => {
    let translations = 0;
    const viewer = { scene: { mode: Cesium.SceneMode.SCENE3D }, entities: { getById: () => ({}) } };
    const context = vm.createContext({ Cesium, window: { __warzoneViewer: viewer },
        __liveTrackReplayState: { selectedTrackKey: "A", mode: "focus" },
        __liveTrackIsCameraFlying: false, __liveTrackHardLockEnabled: true,
        __liveTrackUserCameraInteracting: false, __liveTrackCtrlTiltDragState: null,
        __liveTrackLastFocusCameraSyncAt: 100, LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ: 20,
        performance: { now: () => 110 }, getPositionCartesian: () => ({}),
        getCssNumber: () => 20, clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
        translateFocusedTrackCamera: () => translations++,
    });
    vm.runInContext(fn("syncFocusedTrackCamera"), context);
    for (const guard of ["__liveTrackIsCameraFlying", "__liveTrackUserCameraInteracting"]) {
        context[guard] = true;
        context.syncFocusedTrackCamera({ motionFrame: true });
        context[guard] = false;
    }
    context.__liveTrackHardLockEnabled = false;
    context.syncFocusedTrackCamera({ motionFrame: true });
    context.__liveTrackHardLockEnabled = true;
    viewer.scene.mode = Cesium.SceneMode.SCENE2D;
    context.syncFocusedTrackCamera({ motionFrame: true });
    viewer.scene.mode = Cesium.SceneMode.SCENE3D;
    context.__liveTrackReplayState.mode = "replay";
    context.syncFocusedTrackCamera({ motionFrame: true });
    assert.equal(translations, 0);
    context.__liveTrackReplayState.mode = "focus";
    context.syncFocusedTrackCamera({ motionFrame: true });
    assert.equal(translations, 1);
});
