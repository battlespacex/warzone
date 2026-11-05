import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
import ContextLimits from "../../../node_modules/@cesium/engine/Source/Renderer/ContextLimits.js";
import { setDataSourceActive } from "../../../dev/assets/js/warzone-data-source-lifecycle.js";
const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-gnss.js", import.meta.url), "utf8");
test("GNSS real Cesium entities attach once across ON/OFF, updates and region replacement", async () => {
  const viewer={dataSources:new Cesium.DataSourceCollection(),isDestroyed:()=>false,scene:{requestRender(){}},container:{style:{}}};
  const context=vm.createContext({Cesium,setDataSourceActive,window:{},document:{getElementById:()=>null,querySelector:()=>null}});
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


test("GNSS provider hexagons use cancellable batched ground primitives and preserve pick records", (t) => {
  const minWidth=ContextLimits._minimumAliasedLineWidth, maxWidth=ContextLimits._maximumAliasedLineWidth;
  ContextLimits._minimumAliasedLineWidth=1; ContextLimits._maximumAliasedLineWidth=1;
  t.after(()=>{ContextLimits._minimumAliasedLineWidth=minWidth;ContextLimits._maximumAliasedLineWidth=maxWidth;});
  const frames=[];const primitives=[];
  const groundPrimitives={add(value){primitives.push(value);return value;},remove(value){const index=primitives.indexOf(value);if(index>=0)primitives.splice(index,1);return index>=0;}};
  const viewer={dataSources:new Cesium.DataSourceCollection(),isDestroyed:()=>false,
    scene:{groundPrimitives,requestRender(){}},container:{style:{}}};
  const legend=new Map(["low","medium","high","severe"].map(key=>[`wz-gnss-count-${key}`,{textContent:""}]));
  const context=vm.createContext({Cesium,setDataSourceActive,requestAnimationFrame:(fn)=>frames.push(fn),
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
  assert.equal(primitives.length,0);
  assert.equal(context.getGnssDiagnostics().activeCellEntities,0);
  vm.runInContext('__gnssState.showHexagons=true',context);
  context.renderGnssInterferenceLayer(viewer,cells,{visible:true,sourceMode:'gpsinterference'});
  frames.shift()();
  assert.equal(primitives.length,2);
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
