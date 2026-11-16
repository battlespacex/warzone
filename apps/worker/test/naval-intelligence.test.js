import test from 'node:test';
import assert from 'node:assert/strict';
import {registry,parseDvids,createNavalIntelRunner} from '../src/naval-intel/ingest.js';
import {normalizeNavalActivity,sourceAccess,selectNavalActivities} from '../../shared/naval-intelligence.js';
const now=Date.parse('2026-11-16T12:00:00Z'),source=registry.sources[0];
const article=(extra={})=>({id:'news:1',title:'USS Example Visits Port',short_description:'A destroyer port visit reported in the Arabian Sea.',url:'https://www.dvidshub.net/news/1/example',date_published:'2026-11-15T12:00:00Z',date:'2026-11-01T00:00:00Z',city:'Kuwait',country:'Kuwait',...extra});
function dbMock(){const tables=new Map();return {tables,from(table){if(!tables.has(table))tables.set(table,new Map());const rows=tables.get(table);return {upsert:async row=>{rows.set(row.source_id&&table==='naval_source'?row.source_id:row.activity_id||row.evidence_id,row);return {error:null};},select(){let filtered=[...rows.values()];const q={eq(key,id){filtered=filtered.filter(row=>row[key]===id);return q;},lt(key,value){filtered=filtered.filter(row=>row[key]<value);return q;},order(){return q;},limit(count){return Promise.resolve({data:filtered.slice(0,count),error:null});},maybeSingle:async()=>({data:filtered[0]||null,error:null})};return q;}};}};}
test('63 sources fail closed; noncommercial and paid sources cannot be enabled by approval list',()=>{
 assert.equal(registry.sources.length,63);assert.equal(sourceAccess(source),'not_configured');assert.equal(sourceAccess(source,{key:true}),'ready');
 for(const s of registry.sources.filter(s=>['noncommercial_only','commercial_contract_required','permission_required','member_with_conditions'].includes(s.commercial_gate)))assert.notEqual(sourceAccess(s,{approved:[s.id]}),'approved_import');
 assert.equal(sourceAccess(registry.sources.find(s=>s.id==='JPN-001')),'approval_required');
});
test('documented DVIDS schema separates publication/media dates and never geocodes media location',()=>{
 const input=parseDvids(article()),row=normalizeNavalActivity(input,source,now);assert.equal(row.published_at,'2026-11-15T12:00:00.000Z');assert.equal(row.observation_at,null);assert.equal(row.geometry,null);assert.equal(row.region,'Arabian Sea');assert.equal(row.vessel_name,'USS Example');assert.equal(row.navy_country_iso2,'US');assert.equal(row.live,false);
 assert.equal(parseDvids(article({title:'Navy Award Ceremony',short_description:'Recognition ceremony'})),null);
});
test('worldwide structured reports preserve nationality, dates and provenance without synthetic positions',()=>{
 for(const [id,country]of [['UK-001','GB'],['JPN-001','JP'],['IND-001','IN'],['CHN-001','CN'],['TUR-001','TR'],['BRA-001','BR']]){const s=registry.sources.find(s=>s.id===id);const row=normalizeNavalActivity({external_id:id,title:'Public exercise report',event_type:'EXERCISE',source_url:s.url,published_at:'2026-11-15T12:00:00Z',navy_country_iso2:country,region:'Published operating region'},s,now);assert.equal(row.navy_country_iso2,country);assert.equal(row.geometry,null);assert.equal(row.geometry_role,'NAMED_REGION_ONLY');}
});
test('geometry evidence is required; public ports are references and not live AIS; source URLs are allowlisted',()=>{
 const input=parseDvids(article());assert.throws(()=>normalizeNavalActivity({...input,geometry:{type:'Point',coordinates:[50,25]}},source,now),/evidence/);
 const port=normalizeNavalActivity({...input,geometry:{type:'Point',coordinates:[50,25]},geometry_role:'PUBLIC_PORT_REFERENCE',geometry_evidence:'Published port reference'},source,now);assert.equal(port.precision_class,'PUBLIC_PORT');assert.equal(port.live,false);
 assert.throws(()=>normalizeNavalActivity({...input,source_url:'https://evil.invalid/report'},source,now),/registry/);
});
test('expiration, exact cross-source dedup and conflicting identities retain evidence',()=>{
 const row={...normalizeNavalActivity(parseDvids(article()),source,now),id:'a',hull_number:'DDG-1',evidence:[{source_id:'a'}]},second={...row,id:'b',evidence:[{source_id:'b'}]};
 assert.equal(selectNavalActivities([row,second],{now}).length,1);assert.equal(selectNavalActivities([row,second],{now})[0].evidence.length,2);
 const conflict=selectNavalActivities([row,{...second,vessel_name:'USS Different'}],{now});assert.equal(conflict.length,2);assert.equal(conflict[0].identity_conflict,true);
 assert.equal(selectNavalActivities([row],{now:now+10*86400000}).length,0);assert.equal(selectNavalActivities([row],{now:now+10*86400000,history:true})[0].status,'historical');
});
test('ingest is single-flight, idempotent and bounded; no-key mode makes zero DVIDS requests',async()=>{
 let requests=0;const db=dbMock(),env={DVIDS_API_KEY:'fixture-only'},runner=createNavalIntelRunner({db,env,now:()=>now,logger:{info(){},warn(){}},fetchImpl:async url=>{if(String(url).startsWith('https://www.gov.uk/'))return {status:304};requests++;assert.equal(url.origin,'https://api.dvidshub.net');assert.equal(url.searchParams.get('type'),'news');return {ok:true,text:async()=>JSON.stringify({results:[article()]})};}});
 const first=runner.run();assert.equal(runner.run(),first);await first;await runner.run();assert.equal(requests,1);assert.equal(db.tables.get('naval_activity').size,1);assert.equal(db.tables.get('naval_source').size,63);
 const noKey=createNavalIntelRunner({db:dbMock(),env:{},now:()=>now,logger:{info(){},warn(){}},fetchImpl:url=>{assert.ok(String(url).startsWith('https://www.gov.uk/'));return {status:304};}});assert.equal((await noKey.run()).state,'ok');
});
test('403 and 429 are isolated, respect backoff and never log secrets or prevent directory sync',async()=>{
 for(const status of [403,429]){let clock=now,requests=0;const db=dbMock(),logs=[],runner=createNavalIntelRunner({db,env:{DVIDS_API_KEY:'secret-fixture'},now:()=>clock,random:()=>0,logger:{info(){},warn(...args){logs.push(args.join(' '));}},fetchImpl:async url=>{if(String(url).startsWith('https://www.gov.uk/'))return {status:304};requests++;return {ok:false,status,headers:{get:()=> '7200'}};}});
 await runner.run();clock+=3600000;await runner.run();assert.equal(requests,1);assert.equal(db.tables.get('naval_source').size,63);assert.equal(db.tables.get('naval_source').get('API-001').payload.access_status,'unavailable');assert.ok(logs.every(s=>!s.includes('secret-fixture')));
 }
});
test('old source metadata is revalidated and removed reports are withdrawn without AIS mutations',async()=>{
 const db=dbMock(),row=normalizeNavalActivity(parseDvids(article()),source,now);row.id='old';
 db.from('naval_activity');db.tables.get('naval_activity').set('old',{activity_id:'old',source_id:source.id,checked_at:new Date(now-86400000).toISOString(),payload:row});
 const runner=createNavalIntelRunner({db,env:{DVIDS_API_KEY:'fixture'},now:()=>now,logger:{info(){},warn(){}},fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({results:[]})})});
 await runner.run();assert.equal(db.tables.get('naval_activity').get('old').payload.review_status,'withdrawn');assert.equal(selectNavalActivities([db.tables.get('naval_activity').get('old').payload],{now,history:true}).length,0);
});
