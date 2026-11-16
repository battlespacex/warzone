import Parser from 'rss-parser';
// Supplemental endpoint review; supplied inventory remains unchanged.
export const publicFeeds={
 'UK-001':{url:'https://www.gov.uk/government/organisations/ministry-of-defence',endpoint:'https://www.gov.uk/government/organisations/ministry-of-defence.atom',commercial_gate:'open_government_licence',license_ref:'https://www.gov.uk/help/terms-conditions',attribution:'Contains public sector information licensed under the Open Government Licence v3.0.'}
};
export async function readPublicFeed(source,{fetchImpl=fetch,etag,lastModified}={}){
 const policy=publicFeeds[source.id];if(!policy)throw Error('No reviewed public feed');
 const response=await fetchImpl(policy.endpoint,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/atom+xml, application/rss+xml',...(etag?{'If-None-Match':etag}:{}),...(lastModified?{'If-Modified-Since':lastModified}:{})}});
 if(response.status===304)return {unchanged:true,items:[]};
 if(!response.ok){const error=Error('Public feed unavailable');error.status=response.status;error.retryAfter=Number(response.headers.get('retry-after'));throw error;}
 const xml=await response.text();if(xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsafe/oversized feed');
 const parsed=await new Parser({customFields:{item:['published','updated','rights']}}).parseString(xml);if(!Array.isArray(parsed.items))throw Error('Invalid feed');
 return {items:parsed.items.slice(0,100),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
}
