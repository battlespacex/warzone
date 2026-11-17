import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {selectNavalActivities} from '../../shared/naval-intelligence.js';
const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-naval-intel.js',import.meta.url),'utf8');
function harness(){
 let enabled=false,requests=0,adds=0;const layers=new Set(),regions=new Set(),documents=new Map(),nodes=[],dataSources=new Set(['aircraft','satellites']),clusterCallbacks=new Set();
 class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};}append(el){this.children.push(el);}setAttribute(){}remove(){nodes.splice(nodes.indexOf(this),1);}get firstElementChild(){return this.children[0];}replaceChildren(){this.children=[];}querySelector(cls){return this.children.find(c=>c.className===cls.slice(1))||this.children.map(c=>c.querySelector(cls)).find(Boolean);}}
 class DataSource{constructor(){this.entities={add:()=>({})};this.clustering={clusterEvent:{addEventListener:fn=>{clusterCallbacks.add(fn);return ()=>clusterCallbacks.delete(fn);}}};}}class Handler{setInputAction(){}destroy(){}}
 const viewer={scene:{requestRender(){},canvas:{}},dataSources:{add(s){adds++;dataSources.add(s);},remove(s){dataSources.delete(s);}}};
 const row={id:'f'.repeat(64),source_id:'API-001',vessel_name:'USS Fixture',title:'Public report fixture',event_type:'PORT_VISIT',published_at:new Date().toISOString(),valid_until:new Date(Date.now()+86400000).toISOString(),geometry:{type:'Point',coordinates:[50,25]},geometry_role:'PUBLIC_PORT_REFERENCE',evidence:[],live:false};
 const c=vm.createContext({selectNavalActivities,api:{},Cesium:{CustomDataSource:DataSource,ScreenSpaceEventHandler:Handler,ScreenSpaceEventType:{LEFT_CLICK:1},Cartesian3:{fromDegrees:()=>({})},Color:{ORANGE:{},BLACK:{}},Ellipsoid:{WGS84:{}},Math:{toDegrees:value=>value*180/Math.PI}},isLayerEnabled:()=>enabled,onLayerChange:fn=>(layers.add(fn),()=>layers.delete(fn)),onRegionChange:fn=>(regions.add(fn),()=>regions.delete(fn)),getActiveRegion:()=>({bounds:{minLon:0,maxLon:100,minLat:0,maxLat:50}}),isRegionTransitionInFlight:()=>false,document:{createElement:tag=>new Element(tag),body:{append:el=>nodes.push(el)},addEventListener:(name,fn)=>documents.set(name,fn),removeEventListener:name=>documents.delete(name)},AbortController,setTimeout,clearTimeout});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),c);
 const request=async()=>{requests++;return {events:[row],sources:[]};};
 return {c,viewer,request,nodes,dataSources,layers,regions,documents,clusterCallbacks,get requests(){return requests;},get adds(){return adds;},toggle(value,id='naval'){enabled=value;for(const fn of layers)fn(id);}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('naval owns only its resources; repeated OFF/ON reuses cache, preserves AIS/Air/satellites, and disposes listeners',async()=>{
 const h=harness();const owner=h.c.initNavalIntelligence(h.viewer,{request:h.request});assert.equal(h.requests,0);assert.equal(h.c.initNavalIntelligence(h.viewer),owner);
 for(let i=0;i<20;i++){h.toggle(true);await flush();assert.equal(h.nodes.length,1);assert.equal(h.dataSources.size,3);const adds=h.adds;h.toggle(true,'*');await flush();assert.equal(h.adds,adds);h.toggle(false);assert.equal(h.nodes.length,0);assert.deepEqual([...h.dataSources],['aircraft','satellites']);}
 assert.equal(h.requests,1);owner.dispose();assert.equal(h.layers.size,0);assert.equal(h.regions.size,0);assert.equal(h.documents.size,0);
});
test('late requests after OFF never remount a panel or add geometry',async()=>{
 const h=harness();let complete;h.c.initNavalIntelligence(h.viewer,{request:()=>new Promise(resolve=>complete=resolve)});h.toggle(true);h.toggle(false);complete({events:[],sources:[]});await flush();assert.equal(h.nodes.length,0);assert.equal(h.dataSources.size,2);h.c.disposeNavalIntelligence();
});
test('settled viewport filtering and native report clustering release their owned callbacks on OFF',async()=>{
 const h=harness(),callbacks=new Set();let include=false;
 h.viewer.camera={moveEnd:{addEventListener:fn=>{callbacks.add(fn);return ()=>callbacks.delete(fn);}},computeViewRectangle:()=>({west:0,east:(include?90:10)*Math.PI/180,south:0,north:(include?50:10)*Math.PI/180})};
 h.c.initNavalIntelligence(h.viewer,{request:h.request});h.toggle(true);await flush();assert.equal(h.dataSources.size,2);assert.equal(callbacks.size,1);
 include=true;for(const fn of callbacks)fn();assert.equal(h.dataSources.size,3);assert.equal(h.clusterCallbacks.size,1);
 const cluster={billboard:{},point:{},label:{}};for(const fn of h.clusterCallbacks)fn([1,2,3],cluster);assert.equal(cluster.label.text,'3 reports');assert.equal(cluster.billboard.show,false);
 const adds=h.adds;for(const fn of callbacks)fn();assert.equal(h.adds,adds);assert.equal(h.requests,1);
 h.toggle(false);assert.equal(callbacks.size,0);assert.equal(h.clusterCallbacks.size,0);assert.deepEqual([...h.dataSources],['aircraft','satellites']);h.c.disposeNavalIntelligence();
});
