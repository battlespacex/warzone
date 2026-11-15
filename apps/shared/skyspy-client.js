export function skySpyOrigin(baseUrl,allowedHosts=[]) {
    const base=new URL(baseUrl);
    if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!allowedHosts.includes(base.hostname)||/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(base.hostname))throw Error('SkySpy public HTTPS origin allowlist required');
    return base;
}
export function createSkySpyClient({enabled=false,usageApproved=false,baseUrl='',apiKey='',allowedHosts=[],fetchImpl=fetch,now=Date.now}={}) {
    let pending=null,next=0,lastSuccess=null,lastStatus=null,failures=0;const cache=new Map();
    const paths=new Set(['/notams/','/notams/tfrs/','/notams/nearby/','/notams/stats/','/aviation/airspace/','/aircraft/']);
    async function get(path,query={}) {
        if(!enabled||!usageApproved)throw Error('SkySpy disabled or usage unapproved');
        const base=skySpyOrigin(baseUrl,allowedHosts);
        if(!paths.has(path)&&!/^\/notams\/airport\/[A-Z]{4}\/$/.test(path))throw Error('Unsupported SkySpy endpoint');
        const permitted=new Set(path==='/aircraft/'?['military','min_alt','max_alt','min_distance','max_distance']:['icao','lat','lon','radius_nm','type','active_only','limit']);
        if(Object.keys(query).some(k=>!permitted.has(k)))throw Error('Unsupported SkySpy parameter');
        const key=path+new URLSearchParams(query),cached=cache.get(key);
        if(cached&&now()-cached.at<60000)return structuredClone(cached.data);
        if(pending){await pending;return get(path,query);}
        if(now()<next)throw Error('SkySpy backoff active');
        pending=(async()=>{try{
            const res=await fetchImpl(new URL('/api/v1'+path+(Object.keys(query).length?'?'+new URLSearchParams(query):''),base),
                {headers:{Accept:'application/json',...(apiKey?{'X-API-Key':apiKey}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});
            lastStatus=res.status;if(!res.ok){const header=res.headers.get('retry-after'),seconds=Number(header),retry=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-now())||0;
                next=now()+Math.min(7*86400000,Math.max([401,403].includes(res.status)?86400000:30000*2**Math.min(failures++,5),retry));throw Error('SkySpy request unavailable');}
            if(Number(res.headers.get('content-length'))>5e6)throw Error('Oversized SkySpy payload');
            let data;
            if(res.body?.getReader){const reader=res.body.getReader(),decoder=new TextDecoder();let body='',size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5e6)throw Error('Oversized SkySpy payload');body+=decoder.decode(value,{stream:true});}data=JSON.parse(body+decoder.decode());}finally{await reader.cancel();}}
            else data=await res.json();
            if(!data||typeof data!=='object')throw Error('Malformed SkySpy payload');
            cache.set(key,{data,at:now()});while(cache.size>16)cache.delete(cache.keys().next().value);
            lastSuccess=new Date(now()).toISOString();failures=0;return structuredClone(data);
        }catch(error){next=Math.max(next,now()+30000);throw Error('SkySpy unavailable; inspect sanitized health status');}finally{pending=null;}})();
        return pending;
    }
    return {get,diagnostics:()=>({enabled,usageApproved,lastSuccess,lastStatus,cachedResponses:cache.size,nextRetryAt:new Date(next).toISOString()})};
}
