import Parser from 'rss-parser';
import {hasSourceRights} from './licensed-feeds.js';
// Bounded official-publication adapters. Only the reviewed policies below auto-run.
export const publicationPolicies={
 'BGD-001':{endpoint:'https://navy.mil.bd/',requiresRights:true,commercial_gate:'permission_required',attribution:'Source: Bangladesh Navy public news index; publication date only, not a live vessel observation.'},
 'NZL-001':{endpoint:'https://www.nzdf.mil.nz/navy/navy-news/',articlePath:'/navy/navy-news/',requiresRights:true,commercial_gate:'permission_required',attribution:'Source: New Zealand Defence Force; attributed publication metadata, not live vessel positions.'},
 'ESP-001':{endpoint:'https://armada.defensa.gob.es/ArmadaPortal/page/Portal/ArmadaEspannola/conocenosnoticias/prefLang-es/',articlePath:'/ArmadaPortal/page/Portal/ArmadaEspannola/conocenosnoticias/prefLang-es/00noticias--',requiresRights:true,license_ref:'https://armada.defensa.gob.es/ArmadaPortal/page/Portal/ArmadaEspannola/iniciolegal/prefLang-es/',commercial_gate:'permission_required',attribution:'Source: Armada Española; attributed publication metadata, not live vessel positions.'},
 'IND-001':{endpoint:'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=2&Regid=3&reg=48',license_ref:'https://www.pib.gov.in/content/102_2_Copyright-Policy.aspx?lang=1&reg=30',commercial_gate:'reviewed_open_publication',attribution:'Source: Press Information Bureau, Government of India; attributed metadata normalized by StratOps.'},
 'IND-002':{endpoint:'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2315585&lang=1&reg=48',singlePublication:true,refreshMs:7*86400000,license_ref:'https://www.pib.gov.in/content/102_2_Copyright-Policy.aspx?lang=1&reg=30',commercial_gate:'reviewed_open_publication',attribution:'Source: Press Information Bureau, Government of India; attributed archival publication, not a live feed.'},
 'COAL-002':{endpoint:'https://eunavfor.eu/news/',articlePath:'/news/',license_ref:'https://eunavfor.eu/terms-conditions',commercial_gate:'reviewed_open_publication',attribution:'Source: European Union Naval Force Operation ATALANTA; source-acknowledged reuse, metadata normalized by StratOps.'},
 'FRA-001':{endpoint:'https://www.defense.gouv.fr/marine',articlePath:'/marine/actualites/',license_ref:'https://www.defense.gouv.fr/mentions-legales-conditions-dutilisation-du-site',commercial_gate:'reviewed_open_publication',attribution:'Source: Ministère des Armées, Licence Ouverte Etalab 2.0; metadata normalized by StratOps.'},
 'ARG-001':{endpoint:'https://www.argentina.gob.ar/defensa/armada/noticias',articlePath:'/noticias/',license_ref:'https://www.argentina.gob.ar/terminos-y-condiciones',commercial_gate:'reviewed_open_publication',attribution:'Source: Armada Argentina / Argentina.gob.ar, CC BY 4.0; metadata normalized by StratOps.'}
};
export const hasPublicationRights=(id,grant)=>Boolean(publicationPolicies[id]?.requiresRights)&&hasSourceRights(id,grant);
const decode=s=>String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>String.fromCodePoint(Math.min(0x10ffff,v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):+v))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');
export function bangladeshPublications(html){
 const rows=[];
 for(const item of html.matchAll(/<li\b[^>]*class=["']news-item["'][^>]*>([\s\S]*?)<\/li>/gi)){
  const title=decode(item[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1]?.replace(/<[^>]*>/g,'').trim());
  const date=item[1].match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+\d{2}:\d{2}\s+[ap]m/i);
  if(!title||!date)continue;const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(date[2].toLowerCase())+1;if(!month)continue;
  const day=date[3]+'-'+String(month).padStart(2,'0')+'-'+date[1],description=decode(item[1].match(/<dddd\b[^>]*>([\s\S]*?)<\/dddd>/i)?.[1]?.replace(/<[^>]*>/g,''));
  // The source's detail downloads require POST/session tokens. Never replay those requests.
  rows.push({id:day+':'+title,title,short_description:description,url:publicationPolicies['BGD-001'].endpoint,date_published:day+'T00:00:00Z',publication_precision:'day'});
  if(rows.length===20)break;
 }
 return rows;
}
export function articleMetadata(html,url,sourceId){
 const meta={};for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const attrs={};for(const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))attrs[a[1].toLowerCase()]=decode(a[3]);const key=attrs.property||attrs.name;if(key&&attrs.content)meta[key]=attrs.content;}
 let title=meta['og:title'],date=meta['article:published_time']||meta['datePublished'],precision='timestamp';
 if(sourceId==='NZL-001'){
  for(const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
   try{const data=JSON.parse(script[1]);for(const node of (Array.isArray(data)?data:data['@graph']||[data])){
    if(!['NewsArticle','Article'].includes(node['@type']))continue;
    // Page modification/collection dates must never masquerade as the report's publication.
    title=title||node.headline;date=date||node.datePublished;
   }}catch{}
  }
 }
 if(sourceId==='ESP-001'){
  title=decode(html.match(/<h1\b[^>]*class=["']tituloPlantilla["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g,'').trim());
  const shown=html.match(/class=["']descPlantilla["'][^>]*>[^<]*?(\d{1,2}) de ([a-z]+) de (\d{4})/i);
  if(shown){const month=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'].indexOf(shown[2].toLowerCase())+1;if(month){date=shown[3]+'-'+String(month).padStart(2,'0')+'-'+shown[1].padStart(2,'0')+'T00:00:00Z';precision='day';}}
 }
 if(['IND-001','IND-002'].includes(sourceId)&&!date){const posted=html.replace(/<[^>]*>/g,' ').match(/Posted On:\s*(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/i);if(posted){const month=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(posted[2].toUpperCase())+1;if(month)date=posted[3]+'-'+String(month).padStart(2,'0')+'-'+posted[1].padStart(2,'0')+'T00:00:00Z';precision='day';}}
 if(sourceId==='COAL-002'&&!date){title=decode(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g,'').trim());const shown=html.match(/field--name-created[^>]*>([A-Za-z]{3}) (\d{2}), (\d{4})/);if(shown){const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(shown[1])+1;if(month)date=shown[3]+'-'+String(month).padStart(2,'0')+'-'+shown[2]+'T00:00:00Z';precision='day';}meta.description=html.match(/field--name-body[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]*>/g,'');}
 if(!title||!date||!Number.isFinite(Date.parse(date)))return null;
 return {id:url,title,short_description:meta['og:description']||meta.description||'',url,date_published:new Date(date).toISOString(),publication_precision:precision};
}
export function publicationLinks(html,policy){
 const base=new URL(policy.endpoint),links=new Set();for(const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)){try{const url=new URL(decode(match[2]),base);if(url.origin===base.origin&&url.pathname.startsWith(policy.articlePath)&&url.pathname.length>policy.articlePath.length){url.hash='';links.add(url.href);}}catch{}}
 return [...links].slice(0,8);
}
export function multilingualActivity(row){
 const text=[row.title,row.short_description].join(' ').normalize('NFKC');
 const type=/exercise|exercic|exercí|ejercic|\bentrena\w*|exerc[íi]c|tatbikat|latihan|演習|演练|演习|훈련/i.test(text)?'EXERCISE':/patrol|patrouill|patrull|patrulh|devriye|哨戒|巡逻|순찰/i.test(text)?'PATROL_REPORTED':/déploi|despleg|desdobr|deploy(?:ed|ment)|intikal|展開|部署|전개/i.test(text)?'DEPLOYMENT_REPORTED':/port (?:visit|call)|escale|visita.*porto|visita.*puerto|liman.*ziyaret|寄港|访问|기항/i.test(text)?'PORT_VISIT':/transit|zarp[oó]|航行|통과/i.test(text)?'TRANSIT_REPORTED':null;
 const eventType=type||(/piracy|counter-piracy|maritime security.*(?:operation|joint|cooperation|activity)|\bnaval operation\b|\boperation.*\bnavy\b|\bnavy.*\boperation\b/i.test(text)?'MARITIME_OPERATION_REPORTED':null);if(!eventType)return null;
 const quoted=String(row.title).match(/\b(ARA|FS|HMS|USS|HMAS|HMNZS|TCG|PNS|INS)\s+[“"']([^”"']{2,80})[”"']/u);
 const country=quoted?({ARA:'AR',USS:'US',HMAS:'AU',HMNZS:'NZ',TCG:'TR',PNS:'PK',FS:'FR'})[quoted[1]]:null;
 const vesselClass=text.match(/(?:fr[ée]gate|fragata|corbeta|corvette|submarine|submarino)\s+(?:de (?:la )?)?(?:type|classe?|clase)\s+([A-ZÀ-Ý][\p{L}]+(?:\s+[A-ZÀ-Ý][\p{L}]+){0,2})/u)?.[1]||'';
 return {external_id:row.id,title:row.title,summary:row.short_description,source_url:row.url,published_at:row.date_published,publication_precision:row.publication_precision,event_type:eventType,vessel_name:quoted?quoted[1]+' '+quoted[2]:'',navy_country_iso2:country||null,vessel_class:vesselClass,observation_at:null};
}
export async function readPublication(source,{fetchImpl=fetch,grant}={}){
 const policy=publicationPolicies[source.id];if(!policy)throw Error('No reviewed publication policy');if(policy.requiresRights&&!hasPublicationRights(source.id,grant))throw Error('Documented commercial and automated-ingestion permission required');const requests=[];
 const get=async(url,allowMissing=false)=>{const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});requests.push({url,status:r.status});if(allowMissing&&[404,410].includes(r.status))return null;if(!r.ok){const error=Error('Publication unavailable');error.status=r.status;throw error;}const body=await r.text();if(body.length>2000000)throw Error('Publication exceeds limit');return body;};
 const index=await get(policy.endpoint,policy.singlePublication),rows=[],withdrawn=[];
 if(source.id==='BGD-001')return {rows:bangladeshPublications(index),requests,withdrawn};
 if(policy.singlePublication){const row=index&&articleMetadata(index,policy.endpoint,source.id);return {rows:row?[row]:[],requests,withdrawn:index===null?[policy.endpoint]:[]};}
 let urls;
 if(source.id==='IND-001'){if(/<!DOCTYPE|<!ENTITY/i.test(index))throw Error('Unsafe feed');const feed=await new Parser().parseString(index);urls=feed.items.filter(i=>/navy|naval|नौसेना|INS\s/i.test(i.title||'')).slice(0,8).map(i=>{const u=new URL(i.link);if(!['pib.gov.in','www.pib.gov.in'].includes(u.hostname)||u.protocol!=='https:')throw Error('PIB link outside source');u.hostname='www.pib.gov.in';u.searchParams.set('lang','1');u.searchParams.set('reg',new URL(policy.endpoint).searchParams.get('reg'));return u.href;});}
 else urls=publicationLinks(index,policy);
 for(const url of urls){const html=await get(url,true);if(html===null){withdrawn.push(url);continue;}if(/(?:copyright|droits r.serv.s).{0,80}(?:tiers|third.party)/i.test(html))continue;const meta=articleMetadata(html,url,source.id);if(meta)rows.push(meta);}
 return {rows,requests,withdrawn};
}
