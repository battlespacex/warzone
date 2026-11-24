const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../scripts/benchmark-dev-tuner-entry.cjs');
const vm = require('node:vm');
const fs = require('node:fs');
const { parseExpressionAt } = require('acorn');
const snapshot = h => [...h.elements].map(([id, node]) => [id, node.value, node.checked]);

test('batching preserves all 120 root properties, write order, tuner values and output snippets', () => {
    for (const overrides of [{}, { '--warzone-live-aircraft-model-scale': '12', '--warzone-live-aircraft-model-scale-max': '18',
        '--warzone-map-brightness': '0.73', '--warzone-start-pitch': '-50' }]) {
        const before = harness(undefined, overrides), after = harness(undefined, overrides);
        before.initialize({ batch: false }); after.initialize();
        assert.equal(after.values.size, 120);
        assert.deepEqual(after.writes, before.writes);
        assert.deepEqual(snapshot(after), snapshot(before));
        assert.equal(JSON.stringify(after.c.window.__stratopsConfig), JSON.stringify(before.c.window.__stratopsConfig));
        assert.equal(before.stats.computedReads, 2238); assert.equal(after.stats.computedReads, 131);
        assert.equal(before.stats.outputWrites, 125); assert.equal(after.stats.outputWrites, 5);
        assert.equal(before.stats.eventRefreshes, 23); assert.equal(after.stats.eventRefreshes, 1);
        assert.equal(before.stats.orbitalRefreshes, 9); assert.equal(after.stats.orbitalRefreshes, 1);
        const writes = after.stats.styleWrites, outputs = after.stats.outputWrites;
        after.initialize();
        assert.equal(after.stats.styleWrites, writes); assert.equal(after.stats.outputWrites, outputs);
    }
});
test('interactive edits and Load Current remain immediate and preserve existing root overrides', () => {
    const h = harness(); h.initialize();
    const range = h.elements.get('wz-map-brightness-range');
    range.value = '0.63';
    const count = h.stats.outputWrites;
    range.listeners.input();
    assert.equal(h.values.get('--warzone-map-brightness'), '0.63');
    assert.equal(h.stats.outputWrites, count + 1);
    h.elements.get('wz-map-load-current').listeners.click();
    assert.equal(range.value, '0.63');
    assert.equal(h.elements.get('wz-map-brightness-input').value, '0.63');
});
test('nested initialization batches deduplicate callbacks and release state after an initializer error', () => {
    const h = harness(); let count = 0;
    const update = () => { count++; };
    assert.throws(() => h.c.batchDevTunerInitialization(() => {
        h.c.queueDevTunerUpdate(update);
        h.c.batchDevTunerInitialization(() => h.c.queueDevTunerUpdate(update));
        throw Error('test initialization failure');
    }), /test initialization failure/);
    assert.equal(count, 1);
    assert.equal(h.c.queueDevTunerUpdate(update), false);
});

test('immediate model refresh consumes the queued refresh; normal edits still coalesce into one frame', () => {
    const source = fs.readFileSync('dev/assets/js/warzone-dev-panel.js', 'utf8');
    let next = 0, aircraft = 0, naval = 0, quality = 0;
    const frames = new Map();
    const c = vm.createContext({
        requestAnimationFrame: callback => { frames.set(++next, callback); return next; },
        cancelAnimationFrame: id => frames.delete(id),
        applyLiveAssetRendererQuality() { quality++; }, getLiveTrackSelection: () => null,
        refreshLiveTrackVisualStyles() { aircraft++; }, refreshNavalVisualStyles() { naval++; },
        window: { __warzoneViewer: { scene: { requestRender() {} } } },
    });
    vm.runInContext('let __devLiveAssetRefreshRaf=0;', c);
    for (const name of ['refreshLiveAssetVisualsNow', 'requestLiveAssetVisualRefresh']) {
        const start = source.indexOf(`function ${name}(`);
        vm.runInContext(source.slice(start, parseExpressionAt(source, start, { ecmaVersion: 'latest' }).end), c);
    }
    for (let i = 0; i < 66; i++) c.requestLiveAssetVisualRefresh();
    assert.equal(frames.size, 1);
    c.refreshLiveAssetVisualsNow();
    assert.equal(frames.size, 0); assert.equal(aircraft, 1); assert.equal(naval, 1); assert.equal(quality, 1);
    for (let i = 0; i < 10; i++) c.requestLiveAssetVisualRefresh();
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());
    assert.equal(aircraft, 2); assert.equal(naval, 2); assert.equal(quality, 2); assert.equal(frames.size, 0);
});
