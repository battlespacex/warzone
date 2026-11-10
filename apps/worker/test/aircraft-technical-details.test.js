import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { getAircraftTelemetry } from "../../../dev/assets/js/warzone-aircraft-telemetry.js";
import { normalizeReadsbAircraft } from "../src/tracking/aircraft/providers/readsb.js";
import { createAisStreamProvider } from "../src/tracking/naval/providers/aisstream.js";
import { canReadNavalDiagnostics, navalProviderDiagnostics } from "../src/naval-diagnostics.js";
import { runAdsbWorker } from "../src/adsb-worker.js";
import { resetProviderHealth } from "../src/tracking/provider-health.js";

test("reported ADS-B fields distinguish ground track, true/magnetic headings and both altitude/rate references", () => {
    const normalized = normalizeReadsbAircraft({ hex: "ab1234", flight: "TEST01", r: "TEST-REG", t: "C130",
        lat: 30, lon: 40, alt_baro: 15000, alt_geom: 15700, gs: 220, track: 88, true_heading: 92, mag_heading: 87,
        baro_rate: -320, geom_rate: -300 }, { source: "test", now: 1_000_000 });
    assert.equal(normalized.heading_deg, 88); // Existing renderer direction unchanged.
    assert.equal(normalized.true_heading_deg, 92);
    const telemetry = getAircraftTelemetry({ icao24: normalized.icao24, callsign: normalized.callsign,
        metadata: { telemetry: normalized } });
    const fields = Object.fromEntries(telemetry.fields);
    assert.equal(telemetry.direction, "TRK 88°");
    assert.equal(fields["True heading"], "92 °");
    assert.equal(fields["Barometric altitude"], "15,000 ft");
    assert.equal(fields["Geometric altitude"], "15,700 ft");
    assert.equal(fields["Barometric vertical rate"], "-320 ft/min");
});
test("missing telemetry stays unavailable, zero is valid only when reported and cached observation time isn't replaced by receipt time", () => {
    const track = { altitude_ft: 0, speed_kts: 0, heading_deg: 0, last_received_at: "2026-11-09T14:00:00Z",
        metadata: { telemetry: { altitude_ft: null, speed_kts: null, track_deg: null, observed_at: "2026-11-01T12:00:00Z" } } };
    const value = getAircraftTelemetry(track), fields = Object.fromEntries(value.fields);
    assert.equal(value.altitudeLabel, "N/A"); assert.equal(value.speedLabel, "N/A");
    assert.equal(value.direction, "TRK/HDG N/A");
    assert.equal(fields["Position observed (UTC)"], "2026-11-01T12:00:00.000Z");
    assert.equal(fields["Last received (UTC)"], "2026-11-09T14:00:00.000Z");
    assert.equal(fields["Contact state"], "Stale source observation");
    assert.equal(getAircraftTelemetry({ metadata: { telemetry: { track_deg: 0, speed_kts: 0 } } }).direction, "TRK 0°");
    assert.doesNotThrow(() => getAircraftTelemetry({ metadata: "null" }));
});

test("worker event and track metadata retain measured telemetry without a database write", async () => {
    resetProviderHealth();
    const now = Date.parse("2026-11-09T12:00:00Z");
    const observation = normalizeReadsbAircraft({ hex: "ae9123", flight: "TEST01", t: "C130", mil: true,
        lat: 30, lon: 40, gs: 0, alt_baro: 15000, alt_geom: 15700, track: 0, true_heading: 4,
        baro_rate: -300, geom_rate: -280 }, { source: "adsb_lol", militaryHint: true, now });
    const captured = {};
    await runAdsbWorker({ providers: [{ id: "adsb_lol", enabled: true, priority: 0,
        fetchObservations: async () => ({ observations: [observation] }) }], now,
        logger: { log() {}, warn() {}, error() {} }, persistence: {
            upsertEvents: async (rows) => { captured.events = rows; },
            upsertTracks: async (rows) => { captured.tracks = rows; return rows.length; },
            upsertHistory: async () => {},
        } });
    for (const row of [captured.events[0], captured.tracks[0]]) {
        assert.equal(row.metadata.telemetry.track_deg, 0);
        assert.equal(row.metadata.telemetry.true_heading_deg, 4);
        assert.equal(row.metadata.telemetry.altitude_geom_ft, 15700);
        assert.equal(row.metadata.telemetry.source, "adsb_lol");
        assert.equal(row.metadata.telemetry.speed_kts, 0);
    }
});

// Minimal DOM fixture runs actual keyed card code; it is not a browser visual test.
class Element {
    constructor(tag = "span") { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.className = ""; this._text = ""; }
    appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    insertBefore(child, before) { child.parentNode?.removeChild(child); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); child.parentNode = this; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    get firstChild() { return this.children[0]; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this._text = String(value); this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    get classList() { return { toggle: (name, enabled) => { this.className = this.className.split(/\s+/).filter((item) => item !== name).concat(enabled ? [name] : []).join(" "); } }; }
    querySelectorAll(selector) {
        const matches = (node) => selector.startsWith(".") ? selector.slice(1).split(".").every((name) => node.className.split(/\s+/).includes(name))
            : selector.startsWith("[data-") ? selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in node.dataset : node.tagName === selector;
        return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
test("focus expands one keyed card; Collapse and a different selection preserve the Unlock control and telemetry updates", () => {
    const essential = fs.readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
    const telemetry = fs.readFileSync(new URL("../../../dev/assets/js/warzone-aircraft-telemetry.js", import.meta.url), "utf8")
        .replace(/^export \{[^\n]+\};\r?\n/gm, "").replace(/export /g, "");
    const fn = (name) => { const start = essential.indexOf(`function ${name}(`); return essential.slice(start, essential.indexOf("\n}", start) + 2); };
    const context = vm.createContext({ document: { createElement: (tag) => new Element(tag), createTextNode: (value) => { const el = new Element("#text"); el.textContent = value; return el; } },
        getAircraftWidgetDetailLabel: (track) => track.type_code, getAircraftDisplayTitle: (track) => track.callsign,
        getAircraftWidgetStatusLabel: () => "Active", getAircraftWidgetTimeLabel: () => "Now",
        getAssetFocusController: () => ({ canEnterFocus: () => true }), recordRealtimeWork() {} });
    vm.runInContext(telemetry + '\nlet __aircraftCollapsedDetailsKey="";\n' + fn("getAircraftWidgetActionLabel") + fn("updateAircraftWidgetCard"), context);
    const card = new Element("article"), track = { track_key: "one", callsign: "TEST01", type_code: "C130", active: true, metadata: { telemetry: { speed_kts: 220 } } };
    context.updateAircraftWidgetCard(card, track, { track_key: "", mode: "" });
    assert.equal(card.querySelector(".wz-aircraft-technical-details").hidden, true);
    context.updateAircraftWidgetCard(card, track, { track_key: "one", mode: "focus" });
    assert.equal(card.querySelector(".wz-aircraft-technical-details").hidden, false);
    const action = card.querySelector(".wz-aircraft-action");
    assert.equal(action.dataset.trackAction, "unlock");
    vm.runInContext('__aircraftCollapsedDetailsKey="one"', context);
    context.updateAircraftWidgetCard(card, track, { track_key: "one", mode: "focus" });
    assert.equal(card.querySelector(".wz-aircraft-technical-details").hidden, true);
    assert.equal(card.querySelector(".wz-aircraft-action"), action);
    context.updateAircraftWidgetCard(card, track, { track_key: "two", mode: "focus" });
    assert.equal(action.dataset.trackAction, "focus");
});

test("AIS diagnostics are loopback/explicit-development only, and opening a socket isn't a successful AIS message", async () => {
    assert.equal(canReadNavalDiagnostics({ NODE_ENV: "production", STRATOPS_DEV_DIAGNOSTICS: "true" }, "127.0.0.1"), false);
    assert.equal(canReadNavalDiagnostics({ STRATOPS_DEV_DIAGNOSTICS: "true" }, "203.0.113.1"), false);
    assert.equal(canReadNavalDiagnostics({}, "127.0.0.1"), false);
    assert.equal(canReadNavalDiagnostics({ STRATOPS_DEV_DIAGNOSTICS: "true" }, "127.0.0.1"), true);
    let socket;
    const provider = createAisStreamProvider({ enabled: true, apiKey: "fixture-secret", delayImpl: async () => {},
        webSocketFactory: () => { socket = new EventEmitter(); socket.close = () => socket.emit("close"); socket.send = () => socket.emit("message", Buffer.from(JSON.stringify({ MessageType: "SubscriptionConfirmation", Message: { CompressionEnabled: true } })));
            setImmediate(() => socket.emit("open")); return socket; }, logger: { log() {}, warn() {} } });
    await provider.fetchObservations();
    assert.equal(provider.getDiagnostics().last_message_at, null);
    const publicFields = navalProviderDiagnostics([{ ...provider, apiKey: "fixture-secret", getDiagnostics: () => ({ connected: true, apiKey: "fixture-secret" }) }]);
    assert.doesNotMatch(JSON.stringify(publicFields), /fixture-secret/);
    provider.shutdown();
});
