import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSourceRegistryCache} from '../src/source-registry-cache.js';
import {conflictEscalationLifetime} from '../../shared/conflict-alert-lifecycle.js';
import {saveRawEvidence} from '../src/raw-evidence-writer.js';
import {linkEventSources} from '../src/event-source-links.js';
import {getUsageRow,incrementUsage} from '../src/copernicus-usage.js';
import {cleanupExpiredSatelliteObservations} from '../src/copernicus-runner.js';
import {compactConflictPayload,sameConflictPayload} from '../src/conflict-storage-change.js';
import {upsertConflictFeedItems} from '../src/conflict-supabase-writer.js';
import {normalizeConflictItemToEventPayload} from '../src/intelligence-normalizer.js';

test('source registry coalesces 80 calls into one read, expires and invalidates',async()=>{
 let reads=0,now=0;const db={from(){return{select(){return this},eq(){return this},async maybeSingle(){reads++;return {data:{enabled:true}}}}}};
 const cache=createSourceRegistryCache({db,clock:()=>now});
 await Promise.all(Array.from({length:80},()=>cache.get('test')));assert.equal(reads,1);
 now=60001;await cache.get('test');assert.equal(reads,2);cache.invalidate();await cache.get('test');assert.equal(reads,3);
});
test('source registry errors are not cached as configuration',async()=>{
 let reads=0;const db={from(){reads++;throw Error('unavailable')}};const cache=createSourceRegistryCache({db});
 assert.equal(await cache.get('x'),null);assert.equal(await cache.get('x'),null);assert.equal(reads,2);
});
test('conflict alert expiry uses original UTC event time at 24,48,71 and72 hours',()=>{
 const now=Date.parse('2026-11-26T18:00:00Z');
 for(const age of [24,48,71,72,73]){
  const event={id:'x',dedupe_key:'conflict-feed:x',occurred_at:new Date(now-age*3600000).toISOString()};
  const result=conflictEscalationLifetime(event,now);
  assert.equal(result.status,age<72?'active':'cleared');assert.equal(Date.parse(result.expires_at),Date.parse(event.occurred_at)+72*3600000);
 }
 assert.equal(conflictEscalationLifetime({report_type:'signal'}),null);
});
test('identical raw evidence is reused; changed payload coordinates require a new evidence row',async()=>{
 const row={hash:'x',source_name:'x',raw_text:'same',raw_payload:{lat:1},published_at:'2026-11-26T00:00:00Z'};let inserts=0;
 const q={select(){return this},eq(){return this},gte(){return this},order(){return this},async limit(){return{data:[{...row,id:'old',published_at:'2026-11-26T00:00:00+00:00'}]}},insert(){inserts++;return this},async maybeSingle(){return{data:{id:'new'}}}};
 const db={from:()=>q};assert.equal((await saveRawEvidence(db,row)).deduplicated,true);
 await saveRawEvidence(db,{...row,raw_payload:{lat:2}});assert.equal(inserts,1);
});
test('unchanged conflict content ignores transport freshness and removes only exact duplicate evidence',()=>{
 const item={title:'same',summary:'text',published_at:'2026-11-26T00:00:00Z',fetched_at:'old',raw:{title:'same',summary:'text',unique_evidence:'KEEP',media_content:['url']}};
 const compact=compactConflictPayload(item);assert.equal(compact.raw.unique_evidence,'KEEP');assert.deepEqual(compact.raw.media_content,['url']);
 assert.equal(sameConflictPayload(item,{...compact,fetched_at:'new'}),true);
 assert.equal(sameConflictPayload(item,{...compact,summary:'changed'}),false);
});
test('atomic source links retain legacy supporting type and batch through one RPC',async()=>{
 let calls=0;const db={async rpc(name,args){calls++;assert.equal(name,'stratops_link_event_sources');assert.equal(args.p_rows[0].support_type,'supporting');return{data:{inserted_count:1}}}};
 assert.equal((await linkEventSources(db,[{event_id:'e',raw_item_id:'r'}])).inserted_count,1);assert.equal(calls,1);
});
test('usage initialization never overwrites a concurrently initialized daily counter',async()=>{
 let reads=0;const q={select(){return this},eq(){return this},upsert(row,opts){assert.equal(opts.ignoreDuplicates,true);return this},async maybeSingle(){reads++;return reads<3?{data:null}:{data:{catalog_requests_attempted:9}}}};
 const result=await getUsageRow({from:()=>q},'2026-11-26');assert.equal(result.catalog_requests_attempted,9);
});
test('atomic Copernicus counters use one RPC and keep admission reads independent',async()=>{
 let calls=0;const db={async rpc(){calls++;return{data:{catalog_requests_attempted:10}}},from(){throw Error('unnecessary counter read')}};
 assert.equal((await incrementUsage(db,{catalog_requests_attempted:1})).catalog_requests_attempted,10);assert.equal(calls,1);
});
test('report-pinned or uncertain S3 objects are never expired or deleted',async()=>{
 for(const response of [{data:true},{error:{code:'PGRST202'}}]){
  let changes=0;const q={select(){return this},lt(){return this},or(value){assert.match(value,/status.eq.expired/);return this},async limit(){return{data:[{id:'o',event_id:'e',storage_key:'legacy-key'}]}}};
  const db={from(){return q},async rpc(){return response}};
  const result=await cleanupExpiredSatelliteObservations({supabase:db,config:{},logger:{warn(){}}});assert.equal(result.deleted_count,0);assert.equal(result.expired_count,0);assert.equal(changes,0);
 }
});
test('manual SQL preserves nullable source history, dependency guards, disabled cleanup and user-created indexes',()=>{
 const read=(name)=>readFileSync(new URL('../../../docs/04-development/'+name,import.meta.url),'utf8');
 const source=read('supabase-db-sources-migration.sql');assert.match(source,/event_id IS NOT NULL AND raw_item_id IS NOT NULL/);assert.match(source,/stratops_report_references/);
 const base=read('supabase-db-health-foundation.sql');assert.match(base,/DEFAULT false/);assert.match(base,/stratops_event_has_dependents/);
 const performance=read('supabase-db-performance-migration.sql');assert.doesNotMatch(performance,/CREATE INDEX.*idx_tracks_type_category_updated/i);assert.doesNotMatch(performance,/DROP INDEX/i);
 const security=read('supabase-db-security-migration.sql');assert.doesNotMatch(security,/ARRAY\[[^\]]*'stratops_subscriptions'/);assert.match(security,/GRANT SELECT ON TABLE/);
});
test('unchanged persisted conflict reports avoid JSON rewrites and retain bounded freshness touches',async()=>{
 let stored=[],writes=0,touches=0;const now=Date.now();
 const db={from(){let mode='read';const q={select(){return q},in(){return q},upsert(rows){mode='write';writes++;stored=structuredClone(rows);return q},update(row){mode='touch';touches++;stored=stored.map(old=>({...old,...row}));return q},then(resolve,reject){return Promise.resolve({data:mode==='touch'?null:structuredClone(stored)}).then(resolve,reject)}};return q}};
 const report={title:'Explosion reported in Kharkiv',summary:'A drone strike damaged buildings in Kharkiv.',source_name:'Test',url:'https://example.test/report',published_at:new Date(now-3600000).toISOString(),fetched_at:new Date(now).toISOString(),is_conflict_relevant:true};
 await upsertConflictFeedItems([report],{db,now});await upsertConflictFeedItems([report],{db,now});
 const previous=writes;const unchanged=await upsertConflictFeedItems([report],{db,now});
 assert.equal(unchanged.unchanged_count,1);assert.equal(writes,previous);assert.equal(touches,0);
 await upsertConflictFeedItems([report],{db,now:now+6*60000});assert.equal(touches,1);assert.equal(writes,previous);
});
test('country codes come from resolved incident geography, never publisher nationality',()=>{
 const normalized=normalizeConflictItemToEventPayload({title:'Drone strike in Kharkiv',summary:'Buildings damaged in Kharkiv.',published_at:new Date().toISOString(),source_country:'France'});
 assert.equal(normalized.event.country_code,'UA');
});
