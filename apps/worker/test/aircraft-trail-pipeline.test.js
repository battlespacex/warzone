import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { parse, parseExpressionAt } from 'acorn';
import * as Cesium from 'cesium';
import { curveObservedAircraftTrail } from '../../../dev/assets/js/warzone-aircraft-trail-geometry.js';

const source = fs.readFileSync(process.env.STRATOPS_TRAIL_SOURCE || new URL('../../../dev/assets/js/warzone-live-airforce.js', import.meta.url), 'utf8');
const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
const point = (lon, lat = 20, alt = 1000) => Cesium.Cartesian3.fromDegrees(lon, lat, alt);
const distance = (a,b) => a && b ? Cesium.Cartesian3.distance(a,b) : Infinity;
function harness() {
    const entity = { position: point(10), __liveTrackLastCommittedSourceTimestamp: Date.now() };
    const track = { subtype: 'fighter' };
    let builds = 0;
    const c = vm.createContext({ Cesium, performance, Date,
        window: { __warzoneViewer: { entities: { getById: () => entity } } },
        __liveTrackRegistry: new Map([['a', track]]), __liveTrackTrails: new Map(), __liveTrackTrailPositionsCache: new Map(),
        curveObservedAircraftTrail: positions => { builds++; return curveObservedAircraftTrail(positions); },
        isTrackCurrentlyFocused: key => key === 'a', isFocusedTrackKey: key => key === 'a',
        getCartesianDistanceMeters: distance, getPositionCartesian: value => value?.position,
        resolveTrackSubtype: value => value.subtype || 'aircraft',
        normalizeDegrees: value => ((value % 360) + 360) % 360,
        clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
        getTrackPointRenderAltitudeMeters: value => Number(value.altitude_ft || 0) * .3048,
        buildTrackTrailCartesian: (_track, lon, lat, alt) => point(lon, lat, alt),
    });
    for (const name of ['LIVE_TRACK_NORMAL_MAX_TRAIL_POINTS','LIVE_TRACK_FOCUSED_MAX_TRAIL_POINTS',
        'LIVE_TRACK_TRAIL_MAX_AGE_MS','LIVE_TRACK_TRAIL_INTERRUPTION_GAP_MS','LIVE_TRACK_SEED_HISTORY_MAX_POINTS',
        'LIVE_TRACK_HISTORY_JUMP_MIN_METERS','LIVE_TRACK_HISTORY_SPEED_GRACE_FACTOR',
        'LIVE_TRACK_HISTORY_MAX_SPEED_MPS_BY_SUBTYPE','LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS',
        'LIVE_TRACK_TRAIL_HEAD_INVALIDATION_METERS']) {
        const declaration = declarations.find(node => node.id.name === name);
        vm.runInContext(`const ${source.slice(declaration.start, declaration.end)};`, c);
    }
    for (const name of ['getLiveTrackTrailMaxPoints','trimTrailEntries','getTrackHistoryMaxSpeedMps',
        'isImplausibleTrackMotion','parseTrailPointTimestamp','normalizeLiveTrackHistoryPoint','sanitizeSeedTrailEntries',
        'seedTrackTrailFromHistory','getTraversedTrackTrailEntries','updateTrackTrailPositionsCache',
        'getFocusedRoutePositions','getTrackTrailPositions','getTrackTrailMinDistanceMeters','isDisconnectedTrackTrail','commitTrackTrailPosition',
        'ensureTrackTrailVisible']) {
        const start = source.indexOf(`function ${name}(`);
        if (start < 0) continue; // Allows an explicit pre-change baseline run.
        vm.runInContext(source.slice(start, parseExpressionAt(source,start,{ecmaVersion:'latest'}).end), c);
    }
    return { c, entity, track, builds: () => builds };
}

test('source cutoff excludes all unreached fixes, even when the latest fix is not the motion target', () => {
    const h = harness(), now = Date.now();
    h.entity.__liveTrackLastCommittedSourceTimestamp = now - 10000;
    h.entity.__liveTrackMotionState = { sourceTimestamp: now, endCartesian: point(10.02) };
    h.entity.position = point(10.005);
    h.c.__liveTrackTrails.set('a', [
        {ts: now-20000, position:point(9.99)}, {ts:now-10000, position:point(10)},
        {ts:now-5000, position:point(10.01)}, {ts:now,position:point(10.03)},
    ]);
    const positions = h.c.getFocusedRoutePositions('a');
    assert.equal(positions.length, 3);
    assert.equal(distance(positions.at(-1), h.entity.position), 0);
    assert.ok(positions.every(p => Cesium.Cartographic.fromCartesian(p).longitude <= Cesium.Math.toRadians(10.005)+1e-10));
});

test('seeds order timestamps, reject invalid fixes and duplicates, and start a new segment after gaps/jumps', () => {
    const h = harness(), now = Date.now();
    const fix = (offset,lon,lat=20) => ({ts:now+offset,lon,lat,altitude_ft:10000});
    const observations = [fix(-1000,10.01),fix(-11000,10),fix(-11000,10),fix(-500,999),fix(-400,10,100)];
    const original = JSON.stringify(observations);
    h.c.seedTrackTrailFromHistory('a', h.track, observations);
    let entries = h.c.__liveTrackTrails.get('a');
    assert.equal(entries.length,2); assert.ok(entries[0].ts < entries[1].ts);
    assert.equal(JSON.stringify(observations),original);
    for (const newer of [[fix(-300000,10),fix(-1000,10.01)], [fix(-2000,10),fix(-1000,80)]]) {
        h.c.seedTrackTrailFromHistory('a',h.track,newer);
        entries=h.c.__liveTrackTrails.get('a'); assert.equal(entries.length,1);
        assert.equal(entries[0].ts,now-1000);
        h.entity.position=entries[0].position;
        assert.equal(h.c.getFocusedRoutePositions('a').length,1,'no old-to-reacquired bridge');
    }
});

test('commit uses reached source time, ignores stale updates, and breaks implausible connections', () => {
    const h=harness(), now=Date.now();
    h.entity.__liveTrackLastCommittedSourceTimestamp=now-20000;
    h.c.commitTrackTrailPosition('a',h.track,point(10));
    h.entity.__liveTrackLastCommittedSourceTimestamp=now-10000;
    h.c.commitTrackTrailPosition('a',h.track,point(10.01));
    assert.equal(h.c.__liveTrackTrails.get('a').at(-1).ts,now-10000);
    h.entity.__liveTrackLastCommittedSourceTimestamp=now-15000;
    h.c.commitTrackTrailPosition('a',h.track,point(10.005));
    assert.equal(h.c.__liveTrackTrails.get('a').length,2);
    h.entity.__liveTrackLastCommittedSourceTimestamp=now;
    h.c.commitTrackTrailPosition('a',h.track,point(80));
    assert.equal(h.c.__liveTrackTrails.get('a').length,1);
    h.c.commitTrackTrailPosition('b',h.track,point(90));
    assert.equal(h.c.__liveTrackTrails.has('b'),false,'focus switching cannot mix track identities');
});

test('continuity thresholds respect aircraft type and elapsed time', () => {
    const h=harness();
    assert.equal(h.c.isDisconnectedTrackTrail(1500,1000,{subtype:'helicopter'}),true);
    assert.equal(h.c.isDisconnectedTrackTrail(1500,1000,{subtype:'fighter'}),false);
    assert.equal(h.c.isDisconnectedTrackTrail(2000,1000,{subtype:'fighter'}),true);
    assert.equal(h.c.isDisconnectedTrackTrail(2000,10000,{subtype:'helicopter'}),false);
});

test('focus during interpolation cannot seed a future fix with a reached timestamp', () => {
    const h=harness(),now=Date.now();
    h.entity.__liveTrackLastCommittedSourceTimestamp=now-10000;
    h.entity.__liveTrackMotionState={sourceTimestamp:now,endCartesian:point(10.02)};
    h.entity.position=point(10.005);
    h.c.ensureTrackTrailVisible('a',h.track,10.02,20,1000,90);
    assert.equal(h.c.__liveTrackTrails.has('a'),false);
    const positions=h.c.getFocusedRoutePositions('a');
    assert.equal(positions.length,1); assert.equal(distance(positions[0],h.entity.position),0);
});

test('replacement history with the same length and timestamps invalidates the curve cache', () => {
    const h=harness(),now=Date.now();
    const first=[{ts:now-10000,position:point(10)},{ts:now,position:point(10.01)}];
    const cached=h.c.updateTrackTrailPositionsCache('a',first);
    const replacement=first.map(entry=>({...entry,position:point(11)}));
    const updated=h.c.updateTrackTrailPositionsCache('a',replacement);
    assert.notEqual(updated,cached);
    assert.equal(updated[0],replacement[0].position);
});

test('predicted head follows the model but is never committed by the prediction loop', () => {
    const h=harness(), now=Date.now();
    h.c.__liveTrackTrails.set('a',[{ts:now-10000,position:point(9.99)},{ts:now,position:point(10)}]);
    h.entity.__liveTrackMotionState={phase:'prediction', sourceTimestamp:now,
        prediction:{startedAt:performance.now()-3000,endsAt:performance.now()+1000}};
    for (let i=0;i<20;i++) {
        h.entity.position=point(10+i*.0001);
        const positions=h.c.getFocusedRoutePositions('a');
        assert.ok(distance(positions.at(-1),h.entity.position)<.75);
    }
    assert.equal(h.c.__liveTrackTrails.get('a').length,2);
    assert.equal(h.builds(),1,'moving heads reuse the observation curve');
    const prediction=source.slice(source.indexOf('function updateLiveTrackPredictionFrame('),source.indexOf('function updateLiveTrackMotionFrame('));
    assert.doesNotMatch(prediction,/pushTrackTrailPoint|commitTrackTrailPosition/);
});

for (const name of ['straight','gradual','sharp','dateline','altitude']) test(`bounded geodetic curve: ${name}`, () => {
    const tracks={
        straight:[[10,20,1000],[10.01,20,1000],[10.02,20,1000]],
        gradual:[[10,20,1000],[10.01,20.002,1100],[10.018,20.008,1200],[10.02,20.018,1400]],
        sharp:[[10,20,100],[10.01,20,100],[10.01,20.01,100],[10,20.01,100]],
        dateline:[[179.98,20,1000],[179.99,20,1000],[-179.99,20.01,1100],[-179.98,20.02,1200]],
        altitude:[[10,20,0],[10.01,20.01,15000],[10.02,20.015,50]],
    };
    const raw=tracks[name].map(p=>point(...p)), original=JSON.stringify(raw);
    const curved=curveObservedAircraftTrail(raw);
    assert.equal(curved.length,3*(raw.length-1)+1);
    raw.forEach((p,i)=>assert.equal(curved[i*3],p,'every observed position retained exactly'));
    for(let i=0;i<raw.length-1;i++) {
        const a=Cesium.Cartographic.fromCartesian(raw[i]),b=Cesium.Cartographic.fromCartesian(raw[i+1]);
        b.longitude=a.longitude+Cesium.Math.negativePiToPi(b.longitude-a.longitude);
        for(let j=1;j<3;j++) {
            const p=Cesium.Cartographic.fromCartesian(curved[i*3+j]);
            p.longitude=a.longitude+Cesium.Math.negativePiToPi(p.longitude-a.longitude);
            for(const axis of ['longitude','latitude','height']) {
                assert.ok(p[axis]>=Math.min(a[axis],b[axis])-1e-6 && p[axis]<=Math.max(a[axis],b[axis])+1e-6,axis);
            }
        }
    }
    assert.equal(JSON.stringify(raw),original);
    assert.equal(curveObservedAircraftTrail(raw.slice(0,2)).length,2);
});

test('100–300 aircraft fixtures and long sessions retain bounded geometry and reuse idle caches', () => {
    const h=harness(), now=Date.now(), samples=Array.from({length:600},(_,i)=>({ts:now-600000+i*1000,
        position:point(10+i*.00001,20+Math.sin(i/100)*.001,1000+i)}));
    for(const count of [100,300]) {
        const start=performance.now(), before=h.builds();
        for(let i=0;i<count;i++) {
            const key=`fixture-${count}-${i}`;
            const first=h.c.updateTrackTrailPositionsCache(key,samples);
            assert.equal(first.length,1798);
            for(let frame=0;frame<100;frame++) assert.equal(h.c.updateTrackTrailPositionsCache(key,samples),first);
        }
        assert.equal(h.builds()-before,count);
        console.log(`trail fixture: ${count} x 600 observations, one curve + 100 cache hits each: ${(performance.now()-start).toFixed(1)} ms`);
    }
    for(let i=0;i<3000;i++) {
        h.entity.__liveTrackLastCommittedSourceTimestamp=now-3000000+i*1000;
        h.c.commitTrackTrailPosition('a',h.track,point(10+i*.0003));
    }
    assert.equal(h.c.__liveTrackTrails.get('a').length,600);
});
