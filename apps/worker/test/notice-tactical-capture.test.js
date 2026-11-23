import {installNoticeTemplates} from './notice-template-dom.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import * as RealCesium from 'cesium';
import {noticeGeometryPoints,noticeStatus,validateGeometry,intersectsBounds,containsNotice} from '../../shared/geospatial-notices.js';
const code=fs.readFileSync(new URL('../../../dev/assets/js/warzone-notice-capture.js',import.meta.url),'utf8');
function harness({logoError=false,taint=false,offscreen=false}={}){
 const elements=[],canvases=[],listeners=new Map(),windowListeners=new Map(),downloads=[],logos=[],compositions=[];
 class Element{constructor(tag){this.tag=tag;this.style={};this.children=[];this.events=new Map();this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}setAttribute(){}append(...nodes){this.children.push(...nodes);}addEventListener(name,fn){this.events.set(name,fn);}removeEventListener(name){this.events.delete(name);}closest(selector){return selector==='button'&&this.tag==='button'?this:null;}getBoundingClientRect(){return {width:550,height:100};}setPointerCapture(){}releasePointerCapture(){}remove(){const i=elements.indexOf(this);if(i>=0)elements.splice(i,1);}getContext(){if(!this.ctx)this.ctx={draws:[],texts:[],drawImage(...args){this.draws.push(args);},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},save(){},restore(){},measureText(text){return {width:text.length*6};},fillText(text){this.texts.push(text);}};return this.ctx;}toBlob(fn,type){fn(new Blob(['fixture only'],{type}));}}
 const sceneCanvas={width:1600,height:1200,getBoundingClientRect:()=>({left:20,top:40,width:800,height:600})};
 const viewer={scene:{canvas:sceneCanvas,globe:{tilesLoaded:true},screenSpaceCameraController:{enableInputs:true}}};
 const c=vm.createContext({Cesium:{...RealCesium,SceneTransforms:{worldToWindowCoordinates:()=>offscreen?{x:900,y:800}:{x:300,y:250}}},noticeGeometryPoints,noticeStatus,
  copyNextSceneFrame:async(_viewer,fn)=>{fn?.();return sceneCanvas;},assertCaptureReadable(){if(taint)throw Error('Canvas security blocked');},loadImage:async url=>{if(logoError)throw Error('Logo unavailable');const image={src:url,naturalWidth:400,naturalHeight:80};logos.push(image);return image;},downloadBlob:(blob,name)=>downloads.push({blob,name}),canUseSavePicker:()=>false,
  getComputedStyle:()=>({getPropertyValue:name=>name==='--wz-notice-export-max-pixels'?'16000000':''}),Blob,document:{documentElement:{},querySelectorAll:()=>[],createElement:tag=>{const el=new Element(tag);if(tag==='canvas')canvases.push(el);return el;},body:{append:el=>elements.push(el)},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},
  window:{addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:name=>windowListeners.delete(name)}});
installNoticeTemplates(c);
 vm.runInContext(code.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),c);
 c.paintNoticeExport=async(...args)=>compositions.push(args);
 return {c,viewer,elements,canvases,listeners,windowListeners,downloads,logos,compositions,event(el,type,x,y,target=el){el.events.get(type)({type,target,clientX:x+20,clientY:y+40,pointerId:1,button:0,preventDefault(){},stopPropagation(){}});}};
}
const notice=()=>({id:'fixture',sourceId:'A0001/26',title:'NOTAM A0001/26',noticeType:'notam',country:'India',provider:'notac',geometry:{type:'Point',coordinates:[65,24]},effectiveFrom:new Date(Date.now()-60000).toISOString(),effectiveUntil:new Date(Date.now()+3600000).toISOString(),metadata:{}});

test('capture labels can change without breaking action bindings or preset availability',()=>{
 const h=harness(),cancel=h.c.startNoticeCapture(h.viewer,notice()),toolbar=h.elements[0].children[1];
 const aspect=toolbar.querySelector('[data-action="aspect"]');assert.deepEqual(aspect.children.map(el=>el.getAttribute('value')),['1:1','16:9','9:16','custom']);
 const draw=toolbar.querySelector('[data-action="draw"]');draw.setAttribute('data-resize-label','Adjust frame');draw.onclick();assert.equal(draw.textContent,'Adjust frame');
 const stop=toolbar.querySelector('[data-action="cancel"]');stop.textContent='Close capture';stop.onclick();assert.equal(h.elements.length,0);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,true);cancel();
});
test('capture rectangle clamps reverse drags and native crop preserves DPI, geography, branding and UTC',async()=>{
 const h=harness();assert.deepEqual(JSON.parse(JSON.stringify(h.c.captureRectangle({x:500,y:500},{x:-50,y:20},800,600))),{x:0,y:20,width:500,height:480});
 const blob=await h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:400,height:300});assert.equal(blob.type,'image/png');
 const out=h.canvases[0];assert.equal(out.width,800);assert.equal(out.height,600);assert.deepEqual(out.ctx.draws[0].slice(1),[200,200,800,600,0,0,800,600]);assert.equal(out.ctx.draws[0][0],h.viewer.scene.canvas);
 assert.equal(h.logos.length,2);assert.equal(h.compositions[0][1].sourceId,'A0001/26');assert.ok(Number.isFinite(h.compositions[0][3].getTime()));assert.equal(h.downloads.length,0);
});
test('capture composition receives exported pixel coordinates when framebuffer axes differ',async()=>{
 const h=harness(),moves=[],create=h.c.document.createElement;h.viewer.scene.canvas.height=1800;
 h.c.document.createElement=tag=>{const el=create(tag);if(tag==='canvas')el.getContext().moveTo=(x,y)=>moves.push([x,y]);return el;};
 await h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:400,height:300});
 assert.equal(moves.length,0);assert.equal(h.compositions[0][7],1);assert.equal(h.compositions[0][4],800);assert.equal(h.compositions[0][5],600);assert.deepEqual(JSON.parse(JSON.stringify(h.compositions[0][6])),{x:400,y:300});assert.deepEqual(h.canvases[0].ctx.draws[0].slice(1),[200,300,800,900,0,0,800,600]);
});
test('DRAW/RESET/redraw/move/resize/CANCEL and ESC affect only the screenshot selection and restore inputs',()=>{
 const h=harness();for(let i=0;i<10;i++){const cancel=h.c.startNoticeCapture(h.viewer,notice());assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,false);const overlay=h.elements[0],selection=overlay.children[0],toolbar=overlay.children[1],buttons=Object.fromEntries(toolbar.children.filter(n=>n.tag==='button').map(n=>[n.textContent,n]));
 assert.equal(buttons['SAVE AS'].disabled,false);assert.equal(selection.style.width,'360px');assert.equal(selection.style.height,'360px');
 buttons.DRAW.onclick();h.event(overlay,'pointerdown',100,100);h.event(overlay,'pointermove',500,400);h.event(overlay,'pointerup',500,400);assert.equal(buttons['SAVE AS'].disabled,false);assert.equal(selection.style.width,'400px');assert.equal(selection.style.height,'400px');
 h.event(overlay,'pointerdown',200,200,selection);h.event(overlay,'pointermove',220,210,selection);h.event(overlay,'pointerup',220,210,selection);assert.equal(selection.style.left,'120px');
 h.event(overlay,'pointerdown',520,510,selection.children[0]);h.event(overlay,'pointermove',550,550,selection.children[0]);h.event(overlay,'pointerup',550,550,selection.children[0]);assert.equal(selection.style.width,'440px');
 h.event(overlay,'pointerdown',550,550,selection.children[0]);h.event(overlay,'pointermove',121,111,selection.children[0]);h.event(overlay,'pointerup',121,111,selection.children[0]);assert.equal(selection.style.width,'360px');
 buttons.RESET.onclick();assert.equal(selection.hidden,false);assert.equal(selection.style.width,'360px');assert.equal(buttons['SAVE AS'].disabled,false);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,false);
 if(i%2)h.listeners.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});else buttons.CANCEL.onclick();cancel();assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,true);assert.equal(h.elements.length,0);assert.equal(h.listeners.size,0);assert.equal(h.windowListeners.size,0);}
 h.viewer.scene.screenSpaceCameraController.enableInputs=false;assert.throws(()=>h.c.startNoticeCapture(h.viewer,notice()),/drawing or camera transition/);assert.equal(h.elements.length,0);
});
test('all presets enforce exact minimum export dimensions and reject unsupported viewports',async()=>{
 for(const [aspect,width,height]of [['1:1',720,720],['16:9',912,513],['9:16',513,912],['custom',512,512]]){
  const h=harness();h.c.startNoticeCapture(h.viewer,notice());const overlay=h.elements[0],box=overlay.children[0],toolbar=overlay.children[1],select=toolbar.children.find(n=>n.tag==='select');select.value=aspect;select.onchange();
  assert.equal(Math.round(parseFloat(box.style.width)*2),width);assert.equal(Math.round(parseFloat(box.style.height)*2),height);
  for(const end of [{x:101,y:101},{x:0,y:0},{x:800,y:600}]){h.event(overlay,'pointerdown',100,100);h.event(overlay,'pointermove',end.x,end.y);h.event(overlay,'pointerup',end.x,end.y);const w=Math.round(parseFloat(box.style.width)*2),ht=Math.round(parseFloat(box.style.height)*2);assert.ok(w>=width&&ht>=height);if(aspect!=='custom')assert.equal(w*height,ht*width);}
  const cancel=toolbar.children.find(n=>n.textContent==='CANCEL');cancel.onclick();
 }
 const h=harness();h.viewer.scene.canvas.width=400;h.viewer.scene.canvas.height=300;h.c.startNoticeCapture(h.viewer,notice());const toolbar=h.elements[0].children[1];assert.match(toolbar.children[0].textContent,/needs at least 720 × 720/);assert.equal(toolbar.children.find(n=>n.textContent==='SAVE AS').disabled,true);
 await assert.rejects(h.c.composeNoticeCapture(h.viewer,notice(),{x:0,y:0,width:400,height:300}),/needs at least 512 × 512/);
});
test('Escape and pointer cancellation restore the previous valid selection during a gesture',()=>{
 const h=harness();h.c.startNoticeCapture(h.viewer,notice());const overlay=h.elements[0],box=overlay.children[0],original={...box.style};
 for(const key of ['pointercancel','Escape']){h.event(overlay,'pointerdown',10,10);h.event(overlay,'pointermove',790,590);if(key==='Escape')h.listeners.get('keydown')({key,preventDefault(){},stopPropagation(){}});else h.event(overlay,key,790,590);assert.deepEqual(box.style,original);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,false);}
 h.listeners.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(h.elements.length,0);assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs,true);
});
test('fractional framebuffer scales, reverse/edge drags and export budgets stay within valid pixel bounds',()=>{
 const h=harness(),bounds={width:1400,height:1000};
 for(const scale of [.8,1,1.25,1.5,2,3])for(const aspect of ['1:1','16:9','9:16','custom']){
  const canvas={width:bounds.width*scale,height:bounds.height*scale*1.1},budget=1000000;
  let limits;try{limits=h.c.noticeCaptureLimits(canvas,bounds,aspect,budget);}catch(error){assert.match(error.message,/needs at least/);continue;}
  for(const start of [{x:0,y:0},{x:700,y:500},{x:1399,y:999}])for(const end of [{x:0,y:0},{x:701,y:501},{x:1400,y:1000}]){
   const r=h.c.constrainedNoticeRectangle(start,end,bounds,limits),w=Math.round(r.width*limits.ratio),height=Math.round(r.height*limits.ratio);
   assert.ok(w>=limits.minWidth&&height>=limits.minHeight);assert.ok(w*height<=budget);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=bounds.width+1e-8&&r.y+r.height<=bounds.height+1e-8);
   if(limits.width)assert.equal(w*limits.height,height*limits.width);
  }
 }
 // Highly asymmetric custom growth must preserve the short side's minimum under a tight budget.
 const tight=h.c.noticeCaptureLimits({width:10000,height:1000},{width:10000,height:1000},'custom',300000),r=h.c.constrainedNoticeRectangle({x:0,y:0},{x:10000,y:1},{width:10000,height:1000},tight);
 assert.ok(r.width>=512&&r.height>=512&&r.width*r.height<=300000);
});
test('export validation rejects undersized selections and ratio mismatches before rendering',async()=>{
 const h=harness();
 await assert.rejects(h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:255,height:300}),/512 × 512 exported pixels/);
 await assert.rejects(h.c.composeNoticeCapture(h.viewer,notice(),{x:0,y:0,width:400,height:360},{aspect:'1:1'}),/aspect ratio/);
 assert.equal(h.canvases.length,0);assert.equal(h.logos.length,0);
});
test('native Save As writes once, picker dismissal remains editable, and cancellation prevents a late export',async()=>{
 const h=harness(),writes=[];h.c.canUseSavePicker=()=>true;
 h.c.window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async blob=>writes.push(blob),close:async()=>writes.push('closed')})});
 h.c.startNoticeCapture(h.viewer,notice());await h.elements[0].children[1].children.find(n=>n.textContent==='SAVE AS').onclick();
 assert.equal(writes[0].type,'image/png');assert.equal(writes[1],'closed');assert.equal(writes.length,2);assert.equal(h.downloads.length,0);assert.equal(h.elements.length,0);
 const dismissed=harness();dismissed.c.canUseSavePicker=()=>true;dismissed.c.window.showSaveFilePicker=async()=>{const error=Error('dismissed');error.name='AbortError';throw error;};
 const close=dismissed.c.startNoticeCapture(dismissed.viewer,notice()),save=dismissed.elements[0].children[1].children.find(n=>n.textContent==='SAVE AS');await save.onclick();assert.equal(save.disabled,false);assert.equal(dismissed.elements.length,1);assert.equal(dismissed.canvases.length,0);close();
 const pending=harness();let choose;pending.c.canUseSavePicker=()=>true;pending.c.window.showSaveFilePicker=()=>new Promise(resolve=>{choose=resolve;});
 const cancel=pending.c.startNoticeCapture(pending.viewer,notice()),saving=pending.elements[0].children[1].children.find(n=>n.textContent==='SAVE AS').onclick();cancel();choose({});await saving;
 assert.equal(pending.canvases.length,0);assert.equal(pending.elements.length,0);assert.equal(pending.viewer.scene.screenSpaceCameraController.enableInputs,true);
});
test('a framebuffer resolution change while loading branding cannot silently export different dimensions',async()=>{
 const h=harness();h.c.loadImage=async()=>{h.viewer.scene.canvas.width+=1;return {naturalWidth:400,naturalHeight:80};};
 await assert.rejects(h.c.composeNoticeCapture(h.viewer,notice(),{x:100,y:100,width:400,height:300}),/capture resolution changed/);assert.equal(h.canvases.length,0);
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
