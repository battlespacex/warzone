import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as Cesium from 'cesium';
const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-gnss.js',import.meta.url),'utf8');
function harness(text=source,raster=false){
    const actions=new Map(),frames=new Map(),positions=[];let seq=0,picks=0,lookups=0,panels=0,cancelled=0;
    const state={visible:true,handler:null,hoverFrame:0,hoverPosition:null,pickGeneration:0,clickPending:false,hoverEntity:null,cellsById:new Map()};
    const entity={id:'fixture',__gnssCell:{id:'fixture'}};
    if(raster)state.raster={async pick(){lookups++;return {id:'fixture',lat:24,lon:65};},cancelPick(){cancelled++;}};
    class Handler{setInputAction(fn,key){actions.set(key,fn);}destroy(){actions.clear();}}
    const viewer={scene:{canvas:{},pick(pos){picks++;positions.push({...pos});return raster?null:{id:entity};},requestRender(){}},container:{style:{}}};
    const c=vm.createContext({Cesium:{...Cesium,ScreenSpaceEventHandler:Handler},__gnssState:state,hideTooltip(){},clearHighlight(){state.hoverEntity=null;},applyEntityVisualState(){},showGnssPanel(){panels++;},closeActiveGnssPanel(){},
      requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame(id){frames.delete(id);}});
    for(const name of ['cancelGnssHover','findPickedGnssEntity','bindPicking']){const fn=text.match(new RegExp('function '+name+'\\([^]*?\\n}'))?.[0];if(fn)vm.runInContext(fn,c);}
    c.bindPicking(viewer);
    return {state,c,actions,frames,positions,viewer,get picks(){return picks;},get lookups(){return lookups;},get panels(){return panels;},get cancelled(){return cancelled;},
      move(x){actions.get(Cesium.ScreenSpaceEventType.MOUSE_MOVE)({endPosition:{x,y:1}});},event(type){return actions.get(Cesium.ScreenSpaceEventType[type])?.({position:{x:2,y:3}});},
      async frame(){const copy=[...frames.values()];frames.clear();for(const fn of copy)await fn();await new Promise(r=>setImmediate(r));}};
}
test('GNSS vector and raster hover coalesce 2,000 movements to 20 picks at the newest position',async()=>{
    for(const raster of [false,true]){const h=harness(source,raster);for(let frame=0;frame<20;frame++){for(let i=0;i<100;i++)h.move(i);assert.equal(h.frames.size,1);await h.frame();}
      assert.equal(h.picks,20);assert.ok(h.positions.every(p=>p.x===99));assert.equal(h.lookups,raster?20:0);}
});
test('GNSS drag/pinch suppress hover picking; clicks stay immediate and cancel queued hover',async()=>{
    for(const raster of [false,true]){const h=harness(source,raster);h.move(1);h.event('LEFT_DOWN');assert.equal(h.frames.size,0);for(let i=0;i<100;i++)h.move(i);await h.frame();assert.equal(h.picks,0);
      h.event('LEFT_UP');h.move(3);assert.equal(h.frames.size,1);await h.event('LEFT_CLICK');assert.equal(h.frames.size,0);assert.equal(h.picks,1);assert.equal(h.panels,1);
      h.event('PINCH_START');h.move(4);await h.frame();assert.equal(h.picks,1);h.event('PINCH_END');h.move(5);await h.frame();assert.equal(h.picks,2);}
});
test('GNSS queued hover is cancelled on cleanup and does no work after hide',async()=>{
    const h=harness();h.move(1);h.c.cancelGnssHover();assert.equal(h.frames.size,0);await h.frame();assert.equal(h.picks,0);
    h.move(2);h.state.visible=false;await h.frame();assert.equal(h.picks,0);assert.equal(h.state.hoverPosition,null);
});

test('GNSS second pointer-down does not strand an in-flight click lookup',async()=>{
    const h=harness(source,true);let finish;h.state.raster.pick=()=>new Promise(resolve=>finish=resolve);
    const click=h.event('LEFT_CLICK');assert.equal(h.state.clickPending,true);h.event('LEFT_DOWN');
    finish({id:'fixture',lat:24,lon:65});await click;assert.equal(h.state.clickPending,false);assert.equal(h.panels,1);h.event('LEFT_UP');
});
