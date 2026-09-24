import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);
const essential = await readFile(new URL("dev/assets/js/essential.js", root), "utf8");
const aircraft = await readFile(new URL("dev/assets/js/warzone-live-airforce.js", root), "utf8");
const naval = await readFile(new URL("dev/assets/js/warzone-live-naval.js", root), "utf8");

function functionSource(source, name, nextMarker) {
    const start = source.indexOf(`function ${name}`);
    const end = source.indexOf(nextMarker, start);
    assert.ok(start >= 0 && end > start, `${name} source is available`);
    return source.slice(start, end);
}

test("aircraft history normalization yields between bounded batches and prioritizes live regional rows", () => {
    const normalize = functionSource(essential, "normalizeAircraftHistoryRowsProgressively", "async function refreshAircraftHistoryCache");
    assert.match(normalize, /likelyLive\.concat\(remaining\)/);
    assert.match(normalize, /processed < 12/);
    assert.match(normalize, /performance\.now\(\) - startedAt < 4/);
    assert.match(normalize, /requestAnimationFrame\(processBatch\)/);
    assert.doesNotMatch(essential, /data\.map\(normalizeAircraftHistoryRow\)/);
});

test("active aircraft widget narrows history before subtype classification", () => {
    const widget = functionSource(essential, "getAircraftWidgetItems", "function ensureAircraftWidgetEmptyState");
    assert.match(widget, /if \(__aircraftWidgetFilter === "active"\) return track\.active;/);
    assert.match(widget, /const historyItems = historySourceItems\s*\.map\(\(track\) => \(\{ \.\.\.track, subcategory: resolveAircraftSubtype\(track\) \}\)\)/);
});

test("tracker toggles do not synchronously resync unrelated globe events", () => {
    const exempt = essential.slice(
        essential.indexOf("const GLOBE_EVENT_RESYNC_EXEMPT_LAYER_IDS"),
        essential.indexOf("const GLOBE_EVENT_LAYER_IDS")
    );
    assert.match(exempt, /"aircraft"/);
    assert.match(exempt, /"naval"/);
});

test("aircraft and naval focus start the camera before route, model, and contour work", () => {
    const airFocus = functionSource(aircraft, "focusLiveTrack", "export function clearLiveTrackSelection");
    assert.ok(airFocus.indexOf("startFocusFlight();") < airFocus.indexOf("syncFocusedRouteEntity(trackKey);"));
    assert.ok(airFocus.indexOf("startFocusFlight();") < airFocus.indexOf("refreshLiveTrackVisualMode(trackKey);"));
    const navalFocus = functionSource(naval, "focusNavalVessel", "function escapeNavalHtml");
    assert.ok(navalFocus.indexOf("viewer.camera.flyToBoundingSphere") < navalFocus.indexOf("applyNavalVisual(entry.entity, entry.data);"));
    assert.ok(navalFocus.indexOf("viewer.camera.flyToBoundingSphere") < navalFocus.indexOf("syncNavalContourCenter(trackKey);"));
});

test("focus lifecycle events coalesce tracker widget refreshes", () => {
    const listeners = essential.slice(
        essential.indexOf('document.addEventListener("wz:aircraft-focus-lock-changed"'),
        essential.indexOf("function ensureAlertAudio")
    );
    assert.doesNotMatch(listeners, /requestAircraftMovementsWidgetRender\(0\)/);
    assert.doesNotMatch(listeners, /requestNavalWidgetRender\(0\)/);
});
