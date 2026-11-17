import test from 'node:test';
import assert from 'node:assert/strict';
import {getOptionalStatusSources,fetchOptionalStatusSource,lookupStatusCountry} from '../src/official-status-adapters.js';
import {enrichStatusItem} from '../src/status-filter.js';
import {toPublicStatusSignal} from '../../shared/status-signal-policy.js';
import {fetchSingleStatusSource} from '../src/status-fetcher.js';
import {resetSourceHealth} from '../src/source-health.js';
const at=Date.now();
const env={OTX_ENABLED:'true',OTX_USAGE_APPROVED:'true',OTX_API_KEY:'fixture-private-key',CLOUDFLARE_RADAR_ENABLED:'true',CLOUDFLARE_RADAR_USAGE_APPROVED:'true',CLOUDFLARE_API_TOKEN:'fixture-private-key'};
const otx=getOptionalStatusSources(env).find(s=>s.id==='alienvault-otx'),radar=getOptionalStatusSources(env).find(s=>s.id==='cloudflare-radar');
const pulse={id:'0123456789abcdef01234567',name:'Threat report fixture',description:'Not evidence of an active incident',created:new Date(at-86400000).toISOString(),modified:new Date(at).toISOString(),targeted_countries:['US'],indicators:[{type:'domain',indicator:'example.org'}],references:['https://example.org/report']};
test('optional source credentials and usage gates prevent requests and never expose keys',async()=>{
  let calls=0;for(const e of [{},{...env,OTX_USAGE_APPROVED:'false',CLOUDFLARE_RADAR_USAGE_APPROVED:'false'}]){
    assert.ok(getOptionalStatusSources(e).every(s=>!s.enabled));await fetchOptionalStatusSource(otx,async()=>{calls++;},e,at);
  }assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(getOptionalStatusSources(env)),/fixture-private-key/);
});
test('a caller without approval cannot join an authorized in-flight provider request',async()=>{
  let finish;const approved=fetchOptionalStatusSource(radar,()=>new Promise(resolve=>{finish=resolve;}),env,at);
  const blocked=fetchOptionalStatusSource(radar,()=>{throw Error('must not request');},{...env,CLOUDFLARE_RADAR_USAGE_APPROVED:'false'},at);
  finish({success:true,result:{annotations:[{id:'fixture',description:'Published outage fixture',startDate:new Date(at).toISOString()}]}});
  assert.equal((await approved).items.length,1);assert.equal((await blocked).items.length,0);
});
test('OTX shares requests, incrementally synchronizes stable pulse IDs and preserves indicators without inventing attacks',async()=>{
  let calls=0;const request=async(url,options)=>{calls++;assert.equal(options.headers['X-OTX-API-KEY'],'fixture-private-key');assert.equal(new URL(url).origin,'https://otx.alienvault.com');assert.ok(new URL(url).searchParams.has('modified_since'));return {results:[pulse],next:null};};
  const [a,b]=await Promise.all([fetchOptionalStatusSource(otx,request,env,at),fetchOptionalStatusSource(otx,request,env,at)]);assert.equal(calls,1);assert.equal(a,b);
  const row=enrichStatusItem(a.items[0]);assert.equal(row.is_status_relevant,true);assert.equal(row.severity,'unknown');assert.equal(row.raw.indicators.length,1);
  const item=toPublicStatusSignal(row,at);assert.equal(item.kind,'threat_intelligence');assert.equal(item.status,'reported');assert.equal(item.country,'US');assert.match(item.coverage,/unverified/);assert.equal('raw' in item,false);
  const updated=await fetchOptionalStatusSource(otx,async(url)=>{assert.equal(new URL(url).searchParams.get('modified_since'),new Date(at).toISOString());return {results:[{...pulse,description:'Corrected report'}],next:null};},env,at+1000);
  assert.equal(updated.items.length,1);assert.equal(updated.items[0].summary,'Corrected report');
  const revised=await fetchOptionalStatusSource(otx,async()=>({results:[{...pulse,targeted_countries:['CA']}],next:null}),env,at+1500);
  assert.equal(revised.items.length,1);assert.equal(revised.items[0].country,'CA','removed country references do not survive a pulse correction');
});
test('OTX refuses external pagination before sending credentials',async()=>{
  let calls=0;await assert.rejects(fetchOptionalStatusSource(otx,async()=>{calls++;return {results:[],next:'https://untrusted.example/steal'};},env,at+2000),/pagination/);assert.equal(calls,1);
});
test('malformed OTX records do not advance the incremental watermark',async()=>{
  let since;await assert.rejects(fetchOptionalStatusSource(otx,async url=>{since=new URL(url).searchParams.get('modified_since');return {results:[{invalid:true}],next:null};},env,at+3000),/Invalid OTX/);
  await fetchOptionalStatusSource(otx,async url=>{assert.equal(new URL(url).searchParams.get('modified_since'),since);return {results:[],next:null};},env,at+4000);
});
test('Radar outage annotations preserve explicit location, scope and original start/end dates',async()=>{
  const response=await fetchOptionalStatusSource(radar,async(url,options)=>{assert.equal(url,radar.url);assert.match(options.headers.Authorization,/^Bearer /);return {success:true,result:{annotations:[{id:'1',description:'Reported outage fixture',startDate:new Date(at).toISOString(),endDate:new Date(at+1000).toISOString(),scope:'ASN',locationsDetails:[{code:'CA',name:'Canada'}]}]}};},env,at);
  const row=enrichStatusItem(response.items[0]),item=toPublicStatusSignal(row,at);assert.equal(item.country,'CA');assert.equal(item.coverage,'ASN');assert.equal(item.status,'reported');assert.equal(row.raw.endDate,new Date(at+1000).toISOString());assert.equal(row.severity,'unknown');
  await assert.rejects(fetchOptionalStatusSource(radar,async()=>({success:false}),env,at),/Invalid Radar/);
});
test('Radar layer 3/7 target aggregates remain attributed reports, never national incident ratings',async()=>{
  for(const layer of [3,7]){
    const source=getOptionalStatusSources(env).find(s=>s.id==='cloudflare-radar-l'+layer);
    const result=await fetchOptionalStatusSource(source,async url=>{assert.match(url,new RegExp('/layer'+layer+'/top/locations/target'));return {success:true,result:{meta:{dateRange:[{endTime:new Date(at).toISOString()}]},top_0:[{targetCountryAlpha2:'IN',targetCountryName:'India',value:'2.5'}]}};},env,at);
    const row=enrichStatusItem(result.items[0]),signal=toPublicStatusSignal(row,at);assert.equal(signal.kind,'network_activity');assert.equal(signal.status,'reported');assert.equal(row.severity,'unknown');assert.equal(row.confidence_score,0);assert.match(signal.summary,/not confirmation/);
    if(layer===7)assert.match(signal.summary,/billing country/);
  }
});
test('local country reference resolves codes without spending REST Countries credits, including after restart horizon',async()=>{
  const e={RESTCOUNTRIES_ENABLED:'true',RESTCOUNTRIES_API_KEY:'private-key'};let calls=0;
  const request=async(url,options)=>{calls++;assert.match(url,/\/v5\/codes\.alpha_2\/CA\?response_fields=/);assert.equal(options.headers.Authorization,'Bearer private-key');return {data:{objects:[{names:{common:'Canada'},codes:{alpha_2:'CA',alpha_3:'CAN'}}]}};};
  const result=await Promise.all([lookupStatusCountry('CA',request,e,at),lookupStatusCountry('CA',request,e,at)]);assert.equal(calls,0);assert.equal(result[0].name,'Canada');
  await lookupStatusCountry('CA',request,e,at+3*86400000-1);await lookupStatusCountry('CA',request,e,at+3*86400000);assert.equal(calls,0);
  assert.equal((await lookupStatusCountry('US',request,{},at)).alpha3,'USA');assert.equal(calls,0);
});
test('country alpha-3 aliases resolve locally',async()=>{
  const result=await lookupStatusCountry('CAN',async()=>{throw Error('Must not request country API');},
    {RESTCOUNTRIES_ENABLED:'true',RESTCOUNTRIES_API_KEY:'fixture-only-key'},at);
  assert.equal(result.alpha2,'CA');assert.equal(result.alpha3,'CAN');
});
test('existing worker health isolates forbidden optional sources and respects Retry-After',async()=>{
  const original=globalThis.fetch,saved={...process.env};resetSourceHealth();Object.assign(process.env,env);let calls=0;
  try{globalThis.fetch=async()=>{calls++;return new Response('',{status:403});};
    const source={...radar,id:radar.id};await fetchSingleStatusSource(source);await fetchSingleStatusSource(source);assert.equal(calls,1);
    // A different fixture account isolates the 429 scenario from the durable 403 hold.
    resetSourceHealth();process.env.CLOUDFLARE_API_TOKEN='fixture-independent-429-account';globalThis.fetch=async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});};
    const failed=await fetchSingleStatusSource(source);await fetchSingleStatusSource(source);assert.equal(calls,2);assert.equal(failed.health.last_status_code,429);assert.ok(Date.parse(failed.health.retry_after)>=at+110000);
  }finally{globalThis.fetch=original;for(const key of Object.keys(env))if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];resetSourceHealth();}
});
