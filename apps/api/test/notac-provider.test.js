import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotacProvider,normalizeNotacNotice,deduplicateNotices} from '../../shared/notice-providers.js';
import {createNoticeService,toNoticeStatusSignals} from '../src/routes.notices.js';
const at=Date.parse('2026-11-15T12:00:00Z'),bounds={minLon:55,minLat:0,maxLon:100,maxLat:40};
const input={id:'fixture-uuid',number:'A0001/26',affected_fir:'OPKR',status:'active',notam_type:'N',text:'Published fixture only',notam_issued:'2026-11-14T00:00:00Z',
 effective_start:'2026-11-14T00:00:00Z',effective_end:'2026-11-20T00:00:00Z',record_updated_at:'2026-11-14T00:00:00Z',country:{code:'PK',name:'Pakistan'},
 geography:{geojson:{type:'Point',coordinates:[66,24]},radius_nm:5},category:{code:'AIRSPACE'}};
const reply=(rows,extra={})=>Response.json({results:rows,next:null,next_cursor:'opaque-next',...extra},{headers:{'x-credits-remaining':'9997'}});
test('NOTAC preserves published geometry, source dates, scope and genuine original text',()=>{
 const n=normalizeNotacNotice(input,at);assert.equal(n.status,'active');assert.equal(n.noticeType,'airspace');assert.equal(n.country,'Pakistan');assert.equal(n.geometry.type,'Point');assert.equal(n.metadata.radiusNm,5);assert.equal(n.isMilitaryRelated,false);
 assert.equal(n.rawText,input.text);assert.equal(n.issuedAt,new Date(input.notam_issued).toISOString());assert.match(n.provenance.extraction,/E-line/);
 const absent=normalizeNotacNotice({...input,geography:null},at);assert.equal(absent.geometry,null);
 const polygon=normalizeNotacNotice({...input,text:'AREA BOUNDED BY 240000N0660000E 250000N0660000E 240000N0670000E',geography:null},at);assert.equal(polygon.geometry.type,'Polygon');
 const ambiguous=normalizeNotacNotice({...input,text:'AREA BOUNDED BY 240000N0660000E 250000N0670000E 240000N0670000E 250000N0660000E'},at);assert.equal(ambiguous.geometry.type,'Point');assert.equal(ambiguous.geometrySource,'published Q-line location');
 const signals=toNoticeStatusSignals([n]);assert.equal(signals[0].status,'reported');assert.equal(signals[0].coverage.includes('OPKR'),true);
 assert.equal(deduplicateNotices([n,{...n,provider:'other'}]).length,1);
});
test('NOTAC shares regional requests, follows bounded delta pages and retains original cache freshness',async()=>{
 let clock=at,calls=0;const p=createNotacProvider({NOTAC_ENABLED:'true',NOTAC_API_KEY:'fixture-key'},{now:()=>clock,fetchImpl:async(url,options)=>{
 calls++;assert.equal(options.headers.Authorization,'Bearer fixture-key');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('bbox'),'55,0,100,40');
 if(calls===1)return reply([input],{next:'https://notac.aero/api/v1/notam/delta/?bbox=55,0,100,40&cursor=page2',next_cursor:'page2'});
 if(calls===2)return reply([{...input,id:'second',number:'A0002/26'}]);
 assert.equal(url.searchParams.get('cursor'),'opaque-next');return reply([{id:input.id,number:input.number,text:input.text,status:'cancelled',record_archived_at:new Date(clock).toISOString(),record_updated_at:new Date(clock).toISOString()}]);
 }});
 const [a,b]=await Promise.all([p.fetchNotices(bounds),p.fetchNotices(bounds)]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.length,2);
 clock+=60000;const warm=await p.fetchNotices(bounds);assert.equal(calls,2);assert.equal(warm[0].lastFetchedAt,a[0].lastFetchedAt);
 clock+=1800000;const updated=await p.fetchNotices(bounds);assert.equal(updated.find(n=>n.sourceId==='A0001/26').status,'cancelled');assert.equal(calls,3);
});
test('NOTAC refuses credential redirects and external pagination; disabled providers do not request',async()=>{
 let calls=0;const p=createNotacProvider({NOTAC_ENABLED:'true',NOTAC_API_KEY:'fixture-key'},{now:()=>at,fetchImpl:async()=>{calls++;return reply([input],{next:'https://untrusted.example/steal'});}});
 await assert.rejects(p.fetchNotices(bounds),/pagination/);assert.equal(calls,1);
 const off=createNotacProvider({}, {fetchImpl:()=>{throw Error('must not request');}});assert.deepEqual(await off.fetchNotices(bounds),[]);
});
test('NOTAC credits exhaustion stops retries until the next UTC allowance period',async()=>{
 let clock=at,calls=0;const p=createNotacProvider({NOTAC_ENABLED:'true',NOTAC_API_KEY:'fixture-key'},{now:()=>clock,fetchImpl:async()=>{calls++;return calls===1?new Response('',{status:402,headers:{'x-credits-remaining':'0'}}):reply([input]);}});
 await assert.rejects(p.fetchNotices(bounds));await assert.rejects(p.fetchNotices(bounds));assert.equal(calls,1);clock=Date.parse('2026-12-01T00:01:00Z');await p.fetchNotices(bounds);assert.equal(calls,2);
});
test('NOTAC enablement reaches the existing notice service without another master flag; explicit disable still wins',async()=>{
 const provider=createNotacProvider({NOTAC_ENABLED:'true',NOTAC_API_KEY:'fixture-key'},{now:()=>at,fetchImpl:async()=>reply([input])});
 const service=createNoticeService({env:{NOTAC_ENABLED:'true'},now:()=>at,providers:[provider]});const result=await service.list({...bounds,military:'all'});assert.equal(result.state,'ready');assert.equal(result.notices.length,1);service.dispose();
 const disabled=createNoticeService({env:{NOTAC_ENABLED:'true',NOTICES_ENABLED:'false'},providers:[{diagnostics:()=>({availableForUse:true}),fetchNotices:()=>{throw Error('must not fetch');}}]});assert.equal((await disabled.list(bounds)).total,0);disabled.dispose();
});
test('dateline regions split into bounded provider scopes and deduplicate overlapping notices',async()=>{
 let calls=0;const p=createNotacProvider({NOTAC_ENABLED:'true',NOTAC_API_KEY:'fixture-key'},{now:()=>at,fetchImpl:async url=>{calls++;assert.ok(['170,-20,180,20','-180,-20,-170,20'].includes(url.searchParams.get('bbox')));return reply([input]);}});
 const rows=await p.fetchNotices({minLon:170,maxLon:-170,minLat:-20,maxLat:20});assert.equal(calls,2);assert.equal(rows.length,1);
 await assert.rejects(p.fetchNotices({minLon:999,maxLon:-170,minLat:-20,maxLat:20}),/bounds/);assert.equal(calls,2);
});
test('concurrent regional consumers retain their own notice snapshots',async()=>{
 const provider={id:'notac',diagnostics:()=>({availableForUse:true}),fetchNotices:async query=>[normalizeNotacNotice({...input,id:String(query.minLon),number:query.minLon===55?'A0001/26':'A0002/26',geography:{geojson:{type:'Point',coordinates:[Number(query.minLon)+1,24]}}},at)]};
 const service=createNoticeService({env:{NOTAC_ENABLED:'true'},providers:[provider],now:()=>at});
 const [a,b]=await Promise.all([service.list({...bounds,military:'all'}),service.list({...bounds,minLon:110,maxLon:130,military:'all'})]);
 assert.equal(a.notices.length,1);assert.equal(b.notices.length,1);assert.equal(a.notices[0].sourceId,'A0001/26');assert.equal(b.notices[0].sourceId,'A0002/26');service.dispose();
});

test('explicit published area variants produce validated polygons; unrelated points and invalid rings never do',()=>{
 for(const prefix of ['WITHIN THE AREA DEFINED BY:','AREA WITH THE FOLLOWING COORDINATES:','BOUNDED BY COORDS:']){
   const n=normalizeNotacNotice({...input,text:prefix+' 240000N0660000E 250000N0660000E 240000N0670000E'},at);
   assert.equal(n.geometry.type,'Polygon');assert.equal(n.metadata.radiusNm,undefined);
 }
 const positions=normalizeNotacNotice({...input,text:'PARKING STANDS 240000N0660000E 250000N0660000E 240000N0670000E'},at);assert.equal(positions.geometry.type,'Point');
 const bad=normalizeNotacNotice({...input,text:'BOUNDED BY 240000N0660000E 250000N0670000E 240000N0670000E 250000N0660000E'},at);assert.equal(bad.geometry.type,'Point');assert.match(bad.metadata.boundaryError,/self-intersecting/);
 const provided={type:'Polygon',coordinates:[[[66,24],[66,25],[67,24],[66,24]]]};
 const n=normalizeNotacNotice({...input,geography:{geojson:provided},text:'BOUNDED BY 240000N0660000E 250000N0670000E 240000N0670000E 250000N0660000E'},at);assert.deepEqual(n.geometry,provided);
});

test('published circular E-line and structured route/multi-area inputs preserve their geometry provenance',()=>{
 const circle=normalizeNotacNotice({...input,text:'WITHIN RADIUS 5 NM CENTERED ON 240000N0660000E',geography:{geojson:{type:'Point',coordinates:[60,20]},radius_nm:50}},at);
 assert.equal(circle.metadata.radiusSource,'published');assert.equal(circle.metadata.radiusNm,5);assert.deepEqual(circle.geometry.coordinates,[66,24]);assert.equal(circle.geometryAccuracy,'source stated');
 const route=normalizeNotacNotice({...input,geography:{geojson:{type:'LineString',coordinates:[[65,24],[67,26]]}}},at);assert.equal(route.geometry.type,'LineString');assert.match(route.geometrySource,/route/);
 const multiple=normalizeNotacNotice({...input,geography:{geojson:{type:'MultiPolygon',coordinates:[[[[65,24],[66,24],[66,25],[65,24]]],[[[70,24],[71,24],[71,25],[70,24]]]]}}},at);assert.equal(multiple.geometry.coordinates.length,2);
});
