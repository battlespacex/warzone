import test from 'node:test';import assert from 'node:assert/strict';
import {createNavalIntelService,navalIntelRouter,publicNavalSource} from '../src/routes.naval-intel.js';
const response=()=>({code:200,headers:{},status(n){this.code=n;return this;},set(k,v){this.headers[k]=v;return this;},json(v){this.body=v;return this;}});
test('source diagnostics never expose private permission references or catalog payloads',()=>{
 const result=publicNavalSource({id:'PUB-002',name:'Publisher',access_status:'ready',permission_reference:'https://private.invalid/contract?token=fixture',catalog:{private:'fixture'}});assert.equal(result.id,'PUB-002');assert.equal(result.permission_reference,undefined);assert.equal(result.catalog,undefined);
});
test('premium authorization fails closed before loading any reports',async()=>{
 let queried=false;const router=navalIntelRouter({service:{database(){queried=true;}},authorize:async()=>({allowed:false,status:403})}),res=response();await router.stack[0].handle({headers:{}},res,()=>{throw Error('must not continue');});assert.equal(res.code,403);assert.equal(queried,false);
});
test('bounded API validates bbox/limit, returns named-region reports and keeps errors explicit',async()=>{
 const row={id:'a',published_at:new Date().toISOString(),valid_until:new Date(Date.now()+10000).toISOString(),geometry:null,region:'Arabian Sea',evidence:[]};
 const router=navalIntelRouter({service:{snapshot:async()=>({events:[row],sources:[]}),database(){}},authorize:async()=>({allowed:true})});const route=router.stack.find(l=>l.route&&Array.isArray(l.route.path)).route.stack[0].handle;
 for(const query of [{limit:'999'},{bbox:'invalid'}]){const res=response();await route({query,path:'/events'},res);assert.equal(res.code,400);}
 const res=response();await route({query:{limit:'10'},path:'/events'},res);assert.equal(res.body.events.length,1);assert.equal(res.body.live,false);
});
test('API snapshot cache and concurrent requests share one bounded database read',async()=>{
 let reads=0;const builder={gte(){return this;},order(){return this;},limit(){return this;},then(resolve){reads++;return Promise.resolve({data:[],error:null}).then(resolve);}};
 const service=createNavalIntelService({getDb:()=>({from:()=>({select:()=>builder})})});await Promise.all([service.snapshot(),service.snapshot()]);await service.snapshot();assert.equal(reads,2);
});
