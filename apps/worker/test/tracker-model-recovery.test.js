import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';
import * as Cesium from 'cesium';
const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-live-airforce.js',import.meta.url),'utf8');
function install(context,name){const start=source.indexOf(`function ${name}(`),node=parseExpressionAt(source,start,{ecmaVersion:'latest'});vm.runInContext(source.slice(start,node.end),context);}
test('a transient CDN failure cannot erase the assigned aircraft GLB identity and OFF clears load state',()=>{
  const failed=new Set(['/assets/images/models/air/Fighter-F16.glb']),resources=new Map([['assigned',{url:'assigned.glb'}]]);
  const context=vm.createContext({__liveAircraftFailedModelUris:failed,__liveAircraftModelResourceCache:resources,
    getLiveAircraftModelUriForCode:code=>code==='Fighter-F16'?'/assets/images/models/air/Fighter-F16.glb':'',
    __liveTrackOverlayBound:false,__liveTrackClickBound:false,__liveTrackRuntimeCleanups:[]});
  install(context,'isLiveAircraftModelCodeAvailable');install(context,'unbindLiveTrackRuntime');
  assert.equal(context.isLiveAircraftModelCodeAvailable('Fighter-F16'),true);
  assert.equal(context.isLiveAircraftModelCodeAvailable('missing'),false);
  context.unbindLiveTrackRuntime({});assert.equal(failed.size,0);assert.equal(resources.size,0);
});

test('region/category changes release unselected aircraft render resources while retaining authoritative track records',()=>{
  const registry=new Map([['outside',{active:true,track_key:'outside'}]]),entity={id:'track-outside',show:true},removed=[];
  const viewer={entities:{getById:id=>id===entity.id?entity:null}};
  const context=vm.createContext({window:{__warzoneViewer:viewer},__liveTrackRegistry:registry,__liveTrackEntities:new Map([[entity.id,entity]]),
    __liveTrackRenderReconcileCancel:null,__liveTrackRenderReconcileActive:false,isLayerEnabled:()=>true,
    isFocusSelectionActive:()=>false,getFocusedTrackKey:()=>'',shouldRenderLiveTrackDataState:()=>false,
    removeLiveTrackRenderState:key=>removed.push(key),requestWarzoneRenderBatched:()=>{},cancelAnimationFrame:()=>{}});
  install(context,'syncLiveTrackRenderPopulation');context.syncLiveTrackRenderPopulation();
  assert.deepEqual(removed,['outside']);assert.equal(registry.get('outside').active,true);
  assert.equal(registry.size,1,'render cleanup does not delete genuine tracking data');
});

test('dense Air restoration publishes bounded EntityCollection batches and stale OFF callbacks cannot restore models',t=>{
  const registry=new Map(Array.from({length:300},(_,i)=>[String(i),{active:true,track_key:String(i)}]));
  const entities=new Cesium.EntityCollection(),rendered=new Map(),frames=new Map(),events=[];
  let id=0,enabled=true;
  entities.collectionChanged.addEventListener((_collection,added)=>{if(added.length)events.push(added.length);});
  const context=vm.createContext({window:{__warzoneViewer:{entities}},performance,
    __liveTrackRegistry:registry,__liveTrackEntities:rendered,__liveTrackRenderReconcileCancel:null,__liveTrackRenderReconcileActive:false,
    isLayerEnabled:()=>enabled,isFocusSelectionActive:()=>false,getFocusedTrackKey:()=>'',shouldRenderLiveTrackDataState:()=>enabled,
    upsertLiveTrack:track=>{const entity=entities.add({id:`track-${track.track_key}`,model:{uri:'assigned.glb'}});entity.__trackKey=track.track_key;rendered.set(entity.id,entity);},
    removeLiveTrackRenderState:key=>{entities.removeById(`track-${key}`);rendered.delete(`track-${key}`);},
    purgeLiveTrackRenderEntities:()=>{},unbindLiveTrackRuntime:()=>{},requestWarzoneRenderBatched:()=>{},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key)});
  install(context,'syncLiveTrackRenderPopulation');
  const drain=()=>{let count=0;while(frames.size){const [key,fn]=frames.entries().next().value;frames.delete(key);fn();assert.ok(++count<100);}};
  for(let i=0;i<10;i++){
    enabled=true;context.syncLiveTrackRenderPopulation();drain();assert.equal(entities.values.length,300);
    enabled=false;context.syncLiveTrackRenderPopulation();assert.equal(entities.values.length,0);assert.equal(frames.size,0);
  }
  enabled=true;context.syncLiveTrackRenderPopulation();
  const [key,first]=frames.entries().next().value;frames.delete(key);first();
  assert.ok(entities.values.length<=8);const stale=frames.values().next().value;
  enabled=false;context.syncLiveTrackRenderPopulation();stale();
  assert.equal(entities.values.length,0);assert.equal(frames.size,0);assert.equal(registry.size,300);
  assert.ok(events.length>10 && events.every(size=>size<=8),'Cesium sees each bounded batch rather than one final 300-model burst');
  t.diagnostic(JSON.stringify({fixtureAircraft:300,cycles:10,maxPublishedBatch:Math.max(...events),modelsAfterOff:entities.values.length,
    note:'Real Cesium EntityCollection; no browser/GPU loading or memory claim'}));
});
