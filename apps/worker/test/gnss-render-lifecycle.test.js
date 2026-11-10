import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
import ContextLimits from "../../../node_modules/@cesium/engine/Source/Renderer/ContextLimits.js";
import { setDataSourceActive } from "../../../dev/assets/js/warzone-data-source-lifecycle.js";
import { createOperationalGnssReveal } from "../../../dev/assets/js/warzone-gnss-reveal.js";
const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-gnss.js", import.meta.url), "utf8");
test("GNSS real Cesium entities attach once across ON/OFF, updates and region replacement", async () => {
  const viewer={dataSources:new Cesium.DataSourceCollection(),isDestroyed:()=>false,scene:{requestRender(){}},container:{style:{}}};
  const context=vm.createContext({Cesium,setDataSourceActive,createOperationalGnssReveal,window:{},document:{getElementById:()=>null,querySelector:()=>null}});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),context);
  vm.runInContext('bindPicking=()=>{};closeActiveGnssPanel=()=>{};clearHighlight=()=>{};hideTooltip=()=>{};setLegendVisible=()=>{};',context);
  const cells=[{id:'a',lat:26,lon:50,severity:'high',updatedAt:new Date().toISOString()}];
  for(let i=0;i<10;i++){
    context.renderGnssInterferenceLayer(viewer,cells,{visible:true}); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(viewer.dataSources.length,1);assert.equal(viewer.dataSources.get(0).entities.values.length,1);
    context.renderGnssInterferenceLayer(viewer,cells,{visible:false});assert.equal(viewer.dataSources.length,0);
  }
  context.renderGnssInterferenceLayer(viewer,[{...cells[0],id:'other-region',lat:40}],{visible:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(viewer.dataSources.length,1);assert.equal(viewer.dataSources.get(0).entities.values[0].id,'gnss-cell-other-region');
  context.clearGnssInterferenceLayer(viewer);assert.equal(viewer.dataSources.length,0);
});

test("GNSS 12000-cell geometry retains 200-cell batches, hidden instances, metadata and cancellable cache ownership", (t) => {
  const minWidth=ContextLimits._minimumAliasedLineWidth, maxWidth=ContextLimits._maximumAliasedLineWidth;
  ContextLimits._minimumAliasedLineWidth=1; ContextLimits._maximumAliasedLineWidth=1;
  t.after(()=>{ContextLimits._minimumAliasedLineWidth=minWidth;ContextLimits._maximumAliasedLineWidth=maxWidth;});
  const frames=[], primitives=[], timers=new Map(), events=new Map(), cameraChecks=[];
  const event=()=>({listeners:new Set(),addEventListener(fn){this.listeners.add(fn);},
    removeEventListener(fn){this.listeners.delete(fn);},fire(...args){for(const fn of [...this.listeners])fn(...args);}});
  const document={hidden:false,getElementById:()=>null,querySelector:()=>null,
    addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
    removeEventListener(name,fn){events.get(name)?.delete(fn);}};
  const viewer={dataSources:new Cesium.DataSourceCollection(),isDestroyed:()=>false,container:{style:{}},
    camera:{moveStart:event(),moveEnd:event()},scene:{postRender:event(),renderError:event(),requestRender(){},
    groundPrimitives:{add(p){primitives.push(p);return p;},remove(p){const i=primitives.indexOf(p);if(i<0)return false;
      primitives.splice(i,1);p.destroy();return true;}},pick:()=>null}};
  const context=vm.createContext({Cesium,setDataSourceActive,console,document,window:{},
    requestAnimationFrame:(fn)=>frames.push(fn),createOperationalGnssReveal:(v,options)=>{
      cameraChecks.push(options.cameraSettled);
      return createOperationalGnssReveal(v,{...options,document,now:()=>0,
        setTimer:(fn)=>{const id={};timers.set(id,fn);return id;},clearTimer:(id)=>timers.delete(id)});
    }});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),context);
  vm.runInContext('bindPicking=()=>{};closeActiveGnssPanel=()=>{};clearHighlight=()=>{};hideTooltip=()=>{};setLegendVisible=()=>{};',context);
  const cells=Array.from({length:12000},(_,i)=>({id:`cell-${i}`,lat:26+(i%100)*.01,lon:50+Math.floor(i/100)*.01,
    severity:["low","medium","high","severe"][i%4],sampleCount:i+1,affectedPct:30,source:"fixture"}));
  const options={visible:true,sourceMode:"gpsinterference",regionId:"a",observationKey:"72h"};
  context.renderGnssInterferenceLayer(viewer,cells,options);
  assert.equal(cameraChecks[0](),false);
  for(const fn of events.get("wz:region-camera-settled"))fn({detail:{region:{id:"other"}}});
  assert.equal(cameraChecks[0](),false);
  for(const fn of events.get("wz:region-camera-settled"))fn({detail:{region:{id:"a"}}});
  assert.equal(cameraChecks[0](),true);
  viewer.camera.moveStart.fire();assert.equal(cameraChecks[0](),false);
  viewer.camera.moveEnd.fire();assert.equal(cameraChecks[0](),true);
  // Synchronization before the first construction frame must not queue a duplicate build.
  context.renderGnssInterferenceLayer(viewer,cells,options);
  assert.equal(frames.length,1);
  frames.shift()();
  const first=primitives[0];
  context.clearGnssInterferenceLayer(viewer,{retainGeometry:true});
  context.renderGnssInterferenceLayer(viewer,cells,options);
  while(frames.length)frames.shift()();
  assert.equal(primitives[0],first);
  assert.equal(primitives.length,120);
  assert.equal(context.getGnssDiagnostics().activeCellEntities,12000);
  assert.equal(context.getGnssDiagnostics().reveal.constructed,12000);
  let index=0;
  for(let b=0;b<primitives.length;b+=2){
    const fill=primitives[b],outline=primitives[b+1];
    assert.equal(fill.geometryInstances.length,200);
    assert.equal(outline.geometryInstances.length,200);
    assert.equal(fill.allowPicking,true);assert.equal(outline.allowPicking,false);
    for(let i=0;i<200;i++,index++){
      const instance=fill.geometryInstances[i],border=outline.geometryInstances[i];
      assert.equal(instance.id.__gnssCell,cells[index]);
      assert.equal(border.id,`gnss-outline-${cells[index].id}`);
      assert.equal(instance.attributes.show.value[0],0);assert.equal(border.attributes.show.value[0],0);
      const tokens=vm.runInContext('readGnssTokens()',context);
      const expected=Cesium.ColorGeometryInstanceAttribute.fromColor(context.getSeverityColors(tokens,cells[index].severity).fill);
      assert.deepEqual(instance.attributes.color.value,expected.value);
      assert.ok(instance.geometry instanceof Cesium.PolygonGeometry);
      assert.ok(border.geometry instanceof Cesium.GroundPolylineGeometry);
    }
  }
  const picked=first.geometryInstances[0].id;
  viewer.scene.pick=()=>({id:picked});
  assert.equal(context.findPickedGnssEntity(viewer,{}),picked);
  assert.match(context.renderPopupContent(picked.__gnssCell),/GNSS/);
  const sameReveal=context.getGnssDiagnostics().reveal;
  for(let i=0;i<10;i++)context.renderGnssInterferenceLayer(viewer,cells,options);
  assert.equal(primitives[0],first);assert.equal(frames.length,0);
  assert.equal(context.getGnssDiagnostics().reveal.constructed,sameReveal.constructed);
  assert.equal(viewer.camera.moveStart.listeners.size,1);
  assert.equal(events.get("wz:region-camera-settled").size,1);
  assert.equal(timers.size,1);
  const oldTimer=[...timers.keys()][0];
  // Region and period keys cancel the prior scheduler even if observations happen to be identical.
  context.renderGnssInterferenceLayer(viewer,cells,{...options,regionId:"b"});
  assert.equal(cameraChecks.at(-1)(),false);
  assert.equal(first.isDestroyed(),true);assert.equal(primitives.length,0);
  assert.equal(timers.size,1);
  assert.equal(timers.has(oldTimer),false);
  frames.shift()();
  const regionPrimitive=primitives[0];
  context.renderGnssInterferenceLayer(viewer,cells,{...options,regionId:"b",observationKey:"48h"});
  assert.equal(regionPrimitive.isDestroyed(),true);
  context.clearGnssInterferenceLayer(viewer);
  while(frames.length)frames.shift()();
  assert.equal(primitives.length,0);assert.equal(timers.size,0);
  assert.equal(viewer.scene.postRender.listeners.size,0);
  assert.equal(viewer.camera.moveStart.listeners.size,0);
  assert.equal(events.get("wz:region-camera-settled").size,0);
});


test("GNSS provider hexagons use cancellable batched ground primitives and preserve pick records", (t) => {
  const minWidth=ContextLimits._minimumAliasedLineWidth, maxWidth=ContextLimits._maximumAliasedLineWidth;
  ContextLimits._minimumAliasedLineWidth=1; ContextLimits._maximumAliasedLineWidth=1;
  t.after(()=>{ContextLimits._minimumAliasedLineWidth=minWidth;ContextLimits._maximumAliasedLineWidth=maxWidth;});
  const frames=[];const primitives=[];
  const groundPrimitives={add(value){primitives.push(value);return value;},remove(value){const index=primitives.indexOf(value);if(index>=0)primitives.splice(index,1);return index>=0;}};
  const viewer={dataSources:new Cesium.DataSourceCollection(),isDestroyed:()=>false,
    scene:{groundPrimitives,requestRender(){}},container:{style:{}}};
  const legend=new Map(["low","medium","high","severe"].map(key=>[`wz-gnss-count-${key}`,{textContent:""}]));
  const context=vm.createContext({Cesium,setDataSourceActive,createOperationalGnssReveal,requestAnimationFrame:(fn)=>frames.push(fn),
    window:{},document:{getElementById:(id)=>legend.get(id)||null,querySelector:()=>null}});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/export /g,''),context);
  vm.runInContext('bindPicking=()=>{};closeActiveGnssPanel=()=>{};clearHighlight=()=>{};hideTooltip=()=>{};setLegendVisible=()=>{};',context);
  const polygon=[{lat:26,lon:50},{lat:26.1,lon:50.1},{lat:26.2,lon:50.1},
    {lat:26.3,lon:50},{lat:26.2,lon:49.9},{lat:26.1,lon:49.9}];
  const cells=[{id:'a',cellId:'a',lat:26.15,lon:50,severity:'high',polygon},
    {id:'b',cellId:'b',lat:26.15,lon:50,severity:'severe',polygon}];
  context.renderGnssInterferenceLayer(viewer,cells,{visible:true,sourceMode:'gpsinterference'});
  assert.equal(primitives.length,0);
  frames.shift()();
  assert.equal(primitives.length,2);
  assert.ok(primitives[0] instanceof Cesium.GroundPrimitive);
  assert.ok(primitives[1] instanceof Cesium.GroundPolylinePrimitive);
  assert.equal(primitives[1].geometryInstances.length,2);
  assert.equal(context.getGnssDiagnostics().activeCellEntities,2);
  assert.equal(viewer.dataSources.length,0);
  const instance=primitives[0].geometryInstances;
  assert.equal(instance.length,2);
  assert.equal(instance[0].id.__gnssCell.id,'a');
  vm.runInContext('__gnssState.showHexagons=false',context);
  context.renderGnssInterferenceLayer(viewer,cells,{visible:true,sourceMode:'gpsinterference'});
  assert.equal(primitives.length,2);
  assert.equal(primitives[0].show,false);
  assert.equal(context.getGnssDiagnostics().activeCellEntities,0);
  assert.equal(context.getGnssDiagnostics().cachedCellRecords,2);
  vm.runInContext('__gnssState.showHexagons=true',context);
  context.renderGnssInterferenceLayer(viewer,cells,{visible:true,sourceMode:'gpsinterference'});
  assert.equal(primitives.length,2);
  assert.equal(primitives[0].geometryInstances,instance);
  assert.equal(primitives[0].show,true);
  context.clearGnssInterferenceLayer(viewer);
  assert.equal(primitives.length,0);
  assert.equal(context.getGnssDiagnostics().activeCellEntities,0);
  context.renderGnssInterferenceLayer(viewer,cells,{visible:true,sourceMode:'gpsinterference'});
  context.clearGnssInterferenceLayer(viewer);
  while(frames.length)frames.shift()();
  assert.equal(primitives.length,0);
  for(const [period,periodCells,expected] of [["24h",[],0],["48h",[],0],["72h",cells,2],["24h",[],0]]){
    context.renderGnssInterferenceLayer(viewer,periodCells,{visible:true,sourceMode:"gpsinterference",
      observationPeriod:period,severityCounts:{low:0,medium:0,high:expected?1:0,severe:expected?1:0}});
    while(frames.length)frames.shift()();
    assert.equal(context.getGnssDiagnostics().activeCellEntities,expected,period);
    assert.equal(Number(legend.get("wz-gnss-count-high").textContent),expected?1:0,period);
    assert.equal(Number(legend.get("wz-gnss-count-severe").textContent),expected?1:0,period);
  }
});
