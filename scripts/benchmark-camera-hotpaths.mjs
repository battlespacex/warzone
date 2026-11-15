import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import * as Cesium from 'cesium';

// CPU/operation benchmark only, not a browser FPS or GPU benchmark.
const baselineDirectory=process.argv[2];
const read=(name,before)=>before?(baselineDirectory?fs.readFileSync(`${baselineDirectory}/${name}`,'utf8'):execFileSync('git',['show',`HEAD:dev/assets/js/${name}`],{encoding:'utf8'})):fs.readFileSync(`dev/assets/js/${name}`,'utf8');
function load(name,before,globals){const context=vm.createContext({Cesium,...globals});vm.runInContext(read(name,before).replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);return context;}
function sizing(before){let queries=0;const context=load('warzone-glb-distance-sizing.js',before,{});
    const viewer={camera:{positionWC:new Cesium.Cartesian3(7e6,0,0)},scene:{frameState:{frameNumber:0},canvas:{clientWidth:1000},drawingBufferWidth:1000,requestRender(){}}};
    const config=context.readGlbSizing((_name,fallback)=>fallback,'aircraft','fighter');
    const time=Cesium.JulianDate.now(),entities=Array.from({length:300},()=>({model:{},position:{getValue(_time,out){queries++;return Cesium.Cartesian3.fromElements(6.4e6,0,0,out);}}}));
    for(const entity of entities)context.applyGlbDistanceSizing(entity,config,viewer);
    const start=performance.now();for(let frame=0;frame<1200;frame++){viewer.scene.frameState.frameNumber=frame;viewer.camera.positionWC.x=7e6-frame;
        for(const entity of entities){entity.model.scale.getValue(time);entity.model.minimumPixelSize.getValue(time);}}
    const ms=performance.now()-start,measuredQueries=queries;
    const entity=entities[0],prior=queries;viewer.scene.frameState.frameNumber++;
    entity.model.scale.getValue(time);entity.model.minimumPixelSize.getValue(time);
    assert.equal(queries-prior,2); // Sizing is deliberately unchanged; cache overhead did not justify a change.
    viewer.camera.positionWC.x=6.4e6+1000;const near=entity.model.scale.getValue(time);viewer.camera.positionWC.x=9e6;const far=entity.model.scale.getValue(time);assert.ok(near>far);
    return {positionQueries:measuredQueries,milliseconds:+ms.toFixed(2)};
}
function focus(before){let events=0,taskRuns=0,clock=0;const frames=new Map();let id=0;
    const context=load('warzone-asset-focus-controller.js',before,{window:{},document:{hidden:false,dispatchEvent(){events++;},addEventListener(){}},CustomEvent:class{},AbortController,
        performance:{now:()=>clock},requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i),console});
    const controller=context.getAssetFocusController();controller.registerTask('camera',()=>{taskRuns++;},{hz:60});controller.enterFocus({assetType:'aircraft',assetId:'test'});const startEvents=events;
    const start=performance.now();for(let i=0;i<1200;i++){clock+=17;const batch=[...frames.values()];frames.clear();for(const fn of batch)fn();}
    const ms=performance.now()-start,frameEvents=events-startEvents;assert.equal(taskRuns,1200);assert.equal(context.window.__warzoneFocusDiagnostics.frameCount,1200);
    controller.exitFocus('benchmark');assert.ok(events>startEvents+frameEvents);
    return {frameLifecycleEvents:frameEvents,cameraTaskRuns:taskRuns,milliseconds:+ms.toFixed(2)};
}
function hover(before,base=false){const callbacks=new Map(),frames=new Map();let id=0,picks=0;const naval={};
    const source=read(base?'warzone-globe.js':'warzone-live-naval.js',before),start=source.indexOf(base?'function bindEventMarkerPicking(':'function bindNavalPicking(');
    // Extract the real binding function, without initializing tracker/UI globals.
    const {parseExpressionAt}=awaitAcorn;const ast=parseExpressionAt(source,start,{ecmaVersion:'latest'});
    const viewer={scene:{canvas:{style:{}},pick(){picks++;return null;}},container:{style:{}}};
    const context=vm.createContext({Cesium:{Cartesian2:Cesium.Cartesian2,ScreenSpaceEventType:{MOUSE_MOVE:'move',LEFT_CLICK:'click'},ScreenSpaceEventHandler:class{setInputAction(fn,type){callbacks.set(type,fn);}}},
        safePickEventMarkerScene:(v,p)=>v.scene.pick(p),resolvePickedSatelliteImageryMarkerEntity:()=>null,resolvePickedEventMarkerEntity:()=>null,
        __navalState:naval,window:{},hasRenderedNavalVessels:()=>true,resolvePickedNavalTrackKey:()=>'',hideNavalHoverGuide(){},requestAnimationFrame(fn){frames.set(++id,fn);return id;}});
    vm.runInContext(source.slice(start,ast.end),context);if(base)context.bindEventMarkerPicking(viewer);else context.bindNavalPicking(viewer);
    for(let frame=0;frame<20;frame++){for(let i=0;i<100;i++)callbacks.get('move')({endPosition:new Cesium.Cartesian2(i,frame)});const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}
    assert.equal(picks,before?2000:20);return {mouseEvents:2000,scenePicks:picks};
}
const awaitAcorn=await import('acorn');
const result={description:'1200 synthetic frames; 300 GLBs; actual production functions, stub position provider/DOM/picking',before:{sizing:sizing(true),focus:focus(true),hover:hover(true),eventHover:hover(true,true)},after:{sizing:sizing(false),focus:focus(false),hover:hover(false),eventHover:hover(false,true)}};
assert.equal(result.after.focus.frameLifecycleEvents,0);
console.log(JSON.stringify(result,null,2));
