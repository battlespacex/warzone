import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStratOpsTokenBridge } from './stratops-token-bridge.js';
test('rejects untrusted endpoint', () => {
 assert.throws(() => createStratOpsTokenBridge({ endpoint: 'https://evil.example/token' }), /Untrusted/);
});
test('fetches cookie token, caches and clears', async () => {
 let calls = 0; let authValue;
 const bridge = createStratOpsTokenBridge({
   endpoint:'https://www.battlespacex.com/api/auth/stratops-token',
   realtime:{ setAuth: s => {authValue = s;} },
   fetchImpl:async (url, opts) => {
     calls++; assert.equal(url,'https://www.battlespacex.com/api/auth/stratops-token');
     assert.equal(opts.credentials,'include');
     return {ok:true,json:async()=>({access_token:'signed-token-placeholder', expires_at:Math.ceil(Date.now()/1000)+300})};
   }
 });
 assert.equal(await bridge.getAccessToken(),'signed-token-placeholder');
 assert.equal(await bridge.getAccessToken(),'signed-token-placeholder');
 assert.equal(calls,1); assert.equal(authValue,'signed-token-placeholder');
 bridge.clear(); assert.equal(authValue,'');
 assert.equal(await bridge.getAccessToken(),'signed-token-placeholder');
 assert.equal(calls,2);
});
test('rejects malformed and expired response', async () => {
 const bridge = createStratOpsTokenBridge({
  endpoint:'https://www.battlespacex.com/api/auth/stratops-token',
  fetchImpl:async()=>({ok:true,json:async()=>({access_token:'bad',expires_at:1})})
 });
 await assert.rejects(bridge.getAccessToken(),/invalid/);
});
