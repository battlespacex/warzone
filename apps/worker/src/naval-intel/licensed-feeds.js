import Parser from 'rss-parser';
export const licensedFeeds={
 'COAL-001':{endpoint:'https://combinedmaritimeforces.com/feed/',host:'combinedmaritimeforces.com'},
 'PUB-002':{endpoint:'https://news.usni.org/category/fleet-tracker/feed',host:'news.usni.org'},
 'PUB-005':{endpoint:'https://www.navalnews.com/feed/',host:'www.navalnews.com'}
};
// This is trusted operator configuration, not a browser/API entitlement or an access bypass.
// No grant is supplied by this repository; the operator must first obtain the real rights.
export function hasFeedRights(id,grant){
 return Boolean(licensedFeeds[id])&&hasSourceRights(id,grant);
}
export function hasSourceRights(id,grant){
 if(grant?.source_id!==id||grant?.commercial_display!==true||grant?.automated_ingestion!==true||!grant?.approved_by)return false;
 try{const ref=new URL(grant.permission_reference),reviewed=Date.parse(grant.reviewed_at),expires=grant.expires_at?Date.parse(grant.expires_at):Infinity;return ref.protocol==='https:'&&!ref.username&&!ref.password&&Number.isFinite(reviewed)&&reviewed<=Date.now()&&expires>Date.now();}catch{return false;}
}
export async function readLicensedFeed(id,grant,{fetchImpl=fetch}={}){
 if(!hasFeedRights(id,grant))throw Error('Documented commercial and automated-ingestion permission required');
 const policy=licensedFeeds[id],response=await fetchImpl(policy.endpoint,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/rss+xml, application/atom+xml'}});
 if(!response.ok){const e=Error('Licensed feed unavailable');e.status=response.status;e.retryAfter=Number(response.headers.get('retry-after'));throw e;}
 const xml=await response.text();if(xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsafe/oversized licensed feed');
 const feed=await new Parser({customFields:{item:['published']}}).parseString(xml);
 return feed.items.slice(0,20).map(item=>{const url=new URL(item.link);if(url.protocol!=='https:'||url.hostname!==policy.host||url.username||url.password)throw Error('Licensed feed link outside source');return {id:item.guid||item.id||item.link,title:item.title,short_description:item.contentSnippet||item.summary||'',url:url.href,date_published:item.published||item.pubDate};});
}
