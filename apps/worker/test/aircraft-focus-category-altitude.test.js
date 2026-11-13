import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Cesium from 'cesium';
import postcss from 'postcss';

const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-live-airforce.js',import.meta.url),'utf8');
function harness(values){
 const context=vm.createContext({Cesium,
  clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),feetToMeters:v=>v*.3048,
  getAircraftFocusedSizingCategory:t=>t.category||'fighter',
  getCssNumber:(name,fallback,style)=>{const raw=style?.getPropertyValue(name)??values[name];return Number.isFinite(parseFloat(raw))?parseFloat(raw):fallback;},
  getLiveTrackFocusCameraRangeMeters:()=>24000,getLiveTrackFocusCameraPitchDeg:()=>-58,getLiveTrackFocusFinalRangeMeters:()=>220000,
  getTrackReportedAltitudeFt:t=>t.altitude_ft,
  LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG:-85,LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG:-10,LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS:500,
 });
 for(const name of ['getLiveTrackFocusAltitudeOffsetFt','getAircraftInitialFocusCameraConfig']){
  const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);
  vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
 }
 return context;
}

test('each aircraft category resolves its own feet offset with shared fallback',()=>{
 const values={'--warzone-live-aircraft-focus-altitude-offset-ft':3500};
 const h=harness(values);
 for(const [i,category] of ['fighter','transport','bomber','tanker','recon','awacs','helicopter','vip','drone'].entries()){
  assert.equal(h.getLiveTrackFocusAltitudeOffsetFt(null,{category}),3500);
  values[`--warzone-live-aircraft-model-focus-altitude-${category}`]=400+i*500;
  assert.equal(h.getLiveTrackFocusAltitudeOffsetFt(null,{category}),400+i*500);
 }
 assert.equal(h.getLiveTrackFocusAltitudeOffsetFt({getPropertyValue:n=>n.endsWith('-transport')?'2400':''},{category:'transport'}),2400);
});

test('initial focus, fallback and range safety use category offset without changing reported altitude',()=>{
 const h=harness({'--warzone-live-aircraft-model-focus-altitude-transport':400,'--warzone-live-aircraft-model-focus-altitude-bomber':2500});
 const track={category:'transport',altitude_ft:10000};
 const config=h.getAircraftInitialFocusCameraConfig(track,Cesium.Cartesian3.fromDegrees(-75,32,3048));
 assert.equal(config.altitudeOffsetFt,400);assert.equal(config.cameraAltitudeFt,10400);assert.equal(config.rangeMeters,500);
 assert.equal(track.altitude_ft,10000);
 const bomber=h.getAircraftInitialFocusCameraConfig({category:'bomber',altitude_ft:10000});
 assert.ok(Math.abs(bomber.rangeMeters-2500*.3048/Math.sin(58*Math.PI/180))<1e-8);
 const fallback=h.getAircraftInitialFocusCameraConfig({category:'bomber'});
 assert.equal(fallback.usesReportedAltitude,false);assert.equal(fallback.rangeMeters,bomber.rangeMeters);
});

test('all five CSS tiers expose every category next to its model sizing controls',()=>{
 const css=postcss.parse(fs.readFileSync(new URL('../../../dev/assets/css/root.css',import.meta.url),'utf8'));
 const found=new Map();
 css.walkDecls(d=>{
  if(!d.prop.startsWith('--warzone-live-aircraft-model-focus-altitude-'))return;
  const category=d.prop.slice('--warzone-live-aircraft-model-focus-altitude-'.length);
  found.set(category,(found.get(category)||0)+1);
  assert.equal(d.value,category==='transport'?'400':'var(--warzone-live-aircraft-focus-altitude-offset-ft)');
 });
 assert.equal(found.size,9);for(const count of found.values())assert.equal(count,5);
});
