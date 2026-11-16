import * as RealCesium from 'cesium';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {CustomDataSource,Color,StripeMaterialProperty,Cartesian3,PolygonHierarchy,BoundingSphere,Matrix4} from 'cesium';
import {NOTICE_LAYERS,matchesNoticeLayers,correlateObservation,noticeGeometryParts,noticeGeometryPoints,noticeStatus,nextNoticeBoundary} from '../../shared/geospatial-notices.js';
import {createSkySpyAircraftProvider} from '../src/tracking/aircraft/providers/skyspy.js';
import {createAircraftProviders} from '../src/tracking/aircraft/registry.js';
import {createPlaneAlertMilitaryDatabase} from '../src/tracking/aircraft/providers/plane-alert-db.js';
import {mergeAircraftObservations} from '../src/tracking/merge.js';

const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-notices.js',import.meta.url),'utf8');
function harness(fetchImpl){
    const enabled=new Set(),layerListeners=new Set(),regionListeners=new Set(),timers=new Map(),frames=new Map(),events=new Map(),sources=[],panels=[],handlers=[];let seq=0,flights=0;
    const focus={assetId:''};
    class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.selectors=new Map();}setAttribute(){}getContext(){return this.context||=( {fillRect(){this.fill=this.fillStyle;},beginPath(){},moveTo(){},lineTo(){},stroke(){}} );}append(...children){this.children.push(...children);}remove(){const index=panels.indexOf(this);if(index>=0)panels.splice(index,1);}querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Element(selector));return this.selectors.get(selector);}}
    class Handler{constructor(){handlers.push(this);}setInputAction(fn){this.click=fn;}destroy(){const index=handlers.indexOf(this);if(index>=0)handlers.splice(index,1);}}
    const restores=[];
    const viewer={camera:{positionWC:new Cartesian3(7e6,1,2),directionWC:new Cartesian3(-1,0,0),upWC:new Cartesian3(0,0,1),cancelFlight(){},flyToBoundingSphere(){flights++;},flyTo(view){restores.push(view);}},dataSources:{async add(s){sources.push(s);return s;},remove(s){const index=sources.indexOf(s);if(index>=0)sources.splice(index,1);}},scene:{canvas:{},requestRender(){},pick:()=>({id:sources[0]?.entities.values[0]})},flyTo(){flights++;}};
    const context=vm.createContext({Cesium:{...RealCesium,ScreenSpaceEventHandler:Handler,ScreenSpaceEventType:{LEFT_CLICK:0}},
        NOTICE_LAYERS,matchesNoticeLayers,correlateObservation,noticeGeometryParts,noticeGeometryPoints,noticeStatus,nextNoticeBoundary,getAllLiveTrackSnapshots:()=>[],getAllNavalSnapshots:()=>[],
        onLayerChange(fn){layerListeners.add(fn);return ()=>layerListeners.delete(fn);},onRegionChange(fn){regionListeners.add(fn);return ()=>regionListeners.delete(fn);},
        isLayerEnabled:id=>enabled.has(id),getActiveRegion:()=>({bounds:{minLat:20,maxLat:30,minLon:60,maxLon:70}}),getAssetFocusController:()=>({getState:()=>focus}),
        window:{__stratopsConfig:{apiBase:'https://staging.example.org'}},document:{createElement:tag=>new Element(tag),body:{append:el=>panels.push(el)},addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);}},navigator:{clipboard:{writeText(){}}},
        setTimeout(fn,delay){fn.delay=delay;timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),requestAnimationFrame(fn){frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id),
        performance,URLSearchParams,AbortController,fetch:fetchImpl});
    vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
    return {context,enabled,viewer,sources,panels,handlers,timers,frames,events,focus,restores,layerListeners,regionListeners,get flights(){return flights;},sync(){for(const fn of layerListeners)fn('*');},tick(){const current=[...timers];timers.clear();for(const [,fn]of current)fn();},async settle(){await new Promise(resolve=>setImmediate(resolve));while(frames.size){const current=[...frames];frames.clear();for(const [,fn]of current)fn();}}};
}
function openMore(h){h.panels[0].querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-actions').children.find(el=>el.textContent==='MORE').onclick();}
const n={id:'test:1',sourceId:'001/26',title:'Fixture only',sourceUrl:'https://example.org/notices',noticeType:'notam',isMilitaryRelated:true,status:'active',rawText:'Test fixture',metadata:{},geometry:{type:'Polygon',coordinates:[[[65,24],[66,24],[66,25],[65,24]]]}};
test('restored unconfigured notices stay silent and do not refetch on region entry; explicit user opening remains available',async()=>{
    let calls=0;const h=harness(async()=>{calls++;return {ok:true,json:async()=>({state:'unconfigured',notices:[]})};});
    h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer,{showOnInit:false});await h.settle();assert.equal(calls,1);assert.equal(h.panels.length,0);assert.equal(h.sources.length,0);
    for(let i=0;i<20;i++){for(const fn of h.regionListeners)fn();h.tick();await h.settle();}assert.equal(calls,1);assert.equal(h.timers.size,0);
    for(const fn of h.layerListeners)fn('aviation-notam');await h.settle();assert.equal(calls,2);assert.equal(h.panels.length,1);assert.equal(h.panels[0].querySelector('h3').textContent,'No permitted provider configured');
    h.context.disposeNoticeLayers();assert.equal(h.panels.length,0);assert.equal(h.events.size,0);
});
test('closing a notice widget survives ordinary refreshes without stopping its valid overlays',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n],total:1})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    h.panels[0].querySelector('button').onclick();assert.equal(h.panels.length,0);h.tick();await h.settle();assert.equal(h.panels.length,0);assert.equal(h.sources[0].entities.values.length,1);h.context.disposeNoticeLayers();
});
test('region notice work waits for camera settlement and cancels deferred callbacks on disable',async()=>{
    let ready=true,calls=0;const h=harness(async()=>{calls++;return {ok:true,json:async()=>({notices:[n]})};});
    h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer,{canRefresh:()=>ready});await h.settle();assert.equal(calls,1);
    for(const fn of h.regionListeners)fn();ready=false;assert.equal(calls,1,'region callback does not fetch before flight starts');
    h.tick();await h.settle();assert.equal(calls,1);assert.equal(h.timers.size,0);
    ready=true;h.events.get('wz:region-camera-settled')();await h.settle();assert.equal(calls,2);assert.equal(h.sources.length,1);
    for(const fn of h.regionListeners)fn();h.enabled.clear();h.sync();h.tick();await h.settle();assert.equal(calls,2);
    h.context.disposeNoticeLayers();assert.equal(h.events.size,0);assert.equal(h.timers.size,0);assert.equal(h.frames.size,0);
});
test('metadata refresh preserves notice geometry, drag binding, collapsed widget and latest detail values',async()=>{
    let row=n,binds=0;const h=harness(async()=>({ok:true,json:async()=>({notices:[row],total:1})}));h.enabled.add('aviation-notam');
    h.context.initNoticeLayers(h.viewer,{bindFloatingPanel:()=>{binds++;}});await h.settle();
    const entity=h.sources[0].entities.values[0],panel=h.panels[0],before=binds;
    panel.querySelector('.wz-widget-header-actions').children[0].onclick();
    row={...n,metadata:{lastUpdated:'new timestamp'},rawText:'Updated original notice'};h.tick();await h.settle();
    assert.equal(h.sources[0].entities.values[0],entity);assert.equal(h.panels[0],panel);assert.equal(binds,before);assert.equal(panel.querySelector('.wz-widget-body').hidden,true);
    const cards=panel.querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-cards');cards.children[0].children.find(el=>el.textContent==='View notice').onclick();
    assert.ok(h.panels[0].querySelector('ul').children.some(el=>el.children.some(child=>child.textContent==='Updated original notice')));
    h.context.disposeNoticeLayers();
});
test('unconfigured and permanently denied notices stop polling; transient errors have one bounded backoff',async()=>{
    for(const status of [200,401,403,404,503]){
        const h=harness(async()=>({ok:status===200,status,json:async()=>({state:'unconfigured',notices:[]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
        assert.equal(h.sources.length,0);assert.equal(h.handlers.length,0);
        if(status===503){for(const delay of [60000,120000,240000,300000,300000]){assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,delay);h.tick();await h.settle();}}
        else assert.equal(h.timers.size,0);
        h.context.disposeNoticeLayers();assert.equal(h.timers.size,0);
    }
});
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
test('unconfigured/empty/error states contain no fabricated notice fields and use the drag binder',async()=>{
    for(const [payload,status,title]of [[{state:'unconfigured',notices:[]},200,'No permitted provider configured'],[{state:'ready',notices:[]},200,'No notices in selected area'],[{},403,'Notice access denied'],[{},503,'Provider temporarily unavailable']]){
        let binds=0,disposals=0;const h=harness(async()=>({ok:status===200,status,json:async()=>payload}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer,{bindFloatingPanel:()=>{binds++;return ()=>disposals++;}});await h.settle();
        assert.equal(h.panels[0].querySelector('h3').textContent,title);assert.equal(h.panels[0].querySelector('ul').children.length,0);assert.ok(binds>=1);
        const collapse=h.panels[0].querySelector('.wz-widget-header-actions').children[0];collapse.onclick();assert.equal(h.panels[0].querySelector('.wz-widget-body').hidden,true);collapse.onclick();assert.equal(h.panels[0].querySelector('.wz-widget-body').hidden,false);
        assert.ok(parseFloat(h.panels[0].style.left)>320,'default placement clears a left-side Map Layers panel');
        h.context.disposeNoticeLayers();assert.equal(disposals,binds);assert.equal(h.panels.length,0);
    }
});
test('notice focus preserves existing shared aircraft/naval focus and never changes models',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    h.handlers[0].click({position:{}});openMore(h);const button=h.panels[0].querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-actions').children.find(el=>el.textContent==='Focus area');assert.ok(button);
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

test('NOTAM polygons preserve source rings and CSS line width; Q-line radius defaults to a point',async()=>{
    const point={...n,id:'point:1',geometry:{type:'Point',coordinates:[65,24]},metadata:{radiusNm:300}};
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n,point]})}));
    const css=new Map([['--wz-notice-line-width','4'],['--wz-notice-fill-opacity','.12']]);
    h.context.getComputedStyle=()=>({getPropertyValue:key=>css.get(key)||''});
    h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    const polygon=h.sources[0].entities.getById(n.id),marker=h.sources[0].entities.getById(point.id);
    assert.equal(polygon.polyline.width.getValue(),4);assert.equal(polygon.polygon.hierarchy.getValue().positions.length,4);
    assert.equal(polygon.polygon.height,undefined,'published area uses the terrain-clamped Entity path');assert.equal(polygon.polyline.clampToGround.getValue(),true);
    assert.match(polygon.polygon.material.image.getValue().context.fill,/0\.12\)/);assert.ok(marker.point);assert.equal(marker.ellipse,undefined);
    css.set('--wz-notice-line-width','3');css.set('--wz-notice-marker-size','14');h.events.get('wz:notice-style-refresh')();
    assert.equal(h.sources[0].entities.getById(n.id),polygon);assert.equal(polygon.polyline.width.getValue(),3);assert.equal(marker.point.pixelSize.getValue(),14);
    h.context.disposeNoticeLayers();assert.equal(h.events.size,0);
});
test('notice popup dismisses outside or Escape but not an inside pointer; releases owned handlers',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    h.handlers[0].click({position:{x:20,y:20}});assert.match(h.panels[0].className,/wz-notice-preview/);
    const panel=h.panels[0];panel.contains=target=>target===panel;
    h.events.get('pointerdown')({type:'pointerdown',target:panel});assert.equal(h.panels.length,1);
    h.events.get('pointerdown')({type:'pointerdown',target:{}});assert.equal(h.panels.length,1);assert.notEqual(h.panels[0].className,'wz-notice-popup');
    h.handlers[0].click({position:{}});h.events.get('keydown')({type:'keydown',key:'Enter'});assert.equal(h.panels.length,1);
    h.events.get('keydown')({type:'keydown',key:'Escape'});assert.equal(h.panels.length,1);assert.notEqual(h.panels[0].className,'wz-notice-popup');
    h.context.disposeNoticeLayers();assert.equal(h.events.size,0);assert.equal(h.handlers.length,0);assert.equal(h.sources.length,0);
});

test('duplicate layer notifications share one pending request and a mid-drag response waits for release',async()=>{
    let calls=0,finish;const h=harness(()=>{calls++;return new Promise(resolve=>finish=resolve);});
    h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);for(let i=0;i<100;i++)h.sync();assert.equal(calls,1);
    h.events.get('pointerdown')({type:'pointerdown',target:h.viewer.scene.canvas});finish({ok:true,json:async()=>({notices:[n]})});await h.settle();
    assert.equal(h.sources[0].entities.values.length,0,'no geometry submitted during held drag');
    h.events.get('pointerup')({type:'pointerup'});await h.settle();assert.equal(h.sources[0].entities.values.length,1);
    h.events.get('wheel')({target:h.viewer.scene.canvas});h.sync();assert.equal(calls,1,'wheel burst defers notice refresh');
    h.enabled.clear();h.sync();h.tick();await h.settle();assert.equal(calls,1);assert.equal(h.sources.length,0);
    h.context.disposeNoticeLayers();assert.equal(h.events.size,0);assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
});

test('notice child/group toggles preserve the shared widget and reopen it after all OFF',async()=>{
    const naval={...n,id:'naval:1',noticeType:'navarea'};
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n,naval]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    h.handlers[0].click({position:{}});h.events.get('pointerdown')({type:'pointerdown',target:{}});
    h.enabled.add('naval-warnings');h.sync();await h.settle();assert.equal(h.panels.length,1);assert.equal(h.sources[0].entities.values.length,2);
    h.enabled.delete('aviation-notam');h.sync();await h.settle();assert.equal(h.panels.length,1);assert.deepEqual(h.sources[0].entities.values.map(e=>e.id),['naval:1']);
    h.enabled.clear();h.sync();assert.equal(h.panels.length,0);assert.equal(h.sources.length,0);
    h.enabled.add('aviation-notam');h.enabled.add('naval-warnings');h.sync();await h.settle();assert.equal(h.panels.length,1);assert.equal(h.sources[0].entities.values.length,2);
    h.context.disposeNoticeLayers();assert.equal(h.events.size,0);assert.equal(h.frames.size,0);
});
test('notice Focus toggles to Unfocus and restores an independent snapshot of the real previous view',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();h.handlers[0].click({position:{}});openMore(h);
    const button=h.panels[0].querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-actions').children.find(el=>el.textContent==='Focus area');
    const previous=Cartesian3.clone(h.viewer.camera.positionWC);button.onclick();assert.equal(button.textContent,'Unfocus');assert.equal(h.flights,1);
    h.viewer.camera.positionWC.x=999;button.onclick();assert.equal(button.textContent,'Focus area');assert.equal(h.restores.length,1);
    assert.deepEqual(h.restores[0].destination,previous);assert.deepEqual(h.restores[0].orientation.direction,new Cartesian3(-1,0,0));assert.deepEqual(h.restores[0].orientation.up,new Cartesian3(0,0,1));
    button.onclick();h.events.get('keydown')({type:'keydown',key:'Escape'});
    const controls=h.panels[0].querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-controls');assert.ok(controls.children.some(el=>el.textContent==='Unfocus'));
    h.enabled.clear();h.sync();assert.equal(h.restores.length,2,'turning off the focused notice restores its previous view');h.context.disposeNoticeLayers();
});
test('region changes and other tracker focus invalidate notice return views without camera theft',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    const open=()=>{h.handlers[0].click({position:{}});openMore(h);return h.panels[0].querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-actions').children.find(el=>el.textContent==='Focus area');};
    const button=open();button.onclick();h.focus.assetId='aircraft';h.events.get('wz:asset-focus-changed')();assert.equal(button.textContent,'Focus area');assert.equal(h.restores.length,0);
    h.focus.assetId='';button.onclick();for(const fn of h.regionListeners)fn();assert.equal(h.restores.length,0);h.enabled.clear();h.sync();assert.equal(h.restores.length,0);h.context.disposeNoticeLayers();
});

test('notice polygons share immutable style materials and refresh them together without recreating entities',async()=>{
    const h=harness(async()=>({ok:true,json:async()=>({notices:[n,{...n,id:'other'}]})}));
    const css=new Map();h.context.getComputedStyle=()=>({getPropertyValue:key=>css.get(key)||''});h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
    const [a,b]=h.sources[0].entities.values,old=a.polygon.material;assert.equal(a.polygon.material,b.polygon.material);
    css.set('--wz-notice-fill-opacity','.3');h.events.get('wz:notice-style-refresh')();
    assert.equal(h.sources[0].entities.getById(a.id),a);assert.equal(a.polygon.material,b.polygon.material);assert.notEqual(a.polygon.material,old);assert.match(a.polygon.material.image.getValue().context.fill,/0\.3\)/);
    h.context.disposeNoticeLayers();assert.equal(h.sources.length,0);
});

test('published circles, multipart areas, routes and real-width corridors render without inventing Q-line areas',async()=>{
 const rows=[{...n,id:'circle',geometry:{type:'Point',coordinates:[65,24]},metadata:{radiusNm:5,radiusSource:'published'}},
 {...n,id:'qline',geometry:{type:'Point',coordinates:[66,24]},metadata:{radiusNm:100,radiusSource:'q-line'}},
 {...n,id:'multi',geometry:{type:'MultiPolygon',coordinates:[n.geometry.coordinates,[[[70,24],[71,24],[71,25],[70,24]]]]}},
 {...n,id:'route',geometry:{type:'LineString',coordinates:[[65,24],[67,26]]}},
 {...n,id:'corridor',geometry:{type:'LineString',coordinates:[[65,24],[67,26]]},metadata:{corridorWidthMeters:2000}}];
 const h=harness(async()=>({ok:true,json:async()=>({notices:rows})}));h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();
 assert.equal(h.sources[0].entities.getById('circle').ellipse.semiMajorAxis.getValue(),5*1852);assert.ok(h.sources[0].entities.getById('circle').polyline.positions.getValue().length>8);
 assert.equal(h.sources[0].entities.getById('qline').ellipse,undefined);assert.ok(h.sources[0].entities.getById('multi::part:1').polygon);
 assert.equal(h.sources[0].entities.getById('route').polyline.positions.getValue().length,2);assert.equal(h.sources[0].entities.getById('corridor').corridor.width.getValue(),2000);
 const ids=h.sources[0].entities.values.map(e=>e.id);h.tick();await h.settle();assert.deepEqual(h.sources[0].entities.values.map(e=>e.id),ids);
 h.enabled.clear();h.sync();assert.equal(h.sources.length,0);h.context.disposeNoticeLayers();assert.equal(h.timers.size,0);
});
test('auto preview waits for camera settlement, reuses its DOM, opens MORE and TAKE SHOT, and cancels capture on OFF',async()=>{
 const h=harness(async()=>({ok:true,json:async()=>({notices:[n]})}));const moving=new RealCesium.Event(),settled=new RealCesium.Event();
 h.viewer.camera.moveStart=moving;h.viewer.camera.moveEnd=settled;h.viewer.camera.positionWC=Cartesian3.multiplyByScalar(Cartesian3.fromDegrees(65,24),1.1,new Cartesian3());
 Object.assign(h.viewer.scene.canvas,{clientWidth:800,clientHeight:600,getBoundingClientRect:()=>({left:0,top:0})});
 h.context.Cesium.SceneTransforms={worldToWindowCoordinates:()=>({x:400,y:300})};h.context.Cesium.EllipsoidalOccluder=class{isPointVisible(){return true;}};
 let captures=0,cancelled=0;h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer,{loadCapture:async()=>({startNoticeCapture(_viewer,notice){assert.equal(notice.id,n.id);captures++;return ()=>cancelled++;}})});await h.settle();
 const firePreview=()=>{for(const [id,fn]of [...h.timers])if(fn.delay===180){h.timers.delete(id);fn();}};
 moving.raiseEvent();firePreview();assert.notEqual(h.panels[0].className,'wz-notice-popup wz-notice-preview');settled.raiseEvent();firePreview();assert.match(h.panels[0].className,/wz-notice-preview/);
 const panel=h.panels[0];moving.raiseEvent();assert.equal(panel.style.display,'none');settled.raiseEvent();firePreview();assert.equal(h.panels[0],panel);assert.equal(panel.style.display,'');
 const actions=panel.querySelector('.wz-widget-body').children.find(el=>el.className==='wz-notice-actions');assert.ok(actions.children.some(el=>el.textContent==='MORE'));actions.children.find(el=>el.textContent==='TAKE SHOT').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(captures,1);
 h.enabled.clear();h.sync();assert.equal(cancelled,1);h.context.disposeNoticeLayers();assert.equal(moving.numberOfListeners,0);assert.equal(settled.numberOfListeners,0);assert.equal(h.timers.size,0);
});
test('local expiry removes expired geometry without fetching or resurrecting multipart notices',async()=>{
 let now=Date.now(),calls=0;const row={...n,id:'expiry',effectiveFrom:new Date(now-1000).toISOString(),effectiveUntil:new Date(now+1000).toISOString(),geometry:{type:'MultiPolygon',coordinates:[n.geometry.coordinates,n.geometry.coordinates]}};
 const h=harness(async()=>{calls++;return {ok:true,json:async()=>({notices:[row]})};});class Clock extends Date{static now(){return now;}}
 h.context.Date=Clock;h.context.noticeStatus=notice=>noticeStatus(notice,now);h.context.nextNoticeBoundary=notice=>nextNoticeBoundary(notice,now);
 h.enabled.add('aviation-notam');h.context.initNoticeLayers(h.viewer);await h.settle();assert.equal(h.sources[0].entities.values.length,2);
 now+=1002;for(const [id,fn]of [...h.timers])if(fn.delay<2000){h.timers.delete(id);fn();}
 await h.settle();assert.equal(h.sources[0].entities.values.length,0);assert.equal(calls,1);h.context.disposeNoticeLayers();
});
