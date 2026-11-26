import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordPreviewRetirement} from '../src/copernicus-runner.js';
test('successful storage retirement requires an atomic, matching database receipt',async()=>{
 let calls=0;
 const db={async rpc(name,args){calls++;assert.equal(name,'stratops_record_preview_retirement');assert.deepEqual(args,{p_observation_id:'observation',p_storage_key:'key'});return {data:true};},from(){throw Error('must not clear storage references separately');}};
 assert.equal(await recordPreviewRetirement(db,'observation','key'),true);assert.equal(calls,1);
});
test('missing migration, failed receipt or changed row keeps retirement retryable',async()=>{
 for(const result of [{error:{code:'PGRST202'}},{data:false},{data:null}])
  assert.equal(await recordPreviewRetirement({rpc:async()=>result},'o','key'),false);
 assert.equal(await recordPreviewRetirement({rpc:async()=>{throw Error('network');}},'o','key'),false);
});
test('retirement SQL retains bounded child, shared evidence and report guards',()=>{
 const sql=readFileSync(new URL('../../../docs/04-development/supabase-db-retirement-migration.sql',import.meta.url),'utf8');
 assert.match(sql,/BEFORE INSERT OR UPDATE OR DELETE/);
 assert.match(sql,/report_pins_ref/);assert.match(sql,/preview_retirements r WHERE r.observation_id=o.id/);
 assert.match(sql,/NOT EXISTS\(SELECT 1 FROM public.event_sources x WHERE x.raw_item_id=r.id\)/);
 assert.match(sql,/cleared_at<now\(\)-interval '90 days'/);
 assert.match(sql,/UPDATE stratops_maintenance.controls SET enabled=false/);
 assert.match(sql,/FOR KEY SHARE/);
});
