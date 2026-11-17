import test from 'node:test';
import assert from 'node:assert/strict';
import {createAirplanesLiveProvider} from '../src/tracking/aircraft/providers/airplanes-live.js';
import {createPlaneAlertMilitaryDatabase} from '../src/tracking/aircraft/providers/plane-alert-db.js';
import {mergeAircraftObservations} from '../src/tracking/merge.js';
import {runAdsbWorker} from '../src/adsb-worker.js';
import {resetProviderHealth} from '../src/tracking/provider-health.js';
import {createAircraftProviders} from '../src/tracking/aircraft/registry.js';
const fixture={ac:[{hex:'AE1234',r:'82-1234',t:'C17',lat:40,lon:-70,seen_pos:2,alt_baro:25000,gs:420}],msg:'No error',now:1794740400};
const response=(data=fixture,status=200,retry='')=>({ok:status===200,status,headers:{get:()=>retry},text:async()=>'',json:async()=>structuredClone(data)});
test('all aircraft paths validate input and preserve documented readsb telemetry and source time',async()=>{
 let at=1794740400000;const urls=[];const p=createAirplanesLiveProvider({now:()=>at,minimumIntervalMs:1000,fetchImpl:async u=>{urls.push(u);return response();}});
 const methods=[()=>p.fetchObservations(),()=>p.discoverPoint({lat:40,lon:-70,radius:10}),()=>p.lookupHex('ae1234'),()=>p.lookupHex('ae1234','live'),()=>p.lookupHex('ae1234','last'),()=>p.lookupRegistration('N123AB'),()=>p.lookupCallsign('RCH123'),()=>p.lookupSquawk('7700')];
 for(const method of methods){await method();at+=1001;}
 assert.deepEqual(urls.map(u=>new URL(u).pathname),['/v2/mil','/v2/point/40/-70/10','/v2/hex/ae1234','/v2/hex/ae1234/live','/v2/hex/ae1234/last','/v2/reg/N123AB','/v2/callsign/RCH123','/v2/squawk/7700']);
 const mil=await p.fetchObservations();assert.equal(mil.observations[0].military_hint,true);assert.equal(mil.observations[0].source,'airplanes_live');
 assert.equal(mil.observations[0].observed_at,new Date((fixture.now-2)*1000).toISOString());
 await assert.rejects(p.lookupHex('1234'),/Invalid/);await assert.rejects(p.lookupSquawk('8899'),/Invalid/);
 await assert.rejects(p.discoverPoint({bounds:{minLat:12,maxLat:42,minLon:28,maxLon:65}}),/approved query plan/);
});
test('cache, pending deduplication and global endpoint budget prevent repeated downloads and preserve timestamps',async()=>{
 let at=0,calls=0,resolve,started;const ready=new Promise(r=>started=r);const p=createAirplanesLiveProvider({now:()=>at,minimumIntervalMs:1000,cacheTtlMs:5000,dailyBudget:1,fetchImpl:()=>{calls++;started();return new Promise(r=>resolve=r);}});
 const first=p.fetchObservations(),second=p.fetchObservations();await ready;resolve(response());await Promise.all([first,second]);at=2000;
 await p.fetchObservations();assert.equal(calls,1);assert.equal(p.getDiagnostics().deduplicated,1);
 await assert.rejects(p.lookupHex('ae1234'),/budget/);at=6000;await assert.rejects(p.fetchObservations(),/budget/);
});
for(const [status,delay] of [[403,86400000],[429,600000]])test(`Airplanes.live ${status} persists independently and honors Retry-After without leaking bodies`,async()=>{
 let at=1000,calls=0;const p=createAirplanesLiveProvider({now:()=>at,minimumIntervalMs:1000,fetchImpl:async()=>{calls++;return response({},status,'600');}});
 await assert.rejects(p.fetchObservations(),e=>e.status===status&&e.retryAfterMs===delay);at+=1001;
 await assert.rejects(p.lookupHex('ae1234'),/backoff/);assert.equal(calls,1);assert.equal(p.getDiagnostics().last_status_code,status);
});
test('regional contacts need independent identity evidence; registry and cross-provider merging retain one canonical track',async()=>{
 resetProviderHealth();let clock=Date.now();const p=createAirplanesLiveProvider({now:()=>clock,fetchImpl:async()=>response()});
 const rows=await p.discoverPoint({bounds:{minLat:39,maxLat:41,minLon:-71,maxLon:-69}});assert.equal(rows[0].military_hint,false);
 const db=createPlaneAlertMilitaryDatabase({initialCsv:'$ICAO,$Registration,$Operator,$Type,$ICAO Type,#CMPG\nAE1234,82-1234,United States Air Force,Boeing C-17,C17,Mil'});
 const enriched=await db.enrichObservations(rows);assert.equal(enriched.observations[0].metadata.aircraft_identity.confidence,'strongly_supported_military');
 assert.equal(mergeAircraftObservations([enriched.observations[0],{...enriched.observations[0],source:'adsb_lol'}]).length,1);
 clock+=180001;const tracks=[];await runAdsbWorker({region:{lat:40,lon:-70,radius:10},providers:[createAirplanesLiveProvider({now:()=>clock,fetchImpl:async()=>response()}),db],logger:{log(){},warn(){}},
 persistence:{async upsertEvents(){},async upsertTracks(r){tracks.push(...r);return r.length;},async upsertHistory(){}}});
 assert.equal(tracks.length,1);assert.equal(tracks[0].subcategory,'transport');assert.equal(tracks[0].metadata.aircraft_identity.qualified,true);
});
test('reference/feed requests require an explicit published contract; credentials never enter diagnostics',async()=>{
 const p=createAirplanesLiveProvider();await assert.rejects(p.reference('/invented'),/published/);
 assert.throws(()=>createAirplanesLiveProvider({credential:'secret'}),/published/);
 const openApi={components:{securitySchemes:{key:{type:'apiKey',in:'header',name:'X-Fixture-Authorized-Key'}}},paths:{'/fixture/reference':{get:{parameters:[{name:'q',in:'query'}]}}}};
 let headers;const q=createAirplanesLiveProvider({openApi,credential:'secret',fetchImpl:async(u,o)=>{headers=o.headers;return response({items:[]});}});
 await q.reference('/fixture/reference',{q:'test'});assert.equal(headers['X-Fixture-Authorized-Key'],'secret');assert.ok(!JSON.stringify(q.getDiagnostics()).includes('secret'));
 await assert.rejects(q.reference('/fixture/reference',{invented:1}),/parameters/);
});
test('invalid access configuration isolates only this provider',()=>{
 const providers=createAircraftProviders({AIRPLANES_LIVE_OPENAPI_FILE:'missing-contract.json'});
 assert.equal(providers.find(p=>p.id==='airplanes_live').enabled,false);
 assert.equal(providers.find(p=>p.id==='adsb_lol').enabled,true);
});
