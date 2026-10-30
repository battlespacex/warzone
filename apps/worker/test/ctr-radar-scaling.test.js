import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../../dev/assets/css/root.css", import.meta.url), "utf8");
const start = source.indexOf("function getFocusedCtrRadarConfig(");
const implementation = source.slice(start, source.indexOf("\n}", start) + 2);
const defaults = Object.fromEntries([...css.matchAll(/(--warzone-(?:aircraft-|naval-)?ctr-radar-[\w-]+):\s*([\d.]+);/g)]
    .map(([, key, value]) => [key, Number(value)]));

test("independent CTR extents scale both radii once with bounded grid spacing", () => {
    const values = { ...defaults }, state = { hasFocusPosition: true, profile: "aircraft" };
    const context = vm.createContext({ getContourOverlayState: () => state,
        getContourFocusProfile: () => state.profile, numberVar: (key, fallback) => values[key] ?? fallback });
    vm.runInContext(implementation, context);
    for (let cycle = 0; cycle < 30; cycle++) for (const [profile, factor, inner, outer, spacing] of [
        ["aircraft", defaults["--warzone-aircraft-ctr-radar-extent-scale"],
            150 * defaults["--warzone-aircraft-ctr-radar-extent-scale"],
            300 * defaults["--warzone-aircraft-ctr-radar-extent-scale"],
            Math.max(300 * defaults["--warzone-aircraft-ctr-radar-extent-scale"] / 32, 50)],
        ["naval", 0.5, 750, 1500, 500],
    ]) {
        state.profile = profile;
        const config = context.getFocusedCtrRadarConfig({});
        assert.equal(config.innerRadius, inner); assert.equal(config.outerRadius, outer);
        assert.equal(config.spacing, spacing); assert.equal(config.ringWidth, 1.5);
        assert.equal(config.gridWidth, 1); assert.equal(config.ringCount, 2);
        values[`--warzone-${profile}-ctr-radar-extent-scale`] = 1;
        const previous = context.getFocusedCtrRadarConfig({});
        assert.equal(config.innerRadius / previous.innerRadius, factor);
        assert.equal(config.outerRadius / previous.outerRadius, factor);
        assert.equal(config.spacing, Math.max(config.outerRadius / 32, previous.spacing));
        values[`--warzone-${profile}-ctr-radar-extent-scale`] = factor;
    }
    values["--warzone-aircraft-ctr-radar-inner-radius"] = 200;
    state.profile = "aircraft";
    assert.equal(context.getFocusedCtrRadarConfig({}).innerRadius,
        200 * defaults["--warzone-aircraft-ctr-radar-extent-scale"]);
    state.profile = "naval";
    assert.equal(context.getFocusedCtrRadarConfig({}).innerRadius, 750);
    values["--warzone-naval-ctr-radar-scale"] = 2;
    assert.equal(context.getFocusedCtrRadarConfig({}).outerRadius, 3000);
    assert.equal(context.getFocusedCtrRadarConfig({}).spacing, 1000);
    state.hasFocusPosition = false;
    assert.equal(context.getFocusedCtrRadarConfig({}), null, "unfocused operational grids are unaffected");
});
