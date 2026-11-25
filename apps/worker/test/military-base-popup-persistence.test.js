import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
import * as Cesium from 'cesium';
const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-military-bases.js',import.meta.url),'utf8');
function harness(){
 let projected={x:600,y:300},visible=true,reads=0,cleanups=0;
 const panel={isConnected:true,style:{},offsetWidth:300,offsetHeight:220,
  getBoundingClientRect(){reads++;return {width:Math.min(this.offsetWidth,parseFloat(this.style.maxWidth)||Infinity),height:Math.min(this.offsetHeight,parseFloat(this.style.maxHeight)||Infinity)};},remove(){this.isConnected=false;}};
 const changed=new Cesium.Event(),render=new Cesium.Event(),listeners=new Map();
 const viewer={camera:{viewMatrix:Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),positionWC:Cesium.Cartesian3.fromDegrees(0,0,1e6),changed},
  scene:{canvas:{getBoundingClientRect:()=>({left:20,top:30})},postRender:render,requestRender(){}}};
 const state={viewer,runtimeBound:false,activePanel:{panel,baseId:'stable-base',data:{id:'stable-base'},world:Cesium.Cartesian3.fromDegrees(0,0),cleanup(){cleanups++;}}};
 const window={innerWidth:1200,innerHeight:800,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)};
 const c=vm.createContext({__state:state,window,Cesium:{...Cesium,SceneTransforms:{worldToWindowCoordinates:()=>projected},EllipsoidalOccluder:class{isPointVisible(){return visible;}}},
  bindClickHandler:()=>({destroy(){}}),areMilitaryBasesInteractive:()=>true,refreshBaseIconSizing(){},applyCtrHighlightVisibility(){}});
 for(const name of ['positionBasePanel','isScreenPointInViewport','setBasePanelVisible','getEntityScreenPosition','updateActiveBasePanelPosition','closeActiveBasePanel','bindBaseRuntime','unbindBaseRuntime']){
  const start=source.indexOf(`function ${name}(`);vm.runInContext(source.slice(start,parseExpressionAt(source,start,{ecmaVersion:'latest'}).end),c);
 }
 const move=point=>{projected=point;viewer.camera.viewMatrix[12]++;changed.raiseEvent();render.raiseEvent();};
 return {c,state,panel,viewer,window,move,hide(){visible=false;move(null);},show(){visible=true;move({x:600,y:300});},get reads(){return reads;},get cleanups(){return cleanups;},listeners};
}
test('base selection survives camera motion, offscreen/occlusion and marker replacement, then closes explicitly',()=>{
 const h=harness();h.c.bindBaseRuntime(h.viewer);h.c.bindBaseRuntime(h.viewer);
 assert.equal(h.viewer.camera.changed.numberOfListeners,1);assert.equal(h.viewer.scene.postRender.numberOfListeners,1);
 const active=h.state.activePanel;
 const inBounds=()=>{const left=parseFloat(h.panel.style.left),top=parseFloat(h.panel.style.top),rect=h.panel.getBoundingClientRect();assert.ok(left>=8&&top>=8&&left+rect.width<=h.window.innerWidth-8&&top+rect.height<=h.window.innerHeight-8);};
 for(const point of [{x:10,y:10},{x:800,y:200},{x:-400,y:400},{x:1800,y:300},{x:600,y:-200},{x:500,y:1300},null]){
  h.move(point);assert.equal(h.state.activePanel,active);assert.equal(h.panel.style.opacity,'1');inBounds();
 }
 h.hide();assert.equal(h.state.activePanel,active);inBounds();
 active.entity={position:null};h.show();assert.equal(h.state.activePanel.baseId,'stable-base');inBounds();
 h.panel.offsetHeight=700;h.panel.offsetWidth=500;h.window.innerWidth=320;h.window.innerHeight=300;h.move({x:50,y:50});inBounds();
 h.c.closeActiveBasePanel();assert.equal(h.state.activePanel,null);assert.equal(h.cleanups,1);assert.equal(h.panel.isConnected,false);
 h.c.unbindBaseRuntime();assert.equal(h.viewer.camera.changed.numberOfListeners,0);assert.equal(h.viewer.scene.postRender.numberOfListeners,0);assert.equal(h.listeners.size,0);
});
test('unchanged camera and dimensions avoid repeated base-popup layout reads',()=>{
 const h=harness();h.c.updateActiveBasePanelPosition();const before=h.reads;
 for(let i=0;i<100;i++)h.c.updateActiveBasePanelPosition();assert.equal(h.reads,before);
 h.panel.offsetHeight=400;h.c.updateActiveBasePanelPosition();assert.equal(h.reads,before+1);
});
