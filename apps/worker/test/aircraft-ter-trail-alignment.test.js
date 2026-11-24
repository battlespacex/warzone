import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Cesium from 'cesium';
import VerticalExaggeration from '../../../node_modules/@cesium/engine/Source/Core/VerticalExaggeration.js';
import { parseExpressionAt, parse } from 'acorn';

const source = fs.readFileSync(new URL('../../../dev/assets/js/warzone-live-airforce.js', import.meta.url), 'utf8');
const fixtures = fs.readFileSync(new URL('../../../dev/assets/js/warzone-formation-tuner.js', import.meta.url), 'utf8');
const presetNode = parse(fixtures, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === 'FORMATION_PRESETS'));
const presets = vm.runInNewContext(fixtures.slice(presetNode.declarations[0].init.start, presetNode.declarations[0].init.end));
function harness() {
    let terrain = false;
    const entity = {}, track = { track_key: 'alignment', heading_deg: 92, altitude_ft: 30000 };
    const c = vm.createContext({ Cesium, window: { __warzoneViewer: {
        entities: { getById: () => entity }, __warzone: { isFocusedTerrainActive: () => terrain },
    } },
    __liveTrackRegistry: new Map([['alignment', track]]),
    getTraversedTrackTrailEntries: () => [{ position: Cesium.Cartesian3.fromDegrees(45, 24, 100) }],
    updateTrackTrailPositionsCache: (_key, entries) => entries.map(entry => entry.position),
    getPositionCartesian: value => value?.position,
    getCartesianDistanceMeters: (a,b) => a && b ? Cesium.Cartesian3.distance(a,b) : Infinity,
    isTrackInFocusVisualContext: () => true,
    getFocusedTrackAnchorOffsets: () => ({ backwardMeters: 120, downMeters: 30 }),
    offsetLonLatByMeters: (lon,lat,east,north) => ({ lon: lon + east / 111320, lat: lat + north / 111320 }),
    normalizeDegrees: value => value, getLiveAircraftModelVisibilityConfig: () => ({ alpha: 1, whiteness: .18 }),
    getLiveGlbModelQualityConfig: () => ({}), getLiveGlbMaterialShader: () => undefined,
    });
    for (const name of ['isFocusedTerrainModeActive','getFocusedTerrainModelClearanceMeters',
        'buildTrackEntityCartesian','buildLiveTrackModelGraphics','applyLiveGlbModelQuality','getFocusedRoutePositions']) {
        const start = source.indexOf(`function ${name}(`);
        vm.runInContext(source.slice(start, parseExpressionAt(source,start,{ecmaVersion:'latest'}).end),c);
    }
    return { c, entity, track, terrain: value => { terrain = value; } };
}
test('aircraft opt out of terrain exaggeration on creation and existing-model refresh', () => {
    const {c, track} = harness();
    const model = new Cesium.ModelGraphics(c.buildLiveTrackModelGraphics('fixture.glb',12,36,18,track));
    assert.equal(model.enableVerticalExaggeration.getValue(Cesium.JulianDate.now()),false);
    model.enableVerticalExaggeration = true;
    c.applyLiveGlbModelQuality(model,track);
    assert.equal(model.enableVerticalExaggeration.getValue(Cesium.JulianDate.now()),false);
    assert.equal(model.scale.getValue(),12); assert.equal(model.maximumScale.getValue(),18);
    assert.doesNotThrow(() => c.applyLiveGlbModelQuality(null,track));
    assert.equal(VerticalExaggeration.getHeight(10000,1.25,0)-10000,2500,
        'the previous default exaggeration creates a 2500 m displacement at 10 km');
});
test('existing formation models keep world anchors and trail endpoints through repeated 3D/TER/CTR switches', () => {
    const h = harness();
    for (const preset of Object.values(presets)) for (const member of preset.members) {
        for (const altitude of [0,100,3000,15000]) {
            const track = { ...h.track, model_code: member.assetKey };
            const original = JSON.stringify(track);
            let previous = null;
            for (const mode of ['3D','TER','CTR','TER','3D']) {
                h.terrain(mode === 'TER');
                const position = h.c.buildTrackEntityCartesian(track,45,24,altitude,92);
                h.entity.position = position;
                const positions = h.c.getFocusedRoutePositions('alignment');
                assert.equal(Cesium.Cartesian3.distance(position,positions.at(-1)),0);
                if(previous) assert.ok(Cesium.Cartesian3.distance(position,previous)<1e-8);
                previous=position;
                assert.equal(JSON.stringify(track),original,'camera modes leave telemetry unchanged');
            }
        }
    }
});
