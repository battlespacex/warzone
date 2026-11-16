import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as RealCesium from 'cesium';
import { gnssBoundary, unwrapGnssPolygon, gnssContains } from '../../shared/gnss-geometry.js';
import { setDataSourceActive } from '../../../dev/assets/js/warzone-data-source-lifecycle.js';

const read=name=>fs.readFileSync(new URL(`../../../dev/assets/js/${name}`,import.meta.url),'utf8');
const strip=code=>code.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
const event=()=>new RealCesium.Event();
function harness(fetchImpl) {
    const collection=new RealCesium.ImageryLayerCollection();
    // A non-GNSS owner must survive all GNSS operations.
    const unrelated=collection.addImageryProvider(new RealCesium.SingleTileImageryProvider({url:'http://localhost/base.png',tileWidth:1,tileHeight:1}));
    const providers=[];
    class Provider {
        constructor(options){Object.assign(this,options);this.errorEvent=event();providers.push(this);}
    }
    const Cesium={...RealCesium,UrlTemplateImageryProvider:Provider};
    const viewer={imageryLayers:collection,isDestroyed:()=>false,container:{style:{}},dataSources:new RealCesium.DataSourceCollection(),
        camera:{getPickRay:()=>({})},scene:{requestRender(){},globe:{pick:()=>RealCesium.Cartesian3.fromDegrees(45,45)}}};
    const errors=[];
    const context=vm.createContext({Cesium,gnssBoundary,unwrapGnssPolygon,gnssContains,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:fetchImpl});
    vm.runInContext(strip(read('warzone-gnss-raster.js')),context);
    return {context,viewer,providers,errors,unrelated,create:()=>context.createGnssRasterLayer(viewer,{fetchImpl,onError:e=>errors.push(e)})};
}
const config={raster:{revision:'a'.repeat(32),tileUrl:'http://localhost/api/events/raster/{z}/{x}/{y}.png',lookupUrl:'http://localhost/api/events/lookup',maximumLevel:14},
    filter:'all',show:true,style:{size:28,width:1,fill:Array(5).fill([1,2,3,51]),outline:Array(5).fill([1,2,3,25])}};

test('50 GNSS raster ON/OFF cycles own one layer, release it and leave other imagery and error listeners intact',()=>{
    const h=harness();
    for(let i=0;i<50;i++) {
        const adapter=h.create();adapter.set(config);adapter.set(config);
        assert.equal(h.viewer.imageryLayers.length,2);assert.equal(h.providers.at(-1).errorEvent.numberOfListeners,1);
        assert.ok(h.providers.at(-1).tilingScheme instanceof RealCesium.GeographicTilingScheme);
        assert.match(h.providers.at(-1).url,/filter=all/);
        const owned=h.viewer.imageryLayers.get(1);
        adapter.dispose();adapter.dispose();adapter.set(config);
        assert.equal(owned.isDestroyed(),true);assert.equal(h.providers.at(-1).errorEvent.numberOfListeners,0);
        assert.equal(h.viewer.imageryLayers.length,1);assert.equal(h.viewer.imageryLayers.get(0),h.unrelated);
        assert.equal(adapter.diagnostics().pendingPick,false);assert.equal(adapter.diagnostics().cachedPickCells,0);
    }
});

test('GNSS revision/style/filter changes replace only its layer and tile errors stay local',()=>{
    const h=harness(),adapter=h.create();adapter.set(config);
    const first=h.viewer.imageryLayers.get(1);
    adapter.set({...config,filter:'severe'});assert.equal(first.isDestroyed(),true);assert.equal(h.viewer.imageryLayers.length,2);
    h.providers.at(-1).errorEvent.raiseEvent({message:'HTTP 503'});
    assert.equal(h.errors.length,1);assert.equal(h.viewer.imageryLayers.length,1);
    assert.equal(h.unrelated.show,true);
    adapter.set({...config,raster:{...config.raster,revision:'b'.repeat(32)}});
    assert.equal(adapter.diagnostics().failed,false);assert.equal(h.viewer.imageryLayers.get(1).show,true);
    adapter.dispose();
});

test('lookup is cancellable, preserves exact details and reuses same-cell results without extra requests',async()=>{
    let calls=0,signal;
    const data={id:'real-test-record',cellId:'real-test-record',lon:45,lat:45,severity:'high',affectedPercent:12.5,sampleCount:80};
    const h=harness(async(_url,options)=>{calls++;signal=options.signal;return{ok:true,json:async()=>({cell:data})};});
    const adapter=h.create();adapter.set(config);
    assert.deepEqual(await adapter.pick({x:0,y:0},{immediate:true}),data);
    assert.deepEqual(await adapter.pick({x:1,y:0}),data);assert.equal(calls,1);
    assert.deepEqual(await adapter.pick({x:1,y:0},{immediate:true}),data);assert.equal(calls,2,'click validates overlapping-cell draw order');
    adapter.dispose();assert.equal(signal.aborted,false);assert.equal(adapter.diagnostics().cachedPickCells,0);
    let release;
    const pendingHarness=harness((_url,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);});
    const pendingAdapter=pendingHarness.create();pendingAdapter.set(config);
    const pending=pendingAdapter.pick({x:0,y:0},{immediate:true});
    await new Promise(resolve=>setTimeout(resolve,5));pendingAdapter.dispose();
    assert.equal(signal.aborted,true);assert.equal(await pending,null);
    release({ok:true,json:async()=>({cell:data})});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(pendingAdapter.diagnostics().cachedPickCells,0);
});

test('real operational descriptor uses zero ground primitives/geometry jobs and clears controls, lookup records and handlers',()=>{
    const h=harness(),controls=new Map();
    const control=()=>({checked:true,value:'all',listeners:new Set(),addEventListener(_name,fn){this.listeners.add(fn);},removeEventListener(_name,fn){this.listeners.delete(fn);}});
    controls.set('wz-gnss-show-hexagons',control());controls.set('wz-gnss-severity',control());
    Object.assign(h.context,{setDataSourceActive,document:{getElementById:id=>controls.get(id)||null,querySelector:()=>null},window:{}});
    vm.runInContext(strip(read('warzone-gnss.js')),h.context);
    vm.runInContext('bindPicking=()=>{};closeActiveGnssPanel=()=>{};clearHighlight=()=>{};hideTooltip=()=>{};setLegendVisible=()=>{};',h.context);
    const options={raster:config.raster,totalCells:12000,severityCounts:{low:10000,medium:1000,high:900,severe:100},sourceMode:'gpsinterference',visible:true};
    for(let i=0;i<20;i++) {
        h.context.renderGnssInterferenceLayer(h.viewer,[],options);
        const diagnostics=h.context.getGnssDiagnostics();
        assert.equal(diagnostics.visible,true);assert.equal(diagnostics.groundPrimitiveCount,0);assert.equal(diagnostics.cachedCellRecords,0);
        assert.equal(diagnostics.raster.imageryLayers,1);assert.equal(h.viewer.dataSources.length,0);
        assert.equal(controls.get('wz-gnss-severity').listeners.size,1);
        h.context.clearGnssInterferenceLayer(h.viewer,{retainGeometry:true});
        assert.equal(h.viewer.imageryLayers.length,1);assert.equal(controls.get('wz-gnss-severity').listeners.size,0);
        assert.equal(h.context.getGnssDiagnostics().raster,null);
    }
    let refreshes=0;
    const expiring={...options,onRasterExpired:()=>{refreshes++;}};
    h.context.renderGnssInterferenceLayer(h.viewer,[],expiring);
    h.providers.at(-1).errorEvent.raiseEvent({error:{statusCode:410},message:'expired'});
    assert.equal(refreshes,1);assert.equal(h.viewer.imageryLayers.length,1);
    h.context.renderGnssInterferenceLayer(h.viewer,[],expiring);
    h.providers.at(-1).errorEvent.raiseEvent({error:{statusCode:410},message:'expired again'});
    assert.equal(refreshes,1,'persistent expired revisions do not enter a refresh loop');
    h.context.clearGnssInterferenceLayer(h.viewer);
});

test('drag cancellation stops queued GNSS hover lookup without removing imagery or blocking the next click',async()=>{
    let calls=0;const h=harness(async()=>{calls++;return {ok:true,json:async()=>({cell:null})};}),adapter=h.create();adapter.set(config);
    const layer=h.viewer.imageryLayers.get(1),pending=adapter.pick({x:0,y:0});adapter.cancelPick();
    assert.equal(await pending,null);assert.equal(calls,0);assert.equal(adapter.diagnostics().pendingPick,false);assert.equal(h.viewer.imageryLayers.get(1),layer);
    assert.equal(await adapter.pick({x:0,y:0},{immediate:true}),null);assert.equal(calls,1);adapter.dispose();
});
