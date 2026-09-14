import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const animationFrames = new Map();
const documentListeners = new Map();
let nextFrameId = 1;
let renderCalls = 0;

globalThis.window = {
  __warzoneViewer: {
    scene: {
      requestRender() { renderCalls += 1; },
    },
  },
};
globalThis.document = {
  visibilityState: "visible",
  addEventListener(name, callback) { documentListeners.set(name, callback); },
};
globalThis.requestAnimationFrame = (callback) => {
  const id = nextFrameId++;
  animationFrames.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = (id) => animationFrames.delete(id);

const scheduler = await import(`../../../dev/assets/js/warzone-animation-scheduler.js?phase5=${Date.now()}`);

function flushAnimationFrame(now) {
  const queued = Array.from(animationFrames.entries());
  animationFrames.clear();
  for (const [, callback] of queued) callback(now);
}

test("shared render requests are coalesced to one Cesium request per animation frame", () => {
  scheduler.requestSharedSceneRender();
  scheduler.requestSharedSceneRender();
  assert.equal(animationFrames.size, 1);
  flushAnimationFrame(16);
  assert.equal(renderCalls, 1);
  assert.ok(scheduler.getAnimationSchedulerDiagnostics().coalescedRenderRequests >= 1);
});

test("scheduler starts only for active work and stops after the final task opts out", () => {
  let updates = 0;
  scheduler.registerAnimationTask("test:finite", () => {
    updates += 1;
    return false;
  }, { hz: 30 });
  assert.equal(scheduler.getAnimationSchedulerDiagnostics().activeTasks, 1);
  flushAnimationFrame(32);
  assert.equal(updates, 1);
  assert.equal(scheduler.getAnimationSchedulerDiagnostics().activeTasks, 0);
  assert.equal(scheduler.getAnimationSchedulerDiagnostics().animationFrameActive, false);
});

test("hidden pages cancel decorative frames and visibility restoration synchronizes retained tasks", () => {
  let updates = 0;
  scheduler.registerAnimationTask("test:visibility", () => {
    updates += 1;
    return true;
  }, { hz: 30 });
  globalThis.document.visibilityState = "hidden";
  documentListeners.get("visibilitychange")();
  assert.equal(animationFrames.size, 0);
  assert.equal(scheduler.getAnimationSchedulerDiagnostics().activeTasks, 1);

  globalThis.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  assert.ok(animationFrames.size >= 1);
  flushAnimationFrame(48);
  assert.equal(updates, 1);
  scheduler.unregisterAnimationTask("test:visibility");
  flushAnimationFrame(64);
  assert.equal(scheduler.getAnimationSchedulerDiagnostics().activeTasks, 0);
});

test("sweeper, event pulse and hover pulse use the shared finite scheduler", async () => {
  const sweeper = await readFile(new URL("../../../dev/assets/js/warzone-sweeper.js", import.meta.url), "utf8");
  const globe = await readFile(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
  const hover = await readFile(new URL("../../../dev/assets/js/warzone-live-asset-hover-pulse.js", import.meta.url), "utf8");

  assert.match(sweeper, /registerAnimationTask\([\s\S]*SWEEPER_ANIMATION_TASK_KEY/);
  assert.match(sweeper, /unregisterAnimationTask\(SWEEPER_ANIMATION_TASK_KEY\)/);
  assert.doesNotMatch(sweeper, /requestAnimationFrame\(runSweeperTick\)/);
  assert.match(globe, /registerAnimationTask\(EVENT_PULSE_ANIMATION_TASK_KEY/);
  assert.match(globe, /unregisterAnimationTask\(EVENT_PULSE_ANIMATION_TASK_KEY\)/);
  assert.match(globe, /return false;[\s\S]*eventPulseUpdateCount/);
  assert.match(hover, /registerAnimationTask\([\s\S]*HOVER_PULSE_ANIMATION_TASK_KEY/);
  assert.match(hover, /unregisterAnimationTask\(HOVER_PULSE_ANIMATION_TASK_KEY\)/);
  assert.doesNotMatch(hover, /requestAnimationFrame\(tick\)/);
});

test("region, lens and layer refresh paths still feed the hotspot layer", async () => {
  const essential = await readFile(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
  assert.match(essential, /onRegionChange\(\(\) => \{[\s\S]*syncHotspotLayerEvents/);
  assert.match(essential, /applyHotspotFilters\(events, \{ respectRegion: true \}\)/);
  assert.match(essential, /if \(id === "hotspots" \|\| id === "\*"\)/);
  assert.match(essential, /scheduleHotspotLayerRefresh\(20\)/);
});
