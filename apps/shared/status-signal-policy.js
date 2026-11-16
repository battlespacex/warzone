import {noticeStatus} from './geospatial-notices.js';
// Public status contract. These records inform widgets; they never create map attacks.
export function toPublicStatusSignal(item = {}, now = Date.now()) {
  const signal = item.raw?.status_signal || {};
  const category = String(item.category || "");
  const domain = signal.domain || (/airspace|aviation/.test(category) ? "airspace" : /cyber|internet/.test(category) ? "cyber" : "");
  if (!domain || !item.title) return null;
  const published = Date.parse(item.published_at || "");
  const fetched = Date.parse(item.fetched_at || "");
  const maximumAge = signal.kind === "vulnerability" ? 30 * 86400000 : domain === "airspace" ? 86400000 : 7 * 86400000;
  if (!Number.isFinite(published) || now - published > maximumAge || published > now + 300000) return null;
  let url;
  try { url = new URL(item.url); if (!["http:", "https:"].includes(url.protocol)) return null; } catch { return null; }
  const stale = ["last_known_valid", "source_backoff"].includes(item.raw?.cache_reason) ||
    !Number.isFinite(fetched) || now - fetched > (domain === "airspace" ? 3600000 : 86400000);
  const result = { id: item.guid || item.id || item.url, domain, kind: signal.kind || "reported_signal",
    status: stale ? "stale" : signal.status || "reported", stale, cached: item.raw?.cached === true,
    title: String(item.title).slice(0, 300), summary: String(item.summary || "").slice(0, 1200),
    source_name: String(item.source_name || ""), source_url: url.href,
    published_at: item.published_at, fetched_at: item.fetched_at,
    country: signal.kind === "vulnerability" ? null : item.country || null,
    coverage: signal.coverage || item.region || "Geographic attribution unavailable",
    evidence: {
      scope: signal.kind === 'airport_restriction' || item.raw?.airport ? 'airport' : signal.scope_level || 'unknown',
      authoritative: signal.authoritative === true, verified: signal.verified === true,
      comprehensive: signal.comprehensive === true,
      confidence: signal.confidence || (['otx.alienvault.com','radar.cloudflare.com','nasstatus.faa.gov'].includes(url.hostname)?'medium':'unknown'),
      reliability: signal.reliability || 'unknown', incident_id: signal.incident_id || null,
      state: signal.incident_state || (item.raw?.endDate ? 'resolved' : 'unknown'),
      impact: signal.operational_status || signal.status || 'unknown', severity: signal.severity || 'unknown',
      observed_at: signal.observed_at || item.published_at,
      effective_from: signal.effective_from || null, effective_until: signal.effective_until || item.raw?.endDate || null,
    } };
  result.assessment = assessStatusSignal(result, now);
  return result;
}

// Country rows describe the assessed country. Local evidence remains available
// as reports, but cannot establish a nationwide attack, outage, closure or recovery.
export const STATUS_PRECEDENCE = Object.freeze({
  cyber: ['critical','disrupted','active','recovering','elevated','monitoring','normal','unknown'],
  airspace: ['closed','hazardous','disrupted','partial','restricted','advisory','open','unknown'],
});
const time = value => { const n=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(n)?n:null; };
export function assessStatusSignal(item={}, now=Date.now()) {
  item ||= {};
  const e=item.evidence || {}, domain=item.domain;
  const observed=time(e.observed_at || item.published_at), fetched=time(item.fetched_at);
  const start=time(e.effective_from || item.effective_from), end=time(e.effective_until || item.effective_until);
  const age=domain==='airspace'?86400000:7*86400000, freshness=domain==='airspace'?3600000:86400000;
  const scope=item.kind==='airport_restriction'?'airport':['country','national'].includes(e.scope)?'country':['airport','area','region','organization'].includes(e.scope)?e.scope:'unknown';
  const result={status:'unknown',scope,confidence:'unknown',reason:'Insufficient current evidence',
    observed_at:observed===null?null:new Date(observed).toISOString(),effective_until:end===null?null:new Date(end).toISOString(),
    last_successful_refresh:item.fetched_at || null,nextEvaluationAt:Infinity};
  if(!STATUS_PRECEDENCE[domain]||!item.country)return result;
  let url;try{url=new URL(item.source_url);if(!['https:','http:'].includes(url.protocol))return result;}catch{return result;}
  const validNotice=item.kind==='published_notice'&&domain==='airspace';
  // Permanent notices may have old issue dates, but require a current successful retrieval and valid start.
  const began=validNotice?start:observed;
  if(began===null||fetched===null||fetched>now+300000||item.stale||now-fetched>=freshness||
    (!validNotice&&(observed>now+300000||now-observed>=age)))return result;
  result.nextEvaluationAt=Math.min(fetched+freshness,validNotice?Infinity:observed+age,start!==null&&start>now?start:Infinity,end!==null&&end>now?end:Infinity);
  if(start!==null&&start>now){result.reason='Not yet effective';return result;}
  if(end!==null&&end<=now||['resolved','historical','cancelled','superseded'].includes(e.state)){
    result.reason='Expired or historical evidence';return result;
  }
  if(validNotice){
    const daily=String(e.schedule||'').match(/^DAILY\s+(\d{2})(\d{2})-(\d{2})(\d{2})\s*(?:UTC)?$/i);
    if(daily){const day=new Date(now);day.setUTCHours(0,0,0,0);for(const minute of [+daily[1]*60+ +daily[2],+daily[3]*60+ +daily[4]]){
      let boundary=day.getTime()+minute*60000;if(boundary<=now)boundary+=86400000;result.nextEvaluationAt=Math.min(result.nextEvaluationAt,boundary);
    }}
    const current=noticeStatus({effectiveFrom:item.effective_from||e.effective_from,effectiveUntil:item.effective_until||e.effective_until,
      schedule:e.schedule||'',isCancellation:['cancelled','superseded'].includes(item.notice_status),metadata:{permanent:e.permanent===true,estimated:e.estimated===true}},now);
    if(current!=='active')return result;
  }
  if(!['medium','high'].includes(e.confidence)||['low','unreliable'].includes(e.reliability))return result;
  const strong=e.verified===true&&e.confidence==='high';
  const country=scope==='country', authority=e.authoritative===true;
  const impact=String(e.impact || item.status || '').toLowerCase();
  const assign=(status,reason,confidence='medium')=>Object.assign(result,{status,reason,confidence});
  if(domain==='cyber'){
    if(['vulnerability'].includes(item.kind))return result;
    if(country&&strong){
      if(e.state==='recovering')return assign('recovering','Verified country-scope restoration','high');
      if(e.state==='ongoing'){
        if(impact==='critical'&&['high','critical'].includes(e.severity))return assign('critical','Verified severe country-scope incident','high');
        if(impact==='disrupted')return assign('disrupted','Verified country-scope service disruption','high');
        if(impact==='active')return assign('active','Verified ongoing country-scope malicious activity','high');
      }
      if(impact==='elevated'&&e.state==='ongoing')return assign('elevated','Corroborated country-scope threat indicators','high');
      if(impact==='normal'&&e.state==='normal'&&authority&&e.comprehensive===true)return assign('normal','Comprehensive authoritative normal assessment','high');
    }
    // Reports/top-country traffic shares are monitoring context, never proof of an attack.
    if(['threat_intelligence','network_activity','internet_outage','reported_signal'].includes(item.kind))return assign('monitoring','Current country-associated report; nationwide impact unconfirmed');
  }else{
    if(authority&&strong){
      if(country&&impact==='open'&&e.comprehensive===true)return assign('open','Comprehensive authoritative normal operations','high');
      if(country&&impact==='closed'&&e.comprehensive===true)return assign('closed','Authoritative closure of complete assessed country airspace','high');
      if(['country','area','region'].includes(scope)){
        if(impact==='hazardous')return assign('hazardous','Verified aviation hazard in stated scope','high');
        if(impact==='disrupted')return assign('disrupted','Verified aviation disruption in stated scope','high');
        if(impact==='partial'||impact==='closed'&&!country)return assign('partial','Authoritative closure of part of assessed airspace','high');
        if(impact==='restricted')return assign('restricted','Authoritative restriction in stated area/altitude scope','high');
      }
    }
    if(validNotice||['airport_restriction','advisory'].includes(item.kind))return assign('advisory','Current aviation notice; wider airspace condition unconfirmed');
  }
  return result;
}

export function createCountryStatusClassifier(resolveCountry=value=>String(value||'').trim().toLowerCase()) {
  let previous=null, index=new Map(), cache=new Map();
  return (items,country,domain,now=Date.now())=>{
    if(items!==previous){previous=items;index=new Map();cache=new Map();for(const item of items||[]){
      const name=resolveCountry(item.country);if(!name)continue;const key=item.domain+'|'+name;
      if(!index.has(key))index.set(key,[]);index.get(key).push(item);
    }}
    const key=domain+'|'+resolveCountry(country),old=cache.get(key);if(old&&now<old.nextEvaluationAt)return old;
    const all=index.get(key)||[], latest=new Map();
    for(const item of all)if(item.evidence?.incident_id){const id=item.source_name+'|'+item.evidence.incident_id, prior=latest.get(id);
      if(!prior||(time(item.evidence.observed_at||item.published_at)||0)>(time(prior.evidence.observed_at||prior.published_at)||0))latest.set(id,item);
    }
    const supporting=all.map(item=>({item,assessment:item.evidence?.incident_id&&latest.get(item.source_name+'|'+item.evidence.incident_id)!==item?
      {status:'unknown',scope:item.evidence.scope,reason:'Superseded incident state',nextEvaluationAt:Infinity}:assessStatusSignal(item,now)}));
    const order=STATUS_PRECEDENCE[domain]||['unknown'];supporting.sort((a,b)=>order.indexOf(a.assessment.status)-order.indexOf(b.assessment.status));
    const winner=supporting.find(row=>row.assessment.status!=='unknown');
    const value={country,domain,status:winner?.assessment.status||'unknown',confidence:winner?.assessment.confidence||'unknown',
      priority:winner?order.length-order.indexOf(winner.assessment.status):0,
      reason:winner?.assessment.reason||'No sufficient current evidence',scope:winner?.assessment.scope||'unknown',
      evidence:supporting.map(({item,assessment})=>({id:item.id,source:item.source_name,url:item.source_url,status:assessment.status,scope:assessment.scope,
        severity:item.evidence?.severity||'unknown',confidence:assessment.confidence||'unknown',
        observed_at:assessment.observed_at,effective_until:assessment.effective_until,last_successful_refresh:assessment.last_successful_refresh,reason:assessment.reason})),
      reportCount:supporting.length,nextEvaluationAt:Math.min(...supporting.map(row=>row.assessment.nextEvaluationAt))};
    cache.set(key,value);return value;
  };
}
