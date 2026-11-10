import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createOperationalGnssReveal } from "../../../dev/assets/js/warzone-gnss-reveal.js";

class Event {
    listeners = new Set();
    addEventListener(fn) { this.listeners.add(fn); }
    removeEventListener(fn) { this.listeners.delete(fn); }
    fire(...args) { for (const fn of [...this.listeners]) fn(...args); }
}

function harness(count, { ready = true, outlines = true, camera = true } = {}) {
    let time = 0, requests = 0, settled = camera, destroyed = false;
    const timers = new Map(), events = new Map(), warnings = [], writes = [], batches = [];
    const scene = { postRender: new Event(), renderError: new Event(), requestRender() { requests++; } };
    const document = { hidden: false,
        addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
        removeEventListener(name, fn) { events.get(name)?.delete(fn); } };
    const viewer = { scene, isDestroyed: () => destroyed };
    const job = createOperationalGnssReveal(viewer, { total: count, document, now: () => time,
        setTimer(fn, ms) { const id = {}; timers.set(id, { fn, at: time + ms }); return id; },
        clearTimer(id) { timers.delete(id); }, cameraSettled: () => settled, warn: (message) => warnings.push(message) });
    function primitive(ids, side) {
        const attributes = new Map(ids.map((id) => {
            let show = new Uint8Array([0]);
            return [id, { color: new Uint8Array([14, 127, 255, 77]), get show() { return show; },
                set show(value) { show = value; writes.push({ id, side, time }); } }];
        }));
        return { ready, show: true, destroyed: false, attributes, isDestroyed() { return this.destroyed; },
            getGeometryInstanceAttributes(id) { assert.equal(this.destroyed, false); return attributes.get(id); } };
    }
    for (let offset = 0; offset < count; offset += 200) {
        const records = Array.from({ length: Math.min(200, count - offset) }, (_, i) => ({
            fillId: { id: `gnss-cell-${offset + i}`, __gnssCell: { id: offset + i } }, outlineId: `outline-${offset + i}` }));
        const fill = primitive(records.map((r) => r.fillId), "fill");
        const outline = outlines ? primitive(records.map((r) => r.outlineId), "outline") : null;
        batches.push({ records, fill, outline });
        job.addBatch(fill, outline, records);
    }
    job.seal();
    return { job, scene, document, warnings, batches, writes, timers, events,
        get time() { return time; }, get requests() { return requests; },
        camera(value) { settled = value; }, destroyViewer() { destroyed = true; },
        frame(ms = 1000 / 60) {
            time += ms;
            for (const [id, timer] of [...timers]) if (time >= timer.at) { timers.delete(id); timer.fn(); }
            scene.postRender.fire();
        },
        hidden(value) { document.hidden = value; for (const fn of events.get("visibilitychange") || []) fn(); },
        run(ms = 1000 / 60) {
            let frames = 0;
            while (scene.postRender.listeners.size && frames++ < 5000) this.frame(ms);
            assert.ok(frames < 5000, "reveal must terminate");
            return job.diagnostics();
        },
    };
}

for (const count of [8, 200, 2000, 12000]) {
    for (const fps of [60, 30]) test(`${count} cells at ${fps} simulated FPS retain coverage and paired attributes`, (t) => {
        const h = harness(count);
        t.after(() => h.job.dispose());
        const started = performance.now();
        h.frame(1000 / fps);
        assert.ok(h.job.diagnostics().revealed > 0 && h.job.diagnostics().revealed < count);
        const result = h.run(1000 / fps);
        const cpuMs = performance.now() - started;
        assert.equal(result.status, "complete");
        assert.equal(result.revealed, count);
        assert.equal(result.failed, 0);
        assert.equal(result.batchCount, Math.ceil(count / 200));
        assert.equal(h.timers.size, 0);
        assert.equal(h.scene.renderError.listeners.size, 0);
        assert.ok(result.maxCellsPerFrame <= Math.max(1, Math.ceil(count / 60)));
        const fills = h.writes.filter((w) => w.side === "fill");
        const progressionMs = fills.at(-1).time - fills[0].time;
        if (count >= 60) assert.ok(progressionMs >= 2300 && progressionMs <= 3000, progressionMs);
        for (const batch of h.batches) for (const record of batch.records) {
            const fill = batch.fill.attributes.get(record.fillId), outline = batch.outline.attributes.get(record.outlineId);
            assert.equal(fill.show[0], 1); assert.equal(outline.show[0], 1);
            assert.deepEqual([...fill.color], [14, 127, 255, 77]);
            assert.deepEqual([...outline.color], [14, 127, 255, 77]);
        }
        for (let i = 0; i < h.writes.length; i += 2) {
            assert.equal(h.writes[i].time, h.writes[i + 1].time);
            assert.equal(`outline-${h.writes[i].id.__gnssCell.id}`, h.writes[i + 1].id);
        }
        assert.notDeepEqual(fills.slice(0, 5).map((w) => w.id.__gnssCell.id), [0, 1, 2, 3, 4]);
        t.diagnostic(JSON.stringify({ count, fps, progressionMs: Math.round(progressionMs),
            maxCellsPerFrame: result.maxCellsPerFrame, geometryBatches: result.batchCount,
            schedulerCpuMs: Number(cpuMs.toFixed(2)), note: "simulated frames and attributes; no GPU or workers" }));
    });
}

test("fill waits for its outline, then late batches retain complete coverage", (t) => {
    const h = harness(201); t.after(() => h.job.dispose());
    h.batches[0].outline.ready = false;
    for (let i = 0; i < 90; i++) h.frame();
    assert.equal(h.job.diagnostics().revealed, 1);
    assert.ok(h.writes.every((w) => w.side !== "fill" || w.id.__gnssCell.id === 200));
    h.batches[0].outline.ready = true;
    assert.equal(h.run().revealed, 201);
});

test("camera settlement gates visibility; missing settlement is bounded", (t) => {
    const h = harness(200, { camera: false }); t.after(() => h.job.dispose());
    for (let i = 0; i < 120; i++) h.frame();
    assert.equal(h.writes.length, 0);
    h.camera(true); h.frame();
    assert.ok(h.writes.length > 0);
    h.run();
    const missing = harness(200, { camera: false }); t.after(() => missing.job.dispose());
    for (let i = 0; i < 56; i++) missing.frame(100);
    assert.ok(missing.job.diagnostics().revealed > 0);
    assert.equal(missing.run().status, "complete");
});

test("OFF/ON and hidden tabs preserve progress without catch-up or new batches", (t) => {
    const h = harness(2000); t.after(() => h.job.dispose());
    for (let i = 0; i < 20; i++) h.frame();
    const before = h.job.diagnostics().revealed;
    h.job.setVisible(false);
    assert.equal(h.scene.postRender.listeners.size, 0);
    assert.equal(h.timers.size, 0);
    h.frame(60000);
    assert.equal(h.job.diagnostics().revealed, before);
    for (const batch of h.batches) assert.equal(batch.fill.show, false);
    h.job.setVisible(true); h.frame();
    assert.ok(h.job.diagnostics().revealed - before <= 34);
    h.hidden(true); const hiddenCount = h.job.diagnostics().revealed;
    h.frame(60000);
    assert.equal(h.job.diagnostics().revealed, hiddenCount);
    h.hidden(false); h.frame();
    assert.ok(h.job.diagnostics().revealed - hiddenCount <= 34);
    assert.equal(h.run().revealed, 2000);
    assert.equal(h.batches.length, 10);
});

test("timeout restores ready cells, leaves real pending geometry incomplete and restores late successes passively", (t) => {
    const h = harness(201, { ready: false }); t.after(() => h.job.dispose());
    h.batches[0].fill.ready = true; h.batches[0].outline.ready = true;
    h.frame(30001);
    assert.equal(h.job.diagnostics().revealed, 200);
    assert.equal(h.job.diagnostics().pending, 1);
    assert.equal(h.job.diagnostics().status, "readiness-timeout");
    const requests = h.requests;
    for (let i = 0; i < 100; i++) h.frame();
    assert.equal(h.requests, requests, "fallback must not request frames indefinitely");
    assert.equal(h.timers.size, 0);
    h.batches[1].fill.ready = true; h.batches[1].outline.ready = true;
    h.frame();
    assert.equal(h.job.diagnostics().revealed, 201);
    assert.equal(h.job.diagnostics().status, "fallback-visible");
    assert.equal(h.scene.postRender.listeners.size, 0);
    assert.equal(h.warnings.length, 1);
});

test("missing attributes and render errors fall back safely without false completion", (t) => {
    const h = harness(8); t.after(() => h.job.dispose());
    h.batches[0].outline.attributes.delete(h.batches[0].records[0].outlineId);
    h.run();
    assert.equal(h.job.diagnostics().status, "incomplete");
    assert.equal(h.job.diagnostics().failed, 1);
    assert.ok(h.batches[0].fill.attributes.get(h.batches[0].records[0].fillId).show[0]);
    const error = harness(8); t.after(() => error.job.dispose());
    error.scene.renderError.fire(error.scene, new Error("worker import failed"));
    assert.equal(error.job.diagnostics().status, "fallback-visible");
    assert.equal(error.job.diagnostics().revealed, 8);
    assert.ok(error.warnings[0].includes("render-error"));
});

test("timeout restores a ready fill without hiding it forever behind an unavailable outline", (t) => {
    const h = harness(8); t.after(() => h.job.dispose());
    h.batches[0].outline.ready = false;
    h.frame(30001);
    assert.equal(h.job.diagnostics().revealed, 8);
    assert.equal(h.job.diagnostics().pending, 8);
    assert.equal(h.job.diagnostics().status, "readiness-timeout");
    assert.equal(h.writes.filter((w) => w.side === "outline").length, 0);
    h.batches[0].outline.ready = true; h.frame();
    assert.equal(h.job.diagnostics().status, "fallback-visible");
    assert.equal(h.job.diagnostics().fallbackReason, "readiness-timeout");
    assert.equal(h.job.diagnostics().revealed, 8);
    assert.equal(h.writes.length, 16, "each side restored once");
});

test("late outline restoration requests a frame even while another batch is still pending", (t) => {
    const h = harness(201, { ready: false }); t.after(() => h.job.dispose());
    h.batches[0].fill.ready = true;
    h.frame(30001);
    const requests = h.requests;
    h.batches[0].outline.ready = true; h.frame();
    assert.equal(h.job.diagnostics().pending, 1);
    assert.ok(h.requests > requests);
    const before = h.requests; h.frame();
    assert.equal(h.requests, before, "passive fallback does not keep requesting frames");
});

test("destroyed outlines do not leave surviving fill geometry hidden", (t) => {
    const h = harness(8); t.after(() => h.job.dispose());
    h.batches[0].outline.destroyed = true;
    h.frame();
    assert.equal(h.job.diagnostics().status, "incomplete");
    assert.equal(h.job.diagnostics().revealed, 8);
    assert.equal(h.job.diagnostics().failed, 8);
    assert.equal(h.job.diagnostics().fallbackReason, "destroyed-geometry");
});

test("destruction and cancellation remove owned callbacks and cannot write stale IDs", () => {
    const h = harness(200); h.frame();
    h.batches[0].fill.destroyed = true;
    h.frame();
    assert.equal(h.job.diagnostics().status, "incomplete");
    assert.ok(h.job.diagnostics().failed > 0);
    h.job.dispose();
    const before = h.writes.length;
    h.frame(60000);
    assert.equal(h.writes.length, before);
    assert.equal(h.timers.size, 0);
    assert.equal(h.events.get("visibilitychange").size, 0);
    const viewer = harness(200); viewer.destroyViewer(); viewer.frame();
    assert.equal(viewer.job.diagnostics().status, "cancelled");
    assert.equal(viewer.scene.postRender.listeners.size, 0);
});

test("no-outline path and low frame rates finish within bounded per-frame work", (t) => {
    const h = harness(12000, { outlines: false }); t.after(() => h.job.dispose());
    const result = h.run(100);
    assert.equal(result.status, "complete");
    assert.equal(result.revealed, 12000);
    assert.ok(result.maxCellsPerFrame <= 200);
    assert.ok(h.time < 10000, "slow device extends duration without a 40-second reveal");
});
