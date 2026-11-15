import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
const source=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8');
test('notice header reuses real floating-panel drag, captures input, clamps bounds and disposes',()=>{
    const events=new Map(),windowEvents=new Map(),headerEvents=new Map(),frames=new Map();let frame=0,captured=null,prevented=0,stopped=0,focused=0,position;
    const head={addEventListener:(name,fn)=>headerEvents.set(name,fn),removeEventListener:name=>headerEvents.delete(name),setPointerCapture:id=>captured=id,releasePointerCapture:()=>captured=null};
    const panel={style:{},offsetWidth:300,offsetHeight:200,parentElement:{},classList:{add(){},remove(){}},matches:()=>false,
        querySelector:selector=>{assert.equal(selector,'.wz-widget-header');return head;},getBoundingClientRect:()=>({left:500,top:100}),focus(){focused++;}};
    const c=vm.createContext({document:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)},window:{innerWidth:1000,innerHeight:700,addEventListener:(name,fn)=>windowEvents.set(name,fn),removeEventListener:name=>windowEvents.delete(name)},
        requestAnimationFrame(fn){frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
    const start=source.indexOf('function bindFloatingPanel('),ast=parseExpressionAt(source,start,{ecmaVersion:'latest'});vm.runInContext(source.slice(start,ast.end),c);
    const dispose=c.bindFloatingPanel(panel,{headerSelector:'.wz-widget-header',fixed:true,onPosition:value=>position=value});
    const pointer={button:0,pointerId:1,clientX:510,clientY:110,target:{closest:()=>null},preventDefault(){prevented++;},stopPropagation(){stopped++;}};
    headerEvents.get('pointerdown')(pointer);assert.equal(captured,1);assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(focused,1);
    events.get('pointermove')({...pointer,clientX:2000,clientY:2000});assert.equal(frames.size,1);events.get('pointerup')(pointer);
    assert.equal(position.left,700);assert.equal(position.top,500);assert.equal(panel.style.left,'700px');assert.equal(events.size,0);assert.equal(captured,null);
    windowEvents.get('resize')();assert.equal(position.left,500);assert.equal(position.top,100);
    dispose();assert.equal(headerEvents.size,0);assert.equal(windowEvents.size,0);assert.equal(frames.size,0);
});
