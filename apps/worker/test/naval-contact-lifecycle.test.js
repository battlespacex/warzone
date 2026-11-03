import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getNavalContactStatus, matchesNavalContactStatus } from "../../shared/naval-contact-lifecycle.js";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
function sourceFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} is present`);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("naval contact states cross the configured age boundaries without deleting identity", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const at = (minutes) => now - minutes * 60_000;
    assert.equal(getNavalContactStatus(at(15), now), "LIVE");
    assert.equal(getNavalContactStatus(at(16), now), "DELAYED");
    assert.equal(getNavalContactStatus(at(60), now), "DELAYED");
    assert.equal(getNavalContactStatus(at(61), now), "LAST KNOWN");
    assert.equal(getNavalContactStatus(at(24 * 60 + 1), now), "HISTORICAL");
    assert.equal(getNavalContactStatus(at(7 * 24 * 60 + 1), now), "ARCHIVED");
    assert.equal(getNavalContactStatus(0, now), "UNKNOWN");
    assert.equal(matchesNavalContactStatus("LAST KNOWN", "recent"), true);
    assert.equal(matchesNavalContactStatus("HISTORICAL", "recent"), false);
    assert.equal(matchesNavalContactStatus("HISTORICAL", "historical"), true);
});

test("naval validation retains 400 old verified contacts while removing invalid records", () => {
    const vessels = new Map(Array.from({ length: 400 }, (_, index) => [
        `ais-${index}`, { data: { last_seen_at: Date.now() - 30 * 86400000, mmsi: String(index) } },
    ]));
    vessels.set("aircraft", { data: { aircraft: true } });
    const state = { vessels };
    const context = vm.createContext({
        __navalState: state,
        isProbablyAircraftContact: (data) => data.aircraft === true,
        isKnownNonOperationalNavalContact: () => false,
        hasNavalTelemetrySignature: () => true,
        clearNavalVessel: (key) => vessels.delete(key),
    });
    vm.runInContext(sourceFunction("purgeInvalidNavalContacts"), context);
    context.purgeInvalidNavalContacts();
    assert.equal(vessels.size, 400);
    assert.equal(vessels.has("aircraft"), false);
});

test("Cesium admission caps rendered vessels without deleting retained records", () => {
    const vessels = new Map(Array.from({ length: 400 }, (_, index) => [
        `ais-${index}`, { data: { last_seen_at: index + 1 } },
    ]));
    const rendered = new Map();
    const frames = [];
    const viewer = { entities: { getById: (id) => rendered.get(id) || null } };
    const state = { vessels, renderEnabled: true, selectedKey: "ais-0", reconcileGeneration: 0,
        reconcileFrame: 0, reconcileQueueFrame: 0 };
    const context = vm.createContext({
        __navalState: state, NAVAL_RENDER_MAX_ITEMS: 320, window: { __warzoneViewer: viewer },
        requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
        cancelAnimationFrame() {},
        performance: { now: () => 0 },
        matchesNavalVisibilityFilter: () => true,
        createVesselEntity: (_viewer, data) => {
            const id = `naval-${[...vessels].find(([, entry]) => entry.data === data)[0]}`;
            const entity = { id }; rendered.set(id, entity); return entity;
        },
        updateVesselEntity() {}, unregisterAnimationTask() {}, requestNavalRenderBatched() {},
    });
    vm.runInContext(sourceFunction("cancelNavalRenderReconcile") + "\n" +
        sourceFunction("scheduleNavalRenderReconcile"), context);
    context.scheduleNavalRenderReconcile();
    while (frames.length) frames.shift()();
    assert.equal(vessels.size, 400);
    assert.equal(rendered.size, 320);
    assert.equal(rendered.has("naval-ais-0"), true, "focused old contact stays eligible");
    assert.equal(rendered.has("naval-ais-1"), false, "oldest nonfocused contact is not rendered");
});
