import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCommercialNoticeProviders,deduplicateNotices} from '../../shared/notice-providers.js';
import {normalizeNotice} from '../../shared/geospatial-notices.js';
import {createNoticeService,noticesRouter} from '../src/routes.notices.js';
const require=createRequire(import.meta.url),{mountLocalNotices}=require('../../../server/local-notices.cjs');
const now=()=>Date.parse('2026-11-15T12:00:00Z');
const input={provider:'import',issuer:'FIR1',fir:'FIR1',sourceId:'A0001/26',noticeType:'notam',sourceUrl:'https://example.org/notice',rawText:'Synthetic fixture only',
    isMilitaryRelated:true,effectiveFrom:'2026-11-15T00:00:00Z',effectiveUntil:'2026-11-16T00:00:00Z',geometry:{type:'Point',coordinates:[66,24]}};
async function listen(app){const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};}
const mockService=rows=>createNoticeService({env:{NOTICES_ENABLED:'true',NOTICES_IMPORT_FILE:'fixture',NOTICES_IMPORT_USAGE_APPROVED:'true'},now,readFile:async()=>Buffer.from(JSON.stringify(rows))});
test('real HTTP local notice middleware returns populated/empty JSON and preserves service errors',async()=>{
    for(const [service,status,count]of [[mockService([input]),200,1],[mockService([]),200,0],[createNoticeService({env:{}}),200,0],[mockService([{invalid:true}]),503,undefined],[{list:async()=>{throw Object.assign(Error(),{status:403});}},403,undefined]]){
        const app=express();mountLocalNotices(app,{service});app.use((_q,r)=>r.status(404).json({error:'Missing'}));const server=await listen(app);
        try{const response=await fetch(server.url+'/api/notices?military=all&minLat=20&maxLat=30&minLon=60&maxLon=70');assert.equal(response.status,status);const body=await response.json();if(count!=null)assert.equal(body.notices.length,count);else assert.equal(body.state,'unavailable');}
        finally{service.dispose?.();await server.close();}
    }
});
test('actual frontend preview serves local notices; production proxy reaches backend and retains 403/404',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'notices-http-')),file=path.join(directory,'notices.json');await fs.writeFile(file,JSON.stringify([input]));
    const backend=express();backend.use('/notices',noticesRouter(mockService([input])));backend.get('/forbidden',(_q,r)=>r.status(403).json({error:'Denied'}));backend.use((_q,r)=>r.status(404).json({error:'Missing'}));const upstream=await listen(backend);
    const names=['NODE_ENV','API_UPSTREAM_URL','NOTICES_ENABLED','NOTICES_IMPORT_FILE','NOTICES_IMPORT_USAGE_APPROVED','SKYSPY_ENABLED','AVIATION_EDGE_ENABLED','AUTOROUTER_ENABLED','ICAO_ENABLED','DTN_ENABLED'];
    const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
    try{Object.assign(process.env,{API_UPSTREAM_URL:upstream.url,NOTICES_ENABLED:'true',NOTICES_IMPORT_FILE:file,NOTICES_IMPORT_USAGE_APPROVED:'true',SKYSPY_ENABLED:'false',AVIATION_EDGE_ENABLED:'false',AUTOROUTER_ENABLED:'false',ICAO_ENABLED:'false',DTN_ENABLED:'false'});
        for(const mode of ['test','production']){process.env.NODE_ENV=mode;delete require.cache[require.resolve('../../../server.js')];const app=require('../../../server.js'),server=await listen(app);
            try{const response=await fetch(server.url+'/api/notices?military=all&status=all');assert.equal(response.status,200);assert.equal((await response.json()).notices[0].sourceId,'A0001/26');
                for(const [route,status]of [['forbidden',403],['missing',404]]){const failure=await fetch(server.url+'/api/'+route);assert.equal(failure.status,status);assert.ok((await failure.json()).error);}}
            finally{await server.close();}}
    }finally{for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];await upstream.close();await fs.rm(directory,{recursive:true,force:true});}
});
test('cross-provider identity preserves source records, newer data and independent authorities',()=>{
    const a=normalizeNotice({...input,provider:'a',issuedAt:'2026-11-15T10:00:00Z'},now()),b=normalizeNotice({...input,provider:'b',metadata:{version:'provider revision'},issuedAt:'2026-11-15T09:00:00Z',geometry:null},now());
    const merged=deduplicateNotices([a,b]);assert.equal(merged.length,1);assert.equal(merged[0].provider,'a');assert.equal(merged[0].sourceRecords.length,2);assert.ok(merged[0].geometry);
    assert.equal(deduplicateNotices([a,{...b,sourceId:'A0002/26'}]).length,2);
    assert.equal(deduplicateNotices([{...a,issuer:'Office A'},{...b,issuer:'Office B'}]).length,2);
    assert.equal(deduplicateNotices([a,{...b,sourceId:'A0002/26',isCancellation:true,replacesNoticeId:'A0001/26'}])[0].superseded,true);
});
const enabled=prefix=>({[prefix+'_ENABLED']:'true',[prefix+'_USAGE_APPROVED']:'true',[prefix+'_API_KEY']:'fixture-private-key',[prefix+'_LOCATIONS']:'OPKR'});
test('Aviation Edge documented location/key request parses original ICAO text and caches',async()=>{
    let calls=0;const raw='a0001/26 notamnq) opkr/qwmlw/iv/bo/w/000/100/2450n06630e010a) opkr b) 2611150000 c) 2611162359e) military exercise';
    const provider=createCommercialNoticeProviders(enabled('AVIATION_EDGE'),{now,fetchImpl:async(url)=>{calls++;assert.equal(url.origin+url.pathname,'https://aviation-edge.com/v2/public/notams');assert.equal(url.searchParams.get('location'),'OPKR');assert.equal(url.searchParams.get('key'),'fixture-private-key');return new Response(JSON.stringify([{condition:raw,location:'opkr',number:'a0001/26'}]));}})[0];
    const rows=await provider.fetchNotices();assert.equal(rows.length,1);assert.equal(rows[0].sourceId,'A0001/26');assert.equal(rows[0].rawText,raw);assert.equal(rows[0].metadata.radiusNm,10);assert.equal(rows[0].isMilitaryRelated,true);
    assert.equal(rows[0].activityType,'military exercise');
    await provider.fetchNotices();assert.equal(calls,1);assert.equal(JSON.stringify(provider.diagnostics()).includes('fixture-private-key'),false);
});
test('autorouter uses bearer auth, documented pagination and Garmin coordinates',async()=>{
    let calls=0;const provider=createCommercialNoticeProviders(enabled('AUTOROUTER'),{now,fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer fixture-private-key');assert.deepEqual(JSON.parse(url.searchParams.get('itemas')),['OPKR']);const offset=+url.searchParams.get('offset');return new Response(JSON.stringify({total:101,rows:Array.from({length:offset?1:100},(_,i)=>({series:'A',number:offset+i+1,year:26,nof:'OPKR',fir:'OPKR',iteme:'MIL SIDE fixture',startvalidity:1794700800,endvalidity:1794873600,lat:24*(1<<30)/90,lon:66*(1<<30)/90,radius:5,type:'N'}))}));}})[1];
    const rows=await provider.fetchNotices();assert.equal(rows.length,101);assert.equal(calls,2);assert.deepEqual(rows[0].geometry.coordinates,[66,24]);assert.equal(provider.diagnostics().partial,false);
});
test('blocked and unapproved providers never retry or invent an endpoint',async()=>{
    let calls=0;const provider=createCommercialNoticeProviders(enabled('AVIATION_EDGE'),{now,fetchImpl:async()=>{calls++;return new Response('',{status:403});}})[0];
    await assert.rejects(provider.fetchNotices());await assert.rejects(provider.fetchNotices());assert.equal(calls,1);assert.equal(provider.diagnostics().lastStatus,403);
    for(const p of createCommercialNoticeProviders({}, {fetchImpl:()=>{throw Error('No request allowed');}}))assert.deepEqual(await p.fetchNotices(),[]);
    const unknown=createCommercialNoticeProviders({...enabled('ICAO'),...enabled('DTN')});assert.equal(unknown[2].diagnostics().availableForUse,false);assert.equal(unknown[3].diagnostics().availableForUse,false);
    let clock=now(),limitedCalls=0;const limited=createCommercialNoticeProviders(enabled('AVIATION_EDGE'),{now:()=>clock,fetchImpl:async()=>{limitedCalls++;return new Response('',{status:429,headers:{'Retry-After':new Date(clock+120000).toUTCString()}});}})[0];
    await assert.rejects(limited.fetchNotices());clock+=61000;await assert.rejects(limited.fetchNotices());assert.equal(limitedCalls,1);
});
