// Public, key-free government feeds. Never infer incident geography from publisher location.
function text(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  return text(xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] || "");
}
export function parseFaaStatus(xml, source, now = Date.now()) {
  // Fixed FAA XML contract; no external entities, DTD loading or arbitrary XML execution.
  if (typeof xml !== "string" || xml.length > 2e6 || !xml.includes("<AIRPORT_STATUS_INFORMATION>") ||
    !xml.includes("</AIRPORT_STATUS_INFORMATION>")) throw new Error("Invalid FAA XML");
  const updated = tag(xml, "Update_Time");
  const observed = Date.parse(updated);
  if (!Number.isFinite(observed)) throw new Error("Invalid FAA update timestamp");
  if (now - observed > 6 * 3600000 || observed > now + 300000) throw new Error("Stale FAA snapshot");
  const items = [];
  for (const group of xml.matchAll(/<Delay_type>([\s\S]*?)<\/Delay_type>/g)) {
    const name = tag(group[1], "Name");
    for (const airport of group[1].matchAll(/<Airport>([\s\S]*?)<\/Airport>/g)) {
      const code = tag(airport[1], "ARPT"), reason = tag(airport[1], "Reason");
      if (!/^[A-Z0-9]{3,4}$/.test(code) || !reason) continue;
      const restriction = /closures|ground stop/i.test(name);
      items.push({ source_id: source.id, source_name: source.name, source_type: source.type,
        source_category: source.category, title: `${code}: ${name}`, summary: reason,
        guid: `faa:${code}:${name}:${reason}`, url: `https://nasstatus.faa.gov/#${encodeURIComponent(`${code}:${name}:${reason}`)}`,
        country: "United States", region: "United States", published_at: new Date(observed).toISOString(),
        fetched_at: new Date(now).toISOString(),
        raw: { status_signal: { domain: "airspace", kind: restriction ? "airport_restriction" : "advisory",
          status: restriction ? "restricted" : "advisory", coverage: "United States", observed_at: updated },
          airport: code, reason, start: tag(airport[1], "Start"), reopen: tag(airport[1], "Reopen") } });
    }
  }
  return items;
}
export function parseKevStatus(payload, source, now = Date.now()) {
  if (!Array.isArray(payload?.vulnerabilities) || !Number.isFinite(Date.parse(payload.dateReleased))) throw new Error("Invalid KEV JSON");
  return payload.vulnerabilities.filter(item => /^CVE-\d{4}-\d+$/.test(item.cveID || "") && item.vulnerabilityName &&
    Number.isFinite(Date.parse(item.dateAdded)) && now - Date.parse(item.dateAdded) <= 30 * 86400000 && Date.parse(item.dateAdded) <= now)
    .map(item => ({ source_id: source.id, source_name: source.name, source_type: source.type,
      source_category: source.category, title: `${item.cveID}: ${text(item.vulnerabilityName)}`,
      summary: text(item.shortDescription), guid: `cisa-kev:${item.cveID}`,
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog#${item.cveID}`, published_at: item.dateAdded,
      fetched_at: new Date(now).toISOString(), country: null, region: null,
      raw: { status_signal: { domain: "cyber", kind: "vulnerability", status: "advisory", coverage: "Global; geographic attribution unavailable" },
        cve: item.cveID, dateAdded: item.dateAdded, requiredAction: item.requiredAction, catalog_version: payload.catalogVersion,
        catalog_released_at: payload.dateReleased } }));
}

// Optional authenticated sources share the existing status worker, cache and
// source-health backoff. Tokens never enter source definitions or public rows.
const optionalState = new Map(), optionalPending = new Map();
export function getOptionalStatusSources(env = process.env) {
  const radarEnabled=env.CLOUDFLARE_RADAR_ENABLED==='true' && env.CLOUDFLARE_RADAR_USAGE_APPROVED==='true' && Boolean(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_RADAR_API_TOKEN);
  return [
    {id:'cloudflare-radar',name:'Cloudflare Radar',adapter:'cloudflare_radar',url:'https://api.cloudflare.com/client/v4/radar/annotations/outages',
      enabled:radarEnabled},
    ...[3,7].map(layer=>({id:'cloudflare-radar-l'+layer,name:'Cloudflare Radar Layer '+layer,adapter:'cloudflare_radar_aggregate',layer,
      url:`https://api.cloudflare.com/client/v4/radar/attacks/layer${layer}/top/locations/target?dateRange=1d&limit=10`,enabled:radarEnabled})),
    {id:'alienvault-otx',name:'AlienVault OTX',adapter:'otx_pulses',url:'https://otx.alienvault.com/api/v1/pulses/subscribed',
      enabled:env.OTX_ENABLED==='true' && env.OTX_USAGE_APPROVED==='true' && Boolean(env.OTX_API_KEY)},
  ].map(source=>({...source,type:'api',category:'cyber_disruption',region_scope:'global',cache_ttl_ms:900000,
    note:'Requires configured backend credentials and explicit authorized use; reports are not national threat ratings.'}));
}
export function fetchOptionalStatusSource(source, fetchJson, env = process.env, now = Date.now()) {
  const configured=getOptionalStatusSources(env).find(s=>s.id===source.id);
  if(!configured?.enabled)return Promise.resolve({items:[],fetched_count:0,skipped:true});
  if(optionalPending.has(source.id))return optionalPending.get(source.id);
  const pending=(async()=>{
    if(source.adapter==='cloudflare_radar_aggregate'){
      const payload=await fetchJson(configured.url,{redirect:'error',headers:{Authorization:'Bearer '+(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_RADAR_API_TOKEN)}});
      if(payload.success!==true||!Array.isArray(payload.result?.top_0))throw Error('Invalid Radar aggregate JSON');
      const stamp=payload.result.meta?.dateRange?.[0]?.endTime || payload.result.meta?.lastUpdated;
      if(!Number.isFinite(Date.parse(stamp)))throw Error('Invalid Radar observation timestamp');
      const items=payload.result.top_0.filter(row=>/^[A-Z]{2}$/.test(row.targetCountryAlpha2)&&Number.isFinite(Number(row.value))).map(row=>({
        source_id:source.id,source_name:source.name,source_type:'api',category:'cyber_advisory',country:row.targetCountryAlpha2,
        guid:`${source.id}:${row.targetCountryAlpha2}:${stamp}`,title:`Layer ${configured.layer} aggregate activity: ${row.targetCountryName || row.targetCountryAlpha2}`,
        summary:`${row.value}% share of Cloudflare's observed layer ${configured.layer} attack traffic. Aggregate activity, not confirmation of a national incident.${configured.layer===7?' Target location can reflect the attacked zone billing country.':''}`,
        url:`https://radar.cloudflare.com/attacks/layer${configured.layer}`,published_at:stamp,fetched_at:new Date(now).toISOString(),
        raw:{status_signal:{domain:'cyber',kind:'network_activity',status:'reported',coverage:'Cloudflare observed traffic; top target countries, not complete coverage'},share:row.value,layer:configured.layer}
      }));return {items,fetched_count:items.length};
    }
    if(source.adapter==='cloudflare_radar'){
      const payload=await fetchJson(configured.url,{redirect:'error',headers:{Authorization:'Bearer '+(env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_RADAR_API_TOKEN)}});
      if(payload.success!==true || !Array.isArray(payload.result?.annotations))throw Error('Invalid Radar JSON');
      const items=[];
      for(const row of payload.result.annotations.slice(0,500)){
        if(!row.id || !row.description || !Number.isFinite(Date.parse(row.startDate)))continue;
        // Location is published by Radar; never derive it from an ASN's owner.
        const countries=(row.locationsDetails || []).filter(c=>/^[A-Z]{2}$/.test(c.code));
        for(const country of countries.length?countries:[null])items.push({source_id:source.id,source_name:source.name,source_type:'api',
          category:'internet_outage',title:text(row.description).slice(0,300),summary:text(row.description),
          guid:`radar:${row.id}:${country?.code || 'global'}`,url:row.linkedUrl || 'https://radar.cloudflare.com/outage-center',
          country:country?.code || null,region:country?.name || row.scope || null,published_at:row.startDate,fetched_at:new Date(now).toISOString(),
          raw:{status_signal:{domain:'cyber',kind:'internet_outage',status:'reported',coverage:row.scope || 'Published outage scope'},
            endDate:row.endDate || null,eventType:row.eventType,annotationId:row.id}});
      }
      if(payload.result.annotations.length && !items.length)throw Error('Invalid Radar records');
      return {items,fetched_count:payload.result.annotations.length};
    }
    let state=optionalState.get(source.id) || {rows:new Map(),since:new Date(now-7*86400000).toISOString(),next:null};
    let url=new URL(state.next || configured.url);
    if(!state.next){url.searchParams.set('modified_since',state.since);url.searchParams.set('limit','100');}
    const updated=new Map(state.rows),started=state.next?state.started:new Date(now).toISOString();let next=null,count=0;
    for(let page=0;page<3;page++){
      if(url.origin!=='https://otx.alienvault.com' || url.pathname!=='/api/v1/pulses/subscribed' && url.pathname!=='/api/v1/pulses/subscribed/')throw Error('Invalid OTX pagination');
      const payload=await fetchJson(url.href,{redirect:'error',headers:{'X-OTX-API-KEY':env.OTX_API_KEY}});
      if(!Array.isArray(payload.results))throw Error('Invalid OTX JSON');
      let valid=0;
      for(const pulse of payload.results){
        if(!/^[a-f0-9]{24}$/i.test(pulse.id || '') || !pulse.name || !Number.isFinite(Date.parse(pulse.modified || pulse.created)))continue;
        valid++;
        for(const id of updated.keys())if(id.startsWith(`otx:${pulse.id}:`))updated.delete(id);
        // Targeted-country references describe a report's subject, not an active attack.
        const countries=(pulse.targeted_countries || []).filter(c=>typeof c==='string' && /^[A-Z]{2}$/.test(c));
        for(const country of countries.length?countries:[null])updated.set(`otx:${pulse.id}:${country || 'global'}`,{
          source_id:source.id,source_name:source.name,source_type:'api',category:'cyber_advisory',title:text(pulse.name),summary:text(pulse.description),
          guid:`otx:${pulse.id}:${country || 'global'}`,url:'https://otx.alienvault.com/pulse/'+pulse.id,country,
          published_at:pulse.modified || pulse.created,fetched_at:new Date(now).toISOString(),
          raw:{status_signal:{domain:'cyber',kind:'threat_intelligence',status:'reported',coverage:'Published threat intelligence; incident location unverified'},
            pulseId:pulse.id,created:pulse.created,modified:pulse.modified,references:(pulse.references || []).slice(0,20),indicators:(pulse.indicators || []).slice(0,100)}});
      }
      if(payload.results.length && !valid)throw Error('Invalid OTX records');
      count+=payload.results.length;next=payload.next?new URL(payload.next,configured.url).href:null;
      if(!next)break;url=new URL(next);
    }
    for(const [id,row]of updated)if(now-Date.parse(row.published_at)>7*86400000)updated.delete(id);
    while(updated.size>5000)updated.delete(updated.keys().next().value);
    state={rows:updated,since:next?state.since:started,started:next?started:null,next};optionalState.set(source.id,state);
    return {items:[...updated.values()],fetched_count:count};
  })().finally(()=>optionalPending.delete(source.id));optionalPending.set(source.id,pending);return pending;
}

const countryCache=new Map(),countryPending=new Map();
export async function lookupStatusCountry(code,fetchJson,env=process.env,now=Date.now()) {
  if(!/^[A-Z]{2,3}$/.test(code || '') || env.RESTCOUNTRIES_ENABLED!=='true' || !env.RESTCOUNTRIES_API_KEY)return null;
  for(const [key,entry]of countryCache)if(entry.until<=now)countryCache.delete(key);
  const cached=countryCache.get(code);if(cached?.until>now)return cached.value;
  countryCache.delete(code);
  if(countryPending.has(code))return countryPending.get(code);
  const pending=(async()=>{
    const property=code.length===2?'codes.alpha_2':'codes.alpha_3';
    const payload=await fetchJson(`https://api.restcountries.com/countries/v5/${property}/${code}?response_fields=names.common,codes.alpha_2,codes.alpha_3`,
      {redirect:'error',timeoutMs:3000,headers:{Authorization:'Bearer '+env.RESTCOUNTRIES_API_KEY}});
    const rows=payload.data?.objects;if(payload.data?._demo || !Array.isArray(rows) || rows.length!==1)throw Error('Invalid country JSON');
    const row=rows[0];if(!row.names?.common || !/^[A-Z]{2}$/.test(row.codes?.alpha_2))throw Error('Invalid country JSON');
    const value={name:row.names.common,alpha2:row.codes.alpha_2,alpha3:row.codes.alpha_3};
    if(countryCache.size>=260)countryCache.delete(countryCache.keys().next().value);
    countryCache.set(code,{value,until:now+3*86400000});return value;
  })().finally(()=>countryPending.delete(code));countryPending.set(code,pending);return pending;
}
