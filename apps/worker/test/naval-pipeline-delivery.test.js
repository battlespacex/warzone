import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { runAisWorker } from '../src/ais-worker.js';
import { resetProviderHealth } from '../src/tracking/provider-health.js';
import { toPublicMapEvent } from '../../api/src/public-event-normalizer.js';
import { getNavalContactStatus, matchesNavalContactStatus } from '../../shared/naval-contact-lifecycle.js';
import { navalProviderDiagnostics, canReadNavalDiagnostics } from '../src/naval-diagnostics.js';

const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-layers.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
function router(){
 const state={naval:true,strikes:false,aircraft:true};
 const ctx=vm.createContext({getEffectiveLayerState:id=>state[id]===true,getLayerDef:id=>({id})});
 for(const node of ast.body){
  if(node.type==='VariableDeclaration'&&node.declarations.some(d=>['NAVAL_LAYER_SUBTYPES','AIRCRAFT_LAYER_SUBTYPES'].includes(d.id.name)))vm.runInContext(source.slice(node.start,node.end),ctx);
  const fn=node.type==='ExportNamedDeclaration'?node.declaration:node;
  if(fn?.type==='FunctionDeclaration'&&['getEventMetadata','isAircraftTelemetryLayerEvent','getEventLayerId','isEventVisible'].includes(fn.id.name))vm.runInContext(source.slice(fn.start,fn.end),ctx);
 }
 return ctx;
}

test('actual worker candidate survives public map projection and Naval isolation without becoming verified',async()=>{
 resetProviderHealth();let persisted=[];
 const seen=new Date().toISOString();
 const result=await runAisWorker({providers:[{id:'pipeline-fixture',enabled:true,priority:0,fetchObservations:async()=>[{provider:'pipeline-fixture',source:'pipeline-fixture',mmsi:'999000001',vessel_name:'TEST VESSEL',ship_type:35,ship_type_code:35,latitude:32,longitude:-75,observed_at:seen}]}],
  persistence:{upsertEvents:async rows=>persisted=rows,upsertTracks:async rows=>rows.length,upsertHistory:async()=>{},endAliases:async()=>{}},logger:{log(){},warn(){},error(){}}});
 assert.equal(result.upserted,1);assert.equal(persisted.length,1);
 const event=toPublicMapEvent(persisted[0]);
 assert.equal(event.category,'unverified');assert.equal(event.metadata.verification_status,'unverified');
 assert.equal(event.dedupe_key,persisted[0].dedupe_key);assert.equal(event.metadata.observed_at,seen);
 const ui=router();assert.equal(ui.getEventLayerId(event),'naval');assert.equal(ui.isEventVisible(event),true);
 assert.equal(matchesNavalContactStatus(getNavalContactStatus(event.occurred_at),'recent'),true);
 // Camera/focus do not participate in routing or lifecycle. A map news event
 // and explicit aircraft contact still use their own layer, not Naval.
 assert.equal(ui.getEventLayerId({category:'strike',metadata:{}}),'strikes');
 assert.notEqual(ui.getEventLayerId({...event,track_type:'aircraft',category:'military',subcategory:'fighter'}),'naval');
});

test('map bootstrap preserves identity/pose and stable keys while excluding unrelated raw payloads',()=>{
 const event=toPublicMapEvent({id:'fixture',dedupe_key:'ais-mmsi:999000001',source_key:'ais-mmsi:999000001',category:'unverified',report_type:'signal',occurred_at:new Date().toISOString(),lat:32,lon:-75,
 metadata:{mmsi:'999000001',ship_type:35,observed_at:'2026-11-13T10:00:00Z',speed_kts:0,heading:90,qualification_reason:'military_ship_type',raw_private_payload:'must-not-pass'}});
 assert.equal(event.metadata.speed_kts,0);assert.equal(event.metadata.heading,90);
 assert.equal(event.metadata.qualification_reason,'military_ship_type');assert.equal('raw_private_payload' in event.metadata,false);
});

test('diagnostics cannot label enabled providers disabled or return raw errors',()=>{
 const [p]=navalProviderDiagnostics([{id:'fixture',enabled:true,disabledReason:'DISABLED_BY_CONFIG',getDiagnostics:()=>({valid_positions:4,last_error:'private credential detail',raw_payload:'private'})}]);
 assert.equal(p.disabled_reason,null);assert.equal(p.valid_positions,4);assert.equal(p.has_error,true);assert.equal('last_error' in p,false);assert.equal('raw_payload' in p,false);
 assert.equal(canReadNavalDiagnostics({NODE_ENV:'production',STRATOPS_DEV_DIAGNOSTICS:'true'},'127.0.0.1'),false);
});

test('empty/partial refresh and focus state do not clear retained naval observations',()=>{
 const source=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='syncNavalSignals');
 const retained=new Map(),ui=router();
 const ctx=vm.createContext({window:{},__lastNavalSignalsSyncKey:'',isNavalTrackingFeatureEnabled:()=>true,isLayerEnabled:()=>true,
  setNavalLayerVisible:show=>assert.equal(show,true),isNavalSignalEvent:()=>true,isEventVisible:event=>ui.isEventVisible(event),getNavalTrackKey:e=>e.dedupe_key,
  getAllNavalSnapshots:()=>[...retained.values()],markTrackerPerf(){},requestNavalWidgetRender(){},upsertNavalVessel:e=>retained.set(e.dedupe_key,{...e,track_key:e.dedupe_key})});
 vm.runInContext(source.slice(node.start,node.end),ctx);
 const events=[1,2].map(n=>({dedupe_key:`ais-${n}`,category:'unverified',report_type:'signal',lat:32,lon:-75,occurred_at:'2026-11-13T10:00:00Z',metadata:{mmsi:`99900000${n}`,ship_type:35}}));
 ctx.syncNavalSignals(events);assert.equal(retained.size,2);
 ctx.selectedNavalKey='ais-1';ctx.syncNavalSignals([]);ctx.syncNavalSignals([events[0]]);ctx.syncNavalSignals(events);
 assert.equal(retained.size,2);assert.equal(ctx.selectedNavalKey,'ais-1');
 assert.equal(retained.get('ais-1').occurred_at,events[0].occurred_at);
});
