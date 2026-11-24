const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { harness } = require('../scripts/benchmark-region-resume.cjs');

test('one restoration event burst resumes each pipeline and aircraft lifecycle once', () => {
    const h = harness();
    for (let i = 0; i < 50; i++) { h.foreground(); h.advance(20); }
    assert.equal(h.counts.pipelineResumes, 1);
    assert.equal(h.counts.lifecycleResumes, 1);
    assert.equal(h.counts.aircraftMotionResets, 1000);
    assert.equal(h.counts.viewportSchedules, 1);
});
test('a genuine second suspension inside the throttle still resumes current live data', () => {
    const h = harness(); h.foreground();
    for (let i = 0; i < 50; i++) {
        h.suspend(); h.advance(20); h.foreground();
        assert.equal(h.counts.pipelineResumes, i + 1, 'hidden tabs do no recovery work');
        h.show(); h.foreground(); h.foreground();
        assert.equal(h.counts.pipelineResumes, i + 2);
    }
    assert.equal(h.counts.lifecycleResumes, 51);
});
test('the recovery throttle uses monotonic time and does not suppress the first early event', () => {
    const h = harness(); h.advance(-9999); h.foreground();
    assert.equal(h.counts.pipelineResumes, 1);
    h.adjustWall(-24 * 60 * 60 * 1000); h.advance(20); h.foreground();
    assert.equal(h.counts.pipelineResumes, 1);
    h.advance(1500); h.foreground();
    assert.equal(h.counts.pipelineResumes, 2, 'an unpaused focus can still refresh after the existing throttle expires');
});
test('allocation diagnostics read existing resources and deduplicate shared tile textures and mesh buffers', () => {
    const shared = { sizeInBytes: 1024 }, projected = { sizeInBytes: 256 }, buffer = new ArrayBuffer(512);
    const tiles = Array.from({ length: 3 }, () => ({ data: {
        imagery: [{ readyImagery: { texture: shared, textureWebMercator: projected }, loadingImagery: { texture: shared } }],
        mesh: { vertices: new Float32Array(buffer), indices: new Uint16Array(buffer) },
    } }));
    let contextQueries = 0;
    const viewer = { scene: { drawingBufferWidth: 3440, drawingBufferHeight: 1440,
        canvas: { getContext() { contextQueries++; throw Error('must not create/query a WebGL context'); } },
        context: { _gl: { isContextLost: () => false } },
        globe: { _surface: { forEachLoadedTile: callback => tiles.forEach(callback) } } } };
    const c = vm.createContext({ performance: { now: () => 100, memory: { usedJSHeapSize: 1234 } },
        ResourceCache: { statistics: { geometryByteLength: 5678, texturesByteLength: 9012 } } });
    const source = fs.readFileSync('dev/assets/js/warzone-session-diagnostics.js', 'utf8');
    vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, ''), c);
    const memory = c.readAllocationCounters(viewer), loaded = c.readLoadedTileAllocations(viewer);
    assert.equal(memory.heapUsedBytes, 1234); assert.equal(memory.heapTotalBytes, null);
    assert.equal(memory.modelCacheGeometryCpuAndGpuBytes, 5678);
    assert.equal(memory.modelCacheTextureBytes, 9012); assert.equal(memory.contextLost, false);
    assert.equal(loaded.loadedTiles, 3); assert.equal(loaded.uniqueImageryTextures, 2);
    assert.equal(loaded.imageryTextureBytes, 1280); assert.equal(loaded.terrainMeshCpuBytes, 512);
    assert.equal(contextQueries, 0);
    assert.equal(c.readLoadedTileAllocations(null), null);
    const model = { getNode() {}, statistics: {}, ready: true };
    const children = [model], nested = { destroyPrimitives: true, length: children.length, get: i => children[i] };
    const primitives = [model, nested, model], collection = { length: primitives.length, get: i => primitives[i] };
    assert.equal(c.countLoadedModels(collection).total, 1);
    assert.equal(c.countLoadedModels(collection).ready, 1);
});
