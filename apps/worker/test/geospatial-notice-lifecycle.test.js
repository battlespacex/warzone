import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CustomDataSource,Color,StripeMaterialProperty,Cartesian3} from 'cesium';
import {NOTICE_LAYERS,matchesNoticeLayers,correlateObservation} from '../../shared/geospatial-notices.js';
import {createSkySpyAircraftProvider} from '../src/tracking/aircraft/providers/skyspy.js';
import {createAircraftProviders} from '../src/tracking/aircraft/registry.js';
import {createPlaneAlertMilitaryDatabase} from '../src/tracking/aircraft/providers/plane-alert-db.js';
import {mergeAircraftObservations} from '../src/tracking/merge.js';

const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-notices.js',import.meta.url),'utf8');
function harness(fetchImpl){
    const enabled=new Set(),layerListeners=new Set(),regionListeners=new Set(),timers=new Map(),frames=new Map(),sources=[],panels=[],handlers=[];let seq=0,flights=0;
    const focus={assetId:''};
    class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.selectors=new Map();}setAttribute(){}append(...children){this.children.push(...children);}remove(){const index=panels.indexOf(this);if(index>=0)panels.splice(index,1);}querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Element(selector));return this.selectors.get(selector);}}
    class Handler{constructor(){handlers.push(this);}setInputAction(fn){this.click=fn;}destroy(){const index=handlers.indexOf(this);if(index>=0)handlers.splice(index,1);}}
    const viewer={dataSources:{async add(s){sources.push(s);return s;},remove(s){const index=sources.indexOf(s);if(index>=0)sources.splice(index,1);}},scene:{canvas:{},requestRender(){},pick:()=>({id:sources[0]?.entities.values[0]})},flyTo(){flights++;}};
    const context=vm.createContext({Cesium:{CustomDataSource,Color,StripeMaterialProperty,Cartesian3,ScreenSpaceEventHandler:Handler,ScreenSpaceEventType:{LEFT_CLICK:0}},
        NOTICE_LAYERS,matchesNoticeLayers,correlateObservation,getAllLiveTrackSnapshots:()=>[],getAllNavalSnapshots:()=>[],
        onLayerChange(fn){layerListeners.add(fn);return ()=>layerListeners.delete(fn);},onRegionChange(fn){regionListeners.add(fn);return ()=>regionListeners.delete(fn);},
        isLayerEnabled:id=>enabled.has(id),getActiveRegion:()=>({bounds:{minLat:20,maxLat:30,minLon:60,maxLon:70}}),getAssetFocusController:()=>({getState:()=>focus}),
        window:{__stratopsConfig:{apiBase:'https://staging.example.org'}},document:{createElement:tag=>new Element(tag),body:{append:el=>panels.push(el)}},navigator:{clipboard:{writeText(){}}},
        setInterval(fn){timers.set(++seq,fn);return seq;},clearInterval:id=>timers.delete(id),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id),
        URLSearchParams,AbortController,fetch:fetchImpl});
    vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
    return {context,enabled,viewer,sources,panels,handlers,timers,frames,focus,layerListeners,regionListeners,get flights(){return flights;},sync(){for(const fn of layerListeners)fn('*');},async settle(){await new Promise(resolve=>setImmediate(resolve));while(frames.size){const current=[...frames];frames.clear();for(const [,fn]of current)fn();}}};
}
const n={id:'test:1',sourceId:'001/26',title:'Fixture only',sourceUrl:'https://example.org/notices',noticeType:'notam',isMilitaryRelated:true,status:'active',rawText:'Test fixture',metadata:{},geometry:{type:'Polygon',coordinates:[[[65,24],[66,24],[66,25],[65,24]]]}};
test('notice owner reuses viewer, bounds requests, prevents duplicate init and cleans 25 toggles',async()=>{
    let calls=0;const h=harness(async url=>{calls++;assert.match(url,/minLat=20/);return {ok:true,json:async()=>({notices:[n],total:1})};});
    const unrelated={name:'existing tracker data'};h.sources.push(unrelated);h.context.initNoticeLayers(h.viewer);h.context.initNoticeLayers(h.viewer);
    assert.equal(calls,0);assert.equal(h.layerListeners.size,1);
    for(let i=0;i<25;i++){h.enabled.add('aviation-notam');h.sync();await h.settle();assert.equal(h.sources.length,2);assert.equal(h.handlers.length,1);assert.equal(h.timers.size,1);assert.equal(h.panels.length,1);
        h.enabled.clear();h.sync();await h.settle();assert.deepEqual(h.sources,[unrelated]);assert.equal(h.handlers.length,0);assert.equal(h.timers.size,0);assert.equal(h.panels.length,0);assert.equal(h.frames.size,0);}
    h.context.disposeNoticeLayers();assert.equal(h.layerListeners.size,0);assert.equal(h.regionListeners.size,0);assert.equal(h.flights,0);
});
test('stale fetch completion after disable cannot restore resources',async()=>{
    let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));h.context.initNoticeLayers(h.viewer);h.enabled.add('aviation-notam');h.sync();h.enabled.clear();h.sync();
    finish({ok:true,json:async()=>({notices:[n]})});await h.settle();assert.equal(h.sources.length,0);assert.equal(h.handlers.length,0);assert.equal(h.panels.length,0);h.context.disposeNoticeLayers();
});
test('notice focus preserves existing shared aircraft/naval focus and never changes models',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    h.handlers[0].click({position:{}});const button=h.panels[0].children.find(el=>el.textContent==='Focus area');assert.ok(button);
    h.focus.assetId='existing-aircraft';button.onclick();assert.equal(h.flights,0);h.focus.assetId='existing-vessel';button.onclick();assert.equal(h.flights,0);
    h.focus.assetId='';button.onclick();assert.equal(h.flights,1);h.context.disposeNoticeLayers();
});
test('notice changes reuse unchanged entities, update geometry and prune removed IDs',async()=>{
    let rows=[n];const h=harness(async()=>({ok:true,json:async()=>({notices:rows})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();const entity=h.sources[0].entities.values[0];
    h.sync();await h.settle();assert.equal(h.sources[0].entities.values[0],entity);
    rows=[{...n,geometry:{type:'Point',coordinates:[66,24]}}];h.sync();await h.settle();assert.notEqual(h.sources[0].entities.values[0],entity);
    rows=[];h.sync();await h.settle();assert.equal(h.sources[0].entities.values.length,0);h.context.disposeNoticeLayers();
});
test('disabling one notice category unloads it before a slow refresh while other notices remain',async()=>{
    let slow=false,finish;const h=harness(()=>slow?new Promise(resolve=>{finish=resolve;}):Promise.resolve({ok:true,json:async()=>({notices:[n,{...n,id:'naval:1',noticeType:'navarea'}]})}));
    h.enabled.add('aviation-notam');h.enabled.add('naval-warnings');h.context.initNoticeLayers(h.viewer);await h.settle();assert.equal(h.sources[0].entities.values.length,2);
    slow=true;h.enabled.delete('aviation-notam');h.sync();assert.equal(h.sources[0].entities.values.length,1);assert.equal(h.sources[0].entities.values[0].id,'naval:1');
    h.context.disposeNoticeLayers();finish({ok:true,json:async()=>({notices:[]})});await h.settle();assert.equal(h.sources.length,0);
});
test('notice toggles coexist with operational trackers, GNSS, orbital assets and basemap rules',()=>{
    const text=fs.readFileSync(new URL('../../../dev/assets/js/warzone-layers.js',import.meta.url),'utf8');
    const c=vm.createContext({isStratOpsFeatureEnabled:()=>true,getStratOpsLayerFeaturePath:()=>'',window:{__stratopsAuthState:{isAuthenticated:true}},document:{body:{classList:{contains:()=>false}},querySelector:()=>null,getElementById:()=>null},localStorage:{setItem(){},getItem:()=>null}});
    vm.runInContext(text.replace(/^import[\s\S]*?from "[^"]+";\r?\n/m,'').replace(/import\.meta\.env\?\.DEV/g,'false').replace(/export \{[^}]+\};/g,'').replace(/\bexport /g,''),c);
    for(const id of NOTICE_LAYERS)c.setLayer(id,true);
    for(let i=0;i<15;i++){for(const id of ['aircraft','naval','gnss','orbital-assets'])c.setLayer(id,true);
        for(const id of NOTICE_LAYERS)assert.equal(c.isLayerEnabled(id),true);
        c.setLayer('naval-warnings',false);assert.equal(c.isLayerEnabled('naval'),true);c.setLayer('naval-warnings',true);
        c.setLayer('aviation-notam',false);assert.equal(c.isLayerEnabled('aircraft'),true);c.setLayer('aviation-notam',true);}
    for(const id of ['orbital-assets','aircraft','naval']){c.setLayer(id,false);for(const notice of NOTICE_LAYERS)assert.equal(c.isLayerEnabled(notice),true,`Leaving ${id} preserves ${notice}`);}
});
const env={SKYSPY_ENABLED:'true',SKYSPY_AIRCRAFT_ENABLED:'true',SKYSPY_USAGE_APPROVED:'true',SKYSPY_BASE_URL:'https://feed.example.org',SKYSPY_ALLOWED_HOSTS:'feed.example.org'};
const at=Date.parse('2026-11-15T12:00:00Z');
test('SkySpy aircraft timestamps, units and strict ICAO24 pass existing identity fusion without military promotion',async()=>{
    const p=createSkySpyAircraftProvider({env,now:()=>at,fetchImpl:async()=>new Response(JSON.stringify({now:at/1000,aircraft:[{hex:'AE1234',flight:'TEST1',type:'C17',alt:12000,gs:320,lat:24,lon:65,military:true},{hex:'bad',lat:24,lon:65}]}))});
    const {observations}=await p.fetchObservations();assert.equal(observations.length,1);const row=observations[0];assert.equal(row.altitude_ft,12000);assert.equal(row.aircraft_type,'C17');assert.equal(row.military_hint,false);assert.equal(row.metadata.provider_military_claim,true);assert.equal(row.observed_at,new Date(at).toISOString());
    const merged=mergeAircraftObservations([row,{...row,source:'adsb_lol'}],{now:at});assert.equal(merged.length,1);p.dispose();
    const database=createPlaneAlertMilitaryDatabase({initialCsv:'$ICAO,$Registration,$Operator,$Type,$ICAO Type,#CMPG\nAE1234,82-1234,United States Air Force,Boeing C-17,C17,Mil'});
    const enriched=await database.enrichObservations([row]);assert.equal(enriched.observations[0].metadata.aircraft_identity.confidence,'strongly_supported_military');
});
test('SkySpy disabled defaults and 403 source isolation preserve other configured providers',async()=>{
    let calls=0;const disabled=createSkySpyAircraftProvider({fetchImpl:()=>{calls++;throw Error('no fetch');}});assert.equal(disabled.enabled,false);await disabled.fetchObservations();assert.equal(calls,0);
    const p=createSkySpyAircraftProvider({env,now:()=>at,fetchImpl:async()=>{calls++;return new Response('',{status:403});}});
    await assert.rejects(p.fetchObservations(),error=>error.status===403);await assert.rejects(p.fetchObservations());assert.equal(calls,1);
    const providers=createAircraftProviders({});assert.ok(providers.some(p=>p.id==='adsb_lol'));assert.ok(providers.some(p=>p.id==='airplanes_live'));assert.equal(providers.find(p=>p.id==='skyspy').enabled,false);p.dispose();
});
test('SkySpy rejects absent/stale source timestamps instead of fabricating fresh observations',async()=>{
    for(const now of [undefined,(at-600000)/1000]){const p=createSkySpyAircraftProvider({env,now:()=>at,fetchImpl:async()=>new Response(JSON.stringify({now,aircraft:[{hex:'AE1234',lat:24,lon:65}]}))});assert.equal((await p.fetchObservations()).observations.length,0);p.dispose();}
});
