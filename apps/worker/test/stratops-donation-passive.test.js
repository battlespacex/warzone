import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const essential = await fs.readFile(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
const aoi = await fs.readFile(new URL("../../../dev/assets/js/warzone-aoi-lens.js", import.meta.url), "utf8");

function section(source, name, next) {
    return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test("Donation does not suspend map work or change the Cesium render budget", () => {
    assert.doesNotMatch(section(essential, "shouldSuspendMapWork", "isAircraftFocusPerformanceMode"), /isSupportModalVisible/);
    assert.match(section(essential, "syncModalRenderBudget", "onAuthModalVisibilityChanged"), /setAuthModalRenderBudget\(false\)/);
    assert.doesNotMatch(section(essential, "syncModalRenderBudget", "onAuthModalVisibilityChanged"), /isSupportModalVisible|isAuthModalVisible/);
});

test("Donation open and close only change modal UI state", () => {
    const open = section(essential, "openSupportModal", "closeSupportModal");
    const close = section(essential, "closeSupportModal", "showSupportModal");
    const forbidden = /setAuthModalRenderBudget|syncHotspotRootVisibility|scheduleViewportFetch|stopAircraft|stopNaval|clearLiveTrack|clearNaval|unsubscribe|disconnect/;
    assert.doesNotMatch(open, forbidden);
    assert.doesNotMatch(close, forbidden);
    assert.match(open, /__warzoneOpenSharedModal/);
    assert.match(close, /__warzoneCloseSharedModal/);
});

test("Donation no longer hides the live AOI data source", () => {
    const modalBinding = section(aoi, "bindModalVisibility", "applyDataSourceVisibility");
    assert.doesNotMatch(modalBinding, /wz-donate-modal/);
    assert.match(modalBinding, /wz-about-modal/);
});
