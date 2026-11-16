import express from 'express';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import WebSocket from 'ws';
import {normalizeNotice,noticeStatus,intersectsBounds,correlateObservation,matchesNoticeLayers,NOTICE_LAYERS} from '../../shared/geospatial-notices.js';
import {assessStatusSignal} from '../../shared/status-signal-policy.js';
import {createSkySpyClient} from '../../shared/skyspy-client.js';
import {createSkySpyStream} from '../../shared/skyspy-stream.js';
import {skySpyNotice,createOfficialNoticeAdapter,createCommercialNoticeProviders,deduplicateNotices} from '../../shared/notice-providers.js';

export function createNoticeService({env=process.env,readFile=fs.readFile,now=Date.now,skyspy,providers=createCommercialNoticeProviders(env,{now}),createWebSocket=(url,protocols)=>new WebSocket(url,protocols,{maxPayload:1e6,handshakeTimeout:15000})}={}) {
    const enabled=env.NOTICES_ENABLED==='true'||env.NOTICES_ENABLED==null&&env.NOTAC_ENABLED==='true';
    const client=skyspy||createSkySpyClient({enabled:env.SKYSPY_ENABLED==='true'&&env.SKYSPY_NOTAMS_ENABLED==='true',usageApproved:env.SKYSPY_USAGE_APPROVED==='true',
        baseUrl:env.SKYSPY_BASE_URL,apiKey:env.SKYSPY_API_KEY,allowedHosts:String(env.SKYSPY_ALLOWED_HOSTS||'').split(',')});
    let rows=[],pending=null,until=0,lastScope='',disposed=false,streamStarted=false,streamDirty=false,health={enabled,import:'not configured',skyspy:'disabled',rejected:0,lastSuccess:null};
    const streamed=new Map(),families=new Map();let imported=[],canonicalRows=null;
    const configured=()=>enabled&&Boolean((env.NOTICES_IMPORT_FILE&&env.NOTICES_IMPORT_USAGE_APPROVED==='true')||(env.SKYSPY_ENABLED==='true'&&env.SKYSPY_NOTAMS_ENABLED==='true'&&env.SKYSPY_USAGE_APPROVED==='true')||providers.some(p=>p.diagnostics().availableForUse));
    const stream=createSkySpyStream({enabled:env.NOTICES_ENABLED==='true'&&env.SKYSPY_ENABLED==='true'&&env.SKYSPY_NOTAMS_ENABLED==='true'&&env.SKYSPY_STREAM_ENABLED==='true',
        usageApproved:env.SKYSPY_USAGE_APPROVED==='true',baseUrl:env.SKYSPY_BASE_URL,allowedHosts:String(env.SKYSPY_ALLOWED_HOSTS||'').split(','),
        token:env.SKYSPY_API_KEY,transport:'native',topics:['notams'],createWebSocket,now,onEvent(type,data){streamDirty=true;canonicalRows=null;
            for(const input of (Array.isArray(data?.notams)?data.notams:[data]).slice(0,200))try{const row=skySpyNotice(input,now());streamed.set(row.id,row);}catch{health.rejected++;}
            while(streamed.size>500)streamed.delete(streamed.keys().next().value);}});
    async function refresh(query={}) {
        if(!enabled||disposed)return;
        if(!streamStarted){streamStarted=true;stream.start();}
        const scope=env.NOTAC_ENABLED==='true'?JSON.stringify(['minLon','minLat','maxLon','maxLat'].map(k=>query[k])):'global';
        if(now()<until&&scope===lastScope)return currentRows();if(pending){await pending;return refresh(query);}
        pending=(async()=>{const next=[];let rejected=0,success=false;
            if(env.NOTICES_IMPORT_FILE&&env.NOTICES_IMPORT_USAGE_APPROVED==='true')try{
                const bytes=await readFile(env.NOTICES_IMPORT_FILE);if(bytes.length>5e6)throw Error();
                const data=JSON.parse(bytes.toString());if(!Array.isArray(data)||data.length>5000)throw Error();
                const parsed=[];for(const row of data)try{parsed.push(normalizeNotice(row,now()));}catch{rejected++;}if(data.length&&!parsed.length)throw Error('Import validation failed');imported=parsed;next.push(...imported);health.import='loaded';success=true;
            }catch{health.import='unavailable';next.push(...imported);}
            if(env.SKYSPY_ENABLED==='true'&&env.SKYSPY_NOTAMS_ENABLED==='true')try{
                let retrieved=0;
                for(const path of ['/notams/','/notams/tfrs/','/aviation/airspace/'])try{
                    const payload=await client.get(path,path==='/notams/'?{limit:200,active_only:false}:{}),items=Array.isArray(payload)?payload:payload.results||payload.notams||payload.airspace;
                    if(!Array.isArray(items))throw Error('Unverified deployed notice schema');
                    const normalized=[];for(const row of items.slice(0,200))try{normalized.push(skySpyNotice(row,now()));}catch{rejected++;}if(items.length&&!normalized.length)throw Error('Unverified provider schema');families.set(path,normalized);next.push(...normalized);retrieved++;
                }catch{next.push(...(families.get(path)||[]));}
                if(!retrieved)throw Error('No accessible notice family');health.skyspy='retrieved';success=true;
            }catch{health.skyspy='unavailable or unapproved';next.push(...rows.filter(n=>n.provider==='skyspy'));}
            for(const provider of providers)if(provider.diagnostics().availableForUse)try{
                const records=await provider.fetchNotices(query);families.set(provider.id,records);next.push(...records);success=true;
            }catch{next.push(...(families.get(provider.id)||[]));}
            const values=deduplicateNotices([...next,...streamed.values()]);
            if(disposed)return;rows=values.slice(0,5000);canonicalRows=streamed.size?null:rows;lastScope=scope;health.rejected=rejected;if(success)health.lastSuccess=new Date(now()).toISOString();health.streamDirty=streamDirty;streamDirty=false;until=now()+60000;
            health.state=!configured()?'unconfigured':success?'ready':rows.length?'stale':'unavailable';
            return currentRows();
        })().finally(()=>pending=null);return pending;
    }
    function currentRows(){return canonicalRows ||= deduplicateNotices([...rows,...streamed.values()]);}
    return {async list(query={}){const snapshot=await refresh(query);let values=(disposed?[]:snapshot || currentRows()).map(n=>({...n,status:noticeStatus(n,now())}));
        if(health.state==='unavailable'){const error=Error('Notice providers unavailable');const statuses=providers.map(p=>p.diagnostics().lastStatus).filter(Boolean);error.status=statuses.length===1?statuses[0]:503;throw error;}
        if(query.layers){const layers=String(query.layers).split(',');if(layers.some(id=>!NOTICE_LAYERS.includes(id)))throw Object.assign(Error('Invalid notice layer'),{status:400});values=values.filter(n=>matchesNoticeLayers(n,layers));}
        if(query.status==='all'){}else if(['active','upcoming','expired','cancelled','superseded','unknown'].includes(query.status))values=values.filter(n=>n.status===query.status);
        else values=values.filter(n=>['active','upcoming','unknown'].includes(n.status));
        if(query.military!=='all')values=values.filter(n=>n.isMilitaryRelated);
        if(query.type)values=values.filter(n=>n.noticeType===query.type);
        if(['minLat','maxLat','minLon','maxLon'].some(k=>query[k]!=null)){
            const bounds=Object.fromEntries(['minLat','maxLat','minLon','maxLon'].map(k=>[k,Number(query[k])]));
            if(!Object.values(bounds).every(Number.isFinite)||bounds.minLat>bounds.maxLat||bounds.minLat< -90||bounds.maxLat>90||Math.abs(bounds.minLon)>180||Math.abs(bounds.maxLon)>180)throw Object.assign(Error('Invalid bounds'),{status:400});
            values=values.filter(n=>intersectsBounds(n,bounds));}
        const offset=Math.max(0,Math.floor(Number(query.offset)||0)),limit=Math.max(1,Math.min(200,Math.floor(Number(query.limit)||100)));
        return {state:health.state||'unconfigured',partial:providers.some(p=>p.diagnostics().partial),notices:values.slice(offset,offset+limit),total:values.length,offset,providers:{...health,commercial:providers.map(p=>({id:p.id,...p.diagnostics()})),skyspyHealth:{...client.diagnostics(),licensing:env.SKYSPY_USAGE_APPROVED==='true'?'approved':'unapproved',authentication:env.SKYSPY_API_KEY?'configured; not live verified':'unconfigured/public mode',coverage:'Configured service scope; not global coverage'},stream:stream.diagnostics(),
            aai:createOfficialNoticeAdapter('aai').diagnostics(),navareaIX:createOfficialNoticeAdapter('navareaIX').diagnostics()},
            active:values.filter(n=>n.status==='active').length,geolocated:values.filter(n=>n.geometry).length,nonGeolocated:values.filter(n=>!n.geometry).length};},
        async correlate(observation){await refresh();return currentRows().filter(n=>containsCandidate(n,observation)).slice(0,50).map(n=>correlateObservation(n,observation,now()));},
        dispose(){disposed=true;stream.stop();streamed.clear();families.clear();rows=[];canonicalRows=null;until=0;}};
}
function containsCandidate(n,o){return n.geometry&&Number.isFinite(o.longitude)&&Number.isFinite(o.latitude)&&intersectsBounds(n,{minLat:o.latitude,maxLat:o.latitude,minLon:o.longitude,maxLon:o.longitude});}
let sharedNoticeService;
export function getSharedNoticeService(){return sharedNoticeService ||= createNoticeService();}
export function toNoticeStatusSignals(notices=[]){return notices.filter(n=>['active','upcoming','unknown'].includes(n.status)).map(n=>{
    const text=String(n.rawText||n.summary||'').toUpperCase(),area=['Polygon','MultiPolygon'].includes(n.geometry?.type);
    const published=['published','verified'].includes(n.provenance?.verification)&&Boolean(n.issuer);
    const affirmative=!/\b(?:NOT|CANCELLED|CANCELED|WITHDRAWN|RESUMED)\b/.test(text);
    const impact=area&&affirmative&&/\bAIRSPACE(?: IS| WILL BE)? (?:CLSD|CLOSED)\b/.test(text)?'partial':
        area&&affirmative&&/\b(?:(?:TEMPORARY )?(?:RESTRICTED|PROHIBITED) AREA (?:ACTIVATED|ACTIVE|ESTABLISHED)|AIRSPACE RESTRICTIONS? (?:IN FORCE|IN EFFECT))\b/.test(text)?'restricted':
        area&&affirmative&&/\b(?:VOLCANIC ASH|RADIOACTIVE CLOUD|AVIATION HAZARD) (?:OBSERVED|REPORTED|PRESENT|CONFIRMED)\b/.test(text)?'hazardous':'advisory';
    const item={
    id:'notice:'+n.id,domain:'airspace',kind:'published_notice',status:'reported',notice_status:n.status,stale:false,
    title:n.title,summary:n.summary || n.rawText,source_name:n.provider,source_url:n.sourceUrl,country:n.country || null,
    published_at:n.issuedAt,fetched_at:n.lastFetchedAt,coverage:[n.fir,n.region,n.geometryAccuracy].filter(Boolean).join(' | ') || 'Published notice scope',
    effective_from:n.effectiveFrom,effective_until:n.effectiveUntil,
    evidence:{scope:area?'area':'unknown',authoritative:published,verified:published,confidence:published?'high':'unknown',
        state:'ongoing',impact,permanent:n.metadata?.permanent===true,estimated:n.metadata?.estimated===true,schedule:n.schedule||'',observed_at:n.issuedAt,
        effective_from:n.effectiveFrom,effective_until:n.effectiveUntil,lower_altitude:n.lowerAltitude,upper_altitude:n.upperAltitude}
    };item.assessment=assessStatusSignal(item);return item;
});}
export function noticesRouter(service=createNoticeService()) {
    const router=express.Router();router.get('/',async(req,res)=>{try{const data=await service.list(req.query);const body=JSON.stringify(data),etag='"'+createHash('sha256').update(body).digest('hex')+'"';
        res.set({'ETag':etag,'Cache-Control':'private, max-age=30'});if(req.headers['if-none-match']===etag)return res.status(304).end();res.json(data);
    }catch(error){res.status([400,401,403,404,429,500,502,503,504].includes(error.status)?error.status:503).json({error:'Notice service unavailable or invalid query',state:'unavailable'});}});
    router.get('/overlap',async(req,res)=>{const longitude=Number(req.query.lon),latitude=Number(req.query.lat),observed_at=String(req.query.observed_at||'');
        if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90||!Number.isFinite(Date.parse(observed_at)))return res.status(400).json({error:'Valid observed longitude, latitude and UTC timestamp required'});
        try{res.set('Cache-Control','private, max-age=30').json({overlaps:(await service.correlate({longitude,latitude,observed_at})).filter(n=>n.geographicOverlap)});}catch{res.status(503).json({error:'Notice service unavailable'});}});
    return router;
}
