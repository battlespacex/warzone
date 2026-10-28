import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
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
