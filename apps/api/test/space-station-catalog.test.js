import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { parseExpressionAt } from 'acorn';
import { json2satrec, propagate } from 'satellite.js';
const source=fs.readFileSync(new URL('../src/strategic-satellites.js',import.meta.url),'utf8');
const epoch='2026-11-25T12:00:00Z';
const gp=(id,name='Fixture')=>({NORAD_CAT_ID:id,OBJECT_NAME:name,OBJECT_ID:'1998-067A',EPOCH:epoch,
 MEAN_MOTION:15.5,ECCENTRICITY:.0005,INCLINATION:51.6,RA_OF_ASC_NODE:30,ARG_OF_PERICENTER:20,MEAN_ANOMALY:10,
 BSTAR:.0001,MEAN_MOTION_DOT:0,MEAN_MOTION_DDOT:0});
function harness(){
 const calls=[],h={military:[gp(99999,'USA TEST')],stations:{25544:[gp(25544,'ISS (ZARYA)')],48274:[gp(48274,'CSS (TIANHE)')]}};
 const c=vm.createContext({dirname,join,process:{env:{}},console,Date,URL,AbortController,setTimeout,clearTimeout,
  readFile:async()=>{throw Error('no fixture disk cache');}});
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace('fileURLToPath(import.meta.url)','"fixture.js"').replace(/^export /gm,''),c);
 c.readJsonLimited=async url=>{calls.push(url);const id=new URL(url).searchParams.get('CATNR');if(!id)return h.military;if(h.fail)throw Error('fixture outage');return h.stations[id]||[];};
 c.fetchSatcatMap=async()=>new Map();c.readCuratedCatalog=async()=>new Map();c.saveDiskCache=async()=>{};
 return Object.assign(h,{c,calls,get:forceRefresh=>c.getMilitarySatellitePayload({forceRefresh,logger:{log(){},warn(){}}})});
}
test('only two station exceptions join the unchanged military group, with canonical names and no duplicates',async()=>{
 const h=harness();h.military.push(gp(99999,'duplicate'),gp(25544,'ISS group duplicate'));
 h.stations[48274].push(gp(25544,'wrong query'),gp(20580,'HUBBLE'),gp(12345,'STARLINK'),gp(48274,'duplicate'));
 const result=await h.get();assert.equal(result.count,3);assert.deepEqual(Array.from(result.satellites,r=>r.noradId),['99999','25544','48274']);
 for(const [id,name,operator]of [['25544','International Space Station (ISS)','International partnership'],['48274','Chinese Space Station (Tiangong)','China']]){
  const station=result.satellites.find(r=>r.noradId===id);assert.equal(station.name,name);assert.equal(station.operator,operator);
  assert.equal(station.classification.associationLabel,'Space Station');assert.equal(station.classification.missionLabel,'Space Station');
  const position=propagate(json2satrec(station.omm),new Date(epoch)).position;assert.ok(position&&Number.isFinite(position.x));
 }
 assert.equal(result.satellites[0].classification.association,'likely-military-associated');
 assert.equal(h.calls.filter(url=>url.includes('CATNR=25544')).length,0,'reuse station already in military response');
 const count=h.calls.length;await h.get();assert.equal(h.calls.length,count,'fresh catalog uses existing cache');
});
test('supplemental outages preserve military records and existing station epochs without invented positions',async()=>{
 const h=harness();const first=await h.get();h.fail=true;const next=await h.get(true);
 assert.equal(next.count,3);assert.equal(next.satellites.find(r=>r.noradId==='25544').orbital.epoch,first.satellites.find(r=>r.noradId==='25544').orbital.epoch);
 const empty=harness();empty.fail=true;const result=await empty.get();assert.equal(result.count,1);assert.equal(result.satellites[0].noradId,'99999');
});
test('malformed or other civilian station results are rejected; cap reserves the two explicit exceptions',async()=>{
 const h=harness();h.stations[25544]=[gp(20580,'HUBBLE'),{...gp(25544),EPOCH:'invalid'}];
 const result=await h.get();assert.equal(result.count,2);assert.equal(result.satellites.some(r=>r.noradId==='25544'),false);
 const dense=harness();dense.military=Array.from({length:2001},(_,i)=>gp(60000+i));const capped=await dense.get();
 assert.equal(capped.count,2000);assert.equal(capped.satellites.filter(r=>r.classification.association==='space-station').length,2);
 assert.equal(h.c.shouldRefresh({catalogPolicy:'previous',fetchedAt:new Date().toISOString()}),true);
});
test('stations use existing UI classification filters and fit the existing visible-asset budget',async()=>{
 const h=harness(),payload=await h.get(),front=fs.readFileSync(new URL('../../../dev/assets/js/warzone-mil-sats.js',import.meta.url),'utf8');
 const c=vm.createContext({state:{config:{},filters:{association:'all',country:'all',mission:'all',orbit:'all'}},
  getSatrec:record=>json2satrec(record.omm),getMinimumConfidenceRank:()=>1,confidenceRank:()=>4,
  DEFAULT_CONFIG:{maximumVisibleSatellites:20},optionKey:value=>String(value).toLowerCase().replace(/\s+/g,'-')});
 for(const name of ['getPriorityScore','matchesFilters','chooseVisibleRecords']){const start=front.indexOf(`function ${name}(`);vm.runInContext(front.slice(start,parseExpressionAt(front,start,{ecmaVersion:'latest'}).end),c);}
 const stations=payload.satellites.filter(r=>r.classification.association==='space-station');
 const records=[...Array.from({length:100},(_,i)=>({...payload.satellites[0],id:'fixture-'+i})),...stations];
 const visible=c.chooseVisibleRecords(records);assert.equal(visible.length,20);for(const station of stations)assert.ok(visible.includes(station));
 c.state.filters.association='space-station';assert.equal(c.chooseVisibleRecords(records).length,2);
 c.state.filters.association='likely-military-associated';assert.equal(c.chooseVisibleRecords(records).some(r=>r.classification.association==='space-station'),false);
});

test('documented international IDs supplement the restricted group without admitting unrelated records',async()=>{
 const curated=JSON.parse(fs.readFileSync(new URL('../src/config/strategic-satellite-catalog.json',import.meta.url),'utf8'));
 const h=harness();h.c.readCuratedCatalog=async()=>new Map(curated.map(record=>[record.noradId,record]));
 h.c.fetchSatcatMap=async()=>new Map([['48865',{OWNER:'CIS',OBJECT_TYPE:'PAY'}],['36110',{OWNER:'PRC',OBJECT_TYPE:'PAY'}]]);
 h.stations['48865']=[gp(48865,'COSMOS 2550'),gp(10000,'STARLINK'),gp(10001,'R/B')];h.stations['36110']=[gp(36110,'YAOGAN-7')];
 const result=await h.get();assert.equal(result.count,5);
 const russian=result.satellites.find(record=>record.noradId==='48865'),chinese=result.satellites.find(record=>record.noradId==='36110');
 assert.equal(russian.country,'Russia');assert.equal(russian.ownerCode,'CIS');assert.equal(chinese.country,'China');assert.equal(chinese.ownerCode,'PRC');
 assert.equal(chinese.classification.inferred,true);assert.equal(chinese.classification.missionLabel,'Mission unconfirmed');
 assert.equal(result.satellites.some(record=>['10000','10001'].includes(record.noradId)),false);
 assert.equal(result.satellites.find(record=>record.noradId==='25544').country,'International partnership');
 const calls=h.calls.length;await h.get();assert.equal(h.calls.length,calls);
 const blocked=harness();blocked.c.readCuratedCatalog=h.c.readCuratedCatalog;blocked.c.fetchSatcatMap=async()=>new Map([['48865',{OBJECT_TYPE:'R/B'}]]);
 blocked.stations['48865']=[gp(48865,'COSMOS 2550')];blocked.stations['36110']=[gp(36110,'YAOGAN-7 DEB')];
 const filtered=await blocked.get();assert.equal(filtered.count,3);
});
