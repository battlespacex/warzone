import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import * as RealCesium from 'cesium';
import {noticeGeometryPoints,noticeStatus,validateGeometry,intersectsBounds,containsNotice} from '../../shared/geospatial-notices.js';
const code=fs.readFileSync(new URL('../../../dev/assets/js/warzone-notice-capture.js',import.meta.url),'utf8');
function harness({logoError=false,taint=false,offscreen=false}={}){
 const elements=[],canvases=[],listeners=new Map(),windowListeners=new Map(),downloads=[],logos=[],compositions=[];
 class Element{constructor(tag){this.tag=tag;this.style={};this.children=[];this.events=new Map();this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}setAttribute(){}append(...nodes){this.children.push(...nodes);}addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name){this.events.delete(name);}closest(selector){return selector==='button'&&this.tag==='button'?this:null;}setPointerCapture(){}releasePointerCapture(){}remove(){const i=elements.indexOf(this);if(i>=0)elements.splice(i,1);}getContext(){if(!this.ctx)this.ctx={draws:[],texts:[],drawImage(...args){this.draws.push(args);},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},measureText(text){return {width:text.length*6};},fillText(text){this.texts.push(text);}};return this.ctx;}toBlob(fn,type){fn(new Blob(['fixture only'],{type}));}}
 const sceneCanvas={width:1600,height:1200,getBoundingClientRect:()=>({left:20,top:40,width:800,height:600})};
 const viewer={scene:{canvas:sceneCanvas,globe:{tilesLoaded:true},screenSpaceCameraController:{enableInputs:true}}};
 const c=vm.createContext({Cesium:{...RealCesium,SceneTransforms:{worldToWindowCoordinates:()=>offscreen?{x:900,y:800}:{x:300,y:250}}},noticeGeometryPoints,noticeStatus,
  copyNextSceneFrame:async(_viewer,fn)=>{fn?.();return sceneCanvas;},assertCaptureReadable(){if(taint)throw Error('Canvas security blocked');},loadImage:async url=>{if(logoError)throw Error('Logo unavailable');const image={src:url,naturalWidth:400,naturalHeight:80};logos.push(image);return image;},downloadBlob:(blob,name)=>downloads.push({blob,name}),canUseSavePicker:()=>false,
  getComputedStyle:()=>({getPropertyValue:name=>name==='--wz-notice-export-max-pixels'?'16000000':''}),Blob,document:{documentElement:{},createElement:tag=>{const el=new Element(tag);if(tag==='canvas')canvases.push(el);return el;},body:{append:el=>elements.push(el)},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
  window:{addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:name=>windowListeners.delete(name)}});
 vm.runInContext(code.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),c);
 c.paintNoticeExport=async(...args)=>compositions.push(args);
 return {c,viewer,elements,canvases,listeners,windowListeners,downloads,logos,compositions,event(el,type,x,y,target=el){el.events.get(type)({target,clientX:x+20,clientY:y+40,pointerId:1,button:0,preventDefault(){},stopPropagation(){}});}};
}
const notice=()=>({id:'fixture',sourceId:'A0001/26',title:'NOTAM A0001/26',noticeType:'notam',country:'India',provider:'notac',geometry:{type:'Point',coordinates:[65,24]},effectiveFrom:new Date(Date.now()-60000).toISOString(),effectiveUntil:new Date(Date.now()+3600000).toISOString(),metadata:{}});
test('capture rectangle clamps reverse drags and native crop preserves DPI, geography, branding and UTC',async()=>{
 const h=harness();assert.deepEqual(JSON.parse(JSON.stringify(h.c.captureRectangle({x:500,y:500},{x:-50,y:20},800,600))),{x:0,y:20,width:500,height:480});
 const blob=await h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:400,height:300});assert.equal(blob.type,'image/png');
 const out=h.canvases[0];assert.equal(out.width,800);assert.equal(out.height,600);assert.deepEqual(out.ctx.draws[0].slice(1),[200,200,800,600,0,0,800,600]);assert.equal(out.ctx.draws[0][0],h.viewer.scene.canvas);
 assert.equal(h.logos.length,2);assert.equal(h.compositions[0][1].sourceId,'A0001/26');assert.ok(Number.isFinite(h.compositions[0][3].getTime()));assert.equal(h.downloads.length,0);
});
test('capture composition receives CSS coordinates and uniform output pixel ratio when framebuffer axes differ',async()=>{
 const h=harness(),moves=[],create=h.c.document.createElement;h.viewer.scene.canvas.height=1800;
 h.c.document.createElement=tag=>{const el=create(tag);if(tag==='canvas')el.getContext().moveTo=(x,y)=>moves.push([x,y]);return el;};
 await h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:400,height:300});
 assert.equal(moves.length,0);assert.equal(h.compositions[0][7],2);assert.deepEqual(JSON.parse(JSON.stringify(h.compositions[0][6])),{x:200,y:150});assert.deepEqual(h.canvases[0].ctx.draws[0].slice(1),[200,300,800,900,0,0,800,600]);
});
test('DRAW/RESET/redraw/move/resize/CANCEL and ESC affect only the screenshot selection and restore inputs',()=>{
 const h=harness();for(let i=0;i<10;i++){const cancel=h.c.startNoticeCapture(h.viewer,notice());assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,false);const overlay=h.elements[0],selection=overlay.children[0],toolbar=overlay.children[1],buttons=Object.fromEntries(toolbar.children.filter(n=>n.tag==='button').map(n=>[n.textContent,n]));
 assert.equal(buttons['SAVE AS'].disabled,true);h.event(overlay,'pointerdown',100,100);h.event(overlay,'pointermove',500,400);h.event(overlay,'pointerup',500,400);assert.equal(buttons['SAVE AS'].disabled,false);assert.equal(selection.style.width,'400px');
 h.event(overlay,'pointerdown',200,200,selection);h.event(overlay,'pointermove',220,210,selection);h.event(overlay,'pointerup',220,210,selection);assert.equal(selection.style.left,'120px');
 h.event(overlay,'pointerdown',520,410,selection.children[0]);h.event(overlay,'pointermove',550,450,selection.children[0]);h.event(overlay,'pointerup',550,450,selection.children[0]);assert.equal(selection.style.width,'430px');
 buttons.RESET.onclick();assert.equal(selection.hidden,true);assert.equal(buttons['SAVE AS'].disabled,true);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,false);buttons.DRAW.onclick();
 if(i%2)h.listeners.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else buttons.CANCEL.onclick();cancel();assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,true);assert.equal(h.elements.length,0);assert.equal(h.listeners.size,0);assert.equal(h.windowListeners.size,0);}
 h.viewer.scene.screenSpaceCameraController.enableInputs=false;assert.throws(()=>h.c.startNoticeCapture(h.viewer,notice()),/drawing or camera transition/);assert.equal(h.elements.length,0);
});
test('SAVE AS downloads a branded PNG and failures never silently export incomplete images',async()=>{
 const h=harness();h.c.startNoticeCapture(h.viewer,notice());const overlay=h.elements[0],toolbar=overlay.children[1],save=toolbar.children.find(n=>n.textContent==='SAVE AS');
 h.event(overlay,'pointerdown',100,100);h.event(overlay,'pointermove',500,400);h.event(overlay,'pointerup',500,400);await save.onclick();assert.equal(h.downloads.length,1);assert.match(h.downloads[0].name,/^StratOps_NOTAM_\d{4}-\d{2}-\d{2}_\d{6}Z\.png$/);assert.equal(h.elements.length,0);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,true);
 for(const options of [{logoError:true},{taint:true},{offscreen:true}]){const failed=harness(options);await assert.rejects(failed.c.composeNoticeCapture(failed.viewer,notice(),{x:100,y:100,width:400,height:300}));assert.equal(failed.downloads.length,0);}
 const expired=notice();expired.effectiveUntil=new Date(Date.now()-1000).toISOString();await assert.rejects(h.c.composeNoticeCapture(h.viewer,expired,{x:100,y:100,width:400,height:300}),/no longer current/);
});
test('validated multi-area and route geometry retains exact vertices and geographic filtering',()=>{
 const polygon=[[[65,24],[66,24],[66,25],[65,24]]],multi=validateGeometry({type:'MultiPolygon',coordinates:[polygon,[[[70,24],[71,24],[71,25],[70,24]]]]});assert.equal(multi.coordinates.length,2);assert.equal(containsNotice({geometry:multi},65.8,24.2),true);assert.equal(containsNotice({geometry:multi},68,24),false);
 const route=validateGeometry({type:'MultiLineString',coordinates:[[[65,24],[67,26]],[[70,20],[71,22]]]});assert.deepEqual(route.coordinates[0],[[65,24],[67,26]]);assert.equal(intersectsBounds({geometry:route},{minLon:64,maxLon:68,minLat:23,maxLat:27}),true);
 assert.throws(()=>validateGeometry({type:'LineString',coordinates:[[65,24]]}),/route/);
});
