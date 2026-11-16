import test from 'node:test';import assert from 'node:assert/strict';
import {readPublicFeed} from '../src/naval-intel/public-feeds.js';
test('public Atom preserves original publication, conditional headers and rejects entities',async()=>{
 const source={id:'UK-001'};let headers;
 const feed=await readPublicFeed(source,{etag:'old',fetchImpl:async(_url,options)=>{headers=options.headers;return {ok:true,status:200,headers:{get:()=> 'new'},text:async()=>'<feed xmlns="http://www.w3.org/2005/Atom"><title>MOD</title><entry><id>1</id><title>Royal Navy patrol</title><link href="https://www.gov.uk/government/news/example"/><published>2026-11-15T00:00:00Z</published><updated>2026-11-16T00:00:00Z</updated></entry></feed>'};}});
 assert.equal(headers['If-None-Match'],'old');assert.equal(feed.items[0].published,'2026-11-15T00:00:00Z');assert.equal(feed.etag,'new');
 assert.equal((await readPublicFeed(source,{fetchImpl:async()=>({status:304})})).unchanged,true);
 await assert.rejects(readPublicFeed(source,{fetchImpl:async()=>({ok:true,text:async()=>'<!DOCTYPE feed><feed/>'})}),/Unsafe/);
});
