import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import express from 'express';
import {createRequire} from 'node:module';
import { toPublicStatusSignal } from "../../shared/status-signal-policy.js";
const source=fs.readFileSync(new URL('../src/routes.events.js',import.meta.url),'utf8');
const start=source.indexOf('    router.get("/status-feed"');
const route=source.slice(start,source.indexOf('    // ── Intel Wire',start));
function fixture(data,error=null){
  const calls=[];const query={then:resolve=>resolve({data,error})};
  for(const name of ['select','eq','gte','order','limit'])query[name]=(...args)=>{calls.push([name,...args]);return query;};
  let handler;
  vm.runInNewContext(route,{router:{get:(path,fn)=>{assert.equal(path,'/status-feed');handler=fn;}},
    getSupabase:()=>({from:table=>{assert.equal(table,'status_feed_items');return query;}}),toPublicStatusSignal,Date,Set});
  const response={statusCode:200,status(code){this.statusCode=code;return this;},setHeader(name,value){this.cache=value;},json(body){this.body=body;}};
  return {handler,response,calls};
}
test('status API uses bounded fresh queries, suppresses duplicates and exposes no raw source payload',async()=>{
  const item={guid:'cisa-kev:1',title:'Example',category:'cyber_advisory',url:'https://www.cisa.gov/kev',
    published_at:new Date().toISOString(),fetched_at:new Date().toISOString(),raw:{status_signal:{domain:'cyber',kind:'vulnerability',status:'advisory'},private_payload:'not public'}};
  const {handler,response,calls}=fixture([item,item,{...item,guid:'old',published_at:'2000-01-01'}]);
  await handler({},response);
  assert.equal(response.statusCode,200);assert.equal(response.body.items.length,1);
  assert.equal(response.body.items[0].kind,'vulnerability');assert.equal('raw' in response.body.items[0],false);
  assert.ok(calls.some(([name,value])=>name==='limit'&&value===300));assert.match(response.cache,/max-age=60/);
});
test('status API reports unavailable instead of fabricating a normal result on database failure',async()=>{
  const {handler,response}=fixture(null,{message:'not exposed'});await handler({},response);
  assert.equal(response.statusCode,503);assert.equal(response.body.error,'Status sources unavailable');
});
test('frontend status adapter reaches the real preview proxy and status route over HTTP',async()=>{
  const require=createRequire(import.meta.url),saved={NODE_ENV:process.env.NODE_ENV,API_UPSTREAM_URL:process.env.API_UPSTREAM_URL};
  const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
  const item={guid:'fixture-pulse',title:'Published report fixture',country:'CA',category:'cyber_advisory',url:'https://example.org/report',
    published_at:new Date().toISOString(),fetched_at:new Date().toISOString(),raw:{status_signal:{domain:'cyber',kind:'threat_intelligence',status:'reported',confidence:'medium'}}};
  const data=fixture([item]),backend=express();backend.get('/events/status-feed',data.handler);const upstream=await listen(backend);let preview;
  try{process.env.NODE_ENV='production';process.env.API_UPSTREAM_URL='http://127.0.0.1:'+upstream.address().port;
    delete require.cache[require.resolve('../../../server.js')];preview=await listen(require('../../../server.js'));
    const adapter=fs.readFileSync(new URL('../../../dev/assets/js/supabase.js',import.meta.url),'utf8');
    const read=adapter.match(/async function readJsonResponse\([^]*?\n}/)[0];
    const start=adapter.indexOf('    async getStatusFeedItems('),end=adapter.indexOf('    async getIntelFeedItems(',start);
    const c=vm.createContext({fetch,URLSearchParams,API_BASE:'http://127.0.0.1:'+preview.address().port+'/api'});
    vm.runInContext(read+'\nconst api={'+adapter.slice(start,end)+'};globalThis.readStatus=api.getStatusFeedItems;',c);
    const result=await c.readStatus();assert.equal(result.error,null);assert.equal(result.data.length,1);assert.equal(result.data[0].country,'CA');assert.equal(result.data[0].status,'reported');assert.equal(result.data[0].assessment.status,'monitoring');assert.equal('raw' in result.data[0],false);
  }finally{if(preview)await new Promise(resolve=>preview.close(resolve));await new Promise(resolve=>upstream.close(resolve));
    for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;delete require.cache[require.resolve('../../../server.js')];}
});
