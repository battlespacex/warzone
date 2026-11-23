// Backend request reservations. Internal safety budgets are not provider entitlements.
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {hostname} from 'node:os';
import path from 'node:path';
import {fingerprint,getQuotaStore} from './provider-quota-store.js';

const DAY=86400000;
export class QuotaHeldError extends Error {
    constructor(reason,retryAt,now=Date.now()) {
        super('Provider request held: '+reason);this.code='QUOTA_HELD';this.status=429;
        this.retryAfterMs=Math.max(1000,(retryAt || now+60000)-now);
    }
}
function number(value) {return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;}
function header(headers,name) {
    if(typeof headers?.get==='function')return headers.get(name);
    return Object.entries(headers || {}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1] ?? null;
}
function responseResetAt(headers,now) {
    const raw=header(headers,'x-credits-reset') ?? header(headers,'x-ratelimit-requests-reset') ?? header(headers,'x-ratelimit-reset');
    const numeric=number(raw),value=numeric!==null?(numeric>1e12?numeric:numeric*1000):Date.parse(raw || '');
    // Only a future absolute timestamp is accepted. A duration with undocumented
    // units is not enough evidence to invent a billing anniversary.
    return Number.isFinite(value)&&value>now?value:null;
}
export function quotaWindow(limit,now) {
    const date=new Date(now),period=limit.period;
    if(period==='month')return [Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1),Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)];
    if(period==='anniversary') {
        const anchor=new Date(limit.anchor);if(!Number.isFinite(anchor.getTime()))throw Error('Quota anniversary requires anchor');
        const at=(year,month)=>Date.UTC(year,month,Math.min(anchor.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate()),anchor.getUTCHours(),anchor.getUTCMinutes(),anchor.getUTCSeconds());
        let year=date.getUTCFullYear(),month=date.getUTCMonth();
        if(at(year,month)>now)month--;
        return [at(year,month),at(year,month+1)];
    }
    const duration=period==='day'?DAY:period==='hour'?3600000:period==='minute'?60000:Number(limit.durationMs);
    if(!(duration>0))throw Error('Unknown quota reset period');
    // Fixed provider billing cycles require an explicit anchor; never infer 30 days for all APIs.
    const anchor=number(limit.anchorMs) ?? (limit.anchor?Date.parse(limit.anchor):0);
    if(!Number.isFinite(anchor))throw Error('Invalid quota cycle anchor');
    const start=anchor+Math.floor((now-anchor)/duration)*duration;
    return [start,start+duration];
}

const calls=(id,allowance,period,extra={})=>({id,unit:'calls',allowance,period,reserve:0,evidence:'existing internal restriction',...extra});
export function resolveQuotaPolicy(input,options={},env=process.env,context={}) {
    const url=new URL(input),host=url.hostname.toLowerCase(),h=options.headers;
    let id=context.provider,cacheMs=0,minimumIntervalMs=0,limits=[],costs={calls:1};
    if(!id) {
        if(host==='notac.aero')id='notac';
        else if(/(?:^|\.)skylinkapi\.com$/.test(host)||host==='skylink-api.p.rapidapi.com')id='skylink';
        else if(/(?:^|\.)vesselapi\.com$/.test(host))id='vesselapi';
        else if(host==='api.adsb.lol')id='adsb_lol';
        else if(host==='opensky-network.org'&&url.pathname.startsWith('/api/'))id='opensky';
        else if(host==='api.airplanes.live')id='airplanes_live';
        else if(/(?:^|\.)restcountries\.com$/.test(host))id='restcountries';
        else if(host==='sh.dataspace.copernicus.eu')id='copernicus';
        else if(host==='celestrak.org'||host==='celestrak.com')id='celestrak';
        else if(host==='gpsinterference.com'||host==='api.gpsinterference.com')id='gnss';
        else if(host==='api.cloudflare.com'&&url.pathname.includes('/radar/'))id='cloudflare';
        else if(host==='otx.alienvault.com')id='otx';
        else if(host==='data.aishub.net')id='aishub';
        else if(host==='firms.modaps.eosdis.nasa.gov')id='firms';
        else if(host==='services.swpc.noaa.gov')id='noaa';
        else if(host==='www.aviationweather.gov'||host==='aviationweather.gov')id='aviationweather';
        else if(host==='nominatim.openstreetmap.org')id='nominatim';
        else if(host==='api.acleddata.com')id='acled';
        else if(host==='api.x.com')id='x';
        else if(host==='api.dvidshub.net')id='dvids';
        else if(host==='api.gdeltproject.org')id='gdelt';
        else if(host==='www.cisa.gov'&&url.pathname.includes('known_exploited'))id='cisa';
        else if(host==='nasstatus.faa.gov')id='faa';
    }
    if(!id&&context.manageUnknown)id='host:'+host;
    if(!id)return null;
    const internalMonthly=(name,budget)=>calls('internal-30day',Number(env[name])||budget,'rolling',{
        durationMs:30*DAY,reserve:.2,paced:true,bootstrap:true,evidence:'internal trailing 30-day budget; actual balance/reset UNKNOWN; user confirms FREE plan'
    });
    if(id==='skylink'){limits=[internalMonthly('SKYLINK_MONTHLY_REQUEST_BUDGET',1000)];cacheMs=3600000;}
    if(id==='vesselapi'){limits=[internalMonthly('VESSELAPI_MONTHLY_REQUEST_BUDGET',150)];cacheMs=7*DAY;}
    if(id==='airplanes_live')limits=[calls('internal-daily',Number(env.AIRPLANES_LIVE_DAILY_BUDGET)||480,'day')];
    if(id==='notac'){limits=[calls('internal-daily',96,'day',{spread:true,burst:12}),
        {id:'published-credits',unit:'credits',allowance:10000,period:'month',reserve:.2,paced:true,evidence:'attached NOTAC FREE beta; documented first UTC reset; remaining balance UNKNOWN until headers'}];costs.credits=url.pathname.includes('/delta')?3:2;cacheMs=1800000;}
    if(id==='adsb_lol') {
        // Current built-in client sends no API key. Unknown custom tiers can override via explicit account policy.
        limits=[calls('anonymous-daily',500,'day',{reserve:.1,spread:true,burst:10,evidence:'attached provider research: anonymous 500/day/IP; account tier unverified'})];
        minimumIntervalMs=url.pathname==='/v2/mil'?Math.ceil(DAY/450):0;
        if(url.pathname!=='/v2/mil')cacheMs=5000;
    }
    if(id==='opensky') {
        costs.credits=4; // conservative maximum for states/all, including all bounding boxes
        const authenticated=Boolean(context.credential&&context.credential!=='anonymous'||env.OPENSKY_CLIENT_ID&&env.OPENSKY_CLIENT_SECRET||header(h,'authorization'));
        limits=[{id:'anonymous-floor',unit:'credits',allowance:authenticated?4000:400,period:'day',reserve:.1,evidence:authenticated?'attached standard authenticated FREE allowance; feeder entitlement UNKNOWN':'attached anonymous FREE allowance'}];
        minimumIntervalMs=authenticated?(Number(env.OPENSKY_MINIMUM_INTERVAL_MS)||900000):Math.ceil(DAY/90);
    }
    if(id==='restcountries'){limits=[internalMonthly('RESTCOUNTRIES_MONTHLY_REQUEST_BUDGET',1000)];cacheMs=3*DAY;}
    if(id==='copernicus') {
        const processing=url.pathname.includes('/process');
        limits=[calls('internal-minute',Number(env.COPERNICUS_MAX_REQUESTS_PER_MINUTE)||20,'minute'),
            calls(processing?'preview-attempts':'catalog-attempts',Number(env[processing?'COPERNICUS_DAILY_EVENT_LIMIT':'COPERNICUS_DAILY_CATALOG_REQUEST_LIMIT'])||(processing?30:120),'day',{endpoint:processing?'process':'catalog'})];
        costs.processing_units=processing?(Number(env.COPERNICUS_MAX_PU_PER_REQUEST)||0):0;
        cacheMs=0;
    }
    if(id==='celestrak'){cacheMs=7200000;minimumIntervalMs=7200000;}
    if(id==='gnss')cacheMs=/\/latest\/?$/.test(url.pathname)?60000:DAY;
    if(id==='aishub')minimumIntervalMs=60000;
    if(id==='cloudflare'){cacheMs=900000;limits=[calls('api-user-burst',1200,'rolling',{durationMs:300000,evidence:'attached Cloudflare global user ceiling; other applications must share account ID'})];}
    if(id==='otx')cacheMs=900000;
    // FIRMS publishes transaction limits; the active endpoint's transaction
    // weight is not verified. Keep existing polling, cache and backoff until
    // an operator supplies the unit/weight instead of inventing request credits.
    if(id==='firms')cacheMs=60000;
    if(id==='cisa')cacheMs=6*3600000;
    if(['faa','gdelt','dvids','noaa','aviationweather'].includes(id))cacheMs=60000;
    if(id==='nominatim'){minimumIntervalMs=1000;cacheMs=7*DAY;}
    let overrides={};
    try {overrides=JSON.parse(env.PROVIDER_QUOTA_POLICIES_JSON || '{}')[id] || {};}
    catch {throw Error('Invalid provider quota policy JSON');}
    // Operator policies are the place for verified plan, billing anchor, weights and account-wide aliases.
    const policy={id,cacheMs,minimumIntervalMs,limits,costs,plan:'FREE (user-confirmed)',...overrides,...context};
    policy.limits=[...new Map([...limits,...(context.limits || []),...(overrides.limits || [])].map(limit=>[limit.id+':'+limit.unit,limit])).values()].map(limit=>{
        const monthly=['month','anniversary'].includes(limit.period)||['fixed','rolling'].includes(limit.period)&&limit.durationMs>=28*DAY;
        const reserve=limit.reserve ?? (monthly ? 0.2 : 0);
        if(monthly&&reserve<.1)throw Error('Monthly quotas require a 10-20 percent reserve');
        return {...limit,reserve};
    });
    const endpointCost=Object.entries(overrides.endpointCosts || {}).filter(([prefix])=>url.pathname.startsWith(prefix)).sort((a,b)=>b[0].length-a[0].length)[0]?.[1];
    policy.costs={...costs,...overrides.costs,...endpointCost,...context.costs};
    if(id==='copernicus'&&!url.pathname.includes('/process'))policy.costs.processing_units=0;
    if(!Array.isArray(policy.limits))throw Error('Quota limits must be an array');
    for(const limit of policy.limits) {
        if(!(Number(limit.allowance)>0)||!(Number(limit.reserve ?? 0)>=0&&Number(limit.reserve ?? 0)<=.2))throw Error('Invalid quota allowance/reserve');
        if(!Object.hasOwn(policy.costs,limit.unit))throw Error('Quota unit requires an explicit request weight');
        quotaWindow(limit,context.now || Date.now());
    }
    const credential=overrides.account || context.credential || (id==='opensky'?env.OPENSKY_CLIENT_ID:null) ||
        (id==='copernicus'?env.COPERNICUS_CLIENT_ID:null) || header(h,'x-api-key') || header(h,'x-rapidapi-key') || header(h,'x-otx-api-key') ||
        header(h,'authorization') || url.searchParams.get('username') || url.searchParams.get('key') || url.searchParams.get('api_key') || env.PROVIDER_QUOTA_EGRESS_ID || 'anonymous';
    policy.account=id+':'+fingerprint(String(credential).replace(/^Bearer\s+/i,'').trim());
    if(id==='celestrak')policy.intervalKey=fingerprint(url.pathname+url.search);
    if(id==='adsb_lol'){policy.intervalKey=url.pathname==='/v2/mil'?'military-ingestion':'manual-lookups';policy.optional=url.pathname!=='/v2/mil';}
    policy.endpoint=url.pathname.includes('/process')?'process':'catalog';
    if(id==='copernicus'&&policy.endpoint==='process'&&policy.limits.some(limit=>limit.unit==='processing_units')&&!(policy.costs.processing_units>0))throw new QuotaHeldError('processing-unit weight unconfigured');
    return policy;
}

function bucketFor(state,limit,now) {
    state.buckets ||= {};
    // Internal rolling windows anchor to first persisted use, not to every request/restart.
    state.anchors ||= {};
    if(limit.id==='internal-30day'&&limit.period==='fixed')limit={...limit,anchorMs:state.anchors[limit.id] ||= now};
    const [start,end]=quotaWindow(limit,now),key=limit.id+':'+limit.unit;
    if(limit.period==='rolling') {
        const bucket=state.buckets[key] ||= {anchor:now,baseline:0,today:0,day:Math.floor(now/DAY),events:[]};
        if(!Array.isArray(bucket.events)) {
            // Retain reservations from the earlier fixed-window implementation;
            // their exact dates are unknown, so conservatively retain them for 30 days.
            bucket.events=bucket.used>0?[{at:now,cost:bucket.used,imported:true}]:[];
            bucket.migratedLegacyCoverage=bucket.used||0;
        }
        if(limit.bootstrap&&bucket.bootstrapAt===undefined){bucket.bootstrapAt=now;bucket.bootstrapPrior=Math.max(Number(limit.initialUsed)||0,bucket.used||0);}
        if(limit.bootstrap&&Number(limit.initialUsed)>0&&!bucket.initialUsageImported) {
            const extra=Math.max(0,Number(limit.initialUsed)-(bucket.used||0));
            if(extra)bucket.events.push({at:now,cost:extra,imported:true});
            bucket.initialUsageImported=true;
        }
        bucket.events=(bucket.events || []).filter(event=>event.at>now-limit.durationMs);
        bucket.used=bucket.events.reduce((total,event)=>total+event.cost,0);bucket.start=now-limit.durationMs;
        bucket.end=bucket.events.length?bucket.events[0].at+limit.durationMs:now+limit.durationMs;
        if(bucket.day!==Math.floor(now/DAY)){bucket.day=Math.floor(now/DAY);bucket.today=0;}
        return bucket;
    }
    if(!state.buckets[key]||state.buckets[key].start!==start)state.buckets[key]={start,end,used:Number(limit.initialUsed)||0,anchor:now,baseline:Number(limit.initialUsed)||0,today:0,day:Math.floor(now/DAY)};
    const bucket=state.buckets[key];
    if(bucket.day!==Math.floor(now/DAY)){bucket.day=Math.floor(now/DAY);bucket.today=0;}
    return bucket;
}

function effectiveLimits(state,policy,now) {
    const cycle=state.observedCycleLimit;
    if(cycle&&now>=cycle.anchorMs+cycle.durationMs) {
        const reset=cycle.anchorMs+cycle.durationMs,bucket=state.buckets?.['internal-30day:'+cycle.unit];
        if(bucket?.events) {
            bucket.events=bucket.events.filter(event=>event.at>=reset);
            bucket.bootstrapAt=reset;bucket.bootstrapPrior=0;
        }
        state.lastConfirmedReset=reset;state.observedRemaining=null;delete state.observedCycleLimit;
    }
    const observed=state.observedCycleLimit;
    return [...policy.limits.filter(limit=>!(observed&&limit.id==='internal-30day'&&limit.unit===observed.unit)),
        ...(state.observedLimit?[state.observedLimit]:[]),...(observed?[observed]:[])];
}

export function reserveQuota(state,policy,now) {
    if(state.blockedUntil>now)return {ok:false,reason:state.reason || 'provider backoff',retryAt:state.blockedUntil};
    const checks=[];
    for(const limit of effectiveLimits(state,policy,now)) {
        if(limit.endpoint&&limit.endpoint!==policy.endpoint)continue;
        const cost=Number(policy.costs[limit.unit] || 0);
        if(cost<0||!Number.isFinite(cost))throw Error('Invalid quota cost');
        if(!cost)continue;
        const bucket=bucketFor(state,limit,now),usable=Math.floor(limit.allowance*(1-(limit.reserve || 0)));
        let ceiling=usable;
        if(limit.bootstrap) {
            // Missing history is UNKNOWN. Earn only one day's conservative
            // spending capacity initially; never expose the full allowance as a balance.
            const warming=now-bucket.bootstrapAt<limit.durationMs;
            const prior=warming?(bucket.bootstrapPrior||0):0;
            const daily=Math.max(0,usable-prior)/(limit.durationMs/DAY);
            ceiling=warming?Math.min(usable,prior+Math.floor(daily*(Math.floor((now-bucket.bootstrapAt)/DAY)+1))):usable;
            if(bucket.today+cost>Math.max(cost,Math.ceil(daily*2)))return {ok:false,reason:'daily burst budget',retryAt:(Math.floor(now/DAY)+1)*DAY};
        } else if(limit.paced) {
            const days=Math.max(1,Math.ceil((bucket.end-bucket.anchor)/DAY));
            const daily=Math.max(0,usable-bucket.baseline)/days;
            const elapsed=Math.floor((now-bucket.anchor)/DAY)+1;
            ceiling=Math.min(usable,bucket.baseline+Math.floor(daily*elapsed));
            if(bucket.today+cost>Math.max(cost,Math.ceil(daily*2)))return {ok:false,reason:'daily burst budget',retryAt:(Math.floor(now/DAY)+1)*DAY};
        }
        if(bucket.used+cost>ceiling)return {ok:false,reason:limit.paced?'paced '+limit.unit:'limit '+limit.unit,retryAt:limit.bootstrap?Math.min(bucket.end,bucket.bootstrapAt+(Math.floor((now-bucket.bootstrapAt)/DAY)+1)*DAY):limit.paced?Math.min(bucket.end,bucket.anchor+(Math.floor((now-bucket.anchor)/DAY)+1)*DAY):bucket.end};
        if(limit.spread) {
            const burst=Math.max(cost,Number(limit.burst)||cost),rate=usable/(bucket.end-bucket.start);
            bucket.tokens=Math.min(burst,(bucket.tokens ?? burst)+Math.max(0,now-(bucket.tokenAt ?? now))*rate);bucket.tokenAt=now;
            const required=cost+(policy.optional?1:0);
            if(bucket.tokens<required)return {ok:false,reason:'distributed '+limit.unit,retryAt:now+Math.ceil((required-bucket.tokens)/rate)};
        }
        checks.push([bucket,cost]);
    }
    state.nextByEndpoint ||= {};
    const endpointKey=policy.intervalKey || 'account';
    const authenticationRetry=policy.authenticationRetry&&state.lastStatus===401&&!state.authRetryUsed;
    if(state.nextByEndpoint[endpointKey]>now&&!authenticationRetry)return {ok:false,reason:'shared interval',retryAt:state.nextByEndpoint[endpointKey]};
    if(authenticationRetry)state.authRetryUsed=true;
    for(const [bucket,cost]of checks){bucket.used+=cost;bucket.today+=cost;if(bucket.events)bucket.events.push({at:now,cost});if(bucket.tokens!==undefined)bucket.tokens-=cost;}
    if(policy.minimumIntervalMs)state.nextByEndpoint[endpointKey]=now+policy.minimumIntervalMs;
    state.attempts=(state.attempts || 0)+1;state.lastAttemptAt=now;state.plan=policy.plan;
    state.units ||= {};
    for(const [unit,cost]of Object.entries(policy.costs)) {
        if(!Number.isFinite(Number(cost))||cost<0)throw Error('Invalid quota cost');
        const day=new Date(now).toISOString().slice(0,10),month=day.slice(0,7),usage=state.units[unit] ||= {};
        if(usage.day!==day){usage.day=day;usage.today=0;}if(usage.month!==month){usage.month=month;usage.thisMonth=0;}
        usage.today+=Number(cost);usage.thisMonth+=Number(cost);
    }
    state.lastCost=policy.costs;state.lastDecision='reserved';
    return {ok:true};
}

export function reconcileQuota(state,policy,response,now) {
    const status=Number(response.status),remaining=number(header(response.headers,policy.id==='notac'?'x-credits-remaining':'x-ratelimit-requests-remaining') ?? header(response.headers,'x-ratelimit-remaining') ?? header(response.headers,'x-rate-limit-remaining'));
    const reportedLimit=number(header(response.headers,'x-credits-limit'));
    if(policy.id==='notac'&&reportedLimit>0)state.observedLimit={id:'observed-credits',unit:'credits',allowance:reportedLimit,period:'month',reserve:.2,paced:true,evidence:'X-Credits-Limit; attached NOTAC first UTC reset'};
    if(state.observedLimit) {
        const bucket=bucketFor(state,state.observedLimit,now);
        const cost=number(header(response.headers,'x-credits-cost')) ?? policy.costs.credits ?? 0;
        // Every attempt was reserved before dispatch; this also initializes usage already spent outside this process.
        if(remaining!==null){const extra=Math.max(0,state.observedLimit.allowance-remaining-bucket.used);bucket.used+=extra;if(bucket.balanceInitialized)bucket.baseline+=extra;}
        else bucket.used+=Math.max(0,cost-(policy.costs.credits || 0));
        if(!bucket.balanceInitialized){bucket.baseline=Math.max(0,bucket.used-cost);bucket.anchor=now;bucket.balanceInitialized=true;}
        state.lastObservedAt=now;
    }
    if(remaining!==null&&policy.id!=='notac')for(const limit of policy.limits) {
        // Only bind headers whose unit/window is known to the integration.
        if(['skylink','vesselapi'].includes(policy.id)&&limit.unit==='calls'&&limit.id==='internal-30day') {
            const bucket=bucketFor(state,limit,now),extra=Math.max(0,limit.allowance-remaining-bucket.used);
            if(extra&&bucket.events)bucket.events.push({at:now,cost:extra,imported:true});
            bucket.used+=extra;if(limit.bootstrap)bucket.bootstrapPrior=(bucket.bootstrapPrior||0)+extra;
        }
    }
    if(['skylink','vesselapi'].includes(policy.id)&&remaining!==null) {
        const configured=policy.limits.find(limit=>limit.id==='internal-30day'&&limit.unit==='calls');
        const reset=responseResetAt(response.headers,now);
        if(configured&&reset) {
            const current=state.observedCycleLimit;
            if(!current||current.anchorMs+current.durationMs!==reset)state.observedCycleLimit={
                id:'provider-observed-cycle',unit:'calls',allowance:configured.allowance,period:'fixed',
                anchorMs:now,durationMs:reset-now,reserve:configured.reserve,paced:true,
                initialUsed:Math.max(0,configured.allowance-remaining),evidence:'absolute reset and remaining response headers; configured FREE allowance'
            };
            const bucket=bucketFor(state,state.observedCycleLimit,now),extra=Math.max(0,configured.allowance-remaining-bucket.used);
            bucket.used+=extra;if(bucket.balanceInitialized)bucket.baseline+=extra;
            else {bucket.baseline=bucket.used;bucket.anchor=now;bucket.balanceInitialized=true;}
        }
    }
    state.lastStatus=status;state.observedRemaining=remaining;state.lastResponseAt=now;
    if(status>=200&&status<300){state.lastSuccessAt=now;state.authFailures=0;state.authRetryUsed=false;}
    if(status===401)state.authFailures=(state.authFailures || 0)+1;
    const pu=number(header(response.headers,'x-processingunits-spent'));
    if(pu!==null&&policy.id==='copernicus') {
        state.lastProcessingUnits=pu;
        const extra=Math.max(0,pu-(policy.costs.processing_units || 0));
        for(const limit of policy.limits.filter(limit=>limit.unit==='processing_units'))bucketFor(state,limit,now).used+=extra;
        if(extra&&state.units?.processing_units){state.units.processing_units.today+=extra;state.units.processing_units.thisMonth+=extra;}
    }
    if(remaining===0&&['notac','opensky','adsb_lol'].includes(policy.id)) {
        state.blockedUntil=policy.id==='notac'?quotaWindow({period:'month'},now)[1]:quotaWindow({period:'day'},now)[1];
        state.reason='provider-reported zero balance';
    }
    const refreshable401=status===401&&['opensky','copernicus'].includes(policy.id)&&state.authFailures===1;
    if(status===402||status===429||status===401&&!refreshable401||status===403||status>=500) {
        const raw=header(response.headers,'retry-after') ?? header(response.headers,'x-rate-limit-retry-after-seconds'),numeric=number(raw);
        const retry=numeric!==null?now+numeric*(policy.id==='copernicus'?1:1000):Date.parse(raw || '');
        let until=now+([401,403].includes(status)?DAY:60000);
        if(status===402) {
            const ends=Object.values(state.buckets || {}).map(b=>b.end).filter(end=>end>now);
            // NOTAC reset is documented; unknown exhaustion never gets an invented 30-day reset.
            until=policy.id==='notac'?quotaWindow({period:'month'},now)[1]:ends.length?Math.max(...ends):now+DAY;
            const resetAt=responseResetAt(response.headers,now);if(resetAt)until=resetAt;
        }
        state.blockedUntil=Math.max(state.blockedUntil || 0,until,Number.isFinite(retry)?retry:0);
        state.reason='HTTP '+status;
        if(status===402||status===429)state.lastQuotaErrorAt=now;
    }
}

function cachedResponse(cached,now) {
    const stored=Buffer.from(cached.body,'base64'),bytes=cached.encoding==='gzip'?gunzipSync(stored,{maxOutputLength:16*1024*1024}):stored;
    return new Response(bytes,{status:cached.status,headers:{...cached.headers,'x-stratops-cache-age-ms':String(Math.max(0,now-cached.fetchedAt))}});
}

export function createQuotaFetch({env=process.env,store,fetchImpl=globalThis.fetch,now=Date.now,context={}}={}) {
    return async function quotaFetch(input,options={}) {
        options.signal?.throwIfAborted?.();
        const at=now(),policy=resolveQuotaPolicy(input,options,env,{...context,now:at});
        if(!policy)return fetchImpl(input,options);
        const storage=store || getQuotaStore(env),account='account:'+policy.account;
        // No raw URL, token, request body or Authorization value is persisted as a key.
        const accept=['cisa','faa'].includes(policy.id)?'static-publication':header(options.headers,'accept');
        const requestKey='response:'+policy.account+':'+fingerprint([String(input),options.method || 'GET',String(options.body || ''),accept].join('|'));
        const owner=randomUUID();let leased=false;
        const cacheable=policy.cacheMs>0&&(!options.method||options.method==='GET');
        if(cacheable) {
            for(let attempt=0;attempt<40;attempt++) {
                const decision=await storage.transact(requestKey,state=>{
                    if(state.cached?.until>now())return {cached:state.cached};
                    if(state.owner&&state.leaseUntil>now())return {wait:true};
                    state.owner=owner;state.leaseUntil=now()+90000;return {acquired:true};
                });
                if(decision.cached){await storage.transact(account,state=>{state.cacheHits=(state.cacheHits || 0)+1;});return cachedResponse(decision.cached,now());}
                if(decision.acquired){leased=true;break;}
                await new Promise(resolve=>setTimeout(resolve,50));
            }
            if(!leased)throw new QuotaHeldError('shared request in flight',now()+1000,now());
        }
        try {
            // Migrate the existing per-checkout internal counters before either
            // SkyLink endpoint family can open a new shared ledger. Never read credentials.
            if(['skylink','vesselapi'].includes(policy.id)) {
                const filename=policy.id==='skylink'?'skylink-aircraft-identity.json':'vesselapi-identity.json';
                let previous=null;
                const legacyDirectory=env.PROVIDER_QUOTA_LEGACY_DIRECTORY ?? process.env.PROVIDER_QUOTA_LEGACY_DIRECTORY;
                const legacyFile=legacyDirectory?path.join(legacyDirectory,filename):new URL('../worker/.cache/'+filename,import.meta.url);
                try{previous=JSON.parse(await fs.readFile(legacyFile,'utf8'));}
                catch(error){if(error.code!=='ENOENT')throw Error('Existing quota state unreadable; request held');}
                const month=String(previous?.month||''),year=Number(month.slice(0,4)),monthIndex=Number(month.slice(5,7))-1;
                if(/^\d{4}-\d{2}$/.test(month)&&monthIndex>=0&&monthIndex<12&&Date.UTC(year,monthIndex,1)<=now()&&Date.UTC(year,monthIndex+1,1)>now()-30*DAY) {
                    await storage.transact(account,state=>{
                        state.importedLegacy ||= {};
                        const source=fingerprint(hostname()+':'+filename+':'+month);
                        if(state.importedLegacy[source])return;
                        const count=Math.max(0,Number(previous.requests)||0);
                        for(const limit of policy.limits.filter(limit=>limit.id==='internal-30day'&&limit.bootstrap)) {
                            const bucket=bucketFor(state,limit,now());
                            const covered=Math.min(count,bucket.migratedLegacyCoverage||0),extra=count-covered;
                            bucket.migratedLegacyCoverage=Math.max(0,(bucket.migratedLegacyCoverage||0)-covered);
                            if(extra){bucket.events.push({at:now(),cost:extra,imported:true});bucket.used+=extra;bucket.bootstrapPrior+=extra;}
                        }
                        state.importedLegacy[source]={count,importedAt:now()};
                    });
                }
            }
            const reservation=await storage.transact(account,state=>reserveQuota(state,policy,now()));
            if(!reservation.ok) {
                await storage.transact(account,state=>{state.lastDecision=reservation.reason;state.nextRetryAt=reservation.retryAt;});
                throw new QuotaHeldError(reservation.reason,reservation.retryAt,now());
            }
            // Redirects must not create unreserved paid requests. Provider clients handle any authorized URL explicitly.
            options.signal?.throwIfAborted?.();
            const response=await fetchImpl(input,{...options,redirect:policy.id.startsWith('host:')?(options.redirect || 'follow'):'error'});
            await storage.transact(account,state=>reconcileQuota(state,policy,response,now()));
            if(cacheable&&response.ok&&response.clone) {
                const length=number(header(response.headers,'content-length'));
                if(length===null||length<=16*1024*1024) {
                    const bytes=Buffer.from(await response.clone().arrayBuffer());
                    if(bytes.length<=16*1024*1024){
                        const compressed=gzipSync(bytes);
                        if(compressed.length<=2e6)await storage.transact(requestKey,state=>{
                            if(state.owner===owner)state.cached={body:compressed.toString('base64'),encoding:'gzip',status:response.status,headers:{'content-type':header(response.headers,'content-type') || 'application/json'},fetchedAt:now(),until:now()+policy.cacheMs};
                        });
                    }
                }
            }
            return response;
        } catch(error) {
            if(error.code!=='QUOTA_HELD')await storage.transact(account,state=>{
                state.networkErrors=(state.networkErrors || 0)+1;
                state.blockedUntil=Math.max(state.blockedUntil || 0,now()+60000);state.reason='request/store error';
            });
            throw error;
        } finally {
            if(leased)await storage.transact(requestKey,state=>{if(state.owner===owner){delete state.owner;delete state.leaseUntil;}});
        }
    };
}

export async function getProviderQuotaDiagnostics(policy,{store=getQuotaStore(),now=Date.now()}={}) {
    return store.transact('account:'+policy.account,state=>{
        const limits=effectiveLimits(state,policy,now);
        return {provider:policy.id,plan:state.plan || policy.plan,
        attempts:state.attempts || 0,lastCost:state.lastCost,lastStatus:state.lastStatus,lastQuotaErrorAt:state.lastQuotaErrorAt,
        lastSuccessAt:state.lastSuccessAt,usage:state.units,cacheHits:state.cacheHits || 0,cacheHitPercent:100*(state.cacheHits || 0)/Math.max(1,(state.cacheHits || 0)+(state.attempts || 0)),
        decision:state.lastDecision,blockedUntil:state.blockedUntil,nextRetryAt:state.nextRetryAt,observedRemaining:state.observedRemaining ?? null,
        budgets:limits.map(limit=>{
            const bucket=bucketFor(state,limit,now),remaining=Math.max(0,Math.floor(limit.allowance*(1-(limit.reserve || 0)))-bucket.used);
            const warming=limit.bootstrap&&now-bucket.bootstrapAt<limit.durationMs;
            const prior=warming?(bucket.bootstrapPrior||0):0;
            const usable=Math.floor(limit.allowance*(1-(limit.reserve||0)));
            const daily=limit.bootstrap?Math.max(0,usable-prior)/(limit.durationMs/DAY):limit.paced?Math.max(0,usable-bucket.baseline)/Math.max(1,Math.ceil((bucket.end-bucket.anchor)/DAY)):null;
            const capacity=limit.bootstrap?(warming?prior+Math.floor(daily*(Math.floor((now-bucket.bootstrapAt)/DAY)+1)):usable):limit.paced?bucket.baseline+Math.floor(daily*(Math.floor((now-bucket.anchor)/DAY)+1)):usable;
            const spendable=daily===null?remaining:Math.max(0,Math.min(remaining,capacity-bucket.used,Math.max(Number(policy.costs[limit.unit])||0,Math.ceil(daily*2))-bucket.today));
            const balanceUnit=policy.id==='notac'||policy.id==='opensky'?'credits':['skylink','vesselapi','adsb_lol'].includes(policy.id)?'calls':null;
            const providerRemaining=balanceUnit===limit.unit?(state.observedRemaining ?? null):null;
            return {id:limit.id,unit:limit.unit,allowance:limit.allowance,reserve:limit.reserve,evidence:limit.evidence,used:bucket.used,today:bucket.today,
                remaining:providerRemaining,providerBalanceObservedAt:providerRemaining===null?null:state.lastResponseAt,internalHeadroom:remaining,currentlySpendable:spendable,
                history:limit.bootstrap?'PARTIAL; pre-ledger/account history UNKNOWN':'recorded reservations; external account usage may require headers',
                resetAt:limit.bootstrap?null:new Date(bucket.end).toISOString(),nextBudgetReleaseAt:new Date(limit.bootstrap?Math.min(bucket.end,bucket.bootstrapAt+(Math.floor((now-bucket.bootstrapAt)/DAY)+1)*DAY):bucket.end).toISOString(),
                forecastPerDay:daily ?? remaining/Math.max(1,(bucket.end-now)/DAY),
                forecastDaysToExhaustion:!limit.bootstrap&&bucket.used>bucket.baseline?remaining/((bucket.used-bucket.baseline)/Math.max(1,(now-bucket.anchor)/DAY)):null};
        })};
    });
}
