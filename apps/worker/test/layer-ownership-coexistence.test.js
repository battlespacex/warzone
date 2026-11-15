import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

const read=name=>fs.readFileSync(new URL(`../../../dev/assets/js/${name}`,import.meta.url),'utf8');
test('GNSS, orbital intelligence and both trackers coexist through repeated independent toggles and notifications',()=>{
    const context=vm.createContext({isStratOpsFeatureEnabled:()=>true,getStratOpsLayerFeaturePath:()=>'',
        window:{__stratopsAuthState:{isAuthenticated:true}},document:{body:{classList:{contains:()=>false}},querySelector:()=>null,getElementById:()=>null},
        localStorage:{setItem(){},getItem:()=>null}});
    vm.runInContext(read('warzone-layers.js').replace(/^import[\s\S]*?from "[^"]+";\r?\n/m,'').replace(/import\.meta\.env\?\.DEV/g,'false')
        .replace(/export \{[^}]+\};/g,'').replace(/\bexport /g,''),context);
    context.setLayer('gnss',true);
    for(let i=0;i<20;i++) {
        for(const id of ['orbital-assets','aircraft','naval'])context.setLayer(id,true);
        for(const id of ['gnss','orbital-assets','aircraft','naval'])assert.equal(context.isLayerEnabled(id),true,id);
        context.setLayer('orbital-assets',false);
        for(const id of ['gnss','aircraft','naval'])assert.equal(context.isLayerEnabled(id),true,id);
        context.setLayer('aircraft',false);context.setLayer('naval',false);
        assert.equal(context.isLayerEnabled('gnss'),true);
        context.setLayer('orbital-assets',true);context.setLayer('gnss',false);
        assert.equal(context.isLayerEnabled('orbital-assets'),true);
        context.setLayer('gnss',true);context.setLayer('orbital-assets',false);
    }
});

test('basemap removal and insertion preserve independent overlays and keep them above replacement imagery',()=>{
    const source=read('warzone-globe.js'),layers=[],destroyed=[];
    const collection={get length(){return layers.length;},get:i=>layers[i],
        remove(layer){const i=layers.indexOf(layer);if(i<0)return false;layers.splice(i,1);destroyed.push(layer);return true;},
        addImageryProvider(provider,index){const layer={provider};layers.splice(index,0,layer);return layer;}};
    const context=vm.createContext({removeSelfHostedBasemap:()=>{}});
    for(const name of ['removeOwnedBasemapLayers','basemapInsertionIndex','addBasemapImageryProvider']) {
        const start=source.indexOf(`function ${name}(`),node=parseExpressionAt(source,start,{ecmaVersion:'latest'});
        vm.runInContext(source.slice(start,node.end),context);
    }
    const old={name:'base'},gnss={name:'gnss'},other={name:'other-feature'};
    const viewer={imageryLayers:collection,__imageryBase:old,__warzoneBasemapLayers:[old]};layers.push(old,gnss,other);
    context.removeOwnedBasemapLayers(viewer);assert.deepEqual(layers,[gnss,other]);assert.deepEqual(destroyed,[old]);
    const base=context.addBasemapImageryProvider(viewer,'base'),labels=context.addBasemapImageryProvider(viewer,'labels');
    assert.deepEqual(layers,[base,labels,gnss,other]);
    assert.doesNotMatch(source,/imageryLayers\.removeAll\(/);
});

test('an ArcGIS initialization completing after a newer generation cannot clear or replace its layers',async()=>{
    const source=read('warzone-globe.js'),layers=[];
    let resolve;
    const provider=new Promise(done=>{resolve=done;});
    const collection={get length(){return layers.length;},get:i=>layers[i],
        remove(layer){const i=layers.indexOf(layer);if(i<0)return false;layers.splice(i,1);return true;}};
    const context=vm.createContext({Cesium:{ArcGisMapServerImageryProvider:{fromUrl:()=>provider}},removeSelfHostedBasemap:()=>{},updateMapCredits:()=>{}});
    for(const name of ['removeOwnedBasemapLayers','addArcGisLayers']) {
        let start=source.indexOf(`function ${name}(`);
        if(name==='addArcGisLayers')start-=6;
        const node=parseExpressionAt(source,start,{ecmaVersion:'latest'});
        vm.runInContext(source.slice(start,node.end),context);
    }
    const gnss={id:'gnss'},old={id:'old'},current={id:'new'};
    const viewer={imageryLayers:collection,__warzoneImageryGeneration:1,__imageryBase:old,__warzoneBasemapLayers:[old]};
    layers.push(old,gnss);
    const pending=context.addArcGisLayers(viewer);
    viewer.__warzoneImageryGeneration=2;viewer.__imageryBase=current;viewer.__warzoneBasemapLayers=[current];layers.unshift(current);
    resolve({});await pending;
    assert.deepEqual(layers,[current,gnss]);assert.equal(viewer.__imageryBase,current);
});

test('central Basemap/Borders policy preserves every allowed combination across operational switches and bulk changes',()=>{
    const context=vm.createContext({isStratOpsFeatureEnabled:()=>true,getStratOpsLayerFeaturePath:()=>'',
        window:{__stratopsAuthState:{isAuthenticated:true}},document:{body:{classList:{contains:()=>false}},querySelector:()=>null,getElementById:()=>null},
        localStorage:{setItem(){},getItem:()=>null}});
    vm.runInContext(read('warzone-layers.js').replace(/^import[\s\S]*?from "[^"]+";\r?\n/m,'').replace(/import\.meta\.env\?\.DEV/g,'false')
        .replace(/export \{[^}]+\};/g,'').replace(/\bexport /g,''),context);
    const transitions=[];context.onLayerChange((id,_value,state,changed)=>transitions.push({id,state,changed}));
    context.setLayer('terrain',false);
    assert.equal(context.isLayerEnabled('terrain'),false);assert.equal(context.isLayerEnabled('country-borders'),true);
    assert.equal(transitions.at(-1).id,'*');assert.ok(transitions.at(-1).changed.includes('country-borders'));
    for(let i=0;i<10;i++) {
        for(const id of ['naval','aircraft','gnss','orbital-assets'])context.setLayer(id,true);
        assert.equal(context.isLayerEnabled('terrain'),false);assert.equal(context.isLayerEnabled('country-borders'),true);
        for(const id of ['naval','aircraft','gnss','orbital-assets'])context.setLayer(id,false);
        assert.equal(context.isLayerEnabled('terrain'),false);assert.equal(context.isLayerEnabled('country-borders'),true);
    }
    context.setLayer('country-borders',false);
    assert.equal(context.isLayerEnabled('terrain'),true);assert.equal(context.isLayerEnabled('country-borders'),false);
    context.setLayer('country-borders',true);
    assert.equal(context.isLayerEnabled('terrain'),true);assert.equal(context.isLayerEnabled('country-borders'),true);
    for(const id of ['naval','aircraft','gnss','orbital-assets']){context.setLayer(id,true);context.setLayer(id,false);}
    assert.equal(context.isLayerEnabled('terrain'),true);assert.equal(context.isLayerEnabled('country-borders'),true);
    const panel={querySelectorAll:()=>[],querySelector:()=>null};context.panel=panel;
    vm.runInContext('setAllLayers(false,panel)',context);
    for(const id of ['naval','aircraft','gnss','orbital-assets'])assert.equal(context.isLayerEnabled(id),false);
    assert.ok(transitions.every(({state})=>state.terrain||state['country-borders']));
});

test('focus terrain and CTR restoration preserve basemap OFF and never resurrect an obsolete imagery layer',async()=>{
    const source=read('warzone-globe.js'),reattached=[];
    const terrain={__warzoneProviderKind:'cesium-world'};
    const context=vm.createContext({addImageryLayerIfMissing:(_collection,layer)=>{if(layer)reattached.push(layer);},
        updateLabelsLayerVisibility:()=>{},tuneImageryLayer:()=>{},numberVar:(_name,value)=>value,
        ensureContourTerrainProvider:async()=>terrain,dispatchFocusedTerrainChanged:()=>{}});
    for(const name of ['applyRenderedTerrainVisibility','restoreCtrImagery','enableFocusedTerrain']) {
        let start=source.indexOf(`function ${name}(`);if(name==='enableFocusedTerrain')start-=6;
        const node=parseExpressionAt(source,start,{ecmaVersion:'latest'});vm.runInContext(source.slice(start,node.end),context);
    }
    const base={show:false},viewer={imageryLayers:{},__imageryBase:base,__imageryLabels:null,
        __terrainVisible:false,__satelliteVisible:true,terrainProvider:{},scene:{globe:{},requestRender(){}}};
    viewer.__warzoneCtrImageryState={baseLayer:base,labelsLayer:null,terrainVisible:true,satelliteVisible:true,baseShow:true};
    context.restoreCtrImagery(viewer);assert.equal(viewer.__terrainVisible,false);assert.equal(base.show,false);
    const obsolete={show:false,isDestroyed:()=>true};
    viewer.__warzoneCtrImageryState={baseLayer:obsolete,labelsLayer:null,terrainVisible:true,baseShow:true};
    reattached.length=0;context.restoreCtrImagery(viewer);
    assert.equal(viewer.__imageryBase,base);assert.equal(reattached.length,0);assert.equal(base.show,false);
    assert.equal(await context.enableFocusedTerrain(viewer),true);
    assert.equal(viewer.terrainProvider,terrain);assert.equal(viewer.__terrainVisible,false);assert.equal(base.show,false);
});
