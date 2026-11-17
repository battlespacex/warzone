import test from 'node:test';import assert from 'node:assert/strict';
import {hasFeedRights,readLicensedFeed} from '../src/naval-intel/licensed-feeds.js';
const grant={source_id:'COAL-001',commercial_display:true,automated_ingestion:true,permission_reference:'https://example.org/fixture-permission',reviewed_at:'2026-11-16T00:00:00Z',approved_by:'fixture operator'};
test('licensed feed adapters fail closed before network access without source-scoped rights',async()=>{
 let calls=0;for(const invalid of [undefined,{}, {...grant,source_id:'PUB-002'},{...grant,commercial_display:false},{...grant,automated_ingestion:false},{...grant,permission_reference:'http://unsafe.invalid'}]){assert.equal(hasFeedRights('COAL-001',invalid),false);await assert.rejects(readLicensedFeed('COAL-001',invalid,{fetchImpl:()=>calls++}),/permission required/);}assert.equal(calls,0);
});
test('approved RSS uses pinned endpoint, source dates and no arbitrary external links',async()=>{
 const fetchImpl=async(url,options)=>{assert.equal(url,'https://combinedmaritimeforces.com/feed/');assert.equal(options.redirect,'error');return {ok:true,text:async()=>'<rss version="2.0"><channel><title>Fixture</title><item><title>Naval patrol</title><link>https://combinedmaritimeforces.com/fixture/</link><guid>fixture</guid><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>'};};
 const rows=await readLicensedFeed('COAL-001',grant,{fetchImpl});assert.equal(rows.length,1);assert.equal(rows[0].id,'fixture');
});
