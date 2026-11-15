import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const essential=fs.readFileSync(new URL('../../../dev/assets/js/essential.js',import.meta.url),'utf8');
const bootstrap=essential.slice(essential.indexOf('const __noticeBootstraps ='),essential.indexOf('export function attachWarzoneAppViewer'));
function harness(){
    const enabled=new Set(),listeners=new Set(),events=new Map(),moves=new Set(),timers=new Map();let ready=false,loads=0,inits=0,seq=0,finish;
    const viewer={camera:{moveEnd:{addEventListener(fn){moves.add(fn);return ()=>moves.delete(fn);}}}};
    const c=vm.createContext({bindFloatingPanel(){},console:{warn(){}},isLayerEnabled:id=>enabled.has(id),onLayerChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
        document:{addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);}},
        setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)});
    vm.runInContext(bootstrap.replace('export function','function'),c);
    const options={ready:()=>ready,load:()=>{loads++;return new Promise(resolve=>{finish=resolve;});}};
    return {c,viewer,options,enabled,listeners,events,moves,timers,setReady(value){ready=value;},get loads(){return loads;},get inits(){return inits;},
        init(){c.initDeferredNoticeLayers(viewer,options);},emit(){for(const fn of listeners)fn('*');},event(name){events.get(name)?.();},tick(){const copy=[...timers.values()];timers.clear();for(const fn of copy)fn();},
        async finish(){finish({initNoticeLayers(){inits++;}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('disabled notice startup and region events perform no imports or initialization',()=>{
    const h=harness();h.setReady(true);h.init();h.init();for(let i=0;i<100;i++){h.emit();h.event('wz:region-camera-settled');h.tick();}
    assert.equal(h.loads,0);assert.equal(h.inits,0);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,1);assert.equal(h.moves.size,1);
    assert.doesNotMatch(essential,/^import .*warzone-notices/m);
});
test('optional import starts after entry and camera settlement, deduplicates events and never blocks caller',async()=>{
    const h=harness();h.enabled.add('aviation-notam');h.init();h.tick();assert.equal(h.loads,0);
    h.setReady(true);h.event('wz:app-entered');h.event('wz:region-camera-settled');h.tick();assert.equal(h.loads,1);assert.equal(h.inits,0);
    for(let i=0;i<100;i++){h.emit();h.tick();}assert.equal(h.loads,1);
    h.setReady(false);await h.finish();assert.equal(h.inits,0,'a new region flight prevents stale import initialization');
    h.setReady(true);h.event('wz:region-camera-settled');h.tick();assert.equal(h.inits,1);assert.equal(h.loads,1);
    assert.equal(h.listeners.size,0);assert.equal(h.events.size,0);assert.equal(h.moves.size,0);
});
test('disabling while import is pending cannot allocate notice resources',async()=>{
    const h=harness();h.setReady(true);h.enabled.add('aviation-notam');h.init();h.tick();h.enabled.clear();h.emit();await h.finish();assert.equal(h.inits,0);
    h.enabled.add('naval-warnings');h.emit();h.tick();assert.equal(h.inits,1);assert.equal(h.loads,1);
});
test('failed optional import remains isolated without automatic retry loop',async()=>{
    const h=harness();let calls=0;h.options.load=()=>{calls++;return Promise.reject(Error('fixture unavailable'));};h.enabled.add('aviation-notam');h.setReady(true);h.init();h.tick();await new Promise(resolve=>setImmediate(resolve));
    for(let i=0;i<100;i++){h.event('wz:region-camera-settled');h.tick();}assert.equal(calls,1);assert.equal(h.inits,0);assert.equal(h.timers.size,0);
});
test('wheel bursts reuse the imagery update sampler and retain immediate first input and settlement',()=>{
    const text=fs.readFileSync(new URL('../../../dev/assets/js/warzone-imagery-refinement.js',import.meta.url),'utf8');
    const events=new Map(),preUpdates=[];let now=0,poses=0,updates=0;
    const viewer={camera:{},scene:{canvas:{addEventListener(name,fn){events.set(name,fn);}},preUpdate:{addEventListener(fn){preUpdates.push(fn);}}}};
    const c=vm.createContext({window:{__warzoneFocusDiagnostics:{state:'active',assetId:'a',generation:1},addEventListener(){}},document:{addEventListener(){}},performance:{now:()=>now},
        readFocusCameraPose(){poses++;return {};},createFocusImageryRefinementPolicy:()=>({update({userInteracting}){updates++;return {phase:userInteracting?'FOCUS_TRANSITION':'FOCUS_SETTLED',userMoving:userInteracting};}})});
    vm.runInContext(text.slice(text.indexOf('export function installFocusImageryRefinementPolicy'),text.indexOf('export function readTileRefinementSnapshot')).replace('export function','function'),c);
    c.installFocusImageryRefinementPolicy(viewer,()=>{});c.installFocusImageryRefinementPolicy(viewer,()=>{});assert.equal(preUpdates.length,1);
    for(let i=0;i<100;i++)events.get('wheel')();assert.equal(poses,2);assert.equal(updates,2);assert.equal(viewer.__warzoneFocusRefinementState.userMoving,true);
    now=300;preUpdates[0]();assert.equal(poses,3);events.get('wheel')();now=550;preUpdates[0]();assert.equal(viewer.__warzoneFocusRefinementState.userMoving,true,'later input extends the gesture');
    now=800;preUpdates[0]();assert.equal(viewer.__warzoneFocusRefinementState.phase,'FOCUS_SETTLED');
});
