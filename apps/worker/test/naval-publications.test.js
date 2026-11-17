import test from 'node:test';import assert from 'node:assert/strict';
import {articleMetadata,publicationLinks,multilingualActivity,readPublication,hasPublicationRights,bangladeshPublications} from '../src/naval-intel/publications.js';
import {readNavalCatalog} from '../src/naval-intel/catalogs.js';
test('NZDF JSON-LD uses article publication and never a collection or modified date',()=>{
 const row=articleMetadata('<meta property="og:title" content="Naval exercise"><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-11-05T13:52:19+13:00","dateModified":"2026-11-16T00:00:00Z"}</script>','https://www.nzdf.mil.nz/navy/navy-news/example/','NZL-001');
 assert.equal(row.date_published,'2026-11-05T00:52:19.000Z');
 assert.equal(articleMetadata('<meta property="og:title" content="News"><script type="application/ld+json">{"@type":"CollectionPage","datePublished":"2026-11-05T00:00:00Z"}</script>','https://www.nzdf.mil.nz/navy/navy-news/','NZL-001'),null);
});
test('Spanish Navy visible publication date is explicitly day precision',()=>{
 const row=articleMetadata('<h1 class="tituloPlantilla">Ejercicio naval</h1><h2 class="descPlantilla">Martes, 10 de noviembre de 2026</h2>','https://armada.defensa.gob.es/ArmadaPortal/example','ESP-001');
 assert.equal(row.date_published,'2026-11-10T00:00:00.000Z');assert.equal(row.publication_precision,'day');assert.equal(multilingualActivity(row).event_type,'EXERCISE');
});
test('rights-gated official HTML sources cannot fetch until source-specific permission exists',async()=>{
 for(const id of ['NZL-001','ESP-001','BGD-001']){let calls=0;assert.equal(hasPublicationRights(id,undefined),false);await assert.rejects(readPublication({id},{fetchImpl:()=>calls++}),/permission required/);assert.equal(calls,0);}
 assert.equal(hasPublicationRights('FRA-001',{source_id:'FRA-001',commercial_display:true,automated_ingestion:true,approved_by:'fixture',permission_reference:'https://example.org/fixture',reviewed_at:'2026-11-01'}),false);
});
test('Bangladesh index retains published day without replaying token-protected POST downloads',()=>{
 const rows=bangladeshPublications('<li style="display:none;" class="news-item"><span>ANNUAL NAVAL EXERCISE</span><div><i class="fa fa-calendar"></i>20-Jan-2025 02:16 pm</div><dddd>Published naval exercise report.</dddd><form method="post" action="https://unsafe.invalid"><input name="_token" value="never-copy"></form></li>');
 assert.equal(rows.length,1);assert.equal(rows[0].date_published,'2025-01-20T00:00:00Z');assert.equal(rows[0].publication_precision,'day');assert.equal(rows[0].url,'https://navy.mil.bd/');assert.ok(!JSON.stringify(rows).includes('never-copy'));
 assert.equal(multilingualActivity(rows[0]).event_type,'EXERCISE');
});
test('official metadata uses publication not update; scoped links never leave the source',()=>{
 const item=articleMetadata('<meta content="Exercice naval" property="og:title"><meta property="article:published_time" content="2026-11-12T09:00:00+0100"><meta property="og:updated_time" content="2026-11-16T12:00:00Z">','https://www.defense.gouv.fr/marine/actualites/example');
 assert.equal(item.date_published,'2026-11-12T08:00:00.000Z');assert.equal(multilingualActivity(item).event_type,'EXERCISE');
 assert.equal(articleMetadata('<meta property="og:title" content="No published date">','https://example.org'),null);
 assert.deepEqual(publicationLinks('<a href="https://evil.test/noticias/x">x</a><a href="/noticias/y">y</a>',{endpoint:'https://www.argentina.gob.ar/defensa/armada/noticias',articlePath:'/noticias/'}),['https://www.argentina.gob.ar/noticias/y']);
});
test('multilingual classification adds no fabricated positions or nationality',()=>{
 for(const title of ['Exercice en mer','Ejercicio naval','Exercício naval','Tatbikat','Latihan laut','共同演習','海军演习','해군 훈련']){const row=multilingualActivity({id:'id',title,url:'https://example.org',date_published:'2026-11-16T00:00:00Z'});assert.equal(row.event_type,'EXERCISE');assert.equal(row.geometry,undefined);assert.equal(row.navy_country_iso2,null);}
});
test('catalog parsing cannot manufacture vessel observations',async()=>{
 const result=await readNavalCatalog('API-004',{fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({collections:[{id:'sentinel-1',title:'Sentinel',extent:{}}]})})});assert.equal(result.vessel_detections,0);assert.equal(result.kind,'imagery_catalog_only');
 await assert.rejects(readNavalCatalog('API-005',{fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({detections:[]})})}),/schema/);
});
test('publication HTTP denial is isolated and no page redirects are followed',async()=>{
 await assert.rejects(readPublication({id:'FRA-001'},{fetchImpl:async(_url,options)=>{assert.equal(options.redirect,'error');return {ok:false,status:403};}}),e=>e.status===403);
});
test('ATALANTA publication dates preserve day precision without assuming a timezone',()=>{
 const row=articleMetadata('<h1><span>Piracy incident update</span></h1><span class="field--name-created">Nov 04, 2026 - 15:21</span><div class="field--name-body"><p>Operation update from the Gulf of Aden.</p></div>','https://eunavfor.eu/news/example','COAL-002');
 assert.equal(row.publication_precision,'day');assert.equal(row.date_published,'2026-11-04T00:00:00.000Z');assert.equal(multilingualActivity(row).event_type,'MARITIME_OPERATION_REPORTED');
});
test('PIB date-only timestamps and quoted naval identities retain only explicit evidence',()=>{
 const meta=articleMetadata('<meta property="og:title" content="Maritime security joint cooperation activity"><div>Posted On: 27 SEP 2026 5:52PM by PIB Delhi</div>','https://www.pib.gov.in/PressReleasePage.aspx?PRID=2315585','IND-002');assert.equal(meta.publication_precision,'day');assert.equal(meta.date_published,'2026-09-27T00:00:00.000Z');
 const parsed=multilingualActivity({id:'fixture',title:'El ARA “Bahía Agradable” zarpó para participar de la patrulla naval',date_published:'2026-11-06T00:00:00Z',url:'https://www.argentina.gob.ar/noticias/fixture'});assert.equal(parsed.navy_country_iso2,'AR');assert.equal(parsed.vessel_name,'ARA Bahía Agradable');assert.equal(parsed.geometry,undefined);
});
test('missing publication is withdrawn without converting an index failure to an empty success',async()=>{
 const result=await readPublication({id:'IND-002'},{fetchImpl:async()=>({ok:false,status:410})});assert.equal(result.withdrawn.length,1);assert.equal(result.rows.length,0);
 await assert.rejects(readPublication({id:'ARG-001'},{fetchImpl:async()=>({ok:false,status:404})}),e=>e.status===404);
});
test('PIB discovery resolves canonical HTTPS article URLs and verifies article dates instead of inventing RSS dates',async()=>{
 let calls=0;const response=await readPublication({id:'IND-001'},{fetchImpl:async url=>{calls++;if(calls===1)return {ok:true,status:200,text:async()=>'<rss version="2.0"><channel><title>PIB</title><item><title>नौसेना अभ्यास</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2315585</link></item></channel></rss>'};
 const actual=new URL(url);assert.equal(actual.hostname,'www.pib.gov.in');assert.equal(actual.searchParams.get('lang'),'1');assert.equal(actual.searchParams.get('reg'),'48');return {ok:true,status:200,text:async()=>'<meta property="og:title" content="Naval exercise"><div>Posted On: 27 SEP 2026 5:52PM by PIB Delhi</div>'};}});
 assert.equal(calls,2);assert.equal(response.rows[0].publication_precision,'day');assert.equal(response.rows[0].date_published,'2026-09-27T00:00:00.000Z');
});
