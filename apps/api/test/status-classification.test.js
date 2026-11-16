import test from 'node:test';import assert from 'node:assert/strict';
import {assessStatusSignal,createCountryStatusClassifier,toPublicStatusSignal,STATUS_PRECEDENCE} from '../../shared/status-signal-policy.js';
import {toNoticeStatusSignals} from '../src/routes.notices.js';
const now=Date.parse('2026-11-16T12:00:00Z'),stamp=new Date(now).toISOString();
const signal=(domain,impact,extra={})=>({id:domain+impact,domain,country:'India',kind:domain==='cyber'?'reported_signal':'advisory',status:'reported',title:'Fixture',source_name:'Fixture authority',source_url:'https://example.org/source',published_at:stamp,fetched_at:stamp,
 evidence:{scope:'country',confidence:'high',verified:true,authoritative:true,comprehensive:true,state:'ongoing',impact,severity:'critical',observed_at:stamp,...extra}});
test('all cyber states require their stated evidence rather than report counts or absence',()=>{
 for(const status of STATUS_PRECEDENCE.cyber){const item=signal('cyber',status,{state:status==='normal'?'normal':status==='recovering'?'recovering':'ongoing'});
   if(status==='unknown')item.evidence.confidence='unknown';assert.equal(assessStatusSignal(item,now).status,status,status);}
 assert.equal(createCountryStatusClassifier()([],'India','cyber',now).status,'unknown');
 for(const scope of ['organization','area','unknown'])assert.equal(assessStatusSignal(signal('cyber','critical',{scope}),now).status,'monitoring');
 assert.equal(assessStatusSignal(signal('cyber','active',{verified:false}),now).status,'monitoring');
 assert.equal(assessStatusSignal(signal('cyber','normal',{comprehensive:false,state:'normal'}),now).status,'monitoring');
 assert.equal(assessStatusSignal(signal('cyber','active',{reliability:'low'}),now).status,'unknown');
});
test('all airspace states respect assessed extent and authority; airports never close a country',()=>{
 for(const status of STATUS_PRECEDENCE.airspace){const item=signal('airspace',status);if(status==='unknown')item.evidence.confidence='unknown';assert.equal(assessStatusSignal(item,now).status,status,status);}
 assert.equal(assessStatusSignal(signal('airspace','closed',{scope:'airport'}),now).status,'advisory');
 assert.equal(assessStatusSignal(signal('airspace','closed',{scope:'area'}),now).status,'partial');
 assert.equal(assessStatusSignal(signal('airspace','closed',{comprehensive:false}),now).status,'advisory');
 assert.equal(assessStatusSignal(signal('airspace','open',{authoritative:false}),now).status,'advisory');
 assert.equal(assessStatusSignal(signal('airspace','restricted',{scope:'area'}),now).status,'restricted');
});
test('stale, expired, unreliable, resolved, future and unattributed signals cannot create current incidents',()=>{
 const item=signal('cyber','active');for(const changed of [{stale:true},{country:null},{fetched_at:new Date(now-86400000).toISOString()},{source_url:'javascript:evil'}])assert.equal(assessStatusSignal({...item,...changed},now).status,'unknown');
 for(const e of [{state:'historical'},{state:'resolved'},{effective_until:stamp},{effective_from:new Date(now+60000).toISOString()}])assert.equal(assessStatusSignal({...item,evidence:{...item.evidence,...e}},now).status,'unknown');
});
test('country/domain decisions are independent, precedence is explicit, and latest incident state supersedes old impact',()=>{
 const classify=createCountryStatusClassifier(),active=signal('cyber','active',{incident_id:'incident-1'}),closed=signal('airspace','closed');
 let items=[active,closed,signal('cyber','critical',{scope:'organization'})];assert.equal(classify(items,'India','cyber',now).status,'active');assert.equal(classify(items,'India','airspace',now).status,'closed');assert.equal(classify(items,'Pakistan','cyber',now).status,'unknown');
 const recovered={...active,id:'latest',evidence:{...active.evidence,state:'recovering',observed_at:new Date(now+1).toISOString()}};
 assert.equal(classify([...items,recovered],'India','cyber',now+1).status,'recovering');
 assert.equal(classify([signal('cyber','critical'),signal('cyber','active')],'India','cyber',now).status,'critical');
});
test('unchanged inputs reuse assessments, while time boundaries and replacement evidence recalculate',()=>{
 const classify=createCountryStatusClassifier(),item=signal('airspace','restricted',{scope:'area',effective_until:new Date(now+1000).toISOString()}),items=[item];
 const first=classify(items,'India','airspace',now);for(let i=0;i<1000;i++)assert.equal(classify(items,'India','airspace',now+1),first);
 assert.equal(first.nextEvaluationAt,now+1000);assert.equal(classify(items,'India','airspace',now+1001).status,'unknown');
 assert.equal(classify([signal('airspace','open')],'India','airspace',now).status,'open');assert.equal(first.evidence[0].url,item.source_url);
});
test('NOTAM bridge preserves validity and altitude; schedule boundaries update without requesting new observations',()=>{
 const n={id:'notice',sourceId:'A0001/26',issuer:'FIXTURE FIR',provider:'notac',title:'Fixture',country:'India',status:'active',sourceUrl:'https://notac.aero/notam/fixture',rawText:'AIRSPACE CLOSED',geometry:{type:'Polygon',coordinates:[[[65,24],[66,24],[66,25],[65,24]]]},issuedAt:'2020-01-01T00:00:00Z',lastFetchedAt:stamp,
 effectiveFrom:new Date(now-60000).toISOString(),effectiveUntil:new Date(now+60000).toISOString(),provenance:{verification:'published'},metadata:{},lowerAltitude:'SFC',upperAltitude:'FL100'};
 let item=toNoticeStatusSignals([n])[0];assert.equal(assessStatusSignal(item,now).status,'partial');assert.equal(assessStatusSignal(item,now+60000).status,'unknown');assert.equal(item.evidence.upper_altitude,'FL100');
 item=toNoticeStatusSignals([{...n,rawText:'MILITARY EXERCISE',geometry:{type:'Point',coordinates:[65,24]}}])[0];assert.equal(assessStatusSignal(item,now).status,'advisory');
 item=toNoticeStatusSignals([{...n,status:'upcoming',effectiveFrom:new Date(now+1000).toISOString()}])[0];assert.equal(assessStatusSignal(item,now).status,'unknown');assert.equal(assessStatusSignal(item,now+1001).status,'partial');
 item=toNoticeStatusSignals([{...n,schedule:'DAILY 1201-1300',effectiveFrom:'2026-11-15T00:00:00Z',effectiveUntil:'2026-11-17T00:00:00Z'}])[0];assert.equal(assessStatusSignal(item,now).status,'unknown');assert.equal(assessStatusSignal(item,now+60001).status,'partial');
});
test('public normalization carries explicit proof without leaking raw payloads; current OTX evidence is monitoring only',()=>{
 const raw={guid:'fixture',title:'Fixture',category:'cyber',url:'https://otx.alienvault.com/pulse/fixture',country:'IN',published_at:stamp,fetched_at:stamp,raw:{secret:'private',status_signal:{domain:'cyber',kind:'threat_intelligence',status:'reported'}}};
 const item=toPublicStatusSignal(raw,now);assert.equal(item.assessment.status,'monitoring');assert.equal(item.status,'reported');assert.equal('raw' in item,false);assert.equal(JSON.stringify(item).includes('private'),false);
 const verified=toPublicStatusSignal({...raw,raw:{status_signal:{domain:'cyber',kind:'reported_signal',scope_level:'country',verified:true,confidence:'high',incident_state:'ongoing',operational_status:'active'}}},now);assert.equal(verified.assessment.status,'active');
});

test('airport identity overrides contradictory country-scope flags and negated NOTAM text stays advisory',()=>{
 const airport={...signal('airspace','closed'),kind:'airport_restriction'};assert.equal(assessStatusSignal(airport,now).status,'advisory');
 const n={id:'notice',sourceId:'A0001/26',issuer:'FIXTURE',provider:'notac',country:'India',status:'active',sourceUrl:'https://notac.aero/notam/fixture',geometry:{type:'Polygon',coordinates:[[[65,24],[66,24],[66,25],[65,24]]]},issuedAt:stamp,lastFetchedAt:stamp,effectiveFrom:new Date(now-1000).toISOString(),effectiveUntil:new Date(now+1000).toISOString(),provenance:{verification:'published'},metadata:{}};
 for(const rawText of ['NO AIRSPACE RESTRICTION','VOLCANIC ASH NOT OBSERVED','AIRSPACE CLOSED CANCELLED'])assert.equal(assessStatusSignal(toNoticeStatusSignals([{...n,rawText}])[0],now).status,'advisory');
 assert.equal(assessStatusSignal(toNoticeStatusSignals([{...n,rawText:'RESTRICTED AREA ACTIVATED'}])[0],now).status,'restricted');
});
