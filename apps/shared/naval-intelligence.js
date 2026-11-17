// Reported activity is deliberately separate from the live AIS identity/position pipeline.
import {validateGeometry,intersectsBounds} from './geospatial-notices.js';
const clean=(value,max=300)=>String(value||'').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
export const NAVAL_EVENTS=['PORT_VISIT','DEPLOYMENT_REPORTED','EXERCISE','TRANSIT_REPORTED','PATROL_REPORTED','SCHEDULED_EVENT','SATELLITE_OBSERVATION','OSINT_ESTIMATED_AREA','MARITIME_OPERATION_REPORTED'];
export function sourceAccess(source,{key=false,approved=[]}={}){
    if(source.id==='USA-001'&&source.commercial_gate==='us_government_public_information')return 'ready';
    if(source.id==='UK-001'&&source.commercial_gate==='open_government_licence')return 'ready';
    if(['FRA-001','ARG-001','COAL-002','IND-001','IND-002'].includes(source.id)&&source.commercial_gate==='reviewed_open_publication')return 'ready';
    if(source.id==='API-001')return key?'ready':'not_configured';
    if(!source.implement_adapter||source.commercial_gate==='none')return 'directory_only';
    if(['noncommercial_only','commercial_contract_required','member_with_conditions','permission_required'].includes(source.commercial_gate))return 'blocked';
    return approved.includes(source.id)?'approved_import':'approval_required';
}
export function normalizeNavalActivity(input,source,now=Date.now()){
    const published=Date.parse(input.published_at);if(!Number.isFinite(published)||published>now+300000)throw Error('Valid publication time required');
    const url=new URL(input.source_url);const host=new URL(source.url).hostname.replace(/^www\./,'');
    if(url.protocol!=='https:'||url.username||url.password||!(url.hostname.replace(/^www\./,'')===host||source.id==='API-001'&&url.hostname==='www.dvidshub.net'))throw Error('Source URL is outside registry');
    if(!input.external_id||!NAVAL_EVENTS.includes(input.event_type))throw Error('Invalid activity identity/type');
    if(String(input.external_id).length>2048)throw Error('Activity identity exceeds limit');
    let geometry=null,role='NONE';
    if(input.geometry){geometry=validateGeometry(input.geometry);role=input.geometry_role;
        if(!['PUBLISHED_OBSERVED_POINT','PUBLIC_PORT_REFERENCE','PUBLISHED_POLYGON'].includes(role)||!input.geometry_evidence)throw Error('Published geometry evidence required');
        if(role==='PUBLISHED_POLYGON'&&!['Polygon','MultiPolygon'].includes(geometry.type)||role!=='PUBLISHED_POLYGON'&&geometry.type!=='Point')throw Error('Geometry role mismatch');
        if(role==='PUBLISHED_OBSERVED_POINT'&&!Number.isFinite(Date.parse(input.observation_at)))throw Error('Observed point requires observation time');
    }else if(input.region)role='NAMED_REGION_ONLY';
    const ttl=input.event_type==='DEPLOYMENT_REPORTED'?14*86400000:72*3600000;
    const until=input.valid_until?Date.parse(input.valid_until):published+ttl;if(!Number.isFinite(until)||until<published)throw Error('Invalid expiry');
    return {source_id:source.id,external_id:clean(input.external_id,2048),title:clean(input.title),summary:clean(input.summary,500),
        vessel_name:clean(input.vessel_name,120),navy_country_iso2:/^[A-Z]{2}$/.test(input.navy_country_iso2||'')?input.navy_country_iso2:null,
        group_name:clean(input.group_name,120),hull_number:clean(input.hull_number,40),vessel_class:clean(input.vessel_class,80),event_type:input.event_type,
        region:clean(input.region,160),region_code:clean(input.region_code,40),geometry,geometry_role:role,precision_class:geometry?(role==='PUBLIC_PORT_REFERENCE'?'PUBLIC_PORT':role==='PUBLISHED_POLYGON'?'REGION':'OBSERVED_COORDINATE'):'UNKNOWN',
        geometry_evidence:clean(input.geometry_evidence),source_url:url.href,source_name:source.name,published_at:new Date(published).toISOString(),publication_precision:input.publication_precision==='day'?'day':'timestamp',
        observation_at:Number.isFinite(Date.parse(input.observation_at))?new Date(input.observation_at).toISOString():null,
        valid_until:new Date(until).toISOString(),retrieved_at:new Date(now).toISOString(),status:until<=now?'historical':'reported',
        confidence:source.category==='Government API'||/official/i.test(source.category||'')?'Official report':'Single-source / Unverified',
        review_status:'published',license_status:source.commercial_gate,live:false};
}
export function selectNavalActivities(rows,{bbox,history=false,limit=100,now=Date.now()}={}){
    const seen=new Map();
    for(const item of rows){const row={...item,status:Date.parse(item.valid_until)<=now?'historical':'reported'};
        if(row.review_status&&row.review_status!=='published')continue;
        if(!history&&row.status==='historical'||bbox&&row.geometry&&!intersectsBounds({geometry:row.geometry},bbox))continue;
        // Cross-source merge requires explicit navy + hull + matching activity, place and date.
        const key=row.navy_country_iso2&&row.hull_number?[row.navy_country_iso2,row.hull_number,row.event_type,row.region,row.published_at.slice(0,10)].join('|'):row.id;
        const previous=seen.get(key);if(previous){if(previous.vessel_name&&row.vessel_name&&previous.vessel_name.toUpperCase()!==row.vessel_name.toUpperCase()){previous.identity_conflict=true;seen.set(row.id,{...row,identity_conflict:true});continue;}previous.evidence.push(...(row.evidence||[]));continue;}seen.set(key,{...row,evidence:[...(row.evidence||[])]});
    }return [...seen.values()].slice(0,limit);
}
