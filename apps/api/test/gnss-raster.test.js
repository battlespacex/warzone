import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createGnssRasterStore, gnssRasterRoutes } from '../src/gnss-raster.js';
import { createGnssInterferenceHandler } from '../src/routes.events.js';
import { gnssBoundary } from '../../shared/gnss-geometry.js';

// Deliberately synthetic test-only records. Runtime never installs these observations.
const cell = (id='a',lon=45,lat=45,severity='high') => ({id,cellId:id,lon,lat,severity,sampleCount:100,affectedPercent:20,
    polygon:[{lon:lon-3,lat:lat-3},{lon:lon+3,lat:lat-3},{lon:lon+3,lat:lat+3},{lon:lon-3,lat:lat+3}],isDemo:false});
const payload = cells => ({cells,sourceMode:'gpsinterference',observationPeriod:'2026-11-10',sourceHealth:'Available',demoMode:false});
function decode(png) {
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const blocks=[];
    for(let i=8;i<png.length;) {const length=png.readUInt32BE(i);if(png.toString('ascii',i+4,i+8)==='IDAT')blocks.push(png.subarray(i+8,i+8+length));i+=length+12;}
    const rows=inflateSync(Buffer.concat(blocks));
    return (x,y)=>[...rows.subarray(y*1025+1+x*4,y*1025+5+x*4)];
}

test('raster PNG preserves palette, transparent absence, exact lookup details and severity filtering',async()=>{
    const store=createGnssRasterStore(), original=cell();
    const descriptor=await store.publish(payload([original]));
    assert.equal(descriptor.cells.length,0);assert.equal(descriptor.totalCells,1);
    assert.equal(descriptor.observationPeriod,'2026-11-10');
    assert.deepEqual(await store.lookup(descriptor.raster.revision,45,45),original);
    const rgba=decode(await store.tile(descriptor.raster.revision,0,1,0));
    assert.deepEqual(rgba(64,64),[138,67,254,51]);assert.equal(rgba(200,200)[3],0);
    const filtered=decode(await store.tile(descriptor.raster.revision,0,1,0,'low'));
    assert.equal(filtered(64,64)[3],0);
    assert.equal(await store.lookup(descriptor.raster.revision,45,45,'low'),null);
    const custom=JSON.stringify({fill:Array(5).fill([20,40,60,128]),width:0});
    assert.deepEqual(decode(await store.tile(descriptor.raster.revision,0,1,0,'all',custom))(64,64),[20,40,60,128]);
});

test('dateline and polar tiles match genuine polygon boundaries and fallback hex formula',async()=>{
    const store=createGnssRasterStore();
    const crossing={...cell('date'),polygon:[{lat:8,lon:179},{lat:8,lon:-179},{lat:12,lon:-179},{lat:12,lon:179}]};
    const polar={...cell('polar'),polygon:[{lat:86,lon:40},{lat:86,lon:50},{lat:89,lon:50},{lat:89,lon:40}]};
    const {raster}=await store.publish(payload([crossing,polar]));
    assert.equal((await store.lookup(raster.revision,179.5,10)).id,'date');
    assert.equal((await store.lookup(raster.revision,-179.5,10)).id,'date');
    assert.equal(await store.lookup(raster.revision,0,10),null);
    assert.equal((await store.lookup(raster.revision,45,88)).id,'polar');
    const east=decode(await store.tile(raster.revision,0,1,0));
    const west=decode(await store.tile(raster.revision,0,0,0));
    assert.ok(east(255,113)[3]>0);assert.ok(west(0,113)[3]>0);
    assert.ok(east(64,3)[3]>0);
    assert.equal(gnssBoundary({lat:0,lon:0}).length,6);
});

test('30 identical requests share generation; caches, revision integrity, expiration and failures are bounded',async()=>{
    let now=0;const store=createGnssRasterStore({maxTileBytes:2500,maxSnapshots:1,now:()=>now});
    const {raster}=await store.publish(payload([cell()]));
    const tiles=await Promise.all(Array.from({length:30},()=>store.tile(raster.revision,0,1,0)));
    assert.ok(tiles.every(bytes=>bytes===tiles[0]));assert.equal(store.diagnostics().pending,0);assert.equal(store.diagnostics().pinnedBytes,0);
    assert.ok(store.diagnostics().tileBytes<=2500);
    await assert.rejects(store.tile(raster.revision,15,0,0),/Invalid geographic/);
    await assert.rejects(store.tile(raster.revision,0,0,0,'invented'),/Invalid severity/);
    await assert.rejects(store.tile(raster.revision,0,0,0,'all','null'),/Invalid GNSS style/);
    await assert.rejects(store.publish({...payload([cell()]),demoMode:true}),/genuine/);
    now=31*60*1000;await assert.rejects(store.tile(raster.revision,0,1,0),/expired/);
    const next=await store.publish(payload([cell('new')]));assert.notEqual(next.raster.revision,raster.revision);
    assert.equal(store.diagnostics().snapshots,1);
});

test('snapshot disk cache recovers across API processes and memory eviction without fetching invented observations',async t=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'stratops-raster-test-'));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    const store=createGnssRasterStore({snapshotDirectory:directory,maxSnapshots:1});
    const first=await store.publish(payload([cell()]));await store.publish(payload([cell('next')]));
    assert.equal((await store.lookup(first.raster.revision,45,45)).id,'a');
    const restarted=createGnssRasterStore({snapshotDirectory:directory});
    assert.equal((await restarted.lookup(first.raster.revision,45,45)).id,'a');
    await assert.rejects(restarted.lookup('../escape',45,45),/Invalid GNSS revision/);
});

test('raster descriptor returns all authorized regional cells above the old 12000 display cap; JSON stays compatible',async()=>{
    const cells=Array.from({length:12003},(_,i)=>cell(String(i)));
    const store=createGnssRasterStore();
    const handler=createGnssInterferenceHandler({getSnapshot:async()=>payload(cells),rasterStore:store});
    const res=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
    const raster=res();await handler({query:{format:'raster',limit:'12000',minLon:'0',maxLon:'90',minLat:'0',maxLat:'90'}},raster);
    assert.equal(raster.body.totalCells,12003);assert.equal(raster.body.cells.length,0);assert.equal(raster.body.truncated,false);
    assert.equal((await store.lookup(raster.body.raster.revision,45,45)).id,'12002');
    const json=res();await handler({query:{limit:'12000'}},json);
    assert.equal(json.body.cells.length,12000);assert.equal(json.body.truncated,true);
});

test('raster routes use real error statuses and never turn a missing revision into empty coverage',async()=>{
    const routes=new Map();gnssRasterRoutes({get:(key,handler)=>routes.set(key,handler)},createGnssRasterStore());
    const res={statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await routes.get('/gnss-interference/raster/:revision/lookup')({params:{revision:'a'.repeat(32)},query:{lat:'1',lon:'2'}},res);
    assert.equal(res.statusCode,410);assert.match(res.body.error,/expired/);
});

test('30 descriptor callers share preparation; changed data and regions invalidate it',async()=>{
    let snapshot=payload([cell()]),publishes=0;
    const store=createGnssRasterStore();
    const handler=createGnssInterferenceHandler({getSnapshot:async()=>snapshot,rasterStore:{publish:async data=>{publishes++;return store.publish(data);}}});
    const run=async query=>{const res={status(){return this;},json(body){this.body=body;return this;}};await handler({query:{format:'raster',...query}},res);return res.body;};
    const results=await Promise.all(Array.from({length:30},()=>run({})));
    assert.equal(publishes,1);assert.ok(results.every(result=>result.raster.revision===results[0].raster.revision));
    snapshot=payload([cell('new')]);await run({});assert.equal(publishes,2);
    await run({minLat:'-90',maxLat:'0',minLon:'-180',maxLon:'180'});assert.equal(publishes,2,'empty coverage needs no raster snapshot');
});

test('raster fallback scopes genuine records and never installs enabled demo rows',async()=>{
    const store=createGnssRasterStore();let rows=[{...cell(),isDemo:true}];
    const handler=createGnssInterferenceHandler({getSnapshot:async()=>null,getFallbackClient:()=>null,
        getFallback:async()=>({cells:rows,demoMode:true,sourceMode:'demo'}),rasterStore:store});
    const run=async()=>{const res={status(){return this;},json(body){this.body=body;return this;}};
        await handler({query:{format:'raster',minLon:'0',maxLon:'90',minLat:'0',maxLat:'90'}},res);return res.body;};
    const empty=await run();assert.equal(empty.sourceMode,'unavailable');assert.equal(empty.demoMode,false);assert.equal(store.diagnostics().snapshots,0);
    rows=[cell('within'),cell('outside',-90,-45),{...cell('demo'),isDemo:true}];
    const scoped=await run();assert.equal(scoped.totalCells,1);assert.equal(scoped.demoMode,false);
    assert.equal((await store.lookup(scoped.raster.revision,45,45)).id,'within');
});

test('real Express raster URLs serve PNGs and exact lookup JSON with separate cache headers',async t=>{
    const store=createGnssRasterStore(),app=express(),router=express.Router();
    gnssRasterRoutes(router,store);app.use('/events',router);
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const {raster}=await store.publish(payload([cell()])),origin=`http://127.0.0.1:${server.address().port}`;
    const png=await fetch(origin+raster.tilePath.replace('{z}','0').replace('{x}','1').replace('{y}','0'));
    assert.equal(png.status,200);assert.match(png.headers.get('content-type'),/^image\/png/);
    assert.equal(png.headers.get('cache-control'),'private, max-age=300');
    assert.deepEqual(decode(Buffer.from(await png.arrayBuffer()))(64,64),[138,67,254,51]);
    const lookup=await fetch(origin+raster.lookupPath+'?lon=45&lat=45');
    assert.equal(lookup.headers.get('cache-control'),'no-store');assert.equal((await lookup.json()).cell.id,'a');
});
