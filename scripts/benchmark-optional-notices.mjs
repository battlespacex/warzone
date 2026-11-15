import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import * as geospatial from '../apps/shared/geospatial-notices.js';
import * as providers from '../apps/shared/notice-providers.js';

// CPU/operation benchmark of real service and camera-input functions. No HTTP,
// Cesium scene, browser FPS, live observations or production environment needed.
const baseline=process.argv[2];
if(!baseline)throw Error('Supply a directory containing routes-before.js and imagery-before.js from the reviewed baseline.');
const at=Date.parse('2026-11-15T12:00:00Z');
const rows=Array.from({length:5000},(_,i)=>({provider:'import',issuer:'TEST',fir:'TEST',sourceId:`A${String(i+1).padStart(4,'0')}/26`,noticeType:'notam',
    sourceUrl:'https://example.org/fixture',rawText:'Benchmark fixture only',isMilitaryRelated:true,effectiveFrom:'2026-11-15T00:00:00Z',effectiveUntil:'2026-11-16T00:00:00Z'}));
const bytes=Buffer.from(JSON.stringify(rows));
async function service(source){
    let deduplications=0,reads=0;
    const c=vm.createContext({...geospatial,...providers,createSkySpyStream:()=>({start(){},stop(){},diagnostics:()=>({})}),
        deduplicateNotices(records){deduplications++;return providers.deduplicateNotices(records);}});
    vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),c);
    const api=c.createNoticeService({env:{NOTICES_ENABLED:'true',NOTICES_IMPORT_FILE:'fixture',NOTICES_IMPORT_USAGE_APPROVED:'true'},providers:[],skyspy:{diagnostics:()=>({})},
        now:()=>at,readFile:async()=>{reads++;return bytes;}});
    const start=performance.now();let result;
    for(let i=0;i<30;i++)result=await api.list({status:'all',limit:200});
    const elapsedMs=performance.now()-start;api.dispose();
    assert.equal(result.total,5000);assert.equal(reads,1);
    return {requests:30,inputRecords:5000,deduplications,importReads:reads,elapsedMs:Number(elapsedMs.toFixed(2)),result};
}
function input(source){
    let now=0,poses=0;const events=new Map(),pre=[];
    const c=vm.createContext({performance:{now:()=>now},window:{__warzoneFocusDiagnostics:{state:'active',assetId:'fixture',generation:1},addEventListener(){}},document:{addEventListener(){}},
        readFocusCameraPose(){poses++;return {};},createFocusImageryRefinementPolicy:()=>({update:({userInteracting})=>({userMoving:userInteracting,phase:userInteracting?'FOCUS_TRANSITION':'FOCUS_SETTLED'})})});
    vm.runInContext(source.slice(source.indexOf('export function installFocusImageryRefinementPolicy'),source.indexOf('export function readTileRefinementSnapshot')).replace('export function','function'),c);
    const viewer={camera:{},scene:{canvas:{addEventListener(name,fn){events.set(name,fn);}},preUpdate:{addEventListener(fn){pre.push(fn);}}}};
    c.installFocusImageryRefinementPolicy(viewer,()=>{});
    for(let i=0;i<100;i++)events.get('wheel')();
    const burstSamples=poses;now=400;pre[0]();assert.equal(viewer.__warzoneFocusRefinementState.phase,'FOCUS_SETTLED');
    return {wheelEvents:100,poseSamplesIncludingInitial:burstSamples};
}
const before=await service(fs.readFileSync(`${baseline}/routes-before.js`,'utf8'));
const after=await service(fs.readFileSync('apps/api/src/routes.notices.js','utf8'));
assert.equal(JSON.stringify(before.result),JSON.stringify(after.result));delete before.result;delete after.result;
const output={kind:'local synthetic CPU and operation counts; not browser performance',service:{before,after},wheel:{
    before:input(fs.readFileSync(`${baseline}/imagery-before.js`,'utf8')),after:input(fs.readFileSync('dev/assets/js/warzone-imagery-refinement.js','utf8'))}};
assert.equal(after.deduplications,1);assert.equal(output.wheel.after.poseSamplesIncludingInitial,2);
console.log(JSON.stringify(output,null,2));
