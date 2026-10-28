import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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
