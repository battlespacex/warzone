import {createCountryStatusClassifier} from '../../shared/status-signal-policy.js';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const source = readFileSync(fileURLToPath(new URL("../../../dev/assets/js/essential.js", import.meta.url)), "utf8");
const hints = source.match(/const REGION_COUNTRY_HINTS = \{[\s\S]*?\n\};/)?.[0];
const priority = source.match(/function statusPriority\(status\) \{[\s\S]*?\n\}/)?.[0];
const rank = source.match(/function rankCountryRows\(events, type, max = 10\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(hints && priority && rank);

const context = vm.createContext({
  __statusFeedItemsCache: [], __statusFeedUnavailable: false, __statusFeedLoading:false, countryNameFromCode: () => '',
  getActiveRegion: () => ({ id: "middle_east" }),
  getStatusScopedEvents: (events) => events,
  deriveFocusCountries: () => [],
  getEventResolvedCountry: (event) => event.country,
  normalizeCountryName: (country) => String(country || "").trim(),
  deriveCountryStatus: (events, country) => events.find((event) => event.country === country)?.status || "unknown",
  getCountryMatchCount: (events, country) => events.filter((event) => event.country === country).length,
});
const classify=createCountryStatusClassifier(value=>String(value||'').trim());
context.classifyCountryIntelligence=(country,domain)=>classify(context.__statusFeedItemsCache,country,domain);
vm.runInContext(`${hints}\n${priority}\n${source.match(/function isCurrentStatusReport\([^]*?\n}/)[0]}\n${rank}`, context);

test("all selectable regions retain country rows with unknown status when signals are absent", () => {
  const regionIds = ["middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"];
  for (const id of regionIds) {
    context.getActiveRegion = () => ({ id });
    for (const domain of ["cyber", "airspace"]) {
      const rows = vm.runInContext(`rankCountryRows([], "${domain}")`, context);
      assert.ok(rows.length > 0, `${id} ${domain}`);
      assert.ok(rows.every((row) => row.status === "unknown"), `${id} must not imply normal status`);
    }
  }
});

test("an unsupported legacy status cannot promote a country while other countries remain unknown", () => {
  context.getActiveRegion = () => ({ id: "middle_east" });
  const rows = vm.runInContext('rankCountryRows([{ country: "Saudi Arabia", status: "restricted" }], "airspace")', context);
  assert.equal(rows.find((row) => row.label === "Saudi Arabia").status, "unknown");
  assert.equal(rows.find((row) => row.label === "Qatar").status, "unknown");
});
test('country report references and stale evidence never turn into a national incident rating',()=>{
  context.getActiveRegion=()=>({id:'middle_east'});context.__statusFeedItemsCache=[{domain:'cyber',country:'Qatar',kind:'threat_intelligence',published_at:new Date().toISOString(),fetched_at:new Date().toISOString()}];
  let rows=context.rankCountryRows([],'cyber');assert.equal(rows.find(r=>r.label==='Qatar').status,'unknown');assert.equal(rows.find(r=>r.label==='Qatar').evidenceLabel,'Reports');
  context.__statusFeedItemsCache[0].stale=true;rows=context.rankCountryRows([],'cyber');assert.equal(rows.find(r=>r.label==='Qatar').evidenceLabel,'Stale');
  context.__statusFeedItemsCache[0].kind='vulnerability';rows=context.rankCountryRows([],'cyber');assert.equal(rows.find(r=>r.label==='Qatar').evidenceLabel,'');context.__statusFeedItemsCache=[];
});
test('ISO identifiers resolve South Asian countries and global reports stay outside unrelated regional country rows',()=>{
  const c=vm.createContext({getActiveRegion:()=>({id:'south_asia'}),getStatusScopedEvents:()=>[],deriveFocusCountries:()=>[],getEventResolvedCountry:e=>e.country,
    deriveCountryStatus:()=> 'unknown',getCountryMatchCount:()=>0,__statusFeedUnavailable:false,__statusFeedLoading:false,
    __statusFeedItemsCache:['IN','PK','US'].map(country=>({domain:'cyber',country,kind:'network_activity',published_at:new Date().toISOString(),fetched_at:new Date().toISOString()}))});
  vm.runInContext(hints+'\n'+source.match(/const COUNTRY_NAME_ALIASES = \{[^]*?\n};/)[0]+'\n'+
    ['normalizeCountryName','countryNameFromCode','isCurrentStatusReport'].map(name=>source.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0]).join('\n')+'\n'+priority+'\n'+rank,c);
  const classify=createCountryStatusClassifier(value=>c.normalizeCountryName(c.countryNameFromCode(value)||value));c.classifyCountryIntelligence=(country,domain)=>classify(c.__statusFeedItemsCache,country,domain);
  const rows=c.rankCountryRows([],'cyber');assert.equal(rows.find(r=>r.label==='India').evidenceLabel,'Reports');assert.equal(rows.find(r=>r.label==='Pakistan').evidenceLabel,'Reports');assert.equal(rows.some(r=>r.label==='United States'),false);
});

test('status summaries and reports have independent parents and reported colors without invented severity',()=>{
  for(const domain of ['cyber','airspace']){
    const container={innerHTML:'',setAttribute(){},replaceChildren(){this.innerHTML='';},insertAdjacentHTML(_where,html){this.innerHTML+=html;}};
    const c=vm.createContext({document:{getElementById:()=>container},isLayerEnabled:()=>true,rankCountryRows:()=>[{status:'unknown',label:'Qatar',evidenceLabel:'Reports'}],
      __statusFeedItemsCache:[{domain,kind:'reported_signal',title:'Reported fixture',country:'Qatar',published_at:new Date().toISOString(),fetched_at:new Date().toISOString()}],
      __statusFeedUnavailable:false,__statusFeedLoading:false,getActiveRegion:()=>({id:'middle_east'}),getRegionCountryWhitelist:()=>new Set(['Qatar']),normalizeCountryName:x=>x,countryNameFromCode:x=>x,escapeHtml:String,URL});
    for(const name of ['isCurrentStatusReport','renderStatusFeedRows',domain==='cyber'?'renderCyberStatus':'renderAirspaceStatus'])vm.runInContext(source.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0],c);
    c[domain==='cyber'?'renderCyberStatus':'renderAirspaceStatus']([]);
    assert.match(container.innerHTML,/wz-status-summary/);assert.match(container.innerHTML,/wz-status-details/);assert.match(container.innerHTML,/status-pill--unknown/);
    assert.doesNotMatch(container.innerHTML,/status-pill--critical/);
    if(domain==='cyber')assert.match(container.innerHTML,/cyber-status.svg/);
  }
});

test('identical status reports preserve disclosure DOM and expired reports are removed',()=>{
  let writes=0,html='';const container={firstElementChild:{},set innerHTML(v){writes++;html=v;},get innerHTML(){return html;}};
  const c=vm.createContext({__statusFeedItemsCache:[{domain:'cyber',kind:'reported_signal',title:'Fixture',country:'Qatar',published_at:new Date().toISOString(),fetched_at:new Date().toISOString()}],
    __statusFeedUnavailable:false,getActiveRegion:()=>({id:'middle_east'}),getRegionCountryWhitelist:()=>new Set(['Qatar']),normalizeCountryName:x=>x,countryNameFromCode:x=>x,escapeHtml:String,URL});
  for(const name of ['isCurrentStatusReport','renderStatusFeedRows'])vm.runInContext(source.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0],c);
  for(let i=0;i<100;i++)c.renderStatusFeedRows(container,'cyber','<div>Country summary</div>');assert.equal(writes,1);assert.match(html,/wz-status-details/);
  c.__statusFeedItemsCache=[];c.renderStatusFeedRows(container,'cyber','<div>Country summary</div>');assert.equal(writes,2);assert.doesNotMatch(html,/wz-status-details/);
});

test('classification expiry updates the widgets without issuing a provider/API request',()=>{
  let now=Date.now(),renders=0,sequence=0;const timers=new Map();
  class Clock extends Date{static now(){return now;}}
  const c=vm.createContext({Date:Clock,createCountryStatusClassifier,normalizeCountryName:x=>x,countryNameFromCode:x=>x,
    __statusFeedItemsCache:[{id:'fixture',domain:'airspace',country:'India',kind:'advisory',source_url:'https://example.org',published_at:new Date(now).toISOString(),fetched_at:new Date(now).toISOString(),evidence:{confidence:'high',verified:true,authoritative:true,scope:'area',impact:'restricted',effective_until:new Date(now+1000).toISOString()}}],
    isLayerEnabled:()=>true,__lastStatusWidgetSignature:'old',__eventsCache:[],debouncedRenderUI(){renders++;},setTimeout(fn){timers.set(++sequence,fn);return sequence;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext('let __countryStatusClassifier=null,__statusAssessmentExpiryTimer=0,__statusAssessmentExpiryAt=Infinity;'+['scheduleStatusAssessmentExpiry','classifyCountryIntelligence'].map(name=>source.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0]).join('\n'),c);
  assert.equal(c.classifyCountryIntelligence('India','airspace').status,'restricted');assert.equal(timers.size,1);
  now+=1001;const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());assert.equal(renders,1);assert.equal(c.__lastStatusWidgetSignature,null);
  assert.equal(c.classifyCountryIntelligence('India','airspace').status,'unknown');
});
