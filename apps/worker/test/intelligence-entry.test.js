import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8');
const fn=name=>source.match(new RegExp(`function ${name}\\([^]*?\\n}`))?.[0];
function harness(){
  let active=false,flight=false,calls=0,seq=0;const timers=new Map(),enabled=new Set(['cyber','airspace']);
  const c=vm.createContext({document:{body:{classList:{contains:()=>active}}},isRegionTransitionInFlight:()=>flight,shouldSuspendMapWork:()=>false,
    isStratOpsFeatureEnabled:()=>true,isLayerEnabled:id=>enabled.has(id),shouldDeferBackgroundMapWork:()=>false,getRegionRequestBounds:()=>({minLat:0,maxLat:40,minLon:55,maxLon:100}),AbortController,
    api:{getActiveAlerts:async()=>{calls++;return {data:[{id:'alert'}]};},getAirspaceStatuses:async()=>{calls++;return {data:[{id:'airspace'}]};},getStatusFeedItems:async()=>{calls++;return {data:[]};}},
    setTimeout(fn){timers.set(++seq,fn);return seq;},window:{setTimeout(){return 99;},clearTimeout(){}},
    normalizeActiveAlertStatusEvent:x=>x,normalizeAirspaceStatusEvent:x=>x,dedupeStatusEvents:x=>x,debouncedRenderUI(){},console});
  vm.runInContext('let __statusRefreshTimer=0,__statusRefreshPromise=null,__statusFeedNextRefreshAt=0,__statusNextRefreshAt=0,__statusEventsLastLoadedAt=0,__lastStatusWidgetSignature=null,__statusFeedScope="";let __statusEventsCache=[],__statusAlertsCache=[],__statusAirspaceCache=[],__statusFeedItemsCache=[],__eventsCache=[];let __statusFeedUnavailable=false,__statusFeedLoading=false;const STATUS_REQUEST_TIMEOUT_MS=8000;'+
    fn('scheduleStatusRefresh')+'\n'+fn('refreshStatusEvents')+'\nasync '+fn('refreshStatusEventsOnce'),c);
  return {c,enabled,timers,setActive:v=>active=v,setFlight:v=>flight=v,get calls(){return calls;},tick(){const copy=[...timers.values()];timers.clear();copy.forEach(fn=>fn());},async settle(){await new Promise(resolve=>setImmediate(resolve));}};
}
test('status work does not start before entry or during regional flight; repeated triggers share one task',async()=>{
  const h=harness();h.c.scheduleStatusRefresh();h.tick();assert.equal(h.calls,0);
  h.setActive(true);h.setFlight(true);h.c.scheduleStatusRefresh();h.tick();assert.equal(h.calls,0);
  h.setFlight(false);for(let i=0;i<100;i++)h.c.scheduleStatusRefresh();assert.equal(h.timers.size,1);h.tick();await h.settle();assert.equal(h.calls,3);
  h.c.scheduleStatusRefresh();h.tick();await h.settle();assert.equal(h.calls,3,'warm global status data is shared across region changes');
  assert.doesNotMatch(source,/await refreshStatusEvents\(/);
});
test('a failed airspace request does not suppress fresh alerts and retains last valid airspace data',async()=>{
  const h=harness();await h.c.refreshStatusEvents();h.c.api.getActiveAlerts=async()=>({data:[{id:'new-alert'}]});h.c.api.getAirspaceStatuses=async()=>({data:[],error:Error('unavailable')});
  vm.runInContext('__statusNextRefreshAt=0',h.c);const result=await h.c.refreshStatusEvents();assert.deepEqual(Array.from(result,x=>x.id),['new-alert','airspace']);
});
test('region changes refresh scoped notices without repeating warm global alerts requests',async()=>{
  const h=harness();h.setActive(true);h.c.scheduleStatusRefresh();h.tick();await h.settle();assert.equal(h.calls,3);
  h.c.getRegionRequestBounds=()=>({minLat:20,maxLat:30,minLon:60,maxLon:70});h.c.scheduleStatusRefresh();h.tick();await h.settle();assert.equal(h.calls,4,'only the region-scoped feed is requested again');
});
test('disabled status widgets do not request their airspace or status-feed endpoints',async()=>{
  const h=harness();h.enabled.clear();await h.c.refreshStatusEvents();assert.equal(h.calls,1,'sticky alerts still have their independent existing request');
});
test('a pending status request never holds the caller or schedules duplicate work',async()=>{
  const h=harness();h.setActive(true);h.c.api.getActiveAlerts=()=>new Promise(()=>{});assert.equal(h.c.scheduleStatusRefresh(),undefined);h.tick();
  for(let i=0;i<100;i++)h.c.scheduleStatusRefresh();h.tick();assert.equal(h.calls,2);assert.equal(h.timers.size,0);
});
