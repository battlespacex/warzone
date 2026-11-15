import {normalizeNotice,parseNotam} from './geospatial-notices.js';

function classifyPublishedNotice(n) {
    const text=n.rawText.toUpperCase();
    n.isMilitaryRelated=/\bMILITARY\b|\bMIL (?:SIDE|EXERCISE|FIRING)\b/.test(text);
    if(/\bMIL(?:ITARY)? EXERCISE\b/.test(text))n.activityType='military exercise';
    else if(/\bMIL(?:ITARY)? FIRING\b/.test(text))n.activityType='military firing';
    if(/\bTEMPORARY FLIGHT RESTRICTION\b/.test(text))n.noticeType='tfr';
    else if(/\bAIRSPACE RESTRICTION\b/.test(text))n.noticeType='airspace';
    return n;
}

export function deduplicateNotices(records) {
    const groups=new Map(),clean=value=>String(value||'').trim().toUpperCase().replace(/\s+/g,' ');
    for(const n of records){
        // Identifierless records are never merged on polygon overlap or wording alone.
        const id=clean(n.sourceId),scope=clean(n.fir||n.navarea||n.issuer);
        let key=[scope,id,...(/^[A-Z]\d{4}\/\d{2}$/.test(id)?[]:[clean(n.metadata?.version||'original')])].join(':');
        const prior=groups.get(key);
        if(prior&&clean(prior.issuer)!==scope&&clean(n.issuer)!==scope&&clean(prior.issuer)!==clean(n.issuer))key+=':'+clean(n.issuer);
        const existing=groups.get(key),sources=[...(existing?.sourceRecords||[]),...(n.sourceRecords||[{provider:n.provider,sourceId:n.sourceId,sourceUrl:n.sourceUrl,rawText:n.rawText,issuer:n.issuer,issuedAt:n.issuedAt,lastVerifiedAt:n.lastVerifiedAt}])];
        const rank=row=>[row.provenance?.verification==='verified'?1:0,Date.parse(row.metadata?.updatedAt||row.lastVerifiedAt||row.issuedAt)||0,row.geometry?1:0,({autorouter:2,aviation_edge:1})[row.provider]||0,row.rawText?.length||0];
        const prefer=(a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i]?a:b;return a;};
        const preferred=existing?prefer(existing,n):n;
        const references=[...new Map(sources.map(s=>[[s.provider,s.sourceUrl,s.sourceId].join('|'),s])).values()].slice(0,8);
        groups.set(key,{...preferred,id:key.split(':').map(encodeURIComponent).join(':'),sourceRecords:references});
    }
    const result=[...groups.values()];for(const replacement of result.filter(n=>n.replacesNoticeId))for(const old of result)
        if(clean(old.sourceId)===clean(replacement.replacesNoticeId)&&clean(old.fir||old.navarea||old.issuer)===clean(replacement.fir||replacement.navarea||replacement.issuer)
            &&!(clean(old.issuer)!==clean(old.fir)&&clean(replacement.issuer)!==clean(replacement.fir)&&clean(old.issuer)!==clean(replacement.issuer)))old.superseded=true;
    return result;
}

export function createCommercialNoticeProviders(env={}, {fetchImpl=fetch,now=Date.now}={}) {
    function provider(id,prefix,endpoint,query,parse,contract=true) {
        const enabled=env[prefix+'_ENABLED']==='true',approved=env[prefix+'_USAGE_APPROVED']==='true',key=env[prefix+'_API_KEY']||env[prefix+'_ACCESS_TOKEN']||'';
        let next=0,lastSuccess=null,lastStatus=null,pending=null,cache=null,rejected=0,error=null,partial=false,failures=0;
        const diagnostics=()=>{let valid=true;try{query();}catch{valid=false;}return {enabled,availableForUse:enabled&&approved&&Boolean(key)&&contract&&valid,licensing:approved?'approved':'unapproved',authentication:key?'configured; not live verified':'unconfigured',lastSuccess,lastStatus,rejected,
            coverage:env[prefix+'_LOCATIONS']||'unconfigured',partial,error:!contract?'Verified API contract required':!valid?'Explicit valid location/validity configuration required':error,nextRetryAt:new Date(next).toISOString()};};
        return {id,diagnostics,async fetchNotices(){
            if(!enabled||!approved||!key||!contract)return [];
            if(cache&&now()<cache.until)return cache.rows;if(pending)return pending;if(now()<next)throw Error('Notice provider backoff');
            pending=(async()=>{try{
                const url=new URL(endpoint);const params=query();for(const [name,value]of Object.entries(params))url.searchParams.set(name,value);
                if(id==='aviation_edge')url.searchParams.set('key',key);
                const collected=[];let page=0,total=null;
                do {
                const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json',...(id==='autorouter'?{Authorization:'Bearer '+key}:{})}});
                lastStatus=response.status;if(!response.ok){const header=response.headers.get('retry-after'),seconds=Number(header),retry=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-now());
                    next=now()+Math.max([401,403].includes(response.status)?86400000:60000,Number.isFinite(retry)?Math.min(7*86400000,retry):0);throw Error('Notice provider HTTP failure');}
                if(Number(response.headers.get('content-length'))>5e6)throw Error('Response too large');
                let body='';
                if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;try{
                    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>5e6)throw Error('Response too large');body+=decoder.decode(value,{stream:true});}body+=decoder.decode();
                }finally{await reader.cancel();}}else body=await response.text();
                if(body.length>5e6)throw Error('Response too large');const payload=JSON.parse(body);
                const values=id==='autorouter'?payload.rows:payload;if(!Array.isArray(values)||values.length>5000)throw Error('Invalid provider collection');
                collected.push(...values);page++;
                total=Number.isFinite(payload.total)?payload.total:null;
                if(id!=='autorouter'||values.length<100||total===null||collected.length>=total)break;
                url.searchParams.set('offset',String(collected.length));
                }while(page<3);
                partial=id==='autorouter'&&(total===null?collected.length>=100:collected.length<total);
                const values=collected;
                const rows=[];rejected=0;for(const row of values)try{rows.push(parse(row));}catch{rejected++;}
                if(values.length&&!rows.length)throw Error('Provider schema rejected');
                cache={rows,until:now()+300000};lastSuccess=new Date(now()).toISOString();error=null;failures=0;return rows;
            }catch{error='Provider unavailable; inspect status and configuration';next=Math.max(next,now()+60000*2**Math.min(failures++,4));throw Error('Notice provider unavailable');}finally{pending=null;}})();return pending;
        }};
    }
    const locations=prefix=>{const values=String(env[prefix+'_LOCATIONS']||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
        if(!values.length||values.length>10||values.some(x=>!/^[A-Z]{3,4}$/.test(x)))throw Error('Explicit approved location scope required');return values;};
    const epoch=value=>value!=null&&value!==''&&Number.isFinite(Number(value))?new Date(Number(value)*1000).toISOString():null;
    return [
        provider('aviation_edge','AVIATION_EDGE','https://aviation-edge.com/v2/public/notams',()=>{const values=locations('AVIATION_EDGE');if(values.length!==1)throw Error('One scoped location per cached request');return {location:values[0]};},row=>{
            if(typeof row.condition!=='string')throw Error('Missing original NOTAM');
            const raw=row.condition.toUpperCase().replace(/NOTAM([NRC])(?=Q\))/g,'NOTAM$1\n').replace(/(?<![A-Z])([QABCDEFG])\)/g,'\n$1) ');
            const fir=raw.match(/Q\)\s*([A-Z]{4})/)?.[1];
            const n=parseNotam(raw,{provider:'aviation_edge',issuer:fir||String(row.location).toUpperCase(),sourceUrl:'https://aviation-edge.com/notam-api/',provenance:{extraction:'Aviation Edge REST response',verification:'unverified'},now:now()});
            n.rawText=row.condition;n.country='';return classifyPublishedNotice(n);
        }),
        provider('autorouter','AUTOROUTER','https://api.autorouter.aero/v1.0/notam',()=>{
            const startvalidity=Number(env.AUTOROUTER_START_VALIDITY||0),endvalidity=Number(env.AUTOROUTER_END_VALIDITY||4294967295);
            if(!Number.isInteger(startvalidity)||!Number.isInteger(endvalidity)||startvalidity<0||endvalidity>4294967295||startvalidity>endvalidity)throw Error('Invalid validity interval');
            return {itemas:JSON.stringify(locations('AUTOROUTER')),offset:0,limit:100,startvalidity,endvalidity};
        },row=>{
            if(!/^[A-Z]$/i.test(row.series)||!Number.isInteger(row.number)||!Number.isInteger(row.year)||!row.iteme)throw Error('Invalid NOTAM identifier');
            const sourceId=String(row.series).toUpperCase()+String(row.number).padStart(4,'0')+'/'+String(row.year).slice(-2);
            return classifyPublishedNotice(normalizeNotice({provider:'autorouter',issuer:row.nof||row.fir,sourceId,fir:row.fir,noticeType:'notam',title:'NOTAM '+sourceId,
                sourceUrl:'https://www.autorouter.aero/wiki/api/notams/',provenance:{extraction:'autorouter REST response',verification:'unverified'},rawText:row.iteme,effectiveFrom:epoch(row.startvalidity),effectiveUntil:epoch(row.endvalidity),issuedAt:null,
                lastVerifiedAt:null,schedule:row.itemd||'',lowerAltitude:row.itemf||'',upperAltitude:row.itemg||'',
                geometry:Number.isFinite(row.lat)&&Number.isFinite(row.lon)?{type:'Point',coordinates:[row.lon*90/(1<<30),row.lat*90/(1<<30)]}:null,
                geometrySource:'published Q-line',geometryAccuracy:'approximate area of influence',isCancellation:row.type==='C',isMilitaryRelated:/\bMILITARY\b|\bMIL SIDE\b/i.test(row.iteme),
                replacesNoticeId:row.referredseries&&row.referrednumber?row.referredseries+String(row.referrednumber).padStart(4,'0')+'/'+String(row.referredyear).slice(-2):'',
                metadata:{updatedAt:epoch(row.modified),estimated:row.estimation!=null,...(row.radius>0?{radiusNm:row.radius}:{})}},now()));
        }),
        provider('icao','ICAO',null,()=>({}),()=>{},false),provider('dtn','DTN',null,()=>({}),()=>{},false),
    ];
}

export function createOfficialNoticeAdapter(id) {
    if(!['aai','navareaIX'].includes(id))throw Error('Unknown official provider');
    return {id,enabled:false,diagnostics:()=>({enabled:false,state:'import-only',authentication:'unconfigured',licensing:'unapproved',lastSuccess:null,
        coverage:id==='aai'?'AAI published scope only':'NAVAREA IX published scope only',error:'Approved machine access and redistribution contract required',reason:'Approved machine access and redistribution contract required'})};
}
// REST notice documentation names endpoints but omits complete row schemas. Accept canonical
// records or reviewed raw ICAO text only; never invent authority, source link, dates or geometry.
export function skySpyNotice(row,now=Date.now()) {
    if(row?.rawText&&row?.sourceUrl&&row?.issuer){
        if(!row.sourceId&&/\bNOTAM[NRC]\b/.test(row.rawText))return parseNotam(row.rawText,{...row,provider:'skyspy',now});
        return normalizeNotice({...row,provider:'skyspy'},now);
    }
    throw Error('Deployed notice row requires an authoritative field mapping');
}
