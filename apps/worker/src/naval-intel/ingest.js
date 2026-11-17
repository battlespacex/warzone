import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeNavalActivity,sourceAccess} from '../../../shared/naval-intelligence.js';
import {publicFeeds,publicFeedAliases,readPublicFeed} from './public-feeds.js';
import {publicationPolicies,readPublication,multilingualActivity,hasPublicationRights} from './publications.js';
import {catalogEndpoints,readNavalCatalog} from './catalogs.js';
import {licensedFeeds,readLicensedFeed,hasFeedRights} from './licensed-feeds.js';
export const registry=JSON.parse(fs.readFileSync(new URL('./sources.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const hash=text=>createHash('sha256').update(text).digest('hex');
export function parseDvids(row){
    const text=[row.title,row.short_description,row.keywords].join(' ');
    if(!/\b(navy|naval|warship|destroyer|frigate|submarine|carrier|USS|HMS|HMAS|JS|INS|PLAN)\b/i.test(text))return null;
    const event_type=/port (visit|call)|arriv(?:es|ed|al)|visits?\b/i.test(text)?'PORT_VISIT':/exercis|drill/i.test(text)?'EXERCISE':/deploy/i.test(text)?'DEPLOYMENT_REPORTED':/transit/i.test(text)?'TRANSIT_REPORTED':/patrol/i.test(text)?'PATROL_REPORTED':null;
    if(!event_type)return null;
    const vessel=String(row.title||'').match(/\b(USS|HMS|HMAS|HMNZS|INS|JS|TCG|ROKS|PNS)\s+([\p{L}\d'-]+(?:\s+[\p{L}\d'-]+){0,2})/u);
    const region=text.match(/\b(?:Arabian Sea|South China Sea|East China Sea|Red Sea|Mediterranean Sea|Black Sea|Baltic Sea|Indian Ocean|Pacific Ocean|Atlantic Ocean|Gulf of Aden|Persian Gulf)\b/i)?.[0]||'';
    const vesselName=vessel?.[0]?.split(/\s+(?:Arriv|Depart|Visit|Conduct|Participat|Deploy|Return|Transits?|Sails?|Completes?)\w*\b/i)[0]||'';
    const hull=String(row.title||'').match(/\((CVN|SSN|SSBN|DDG|FFG|LPD|LHD|CG|LCS|LHA)\s*[- ]?\s*(\d{1,4})\)/);
    return {external_id:row.id,title:row.title,summary:row.short_description,source_url:row.url,published_at:row.date_published||row.publishdate,hull_number:hull?hull[1]+'-'+hull[2]:'',group_name:text.match(/\bCarrier Strike Group\s+\d+\b/i)?.[0]||'',
        // DVIDS date/city/country describe media creation, never a ship observation or position.
        observation_at:null,region,event_type,vessel_name:vesselName,navy_country_iso2:vessel?({USS:'US',HMAS:'AU',HMNZS:'NZ',JS:'JP',TCG:'TR',ROKS:'KR',PNS:'PK',HMS:/British|Royal Navy/i.test(text)?'GB':null,INS:/Indian Navy/i.test(text)?'IN':/Israeli Navy/i.test(text)?'IL':null})[vessel[1]]:null};
}
export function createNavalIntelRunner({db,env=process.env,fetchImpl=fetch,now=Date.now,random=Math.random,logger=console}={}){
    let pending=null,next=0,failures=0,providerNext=0;const feedHealth=new Map();
    const approved=String(env.NAVAL_INTEL_APPROVED_SOURCES||'').split(',').map(s=>s.trim());
    let rights=[];if(env.NAVAL_INTEL_RIGHTS_FILE){try{const text=fs.readFileSync(env.NAVAL_INTEL_RIGHTS_FILE,'utf8');if(text.length>100000)throw Error();const data=JSON.parse(text);if(!Array.isArray(data)||data.length>63)throw Error();rights=data;}catch{logger.warn('[naval-intel] invalid rights file; licensed adapters disabled');}}
    const save=async(table,row)=>{const {error}=await db.from(table).upsert(row);if(error)throw Error('Naval intelligence storage unavailable');};
    async function persist(source,input){
        const row=normalizeNavalActivity(input,source,now()),id=hash(source.id+':'+row.external_id),evidence={source_id:source.id,source_url:row.source_url,published_at:row.published_at,observation_at:row.observation_at,label:row.title};
        row.id=id;row.evidence=[evidence];
        await save('naval_evidence',{evidence_id:id,source_id:source.id,external_id:row.external_id,payload:{...evidence,source_quote_hash:hash(row.summary),license_status:row.license_status,retrieved_at:row.retrieved_at}});
        await save('naval_activity',{activity_id:id,source_id:source.id,published_at:row.published_at,valid_until:row.valid_until,checked_at:new Date(now()).toISOString(),payload:row});
    }
    async function fetchDvids(params){
        const url=new URL('https://api.dvidshub.net/search');for(const [key,value]of Object.entries({api_key:env.DVIDS_API_KEY,format:'json',...params}))url.searchParams.set(key,value);
        const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
        if(!response.ok){const error=Error('DVIDS request denied or unavailable');error.status=response.status;error.retryAfter=Number(response.headers.get('retry-after'));throw error;}
        const text=await response.text();if(text.length>2000000)throw Error('DVIDS response exceeds limit');const body=JSON.parse(text);if(!Array.isArray(body.results)||body.results.length>50)throw Error('Invalid DVIDS response');return body;
    }
    async function run(){
        if(env.NAVAL_INTEL_ENABLED==='false'||now()<next)return {state:'idle'};
        next=now()+Math.max(1800000,Number(env.NAVAL_INTEL_INTERVAL_MS)||3600000);
        let count=0;
        try{
            const selected=String(env.NAVAL_INTEL_SOURCE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
            for(const id of [...selected])if(publicFeedAliases[id])selected.push(publicFeedAliases[id]);
            for(const original of registry.sources){if(selected.length&&!selected.includes(original.id))continue;const source={...original,...(publicFeeds[original.id]||publicationPolicies[original.id]||{})};
                const access=sourceAccess(source,{key:Boolean(env.DVIDS_API_KEY),approved});
                const {data:previous,error}=await db.from('naval_source').select('cursor,payload').eq('source_id',source.id).maybeSingle();if(error)throw Error('Naval intelligence migration required');
                const health=source.id==='API-001'&&access==='ready'&&providerNext>now()?{access_status:'unavailable',last_error:previous?.payload?.last_error,retry_at:new Date(providerNext).toISOString()}:{};
                await save('naval_source',{source_id:source.id,payload:{...source,last_success:previous?.payload?.last_success||null,access_status:access,...health},cursor:previous?.cursor||null});
                if(publicFeedAliases[source.id]){await save('naval_source',{source_id:source.id,payload:{...source,access_status:'alias',canonical_source_id:publicFeedAliases[source.id]},cursor:null});continue;}
                if(licensedFeeds[source.id]){
                    const grant=rights.find(r=>hasFeedRights(source.id,r));if(!grant)continue;
                    const state=feedHealth.get(source.id)||{};if(now()<(state.retryAt||0))continue;
                    try{const rows=await readLicensedFeed(source.id,grant,{fetchImpl});let ingested=0;for(const row of rows){const input=parseDvids(row);if(!input)continue;await persist({...source,commercial_gate:'permission_on_file'},input);ingested++;count++;}
                        feedHealth.set(source.id,{retryAt:now()+6*3600000});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'ready',permission_reference:grant.permission_reference,last_success:new Date(now()).toISOString(),records_ingested:ingested},cursor:null});
                    }catch(error){feedHealth.set(source.id,{retryAt:now()+([401,403].includes(error.status)?86400000:Math.max(7200000,(error.retryAfter||0)*1000))});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'unavailable',last_error:error.status||'transport/parser/storage'},cursor:previous?.cursor||null});}
                    continue;
                }
                if(catalogEndpoints[source.id]&&env.NAVAL_INTEL_CATALOG_ENABLED==='true'){
                    try{const catalog=await readNavalCatalog(source.id,{fetchImpl});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'catalog_only',last_success:new Date(now()).toISOString(),catalog},cursor:null});}
                    catch(error){await save('naval_source',{source_id:source.id,payload:{...source,access_status:'unavailable',last_error:error.status||'transport/parser'},cursor:null});}continue;
                }
                const publicationGrant=rights.find(r=>hasPublicationRights(source.id,r));
                if(publicationPolicies[source.id]&&(access==='ready'||publicationGrant)){
                    const state=feedHealth.get(source.id)||{};if(now()<(state.retryAt||0))continue;
                    try{const result=await readPublication(source,{fetchImpl,grant:publicationGrant});let ingested=0;
                        for(const item of result.rows){const input=multilingualActivity(item);if(!input)continue;input.summary=source.attribution+' '+input.summary;await persist(publicationGrant?{...source,commercial_gate:'permission_on_file'}:source,input);ingested++;count++;}
                        for(const url of result.withdrawn||[]){const {data:saved,error}=await db.from('naval_activity').select('*').eq('activity_id',hash(source.id+':'+url)).maybeSingle();if(error)throw Error('Naval intelligence storage unavailable');if(saved)await save('naval_activity',{...saved,checked_at:new Date(now()).toISOString(),payload:{...saved.payload,review_status:'withdrawn'}});}
                        feedHealth.set(source.id,{retryAt:now()+(Number(source.refreshMs)||6*3600000)});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'ready',last_success:new Date(now()).toISOString(),records_ingested:ingested},cursor:null});
                    }catch(error){feedHealth.set(source.id,{retryAt:now()+([401,403].includes(error.status)?86400000:7200000)});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'unavailable',last_error:error.status||'transport/parser/storage'},cursor:previous?.cursor||null});logger.warn('[naval-intel] publication isolated',source.id,error.status||'transport/parser/storage');}
                }
                if(publicFeeds[source.id]&&access==='ready'){
                    const state=feedHealth.get(source.id)||{};
                    if(now()<(state.retryAt||0))continue;
                    try{const feed=await readPublicFeed(source,{fetchImpl,etag:state.etag,lastModified:state.lastModified});let ingested=0;
                        for(const item of feed.items){if(!/\b(navy|naval|HMS|USS|HMAS|submarine|warship|destroyer|frigate)\b/i.test(item.title||'')||/\b(export deal|procurement|contract|scale-up)\b/i.test(item.title||''))continue;const input=parseDvids({id:item.guid||item.id||item.link,title:item.title,short_description:item.contentSnippet||item.summary||'',url:item.link,date_published:item.published||item.pubDate});if(!input)continue;
                            // Atom updated is not necessarily the article's original publication time.
                            input.summary=source.attribution+' '+input.summary;await persist(source,input);ingested++;count++;}
                        feedHealth.set(source.id,{...state,...feed,items:undefined,retryAt:0,failures:0});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'ready',last_success:new Date(now()).toISOString(),records_ingested:ingested,unchanged:feed.unchanged===true},cursor:previous?.cursor||null});
                    }catch(error){const failures=(state.failures||0)+1,retryAt=now()+Math.max((error.retryAfter||0)*1000,[401,403].includes(error.status)?86400000:Math.min(21600000,1800000*2**Math.min(failures,4)));
                        feedHealth.set(source.id,{...state,failures,retryAt});await save('naval_source',{source_id:source.id,payload:{...source,access_status:'unavailable',last_error:error.status||'transport/parser/storage',retry_at:new Date(retryAt).toISOString()},cursor:previous?.cursor||null});logger.warn('[naval-intel] public feed isolated',source.id,error.status||'transport/parser/storage');}
                }
                if(source.id==='API-001'&&access==='ready'&&now()>=providerNext){try{
                    const start=previous?.cursor?Date.parse(previous.cursor)-86400000:now()-14*86400000;
                    let newest=previous?.cursor||null,complete=false;
                    for(let page=1;page<=4;page++){
                        const body=await fetchDvids({branch:'Navy',type:'news',sort:'publishdate',sortdir:'asc',max_results:50,page,from_publishdate:new Date(start).toISOString(),short_description_length:300});
                        for(const item of body.results){const input=parseDvids(item);if(input){try{await persist(source,input);count++;}catch(error){if(error.message==='Naval intelligence storage unavailable')throw error;logger.warn('[naval-intel] rejected invalid report');}}const published=item.date_published||item.publishdate;if(Number.isFinite(Date.parse(published))&&(!newest||published>newest))newest=published;}
                        if(body.results.length<50){complete=true;break;}
                    }
                    // Advance after successful persisted pages; overlap rechecks edits without duplicate events.
                    if(newest)await save('naval_source',{source_id:source.id,cursor:newest,payload:{...source,access_status:'ready',last_success:new Date(now()).toISOString(),page_cap_reached:!complete}});
                    const {data:old,error:oldError}=await db.from('naval_activity').select('*').eq('source_id',source.id).lt('checked_at',new Date(now()-6*3600000).toISOString()).order('checked_at').limit(10);if(oldError)throw Error('Naval intelligence storage unavailable');
                    for(const saved of old||[]){const result=await fetchDvids({id:saved.payload.external_id,max_results:1,short_description_length:300});const input=result.results[0]&&parseDvids(result.results[0]);if(input)await persist(source,input);else await save('naval_activity',{...saved,checked_at:new Date(now()).toISOString(),payload:{...saved.payload,review_status:'withdrawn'}});}
                    failures=0;
                }catch(error){providerNext=now()+([401,403].includes(error.status)?86400000:Math.max((error.retryAfter||0)*1000,1800000*2**Math.min(++failures,4)))*(1+random()*.1);
                    await save('naval_source',{source_id:source.id,cursor:previous?.cursor||null,payload:{...source,access_status:'unavailable',last_error:error.status||'transport/parser/storage',retry_at:new Date(providerNext).toISOString()}});logger.warn('[naval-intel] DVIDS isolated',error.status||'transport/parser/storage');}}
            }
            if(env.NAVAL_INTEL_IMPORT_FILE){const text=fs.readFileSync(env.NAVAL_INTEL_IMPORT_FILE,'utf8');if(text.length>5000000)throw Error('Import exceeds limit');const items=JSON.parse(text);if(!Array.isArray(items)||items.length>500)throw Error('Import limit exceeded');for(const item of items){const source=registry.sources.find(s=>s.id===item.source_id);if(!source||sourceAccess(source,{approved})!=='approved_import')continue;await persist(source,item);count++;}}
            logger.info('[naval-intel] persisted',count);return {state:'ok',count};
        }catch(error){failures++;const delay=[401,403].includes(error.status)?86400000:Math.max((error.retryAfter||0)*1000,Math.min(21600000,1800000*2**Math.min(failures,5)))*(1+random()*.1);next=now()+delay;
            // Never log raw errors/URLs: DVIDS authenticates using a query parameter.
            logger.warn('[naval-intel] isolated',error.status||'storage/parser',new Date(next).toISOString());return {state:'unavailable',status:error.status||null};}
    }
    return {run(){if(pending)return pending;pending=run().finally(()=>{pending=null;});return pending;}};
}
