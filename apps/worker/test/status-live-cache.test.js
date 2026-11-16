import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatusFeedCache} from '../src/status-feed-runner.js';
const row={source_id:'cisa-kev',title:'Fixture advisory',guid:'fixture:1',url:'https://example.org/fixture',published_at:new Date().toISOString(),fetched_at:new Date().toISOString(),
  raw:{status_signal:{domain:'cyber',kind:'vulnerability',status:'advisory'}}};
test('shared cache publishes normalized available sources before the entire background cycle completes',async()=>{
 let finish,calls=0;const cache=createStatusFeedCache({env:{},fetchStatus:({onSourceResult})=>{calls++;onSourceResult({source:{id:'cisa-kev'},ok:true,items:[row]});return new Promise(resolve=>{finish=resolve;});}});
 const snapshots=await Promise.all(Array.from({length:20},()=>cache.list()));assert.equal(calls,1);assert.ok(snapshots.every(s=>s.items.length===1&&s.state==='loading'));assert.equal(snapshots[0].items[0].severity,'unknown');
 finish({items:[row],failed_source_count:0});await new Promise(resolve=>setImmediate(resolve));const ready=await cache.list();assert.equal(ready.state,'ready');assert.equal(calls,1);cache.dispose();
});
test('disposing cache prevents late results from restoring records or starting another cycle',async()=>{
 let finish,calls=0;const cache=createStatusFeedCache({fetchStatus:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
 const pending=cache.list();cache.dispose();finish({items:[row],failed_source_count:0});await pending;assert.equal((await cache.list()).items.length,0);assert.equal(calls,1);
});
