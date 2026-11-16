import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {runStatusFeedFetch} from '../src/status-feed-runner.js';
import {fetchAllStatusItems} from '../src/status-fetcher.js';
import {getStatusSources} from '../src/status-sources.js';
import {toPublicStatusSignal} from '../../shared/status-signal-policy.js';

test('ingestion preserves the supported 30-day CISA window through the API contract and existing widget',async()=>{
  const original=globalThis.fetch,configuredAge=process.env.STATUS_FEED_MAX_AGE_DAYS;delete process.env.STATUS_FEED_MAX_AGE_DAYS;
  const at=Date.now(),older=new Date(at-20*86400000).toISOString().slice(0,10),recent=new Date(at-2*86400000).toISOString().slice(0,10);
  const source={...getStatusSources().find(s=>s.id==='cisa-kev'),url:'https://fixture.example/kev',fallback_urls:[]};
  let calls=0;
  try{globalThis.fetch=async()=>{calls++;return Response.json({dateReleased:new Date(at).toISOString(),vulnerabilities:[
    {cveID:'CVE-2026-90001',vulnerabilityName:'Older fixture',shortDescription:'Published advisory, not a national incident',dateAdded:older},
    {cveID:'CVE-2026-90002',vulnerabilityName:'Recent fixture',dateAdded:recent},
    {cveID:'CVE-2026-90002',vulnerabilityName:'Recent fixture',dateAdded:recent}]});};
    const result=await runStatusFeedFetch({sources:[source]});assert.equal(result.total_items,2,'the public 30-day advisory contract must survive worker filtering');
    const items=result.items.map(row=>toPublicStatusSignal(row,at));assert.ok(items.every(row=>row.country===null && row.status==='advisory'));assert.equal(items[0].published_at,older);
    const frontend=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8'),start=frontend.indexOf('function renderStatusFeedRows(');
    const c=vm.createContext({__statusFeedItemsCache:items,__statusFeedUnavailable:false,getActiveRegion:()=>({id:'middle_east'}),getRegionCountryWhitelist:()=>new Set(['Qatar']),
      normalizeCountryName:x=>x,countryNameFromCode:()=>'',escapeHtml:String,URL});
    vm.runInContext(frontend.match(/function isCurrentStatusReport\([^]*?\n}/)[0]+'\n'+frontend.slice(start,frontend.indexOf('\n}',start)+2),c);let html='';
    assert.equal(c.renderStatusFeedRows({insertAdjacentHTML:(_where,value)=>{html+=value;}},'cyber'),true);assert.match(html,/Older fixture/);assert.match(html,/Vulnerability advisory/);assert.doesNotMatch(html,/critical|safe|attack in Qatar/i);
    const warm=await runStatusFeedFetch({sources:[source],maxAgeDays:7});assert.equal(warm.total_items,1,'explicit operator retention remains authoritative');assert.equal(calls,1,'warm worker cycle reuses the same source response');
  }finally{globalThis.fetch=original;if(configuredAge===undefined)delete process.env.STATUS_FEED_MAX_AGE_DAYS;else process.env.STATUS_FEED_MAX_AGE_DAYS=configuredAge;}
});

test('country enrichment leaves canonical cached source records unchanged across warm cycles',async()=>{
  const original=globalThis.fetch,saved={RESTCOUNTRIES_ENABLED:process.env.RESTCOUNTRIES_ENABLED,RESTCOUNTRIES_API_KEY:process.env.RESTCOUNTRIES_API_KEY};
  Object.assign(process.env,{RESTCOUNTRIES_ENABLED:'true',RESTCOUNTRIES_API_KEY:'fixture-only-key'});
  const source={id:'metadata-pipeline-fixture',name:'Fixture OONI',type:'api',adapter:'ooni_incidents',enabled:true,url:'https://fixture.example/incidents',category:'cyber_disruption'};let metadataCalls=0,feedCalls=0;
  try{globalThis.fetch=async url=>{
      if(String(url).includes('api.restcountries.com')){metadataCalls++;return Response.json({data:{objects:[{names:{common:'New Zealand'},codes:{alpha_2:'NZ',alpha_3:'NZL'}}]}});}
      feedCalls++;return Response.json({incidents:[{id:'fixture:1',title:'Fixture internet outage',CCs:['NZ'],start_time:new Date().toISOString()}]});
    };
    const cold=await fetchAllStatusItems({sources:[source]});assert.equal(cold.items[0].country,'New Zealand');assert.equal(cold.results[0].items[0].country,'NZ');
    const warm=await fetchAllStatusItems({sources:[source]});assert.equal(warm.items[0].country,'New Zealand');assert.equal(warm.results[0].items[0].country,'NZ');assert.equal(feedCalls,1);assert.equal(metadataCalls,1);
  }finally{globalThis.fetch=original;for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
