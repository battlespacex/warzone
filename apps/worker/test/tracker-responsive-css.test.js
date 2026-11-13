import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import * as C from 'cesium';
import { readGlbSizing, applyGlbDistanceSizing } from '../../../dev/assets/js/warzone-glb-distance-sizing.js';

const css=postcss.parse(fs.readFileSync(new URL('../../../dev/assets/css/root.css',import.meta.url),'utf8'));
const categories={aircraft:['fighter','transport','bomber','tanker','recon','awacs','helicopter','vip','drone'],naval:['carrier','amphibious','cruiser','destroyer','frigate','corvette','intelligence','ssbn','ssn','ssk','aip_submarine','submarine','missile_boat','patrol','logistics','minesweeper','naval']};
function cascade(width,overrides={}){
 const values=new Map();let tierMatches=0;
 css.walkRules(rule=>{
  if(rule.selector!==':root')return;
  const media=rule.parent;
  if(media.type==='atrule'){
   if(media.name!=='media')return;
   for(const [,bound,n]of media.params.matchAll(/(min|max)-width:\s*(\d+)px/g))if(bound==='min'?width<+n:width>+n)return;
   if(rule.nodes.some(n=>n.prop==='--warzone-live-aircraft-model-scale'))tierMatches++;
  }
  for(const d of rule.nodes.filter(n=>n.type==='decl'))values.set(d.prop,d.value);
 });
 for(const [name,value]of Object.entries(overrides))values.set(name,String(value));
 const resolve=name=>{const value=values.get(name)||'',ref=value.match(/^var\(([^)]+)\)$/);return ref?resolve(ref[1]):value;};
 return {tierMatches,read:(name,fallback)=>Number.isFinite(parseFloat(resolve(name)))?parseFloat(resolve(name)):fallback};
}

test('all Air/Naval category size endpoints and pixel floors resolve at viewport boundaries',t=>{
 for(const width of [390,767,768,1920,1921,2559,2560,2561,3839,3840,5120]){
  const {read,tierMatches}=cascade(width);assert.equal(tierMatches,1,`one responsive size tier at ${width}`);
  for(const [domain,types]of Object.entries(categories))for(const category of types){
   const config=readGlbSizing(read,domain,category);assert.equal(config.nearSize,10);
   assert.equal(config.farSize,read(`--warzone-live-${domain}-model-scale`,NaN));
   assert.equal(config.minimum,read(`--warzone-live-${domain}-model-min-pixel-size`,NaN));
   const entity=new C.Entity({position:new C.Cartesian3(),model:{uri:'existing.glb'}}),viewer={camera:{positionWC:new C.Cartesian3(8000000,0,0)},scene:{canvas:{clientWidth:width},drawingBufferWidth:width}};
   applyGlbDistanceSizing(entity,config,viewer);const property=entity.model.scale,time=C.JulianDate.now();
   assert.ok(entity.model.minimumPixelSize.getValue(time)>=config.minimum);
   viewer.camera.positionWC.x=2500;assert.ok(Math.abs(property.getValue(time)-10/3)<1e-9);
   assert.equal(entity.model.minimumPixelSize.getValue(time),80); // Approved close-up endpoint.
   applyGlbDistanceSizing(entity,config,viewer);assert.equal(entity.model.scale,property);
  }
  t.diagnostic(JSON.stringify({width,air:readGlbSizing(read,'aircraft','fighter'),naval:readGlbSizing(read,'naval','naval')}));
 }
});

test('QHD gets only a larger far visibility floor; base and category CSS edits reach the sizing reader',()=>{
 assert.equal(cascade(2560).read('--warzone-live-aircraft-model-min-pixel-size'),30);
 assert.equal(cascade(2561).read('--warzone-live-aircraft-model-min-pixel-size'),36);
 assert.equal(cascade(3839).read('--warzone-live-naval-model-min-pixel-size'),29);
 for(const domain of ['aircraft','naval']){
  const category=domain==='aircraft'?'transport':'carrier',prefix=`--warzone-live-${domain}-model-`;
  const changed=cascade(3000,{[prefix+'scale']:2,[prefix+'scale-max']:12,[prefix+'min-pixel-size']:44}).read;
  const config=readGlbSizing(changed,domain,category);assert.equal(config.farSize,2);assert.equal(config.nearSize,12);assert.equal(config.minimum,44);
  assert.equal(readGlbSizing(cascade(3000,{[prefix+'scale-min-'+category]:3}).read,domain,category).farSize,3);
 }
});
