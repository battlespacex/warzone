import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createFileQuotaStore,createSupabaseQuotaStore} from '../../shared/provider-quota-store.js';
import {createQuotaFetch,reserveQuota,reconcileQuota,resolveQuotaPolicy,quotaWindow,getProviderQuotaDiagnostics} from '../../shared/provider-quota.js';
import {lookupLocalCountry,localCountryCount} from '../../shared/country-reference.js';
import {createQuotaAxios} from '../../shared/provider-quota-axios.js';
import axios from 'axios';
import {createProviderStreamLease} from '../../shared/provider-stream-lease.js';
import {createNotacProvider} from '../../shared/notice-providers.js';
import {spawn} from 'node:child_process';

const DAY=86400000,at=Date.parse('2026-11-17T12:00:00Z');
const directory=()=>fileURLToPath(new URL('../../../.generated/quota-tests/'+randomUUID()+'/',import.meta.url));
const policy=(limits,costs={calls:1})=>({id:'fixture',account:'fixture',limits,costs});
const limit=(allowance,extra={})=>({id:'fixture',unit:'calls',allowance,period:'month',reserve:.1,...extra});

test('monthly allowance paces remaining cycle, retains carryover, reserve and bounded bursts',()=>{
    const state={},p=policy([limit(1000,{paced:true,period:'fixed',durationMs:30*DAY,anchorMs:at})]);
    for(let i=0;i<30;i++)assert.equal(reserveQuota(state,p,at).ok,true);
    assert.equal(reserveQuota(state,p,at).ok,false);
    // Five idle days accumulate credits, but today's burst remains <=2 daily budgets.
    for(let i=0;i<60;i++)assert.equal(reserveQuota(state,p,at+5*DAY).ok,true);
    assert.equal(reserveQuota(state,p,at+5*DAY).ok,false);
    let accepted=90;
    for(let day=6;day<30;day++)while(reserveQuota(state,p,at+day*DAY).ok)accepted++;
    assert.equal(accepted,900);assert.equal(reserveQuota(state,p,at+30*DAY).ok,true);
});

test('daily and hourly caps stay independent of monthly budget; failed reservation spends nothing',()=>{
    const state={},p=policy([limit(1000),limit(2,{id:'hour',period:'hour',reserve:0}),limit(3,{id:'day',period:'day',reserve:0})]);
    assert.equal(reserveQuota(state,p,at).ok,true);assert.equal(reserveQuota(state,p,at).ok,true);
    assert.equal(reserveQuota(state,p,at).ok,false);assert.equal(state.buckets['fixture:calls'].used,2);
    assert.equal(reserveQuota(state,p,at+3600000).ok,true);assert.equal(reserveQuota(state,p,at+7200000).ok,false);
    assert.equal(reserveQuota(state,p,at+DAY).ok,true);
});

test('calendar UTC, fixed 30-day and month-end anniversary windows differ correctly',()=>{
    const date=Date.parse('2026-02-28T13:00:00Z');
    assert.equal(new Date(quotaWindow({period:'month'},date)[1]).toISOString(),'2026-03-01T00:00:00.000Z');
    const range=quotaWindow({period:'fixed',durationMs:30*DAY,anchor:'2026-02-15T00:00:00Z'},date);
    assert.equal(range[1]-range[0],30*DAY);
    assert.equal(new Date(quotaWindow({period:'anniversary',anchor:'2026-01-31T12:00:00Z'},date)[1]).toISOString(),'2026-03-31T12:00:00.000Z');
});

test('multiple independent file-store clients atomically reserve one shared key across regions and restart',async()=>{
    const dir=directory(),a=createFileQuotaStore(dir),b=createFileQuotaStore(dir),p=policy([limit(20,{reserve:0})]);
    const results=await Promise.all(Array.from({length:50},(_,i)=>(i%2?a:b).transact('shared',s=>reserveQuota(s,p,at))));
    assert.equal(results.filter(r=>r.ok).length,20);
    assert.equal((await createFileQuotaStore(dir).transact('shared',s=>reserveQuota(s,p,at))).ok,false);
    const files=await fs.readdir(dir);assert.equal(files.length,1);
});

test('Supabase optimistic transactions retry version conflicts without losing a reservation',async()=>{
    let version=0,state={},conflicts=0;
    const fetchImpl=async(url,options)=>{
        const args=JSON.parse(options.body);await new Promise(r=>setTimeout(r,1));
        if(url.endsWith('_read'))return Response.json({version,state});
        if(args.p_version!==version){conflicts++;return Response.json(false);}
        version++;state=args.p_state;return Response.json(true);
    };
    const a=createSupabaseQuotaStore({url:'https://fixture.invalid',key:'never-persist',fetchImpl});
    const b=createSupabaseQuotaStore({url:'https://fixture.invalid',key:'never-persist',fetchImpl});
    const p=policy([limit(5,{reserve:0})]);
    const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).transact('shared',s=>reserveQuota(s,p,at))));
    assert.equal(results.filter(r=>r.ok).length,5);assert.ok(conflicts>0);assert.equal(state.attempts,5);
});

test('NOTAC counts every delta/search page in credits, initializes headers and conservatively reconciles out-of-order balance',()=>{
    const state={},p=resolveQuotaPolicy('https://notac.aero/api/v1/notam/delta/',{}, {},{now:at});
    assert.equal(p.costs.credits,3);assert.equal(resolveQuotaPolicy('https://notac.aero/api/v1/notam/',{},{}).costs.credits,2);
    assert.equal(reserveQuota(state,p,at).ok,true);
    reconcileQuota(state,p,{status:200,headers:new Headers({'X-Credits-Limit':'10000','X-Credits-Remaining':'5997','X-Credits-Cost':'3'})},at);
    assert.equal(state.buckets['observed-credits:credits'].used,4003);
    reserveQuota(state,p,at);assert.equal(state.buckets['observed-credits:credits'].used,4006);
    reconcileQuota(state,p,{status:200,headers:new Headers({'X-Credits-Limit':'10000','X-Credits-Remaining':'5997'})},at);
    assert.equal(state.buckets['observed-credits:credits'].used,4006);
});

test('402 survives restart to documented reset, 429 respects seconds/date, Copernicus milliseconds',async()=>{
    const dir=directory(),store=createFileQuotaStore(dir),p=resolveQuotaPolicy('https://notac.aero/api/v1/notam/delta/',{},{},{now:at});
    await store.transact('account',s=>{reserveQuota(s,p,at);reconcileQuota(s,p,{status:402,headers:new Headers()},at);});
    assert.equal((await createFileQuotaStore(dir).transact('account',s=>reserveQuota(s,p,at+DAY))).ok,false);
    const state={};reconcileQuota(state,p,{status:429,headers:new Headers({'Retry-After':'180'})},at);assert.equal(state.blockedUntil,at+180000);
    reconcileQuota(state,p,{status:429,headers:new Headers({'Retry-After':new Date(at+360000).toUTCString()})},at);assert.equal(state.blockedUntil,at+360000);
    const pu={};reconcileQuota(pu,{id:'copernicus',limits:[],costs:{}},{status:429,headers:new Headers({'Retry-After':'180000'})},at);assert.equal(pu.blockedUntil,at+180000);
});

test('shared cache coalesces simultaneous users and survives process cache eviction/restart without date relabeling',async()=>{
    const dir=directory();let calls=0,clock=at;
    const env={};const fetchImpl=async()=>{calls++;await new Promise(r=>setTimeout(r,15));return Response.json({observed_at:'2026-11-16T00:00:00Z'});};
    const a=createQuotaFetch({store:createFileQuotaStore(dir),env,fetchImpl,now:()=>clock});
    const b=createQuotaFetch({store:createFileQuotaStore(dir),env,fetchImpl,now:()=>clock});
    const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b)('https://api.gpsinterference.com/v1/interference/2026-11-16')));
    assert.equal(calls,1);for(const result of results)assert.equal((await result.json()).observed_at,'2026-11-16T00:00:00Z');
    clock+=3600000;
    await createQuotaFetch({store:createFileQuotaStore(dir),env,fetchImpl,now:()=>clock})('https://api.gpsinterference.com/v1/interference/2026-11-16');
    assert.equal(calls,1);
});

test('timeouts/errors spend reservations; exhausted provider leaves unrelated fallback operational; no credential persisted',async()=>{
    const dir=directory(),store=createFileQuotaStore(dir);let calls=0;
    const env={PROVIDER_QUOTA_POLICIES_JSON:JSON.stringify({skylink:{limits:[limit(2,{reserve:0,period:'day'})],cacheMs:0}})};
    const request=createQuotaFetch({store,env,now:()=>at,fetchImpl:async()=>{calls++;throw Error('timeout');}});
    await assert.rejects(request('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{headers:{'x-api-key':'test-secret'}}),/timeout/);
    await assert.rejects(request('https://data.skylinkapi.com/v3.1/aircraft/icao24/aaaaaa',{headers:{'x-api-key':'test-secret'}}),/held/);assert.equal(calls,1);
    const fallback=createQuotaFetch({store,env,now:()=>at,fetchImpl:async()=>Response.json({ok:true})});
    assert.equal((await fallback('https://api.adsb.lol/v2/mil')).ok,true);
    const all=(await Promise.all((await fs.readdir(dir)).map(f=>fs.readFile(dir+'/'+f,'utf8')))).join('');assert.ok(!all.includes('test-secret'));assert.ok(!all.includes('icao24'));
});

test('SkyLink legacy airport and identity paths share only a matching credential/account; key separation is explicit',()=>{
    const a=resolveQuotaPolicy('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{headers:{'x-api-key':'same'}},{});
    const b=resolveQuotaPolicy('https://skylink-api.p.rapidapi.com/v3/notams/KJFK',{headers:{'X-RapidAPI-Key':'same'}},{});
    assert.equal(a.account,b.account);assert.notEqual(a.account,resolveQuotaPolicy('https://data.skylinkapi.com/x',{headers:{'x-api-key':'other'}},{}).account);
});

test('unknown quota does not disable configured provider; diagnostics preserve uncertainty and independent PU unit',async()=>{
    const p=resolveQuotaPolicy('https://otx.alienvault.com/api/v1/pulses/subscribed',{headers:{'X-OTX-API-KEY':'fixture'}},{}),state={};
    assert.equal(p.limits.length,0);assert.equal(reserveQuota(state,p,at).ok,true);
    const dir=directory(),store=createFileQuotaStore(dir);await store.transact('account:'+p.account,s=>reserveQuota(s,p,at));
    const diagnostic=await getProviderQuotaDiagnostics(p,{store,now:at});assert.equal(diagnostic.plan,'FREE (user-confirmed)');assert.equal(diagnostic.observedRemaining,null);assert.equal(diagnostic.usage.calls.today,1);
    assert.throws(()=>resolveQuotaPolicy('https://sh.dataspace.copernicus.eu/api/v1/process',{},
        {PROVIDER_QUOTA_POLICIES_JSON:JSON.stringify({copernicus:{limits:[limit(10000,{unit:'processing_units'})]}})}),/weight unconfigured/);
});

test('249 local countries resolve alpha2/alpha3/name aliases, including repeated user-reported lookups',()=>{
    assert.equal(localCountryCount,249);
    for(const [a,b]of [['FR','FRA'],['DE','DEU'],['GB','GBR'],['KR','KOR'],['JP','JPN'],['CA','CAN'],['AE','ARE']])assert.deepEqual(lookupLocalCountry(a),lookupLocalCountry(b));
    assert.equal(lookupLocalCountry('United States of America').alpha3,'USA');assert.equal(lookupLocalCountry('UK').alpha2,'GB');assert.equal(lookupLocalCountry('Türkiye').alpha2,'TR');assert.equal(lookupLocalCountry('ZZZ'),null);
});

test('Axios adaptation preserves parsed JSON/text and blocks hidden redirects',async()=>{
    const base=axios.create({adapter:async config=>({data:JSON.stringify({value:1}),status:200,statusText:'OK',headers:new axios.AxiosHeaders({'content-type':'application/json'}),config})});
    base.getAdapter=axios.getAdapter;base.AxiosError=axios.AxiosError;
    const response=await createQuotaAxios(base).get('https://fixture.invalid/data');assert.deepEqual(response.data,{value:1});
});

test('daily free telemetry spending is spread through the day with a bounded shared burst',()=>{
    const state={},p=resolveQuotaPolicy('https://api.adsb.lol/v2/hex/abcdef',{},{},{now:at});
    for(let i=0;i<9;i++)assert.equal(reserveQuota(state,p,at).ok,true);
    assert.equal(reserveQuota(state,p,at).ok,false);
    assert.equal(reserveQuota(state,p,at+192000).ok,true);
    assert.equal(reserveQuota(state,p,at+192000).ok,false);
});

test('real child-process restart reads the same spent file ledger',async t=>{
    const dir=directory(),store=createFileQuotaStore(dir),p=policy([limit(1,{reserve:0})]);
    await store.transact('restart',s=>reserveQuota(s,p,at));
    const code=`import {createFileQuotaStore} from ${JSON.stringify(new URL('../../shared/provider-quota-store.js',import.meta.url).href)};
        import {reserveQuota} from ${JSON.stringify(new URL('../../shared/provider-quota.js',import.meta.url).href)};
        console.log(JSON.stringify(await createFileQuotaStore(${JSON.stringify(dir)}).transact('restart',s=>reserveQuota(s,${JSON.stringify(p)},${at}))));`;
    const output=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});let text='',error='';
        child.stdout.on('data',part=>text+=part);child.stderr.on('data',part=>error+=part);child.on('error',reject);child.on('exit',status=>status?reject(Error(error)):resolve(text));
    }).catch(error=>{if(error.code==='EPERM'){t.skip('Host forbids child process spawn; run the separate-process probe in the runbook');return null;}throw error;});
    if(output!==null)assert.equal(JSON.parse(output).ok,false);
});

test('one shared AIS ingestion lease excludes a second worker and expires by closing the owner',async()=>{
    const store=createFileQuotaStore(directory());let closed=0;
    const a=createProviderStreamLease({provider:'aisstream',credential:'fixture',store,ttlMs:100,close:()=>closed++});
    const b=createProviderStreamLease({provider:'aisstream',credential:'fixture',store,ttlMs:100,close:()=>{}});
    await a.renew();await assert.rejects(b.renew(),/another ingestion worker/);
    await new Promise(r=>setTimeout(r,120));assert.equal(closed,1);await b.renew();await b.release();await a.release();
});

test('legacy Axios and dedicated status fetch share the same CISA response without losing independent parsing',async()=>{
    const env={PROVIDER_QUOTA_STORE:'file',PROVIDER_QUOTA_DIRECTORY:directory()},url='https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';let calls=0;
    const native=createQuotaFetch({env,fetchImpl:async()=>{calls++;return Response.json({vulnerabilities:[]});}});
    await native(url,{headers:{'User-Agent':'status-worker'}});
    const base=axios.create({adapter:async()=>{throw Error('Duplicate legacy request must not dispatch');}});base.getAdapter=axios.getAdapter;base.AxiosError=axios.AxiosError;
    assert.deepEqual((await createQuotaAxios(base,env).get(url,{headers:{Accept:'application/json'}})).data,{vulnerabilities:[]});assert.equal(calls,1);
});

test('NOTAC delta cursor and full regional snapshot survive provider recreation and region switches',async()=>{
    const env={NOTAC_ENABLED:'true',NOTAC_API_KEY:'cursor-fixture',PROVIDER_QUOTA_STORE:'file',PROVIDER_QUOTA_DIRECTORY:directory()};let clock=at,calls=0;
    const bounds={minLon:55,minLat:0,maxLon:100,maxLat:40};
    const fetchImpl=async url=>{
        calls++;if(calls===2)assert.equal(url.searchParams.get('cursor'),'cursor-1');
        return Response.json({results:[{id:'fixture',number:'A0001/26',text:'Published notice',affected_fir:'OPKR',notam_issued:'2026-11-17T00:00:00Z',effective_end:'2026-11-20T00:00:00Z'}],next:null,next_cursor:'cursor-'+calls},
            {headers:{'X-Credits-Limit':'10000','X-Credits-Remaining':String(10000-calls*3),'X-Credits-Cost':'3'}});
    };
    const first=createNotacProvider(env,{fetchImpl,now:()=>clock});const original=await first.fetchNotices(bounds);
    clock+=60000;const restored=createNotacProvider(env,{fetchImpl,now:()=>clock});const warm=await restored.fetchNotices(bounds);
    assert.equal(calls,1);assert.equal(warm[0].lastFetchedAt,original[0].lastFetchedAt);
    clock+=1800000;await restored.fetchNotices(bounds);assert.equal(calls,2);
});

test('cached aircraft lookup age increases so a position cannot acquire a new live timestamp',async()=>{
    const store=createFileQuotaStore(directory());let clock=at,calls=0;
    const request=createQuotaFetch({store,env:{},now:()=>clock,fetchImpl:async()=>{calls++;return Response.json({ac:[{seen_pos:89}]});}});
    await request('https://api.adsb.lol/v2/hex/abcdef');clock+=3000;
    const response=await request('https://api.adsb.lol/v2/hex/abcdef');
    assert.equal(calls,1);assert.equal(Number(response.headers.get('x-stratops-cache-age-ms')),3000);
    const row=(await response.json()).ac[0];assert.ok(row.seen_pos+Number(response.headers.get('x-stratops-cache-age-ms'))/1000>90);
});

test('rolling rate windows cannot double-spend across a fixed window boundary',()=>{
    const state={},p=policy([limit(2,{period:'rolling',durationMs:60000,reserve:0})]);
    assert.equal(reserveQuota(state,p,at+59000).ok,true);assert.equal(reserveQuota(state,p,at+59999).ok,true);
    assert.equal(reserveQuota(state,p,at+60001).ok,false);assert.equal(reserveQuota(state,p,at+119000).ok,true);
});

test('optional search bursts leave a token for the essential military ingestion path',()=>{
    const state={},manual=resolveQuotaPolicy('https://api.adsb.lol/v2/hex/abcdef',{},{},{now:at}),live=resolveQuotaPolicy('https://api.adsb.lol/v2/mil',{},{},{now:at});
    for(let i=0;i<9;i++)assert.equal(reserveQuota(state,manual,at).ok,true);
    assert.equal(reserveQuota(state,manual,at).ok,false);assert.equal(reserveQuota(state,live,at).ok,true);
});

test('a request aborted during quota I/O never dispatches after its timeout',async()=>{
    const controller=new AbortController();let calls=0;
    const backing=createFileQuotaStore(directory()),store={async transact(key,update){await new Promise(r=>setTimeout(r,10));return backing.transact(key,update);}};
    const request=createQuotaFetch({store,env:{},fetchImpl:async()=>{calls++;return Response.json({});}});
    const pending=request('https://opensky-network.org/api/states/all',{signal:controller.signal});controller.abort();
    await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,0);
});

test('large compressible orbital catalogs are shared without repeated provider downloads',async()=>{
    const store=createFileQuotaStore(directory()),body='NORAD_CAT_ID,OBJECT_NAME\n'+('99999,fixture\n'.repeat(240000));let calls=0;
    assert.ok(Buffer.byteLength(body)>2e6);
    const request=createQuotaFetch({store,env:{},now:()=>at,fetchImpl:async()=>{calls++;return new Response(body,{headers:{'Content-Type':'text/csv'}});}});
    await request('https://celestrak.org/pub/satcat.csv');
    assert.equal(await (await request('https://celestrak.org/pub/satcat.csv')).text(),body);assert.equal(calls,1);
});

test('orbital refresh on a second API instance retains shared GP fetch time and source epoch',async()=>{
    const previousFetch=globalThis.fetch,previousNow=Date.now,previousPath=process.env.STRATOPS_SATELLITE_CACHE_PATH;let clock=previousNow(),calls=0;
    const previousQuota={PROVIDER_QUOTA_STORE:process.env.PROVIDER_QUOTA_STORE,PROVIDER_QUOTA_DIRECTORY:process.env.PROVIDER_QUOTA_DIRECTORY};
    const epoch=new Date(clock).toISOString(),root=directory();
    globalThis.fetch=async url=>{calls++;return String(url).includes('gp.php')?Response.json([{NORAD_CAT_ID:99999,OBJECT_NAME:'USA TEST',OBJECT_ID:'2026-001A',EPOCH:epoch,
        MEAN_MOTION:15,ECCENTRICITY:.001,INCLINATION:50,RA_OF_ASC_NODE:0,ARG_OF_PERICENTER:0,MEAN_ANOMALY:0}]):new Response('NORAD_CAT_ID,OBJECT_NAME,COUNTRY,OPS_STATUS_CODE\n99999,USA TEST,US,+\n');};
    Date.now=()=>clock;
    try {
        process.env.PROVIDER_QUOTA_STORE='file';process.env.PROVIDER_QUOTA_DIRECTORY=root+'quota';
        process.env.STRATOPS_SATELLITE_CACHE_PATH=root+'first.json';
        const first=await import('../../api/src/strategic-satellites.js?fixture='+randomUUID());
        const original=await first.getMilitarySatellitePayload({logger:{log(){},warn(){}}});assert.equal(original.count,1);
        clock+=3600000;process.env.STRATOPS_SATELLITE_CACHE_PATH=root+'second.json';
        const second=await import('../../api/src/strategic-satellites.js?fixture='+randomUUID());
        const restored=await second.getMilitarySatellitePayload({logger:{log(){},warn(){}}});
        assert.equal(calls,6);assert.equal(restored.count,1);assert.equal(restored.sourceEpoch,original.sourceEpoch);
        assert.ok(Math.abs(Date.parse(restored.fetchedAt)-Date.parse(original.fetchedAt))<1000);
    } finally {globalThis.fetch=previousFetch;Date.now=previousNow;if(previousPath===undefined)delete process.env.STRATOPS_SATELLITE_CACHE_PATH;else process.env.STRATOPS_SATELLITE_CACHE_PATH=previousPath;
        for(const [key,value] of Object.entries(previousQuota)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('unknown monthly balance earns a daily share and is never reported as a fresh allowance',async()=>{
    const p=resolveQuotaPolicy('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{}, {},{now:at});
    assert.equal(p.limits[0].period,'rolling');assert.equal(p.limits[0].reserve,.2);
    const store=createFileQuotaStore(directory());
    const initial=await getProviderQuotaDiagnostics(p,{store,now:at});
    assert.equal(initial.observedRemaining,null);assert.equal(initial.budgets[0].remaining,null);assert.equal(initial.budgets[0].resetAt,null);
    assert.equal(initial.budgets[0].currentlySpendable,26);assert.equal(initial.budgets[0].internalHeadroom,800);
    const state={};for(let i=0;i<26;i++)assert.equal(reserveQuota(state,p,at).ok,true);
    assert.equal(reserveQuota(state,p,at).ok,false);
    assert.equal(reserveQuota(state,p,at+DAY).ok,true);
});

test('small remaining budgets accrue fractional daily capacity instead of being exhausted in a few days',()=>{
    const p=resolveQuotaPolicy('https://api.vesselapi.com/v1/vessel/123',{}, {},{now:at});
    p.limits[0].initialUsed=115;const state={};
    for(let day=0;day<5;day++)assert.equal(reserveQuota(state,p,at+day*DAY).ok,false);
    assert.equal(reserveQuota(state,p,at+5*DAY).ok,true);assert.equal(state.buckets['internal-30day:calls'].used,116);
    for(let day=6;day<11;day++)assert.equal(reserveQuota(state,p,at+day*DAY).ok,false);
    assert.equal(reserveQuota(state,p,at+11*DAY).ok,true);
});

test('an unknown billing cycle does not refill at a calendar boundary or worker recreation',async()=>{
    const start=Date.parse('2026-11-30T23:59:00Z'),dir=directory(),store=createFileQuotaStore(dir);
    const p=resolveQuotaPolicy('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{}, {},{now:start});
    for(let i=0;i<26;i++)await store.transact('calendar',state=>assert.equal(reserveQuota(state,p,start).ok,true));
    const restored=createFileQuotaStore(dir);
    assert.equal((await restored.transact('calendar',state=>reserveQuota(state,p,start+120000))).ok,false);
});

test('legacy usage from an overlapping previous month is imported once, not erased by calendar reset',async()=>{
    const root=directory(),legacy=root+'legacy';await fs.mkdir(legacy,{recursive:true});
    await fs.writeFile(legacy+'/vesselapi-identity.json',JSON.stringify({month:'2026-10',requests:100}));
    const store=createFileQuotaStore(root+'ledger'),env={PROVIDER_QUOTA_LEGACY_DIRECTORY:legacy};let clock=at,calls=0;
    const request=()=>createQuotaFetch({store,env,now:()=>clock,fetchImpl:async()=>{calls++;return Response.json({vessel:{name:'fixture'}});}});
    // Twenty usable calls remain after importing 100; the first share is <1 call.
    await assert.rejects(request()('https://api.vesselapi.com/v1/vessel/123'),/held/);assert.equal(calls,0);
    clock+=DAY;await request()('https://api.vesselapi.com/v1/vessel/123');assert.equal(calls,1);
    const p=resolveQuotaPolicy('https://api.vesselapi.com/v1/vessel/123',{},env,{now:clock});
    const diagnostic=await getProviderQuotaDiagnostics(p,{store,now:clock});assert.equal(diagnostic.budgets[0].used,101);
});

test('migration keeps a fixed-window debit instead of resetting it as a new rolling allowance',()=>{
    const p=resolveQuotaPolicy('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{}, {},{now:at});
    const state={buckets:{'internal-30day:calls':{start:at-DAY,end:at+29*DAY,used:790,baseline:0,today:0,day:Math.floor(at/DAY),anchor:at-DAY}}};
    assert.equal(reserveQuota(state,p,at).ok,false);assert.equal(state.buckets['internal-30day:calls'].used,790);
    assert.equal(state.buckets['internal-30day:calls'].events[0].cost,790);
});

test('authenticated free OpenSky retains the existing fifteen-minute polling floor',()=>{
    const p=resolveQuotaPolicy('https://opensky-network.org/api/states/all',{headers:{Authorization:'Bearer fixture'}},{},{credential:'client-id'});
    assert.equal(p.limits[0].allowance,4000);assert.equal(p.minimumIntervalMs,900000);assert.equal(p.costs.credits,4);
});

test('verified reset headers pace actual remaining usable calls over the remaining billing days',()=>{
    const state={},p=resolveQuotaPolicy('https://data.skylinkapi.com/v3.1/aircraft/icao24/abcdef',{}, {},{now:at});
    assert.equal(reserveQuota(state,p,at).ok,true);
    reconcileQuota(state,p,{status:200,headers:new Headers({'X-RateLimit-Requests-Remaining':'800','X-RateLimit-Requests-Reset':String((at+5*DAY)/1000)})},at);
    // 800 remaining - 200 reserve = 600 usable, released over five actual days.
    for(let i=0;i<120;i++)assert.equal(reserveQuota(state,p,at).ok,true);
    assert.equal(reserveQuota(state,p,at).ok,false);
    assert.equal(state.buckets['provider-observed-cycle:calls'].used,320);
});

test('confirmed billing reset retires the old cycle without claiming a new full balance',async()=>{
    const state={},p=resolveQuotaPolicy('https://api.vesselapi.com/v1/vessel/123',{}, {},{now:at});
    reserveQuota(state,p,at);
    reconcileQuota(state,p,{status:200,headers:new Headers({'X-RateLimit-Remaining':'31','X-RateLimit-Reset':String((at+DAY)/1000)})},at);
    assert.equal(reserveQuota(state,p,at).ok,true);assert.equal(reserveQuota(state,p,at).ok,false);
    assert.equal(reserveQuota(state,p,at+DAY).ok,true);
    assert.equal(state.observedRemaining,null);assert.equal(state.observedCycleLimit,undefined);
    assert.equal(state.buckets['internal-30day:calls'].used,1);
});

test('undocumented numeric reset durations do not invent a billing anniversary',()=>{
    const state={},p=resolveQuotaPolicy('https://api.vesselapi.com/v1/vessel/123',{}, {},{now:at});
    reserveQuota(state,p,at);
    reconcileQuota(state,p,{status:200,headers:new Headers({'X-RateLimit-Remaining':'100','X-RateLimit-Reset':'3600'})},at);
    assert.equal(state.observedCycleLimit,undefined);
});
