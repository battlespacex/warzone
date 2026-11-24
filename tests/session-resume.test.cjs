const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const essential = fs.readFileSync('dev/assets/js/essential.js', 'utf8');
const extract = name => essential.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
function wakeHarness(mode = true) {
    const frames = new Map(), timers = new Map();
    let id = 0, clock = 0, requests = 0, hidden = false;
    const scene = { requestRenderMode: mode, requestRender() { requests++; } };
    const viewer = { scene, resize() {} };
    const c = vm.createContext({
        __foregroundRenderWakeRaf: 0, __warzoneLifecycleRenderBurstRaf: 0, __warzoneLifecycleRenderBurstUntil: 0,
        performance: { now: () => clock }, isDocumentHidden: () => hidden,
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: i => frames.delete(i),
        clearTimeout: i => timers.delete(i),
        window: { __warzoneViewer: viewer, setTimeout: fn => { timers.set(++id, fn); return id; } },
    });
    vm.runInContext(['startForegroundRenderWakeBurst', 'requestWarzoneLifecycleRenderBurst', 'forceForegroundViewerWake'].map(extract).join('\n'), c);
    c.window.__warzoneLifecycle = { requestRenderBurst: c.requestWarzoneLifecycleRenderBurst };
    return { c, scene, frames, timers, get requests() { return requests; },
        hide(value) { hidden = value; }, jump(ms) { clock += ms; },
        step(ms = 17) { clock += ms; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(clock)); },
        wake(idle = 48 * 60 * 60 * 1000) { c.forceForegroundViewerWake({ backgroundIdleMs: idle }); } };
}
test('frozen restore timers cannot leave request-render mode disabled after repeated long-idle resumes', () => {
    const h = wakeHarness();
    for (let cycle = 0; cycle < 50; cycle++) {
        h.jump(48 * 60 * 60 * 1000); h.wake();
        assert.equal(h.scene.requestRenderMode, true);
        assert.equal(h.timers.size, 0);
        assert.ok(h.frames.size <= 2, 'existing bounded wake loops are coalesced');
    }
    h.step(3000);
    assert.equal(h.frames.size, 0);
    const requests = h.requests;
    h.step(); assert.equal(h.requests, requests, 'no recurring idle render work');
});
test('short resume, hidden frames and explicitly continuous viewers keep their existing policy', () => {
    for (const mode of [true, false]) {
        const h = wakeHarness(mode);
        h.wake(1000); h.hide(true); h.step();
        assert.equal(h.frames.size, 0);
        assert.equal(h.requests, 1, 'hidden animation callbacks do not request frames');
        h.jump(48 * 60 * 60 * 1000); h.hide(false); h.wake(); h.step(3000);
        assert.equal(h.scene.requestRenderMode, mode);
        assert.equal(h.frames.size, 0);
        h.c.window.__warzoneViewer = null;
        assert.doesNotThrow(() => h.wake());
    }
});
class Events {
    listeners = new Map();
    addEventListener(type, fn) {
        if (typeof type === 'function') { fn = type; type = 'scene'; }
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
        return () => this.removeEventListener(type, fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, data = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, ...data }); }
    get numberOfListeners() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
test('local diagnostics are opt-in, bounded, idempotent, suspension-aware and fully disposable', async () => {
    let clock = 0, next = 0;
    const frames = new Map(), window = new Events(), document = new Events(), postRender = new Events();
    window.location = { hostname: 'localhost' };
    document.visibilityState = 'visible';
    document.body = { classList: { contains: () => true } };
    document.getElementById = () => ({ hidden: true });
    const viewer = { scene: { postRender, requestRenderMode: true,
        canvas: { clientWidth: 1000, clientHeight: 800 }, screenSpaceCameraController: { enableInputs: true } }, entities: { values: [] } };
    const c = vm.createContext({ window, document, getRealtimeStats: () => ({ queueDepth: 2, pendingVisualCandidates: 1 }),
        performance: { now: () => clock }, requestAnimationFrame: fn => { frames.set(++next, fn); return next; },
        cancelAnimationFrame: id => frames.delete(id) });
    vm.runInContext(fs.readFileSync('dev/assets/js/warzone-session-diagnostics.js', 'utf8')
        .replace(/^import .*;\r?\n/m, '').replace(/\bexport /g, ''), c);
    assert.equal(c.installSessionDiagnostics(), null);
    window.location.hostname = 'app.stratops.space';
    assert.equal(c.installSessionDiagnostics({ development: true }), null);
    window.location.hostname = 'localhost';
    const api = c.installSessionDiagnostics({ development: true });
    const count = document.numberOfListeners + window.numberOfListeners;
    assert.equal(c.installSessionDiagnostics({ development: true }), api);
    assert.equal(document.numberOfListeners + window.numberOfListeners, count);
    const step = () => { clock += 17; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(clock)); };
    window.__warzoneViewer = viewer;
    document.emit('click', { target: { closest: () => ({ disabled: false }) } });
    window.__warzoneOperationalDataPromise = Promise.resolve([]);
    for (let i = 0; i < 300; i++) step();
    await Promise.resolve();
    assert.equal(api.snapshot().observedViewerCount, 1);
    assert.equal(api.snapshot().frameIntervalsMs.length, 120);
    assert.equal(api.snapshot().pendingTrackUpdates, 2);
    assert.equal(api.snapshot().regionConfirmCount, 1);
    assert.equal(api.snapshot().entries[0].interactiveMs, 17);
    assert.ok(api.snapshot().entries[0].bootDataReadyMs >= 0);
    document.visibilityState = 'hidden'; document.emit('visibilitychange');
    assert.equal(frames.size, 0);
    clock += 48 * 60 * 60 * 1000;
    document.visibilityState = 'visible'; document.emit('visibilitychange');
    window.emit('focus'); window.emit('pageshow', { persisted: true });
    step(); step();
    assert.equal(api.snapshot().frameIntervalsMs[0], 17, 'suspended time is excluded');
    assert.equal(postRender.numberOfListeners, 1);
    api.dispose();
    assert.equal(frames.size, 0);
    assert.equal(document.numberOfListeners + window.numberOfListeners + postRender.numberOfListeners, 0);
    assert.equal(window.__stratopsSessionDiagnostics, undefined);
});
