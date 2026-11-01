import test from "node:test";
import assert from "node:assert/strict";
import * as Cesium from "cesium";

globalThis.HTMLCanvasElement = class {};
globalThis.HTMLImageElement = class {};
globalThis.ImageBitmap = class {};
globalThis.OffscreenCanvas = class {};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  getElementById: () => null,
};

const { renderSweepers, clearSweepers, getSweeperDiagnostics } = await import("../../../dev/assets/js/warzone-sweeper.js");

test("the original radar waits above its zoom limit, resumes below it, and reuses geometry", async () => {
  const primitives = new Set();
  const entities = new Set();
  const changed = new Cesium.Event();
  const moveEnd = new Cesium.Event();
  const viewer = {
    camera: { positionCartographic: { height: 12000000 }, changed, moveEnd },
    entities: {
      suspendEvents() {}, resumeEvents() {},
      add(entity) { entities.add(entity); return entity; },
      remove(entity) { return entities.delete(entity); },
    },
    scene: {
      groundPrimitives: {
        add(primitive) { primitives.add(primitive); return primitive; },
        remove(primitive) { return primitives.delete(primitive); },
      },
      requestRender() {},
    },
  };
  globalThis.window = { __warzoneViewer: viewer };
  const event = { id: "radar-site-1", lat: 29.37, lon: 47.98, category: "military", title: "Air defense radar" };
  try {
    renderSweepers(viewer, [event]);
    assert.equal(getSweeperDiagnostics().activeSweeperPrimitives, 0);
    assert.equal(changed.numberOfListeners, 1);
    assert.equal(moveEnd.numberOfListeners, 1);

    viewer.camera.positionCartographic.height = 3800000;
    moveEnd.raiseEvent();
    await Promise.resolve();
    assert.equal(getSweeperDiagnostics().activeSweeperPrimitives, 1);
    assert.equal(getSweeperDiagnostics().schedulerTaskActive, true);
    const primitive = [...primitives][0];

    viewer.camera.positionCartographic.height = 12000000;
    changed.raiseEvent();
    assert.equal(primitive.show, false);
    assert.equal(getSweeperDiagnostics().schedulerTaskActive, false);

    viewer.camera.positionCartographic.height = 3800000;
    changed.raiseEvent();
    changed.raiseEvent();
    assert.equal(primitive.show, true);
    assert.equal([...primitives][0], primitive);
    assert.equal(primitives.size, 1);
    assert.equal(entities.size, 1);
    assert.equal(getSweeperDiagnostics().schedulerTaskActive, true);

    viewer.camera.positionCartographic.height = 12000000;
    renderSweepers(viewer, [event]);
    viewer.camera.positionCartographic.height = 3800000;
    changed.raiseEvent();
    clearSweepers(viewer);
    await Promise.resolve();
    assert.equal(primitives.size, 0, "an OFF transition cancels queued restoration");
  } finally {
    clearSweepers(viewer);
    delete globalThis.window;
  }
  assert.equal(primitives.size, 0);
  assert.equal(entities.size, 0);
  assert.equal(changed.numberOfListeners, 0);
  assert.equal(moveEnd.numberOfListeners, 0);
  assert.equal(getSweeperDiagnostics().schedulerTaskActive, false);
});
