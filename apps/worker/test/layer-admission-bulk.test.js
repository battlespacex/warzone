import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../../../dev/assets/js/warzone-layers.js",import.meta.url),'utf8');
test("bulk, section and delayed dependency restoration never publish incompatible enabled layers",()=>{
  const context=vm.createContext({isStratOpsFeatureEnabled:()=>true,getStratOpsLayerFeaturePath:()=>'',
    window:{__stratopsAuthState:{isAuthenticated:true}},document:{body:{classList:{contains:()=>false}},querySelector:()=>null,getElementById:()=>null},
    localStorage:{setItem(){},getItem:()=>null}});
  vm.runInContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/m,'').replace(/import\.meta\.env\?\.DEV/g,'false')
    .replace(/export \{[^}]+\};/g,'').replace(/\bexport /g,''),context);
  const panel={querySelectorAll:()=>[],querySelector:()=>null};context.panel=panel;context.conflicts=[];
  vm.runInContext(`resetLayerStateForFreshLoad();setLayer('aircraft',true);setLayer('naval',true);
    onLayerChange((_id,_enabled,state)=>{if(state.aircraft||state.naval){for(const id of ['gnss','cyber','strikes','hotspots'])if(state[id])conflicts.push(id);}});
    setSectionLayers('infrastructure-disruptions',true,panel);
    setAllLayers(true,panel);
    activateDerivedLayerWithDependencies('hotspots',[{id:'strikes'}],panel);`,context);
  for(const id of ['gnss','cyber','strikes','hotspots'])assert.equal(context.isLayerEnabled(id),false);
  assert.equal(context.isLayerEnabled('aircraft'),true);assert.equal(context.isLayerEnabled('naval'),true);
  assert.equal(context.conflicts.length,0);
});
