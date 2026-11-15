import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNotam,parseMaritimeWarning,parseCoordinates,coordinate,parseAltitude,normalizeNotice,noticeStatus,validateGeometry,containsNotice,intersectsBounds,correlateObservation,matchesNoticeLayers} from '../../shared/geospatial-notices.js';
import {createNoticeService,noticesRouter} from '../src/routes.notices.js';
import {createSkySpyClient} from '../../shared/skyspy-client.js';
import {createSkySpyStream} from '../../shared/skyspy-stream.js';
import {createOfficialNoticeAdapter,skySpyNotice} from '../../shared/notice-providers.js';
import {importDocument} from '../../../scripts/import-geospatial-notices.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const at=Date.parse('2026-11-15T12:00:00Z');
const context={provider:'approved-import',issuer:'Test authority',sourceUrl:'https://example.org/publication',isMilitaryRelated:true};
// Synthetic parser fixtures only; these are never installed as application observations.
const raw='A0001/26 NOTAMN\nQ) OPKR/QWMLW/IV/BO/W/000/100/2450N06630E010\nA) OPKR\nB) 2611150000\nC) 2611162359\nD) DAILY 1000-1400 UTC\nE) TEST FIRING AREA\nF) SFC\nG) FL100';
const input={...context,sourceId:'001/26',noticeType:'navarea',rawText:'Parser fixture',effectiveFrom:'2026-11-15T00:00:00Z',effectiveUntil:'2026-11-16T00:00:00Z',
    geometry:{type:'Polygon',coordinates:[[[65,24],[67,24],[67,26],[65,26]]]}};
const serviceEnv={NOTICES_ENABLED:'true',NOTICES_IMPORT_USAGE_APPROVED:'true',NOTICES_IMPORT_FILE:'private-notices.json'};
const skyspy={get:async()=>({results:[]}),diagnostics:()=>({})};

test('ICAO fields, Q-line circle and geographic precision remain distinct',()=>{
    const n=parseNotam(raw,{...context,now:at});assert.equal(n.sourceId,'A0001/26');assert.equal(n.fir,'OPKR');assert.equal(n.status,'active');
    assert.equal(n.metadata.radiusNm,10);assert.equal(n.metadata.qCode,'QWMLW');assert.equal(n.metadata.altitudes.upper.value,10000);
    assert.equal(n.geometryAccuracy,'approximate area of influence');assert.deepEqual(n.geometry.coordinates,[66.5,24+50/60]);
});
test('published E-line polygon takes precedence over Q-line influence',()=>{
    const n=parseNotam(raw.replace('TEST FIRING AREA','245000N 0663000E 250000N 0670000E 253000N 0663000E'),{...context,now:at});
    assert.equal(n.geometry.type,'Polygon');assert.equal(n.geometry.coordinates[0].length,4);assert.equal(n.metadata.radiusNm,undefined);
});
test('DMS, decimal minutes, decimal degrees and hemispheres parse accurately',()=>{
    assert.deepEqual(parseCoordinates('24°30\'30"S 066°15\'00"W'),[[-66.25,-(24.5+30/3600)]]);
    assert.deepEqual(parseCoordinates('24°30.5 N 066°15.5 E'),[[66+15.5/60,24+30.5/60]]);
    assert.deepEqual(parseCoordinates('24.5N 66.25E'),[[66.25,24.5]]);assert.throws(()=>coordinate(90,1,0,'N'));
    assert.deepEqual(parseCoordinates('24-30.5N 066-15.5E'),[[66+15.5/60,24+30.5/60]]);
    assert.deepEqual(parseCoordinates('24 30 30 N 066 15 00 E'),[[66.25,24.5+30/3600]]);
});
test('altitudes preserve FL, surface, MSL/AGL and unknown references',()=>{
    assert.equal(parseAltitude('FL120').value,12000);assert.equal(parseAltitude('SFC').reference,'surface');
    assert.equal(parseAltitude('500 M AGL').reference,'AGL');assert.equal(parseAltitude('UNL').reference,'unlimited');assert.equal(parseAltitude('bad').value,null);
});
test('validity, overnight recurring UTC schedules, EST and PERM are conservative',()=>{
    const n=normalizeNotice(input,at);assert.equal(noticeStatus(n,at),'active');assert.equal(noticeStatus(n,at-86400000),'upcoming');assert.equal(noticeStatus(n,at+86400000),'expired');
    assert.equal(noticeStatus({...n,schedule:'MON WED EXC HOL'},at),'unknown');
    assert.equal(noticeStatus({...n,schedule:'DAILY 2300-0200'},Date.parse('2026-11-15T01:00:00Z')),'active');
    assert.equal(noticeStatus({...n,metadata:{estimated:true}},at+86400000),'unknown');
    assert.equal(noticeStatus({...n,effectiveUntil:null,metadata:{permanent:true}},at),'active');
    assert.equal(noticeStatus({...n,effectiveFrom:null},at),'unknown');
});
test('NOTAMC and NOTAMR preserve replacement identifiers',()=>{
    const n=parseNotam(raw.replace('A0001/26 NOTAMN','A0002/26 NOTAMC A0001/26'),{...context,now:at});
    assert.equal(n.status,'cancelled');assert.equal(n.replacesNoticeId,'A0001/26');
});
test('maritime polygon, radius units, warning identity and absent location',()=>{
    const n=parseMaritimeWarning('NAVAREA IX 123/26\n243000N 0663000E 250000N 0670000E 253000N 0663000E',context);
    assert.equal(n.geometry.type,'Polygon');assert.equal(n.navarea,'IX');assert.equal(n.status,'unknown');
    const circle=parseMaritimeWarning('NAVAREA IX 124/26 24.5N 66.5E RADIUS 10 KM',context);assert.ok(Math.abs(circle.metadata.radiusNm-10000/1852)<1e-10);
    assert.equal(parseMaritimeWarning('NAVAREA IX 125/26 NO POSITIONS PUBLISHED',context).geometry,null);
});
test('invalid coordinates, intersections, duplicated vertices and degenerate polygons reject',()=>{
    assert.throws(()=>validateGeometry({type:'Point',coordinates:[181,0]}));
    for(const ring of [[[0,0],[2,2],[0,2],[2,0]],[[0,0],[1,0],[1,0],[0,1]],[[0,0],[1,1],[2,2]]])assert.throws(()=>validateGeometry({type:'Polygon',coordinates:[ring]}));
    assert.throws(()=>normalizeNotice({...input,sourceUrl:'javascript:alert(1)'}));assert.throws(()=>normalizeNotice({...input,rawText:''}));
});
test('dateline polygons contain correct locations and regional queries avoid opposite hemisphere',()=>{
    const n=normalizeNotice({...input,geometry:{type:'Polygon',coordinates:[[[179,10],[-179,10],[-179,12],[179,12]]]}},at);
    assert.equal(containsNotice(n,179.5,11),true);assert.equal(containsNotice(n,0,11),false);
    assert.equal(intersectsBounds(n,{minLat:9,maxLat:13,minLon:178,maxLon:-178}),true);
    assert.equal(intersectsBounds(n,{minLat:9,maxLat:13,minLon:0,maxLon:20}),false);
    const circle=normalizeNotice({...input,geometry:{type:'Point',coordinates:[179.9,11]},metadata:{radiusNm:30}},at);
    assert.equal(intersectsBounds(circle,{minLat:10,maxLat:12,minLon:-180,maxLon:-179}),true);
});
test('circle containment uses geodesic distance and overlap never infers participation',()=>{
    const n=parseNotam(raw,{...context,now:at});assert.equal(containsNotice(n,66.5,24+50/60),true);assert.equal(containsNotice(n,70,30),false);
    const result=correlateObservation(n,{longitude:66.5,latitude:24+50/60,observed_at:new Date(at).toISOString()},at);
    assert.equal(result.temporalOverlap,true);assert.match(result.evidence,/does not establish participation/);
});
test('independent layers and exercise classification do not double count a record',()=>{
    const n=normalizeNotice({...input,activityType:'weapon firing'},at);
    assert.equal(matchesNoticeLayers(n,['naval-warnings','military-exercises']),true);
    assert.equal(matchesNoticeLayers({...n,activityType:''},['military-exercises']),false);
    assert.equal(matchesNoticeLayers(n,['aviation-notam']),false);
});
test('disabled and unapproved official adapters never fetch',()=>{
    assert.equal(createOfficialNoticeAdapter('aai').enabled,false);assert.equal(createOfficialNoticeAdapter('navareaIX').enabled,false);
    assert.throws(()=>skySpyNotice({id:123,text:'No authoritative field mapping'}));
});
test('service deduplicates, supersedes, paginates, filters geography and shares refresh',async()=>{
    let reads=0;const data=[input,input,{...input,sourceId:'002/26',replacesNoticeId:'001/26'},{...input,sourceId:'003/26',geometry:{type:'Point',coordinates:[-120,45]}}];
    const service=createNoticeService({env:serviceEnv,now:()=>at,skyspy,readFile:async()=>{reads++;return Buffer.from(JSON.stringify(data));}});
    const [a]=await Promise.all([service.list({status:'all',minLat:23,maxLat:27,minLon:64,maxLon:68,limit:1}),service.list()]);
    assert.equal(reads,1);assert.equal(a.total,2);assert.equal(a.notices.length,1);assert.equal(a.notices[0].status,'superseded');
    assert.equal((await service.list({status:'active'})).total,2);await assert.rejects(service.list({minLat:'bad'}));service.dispose();
});
test('outage retains previously validated data and original freshness',async()=>{
    let clock=at,fail=false;const service=createNoticeService({env:serviceEnv,now:()=>clock,skyspy,readFile:async()=>{if(fail)throw Error('unavailable');return Buffer.from(JSON.stringify([input]));}});
    const initial=await service.list();fail=true;clock+=61000;const next=await service.list();
    assert.equal(next.notices.length,1);assert.equal(next.notices[0].lastFetchedAt,initial.notices[0].lastFetchedAt);assert.equal(next.providers.import,'unavailable');service.dispose();
});
test('disabled service does no file or provider work; dispose blocks stale publication',async()=>{
    const service=createNoticeService({env:{},skyspy,readFile:()=>{throw Error('must not read');}});assert.equal((await service.list()).total,0);service.dispose();
    let finish;const pending=createNoticeService({env:serviceEnv,skyspy,readFile:()=>new Promise(resolve=>{finish=resolve;})});const call=pending.list();pending.dispose();finish(Buffer.from(JSON.stringify([input])));assert.equal((await call).total,0);
});
test('route ETag supports 304 without credentials or local paths',async()=>{
    const router=noticesRouter(createNoticeService({env:serviceEnv,now:()=>at,skyspy,readFile:async()=>Buffer.from(JSON.stringify([input]))}));
    const route=router.stack.find(layer=>layer.route?.path==='/').route.stack[0].handle;
    let headers={},data,status=200;const res={set(value){Object.assign(headers,value);return this;},status(value){status=value;return this;},json(value){data=value;},end(){}};
    await route({query:{},headers:{}},res);assert.equal(status,200);assert.ok(headers.ETag);assert.equal(data.notices.length,1);
    await route({query:{},headers:{'if-none-match':headers.ETag}},res);assert.equal(status,304);assert.equal(JSON.stringify(data).includes('private-notices.json'),false);
});
test('SkySpy credentials stay backend-only; cache and concurrent deduplication are bounded',async()=>{
    let calls=0;const client=createSkySpyClient({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],apiKey:'private-key',now:()=>at,
        fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers['X-API-Key'],'private-key');assert.equal(url.pathname,'/api/v1/notams/');return new Response(JSON.stringify({notams:[]}));}});
    await Promise.all([client.get('/notams/'),client.get('/notams/')]);await client.get('/notams/');assert.equal(calls,1);assert.equal(JSON.stringify(client.diagnostics()).includes('private-key'),false);
});
for(const code of [401,403,429])test(`SkySpy HTTP ${code} isolates source and does not retry during backoff`,async()=>{
    let calls=0;const client=createSkySpyClient({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],now:()=>at,
        fetchImpl:async()=>{calls++;return new Response('',{status:code,headers:{'Retry-After':'120'}});}});
    await assert.rejects(client.get('/notams/'));await assert.rejects(client.get('/notams/'));assert.equal(calls,1);assert.equal(client.diagnostics().lastStatus,code);
});
test('SkySpy rejects disabled access, private origins, redirects and malformed responses',async()=>{
    await assert.rejects(createSkySpyClient().get('/notams/'));
    for(const baseUrl of ['http://feed.example.org','https://127.0.0.1','https://172.16.0.1','https://feed.example.org/?token=x']){
        const client=createSkySpyClient({enabled:true,usageApproved:true,baseUrl,allowedHosts:[new URL(baseUrl).hostname],fetchImpl:()=>{throw Error('must not fetch');}});await assert.rejects(client.get('/notams/'));}
    const client=createSkySpyClient({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],fetchImpl:async()=>new Response('bad-json')});await assert.rejects(client.get('/notams/'));
});
test('native stream subscribes with native JSON and releases timers/connections',()=>{
    const tasks=new Map();let count=0,closed=0;const sent=[],events=[];const socket={send:text=>sent.push(JSON.parse(text)),close(){closed++;}};
    const stream=createSkySpyStream({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],topics:['notams'],token:'private',
        createWebSocket(url,protocols){assert.equal(url,'wss://feed.example.org/ws/all/');assert.deepEqual(protocols,['Bearer','private']);return socket;},
        setTimer(fn){tasks.set(++count,fn);return count;},clearTimer:id=>tasks.delete(id),onEvent:(...args)=>events.push(args),now:()=>at});
    stream.start();socket.onopen();assert.deepEqual(sent[0],{action:'subscribe',topics:['notams']});
    socket.onmessage({data:JSON.stringify({type:'notams:tfr_new',data:{id:'fixture'}})});assert.equal(events.length,1);
    socket.onclose({code:1006});assert.equal(tasks.size,1);stream.stop();assert.equal(tasks.size,0);assert.equal(closed,1);
});
test('Socket.IO reconnect uses event subscriptions, never raw WebSocket messages',()=>{
    const handlers=new Map(),tasks=new Map(),emitted=[];let id=0,connections=0;const socket={on:(name,fn)=>handlers.set(name,fn),emit:(...args)=>emitted.push(args),connect(){connections++;},disconnect(){}};
    const stream=createSkySpyStream({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],transport:'socketio',
        createSocketIO(_url,options){assert.equal(options.path,'/socket.io');return socket;},createWebSocket(){throw Error('wrong protocol');},setTimer(fn){tasks.set(++id,fn);return id;},clearTimer:key=>tasks.delete(key)});
    stream.start();handlers.get('connect')();assert.deepEqual(emitted[0],['subscribe',{topics:['aircraft']}]);handlers.get('disconnect')();assert.equal(tasks.size,1);
    [...tasks.values()][0]();assert.equal(connections,2);stream.stop();
});
test('authentication stream denial stops reconnecting; disabled stream has no connections',()=>{
    let calls=0;const disabled=createSkySpyStream({createWebSocket(){calls++;}});disabled.start();assert.equal(calls,0);
    const socket={close(){}};const stream=createSkySpyStream({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],createWebSocket:()=>socket,setTimer(){throw Error('no retry allowed');}});
    stream.start();socket.onclose({code:4001});assert.equal(stream.diagnostics().state,'authentication-denied');stream.stop();
    const events=new Map(),httpSocket={on:(name,fn)=>events.set(name,fn),terminate(){},close(){}};
    const denied=createSkySpyStream({enabled:true,usageApproved:true,baseUrl:'https://feed.example.org',allowedHosts:['feed.example.org'],createWebSocket:()=>httpSocket,setTimer(){throw Error('HTTP denial must not retry');}});
    denied.start();events.get('unexpected-response')({}, {statusCode:403,headers:{},resume(){}});assert.equal(denied.diagnostics().state,'authentication-denied');denied.stop();
});
test('offline administrator import strips executable HTML, preserves text and requires approval',async()=>{
    const folder=await fs.mkdtemp(path.join(os.tmpdir(),'notice-import-'));try{const file=path.join(folder,'notice.html');await fs.writeFile(file,'<script>bad()</script><p>NAVAREA IX 123/26</p><p>24.5N 66.5E</p>');
        await assert.rejects(importDocument(file,{...context,format:'maritime'}));const record=await importDocument(file,{...context,format:'maritime',usageApproved:true});
        assert.equal(record.rawText.includes('bad()'),false);assert.equal(record.geometry.type,'Point');
        const content='BT /F1 12 Tf 20 700 Td (NAVAREA IX 126/26 24.5N 66.5E) Tj ET';
        const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
        let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
        const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        const pdfFile=path.join(folder,'notice.pdf');await fs.writeFile(pdfFile,pdf);const extracted=await importDocument(pdfFile,{...context,format:'maritime',usageApproved:true});assert.equal(extracted.sourceId,'126/26');assert.equal(extracted.geometry.type,'Point');
    }finally{await fs.rm(folder,{recursive:true,force:true});}
});
