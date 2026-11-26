import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNotice,extractNoticeArea,noticeGeometryClassification,noticeGeometryParts,validateGeometry,containsNotice,intersectsBounds} from '../../shared/geospatial-notices.js';
import {createNoticeService} from '../src/routes.notices.js';
import {deduplicateNotices} from '../../shared/notice-providers.js';
const at=Date.parse('2026-11-20T12:00:00Z');
const base={provider:'fixture',issuer:'TEST',sourceId:'A0001/26',noticeType:'notam',sourceUrl:'https://example.org/notice',rawText:'Synthetic fixture only',effectiveFrom:'2026-11-19T00:00:00Z',effectiveUntil:'2026-11-21T00:00:00Z'};
const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[1,2],[2,2],[2,1],[1,1]];
test('published polygons with holes, mixed collections and explicit circles survive validation and containment',()=>{
    const geometry=validateGeometry({type:'GeometryCollection',geometries:[{type:'Polygon',coordinates:[outer,hole]},{type:'Circle',coordinates:[20,20],radiusMeters:5000}]});
    assert.equal(noticeGeometryParts(geometry).length,2);
    const n=normalizeNotice({...base,geometry},at);
    assert.equal(noticeGeometryClassification(n),'Published boundary');
    assert.equal(containsNotice(n,.5,.5),true);assert.equal(containsNotice(n,1.5,1.5),false);assert.equal(containsNotice(n,20,20),true);
    assert.equal(intersectsBounds(n,{minLon:19.9,maxLon:20.1,minLat:19.9,maxLat:20.1}),true);
    assert.throws(()=>validateGeometry({type:'Polygon',coordinates:[outer,[[10,10],[11,10],[10,11],[10,10]]]}));
});
test('body-derived circles, explicit corridors and separate areas replace approximate points without inheriting Q-line radius',()=>{
    const texts=[
        ['AREA BOUNDED BY 240000N0660000E 250000N0660000E 240000N0670000E','Polygon'],
        ['WITHIN 5 NM RADIUS CENTERED ON 240000N0660000E','Point'],
        ['CORRIDOR WIDTH 2 KM ALONG LINE 240000N0660000E 250000N0670000E','LineString'],
        ['AREA 1: BOUNDED BY 240000N0660000E 250000N0660000E 240000N0670000E AREA 2: RADIUS 3 NM CENTERED ON 260000N0680000E','GeometryCollection'],
    ];
    for(const [rawText,type]of texts){const n=normalizeNotice({...base,rawText,geometry:{type:'Point',coordinates:[60,20]},metadata:{radiusNm:90,radiusSource:'q-line'}},at);
        assert.equal(n.geometry.type,type);assert.equal(noticeGeometryClassification(n),'Derived boundary');
        if(type!=='Point')assert.equal(n.metadata.radiusNm,undefined);
        if(type==='LineString')assert.equal(n.metadata.corridorWidthMeters,2000);
        if(type==='GeometryCollection')assert.equal(n.geometry.geometries[1].radiusMeters,3*1852);
    }
});
test('explicit true-bearing sectors retain their arc; ambiguous arcs and unrelated positions do not become polygons',()=>{
    const sector='SECTOR CENTERED ON 240000N0660000E RADIUS 5 NM FROM 090 DEG TRUE TO 180 DEG TRUE CLOCKWISE';
    const n=normalizeNotice({...base,rawText:sector},at);
    assert.equal(n.geometry.type,'Polygon');assert.ok(n.geometry.coordinates[0].length>10);assert.equal(noticeGeometryClassification(n),'Derived boundary');
    assert.equal(extractNoticeArea(sector.replaceAll('TRUE','MAGNETIC')),null);
    assert.equal(extractNoticeArea('ARC CENTERED ON 240000N0660000E 250000N0670000E 240000N0670000E'),null);
    assert.equal(extractNoticeArea('PARKING STANDS 240000N0660000E 250000N0660000E 240000N0670000E'),null);
});
test('provider geometry wins over conflicting text and all five geography classifications are explicit',()=>{
    const published=normalizeNotice({...base,rawText:'RADIUS 5 NM CENTERED ON 240000N0660000E',geometry:{type:'Polygon',coordinates:[outer]}},at);
    assert.deepEqual(published.geometry.coordinates,[outer]);
    assert.equal(noticeGeometryClassification(published),'Published boundary');
    assert.equal(noticeGeometryClassification({...base,geometry:null}),'Unavailable');
    assert.equal(noticeGeometryClassification({...base,geometry:{type:'Point',coordinates:[0,0]}}),'Location only');
    assert.equal(noticeGeometryClassification({...base,geometry:{type:'Point',coordinates:[0,0]},metadata:{radiusNm:5,radiusSource:'q-line'}}),'Approximate coverage');
});
test('server diagnostics distinguish regional filtering and geometry; every page retains all distinct records',async()=>{
    const records=Array.from({length:451},(_,i)=>({...base,sourceId:`A${String(i).padStart(4,'0')}/26`,isMilitaryRelated:i%2===0,geometry:{type:'Point',coordinates:[10,50]}}));
    records.push({...base,sourceId:'B0001/26',geometry:{type:'Point',coordinates:[100,10]}});
    const service=createNoticeService({env:{NOTICES_ENABLED:'true',NOTICES_IMPORT_USAGE_APPROVED:'true',NOTICES_IMPORT_FILE:'fixture'},now:()=>at,providers:[],readFile:async()=>Buffer.from(JSON.stringify(records))});
    const query={minLon:-12,maxLon:20,minLat:35,maxLat:62,status:'all',military:'all',layers:'aviation-notam',limit:200};
    try {
        const ids=new Set();let offset=0;
        while(offset!==null){const data=await service.list({...query,offset});for(const n of data.notices)ids.add(n.id);assert.equal(data.total,451);assert.equal(data.diagnostics.recordsReceived,451);offset=data.pagination.nextOffset;}
        assert.equal(ids.size,451);
        const filtered=await service.list({...query,military:'related'});
        assert.equal(filtered.total,226);assert.equal(filtered.diagnostics.recordsFilteredOut,225);assert.equal(filtered.diagnostics.matchedGeometry['Location only'],226);
        assert.equal(filtered.diagnostics.rendered,null,'backend does not invent browser rendering counts');
    } finally {service.dispose();}
});

test('same-publication dedup retains the stronger boundary, but a genuinely newer correction still wins',()=>{
    const point=normalizeNotice({...base,geometry:{type:'Point',coordinates:[10,50]},metadata:{radiusNm:5,radiusSource:'q-line'}},at);
    const area=normalizeNotice({...base,provider:'aviation_edge',geometry:{type:'Polygon',coordinates:[outer]}},at);
    const result=deduplicateNotices([{...point,provider:'autorouter'},area]);
    assert.equal(result.length,1);assert.equal(result[0].geometry.type,'Polygon');assert.equal(result[0].sourceRecords.length,2);
    const newer={...point,metadata:{...point.metadata,updatedAt:new Date(at+1000).toISOString()}};
    assert.equal(deduplicateNotices([area,newer])[0].geometry.type,'Point');
    assert.equal(deduplicateNotices([area,{...area,issuer:'OTHER',fir:'OTHER'}]).length,2);
});

test('bounded upstream snapshots advertise partial coverage without increasing provider calls',async()=>{
    let calls=0;const rows=Array.from({length:201},(_,i)=>({...base,sourceId:`A${String(i).padStart(4,'0')}/26`,geometry:{type:'Point',coordinates:[10,50]}}));
    const service=createNoticeService({env:{NOTICES_ENABLED:'true',SKYSPY_ENABLED:'true',SKYSPY_NOTAMS_ENABLED:'true',SKYSPY_USAGE_APPROVED:'true'},now:()=>at,providers:[],skyspy:{get:async()=>{calls++;return {results:rows,next:true,total:201};},diagnostics:()=>({})}});
    try {const result=await service.list({military:'all',status:'all'});assert.equal(result.total,200);assert.equal(result.partial,true);assert.equal(calls,3);} finally {service.dispose();}
});
