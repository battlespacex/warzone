import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const source = fs.readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
test("Chrome: expanded Intel pagination, keyed cards, scroll and actions survive automatic refresh", { timeout: 60000 }, async t => {
  const executablePath = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (!fs.existsSync(executablePath)) return t.skip("Installed Chrome required");
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent(`<style>#live-feed-list{height:300px;overflow:auto;overflow-anchor:none}.wz-feed-item{height:100px}</style>
    <section data-widget-id="feed"><select id="wz-feed-filter-country"><option value="all">All</option><option value="us">US</option></select>
    <select id="wz-feed-filter-time"><option value="all">All</option><option value="24h">24h</option></select>
    <div id="live-feed-list"></div><span id="live-feed-count"></span><button id="live-feed-load-more">More</button></section>`);
  await page.addScriptTag({ content: `
    let __feedControlsBound=false,__intelWireFilterControlsBound=false,__intelWireMediaControlsBound=false;
    let __intelWireLastViewModel=null,__intelWireCountryFilter='all',__intelWireTimeFilter='all';
    let __lastFeedSignature=null,__lastFeedDataSignature=null,__feedVisibleCount=12,__intelWireRenderedItems=new Map();
    const FEED_INITIAL_VISIBLE_COUNT=12,FEED_LOAD_MORE_COUNT=12;
    const noop=()=>{},bindIntelWirePanelLifecycle=noop,startIntelWireRelativeTimeLoop=noop;
    const getIntelWireCountryFilterOptions=()=>[],hasActiveIntelWireFilters=()=>false,stopIntelWireCardMedia=noop;
    const refreshIntelWireRelativeTimes=noop,syncIntelWireReadFullControl=noop,renderIntelWireMediaCard=noop,syncVisibleIntelWireReadFullControls=noop;
    const getIntelWireMediaState=()=>({}), syncFeedExpandedState=noop,refreshFeedExpandedLayout=noop;
    const makeEventSignature=rows=>rows.map(e=>e.id+e.title).join('|');
    let opened=0; const openIntelWireDetailModal=()=>opened++;
    const getIntelWireCardRenderSignature=e=>e.id+e.title;
    const createIntelWireFeedCard=(event,id,sig)=>{const card=document.createElement('article');card.className='wz-feed-item';
      card.dataset.eventId=id;card.dataset.renderSignature=sig;card.textContent=event.title;
      const button=document.createElement('button');button.dataset.intelWireReadFull='1';button.textContent='Read Full';card.append(button);return card;};
    const buildIntelWireViewModel=()=>window.view(window.articles);
    ${['getIntelWireEventDomKey','runFeedPanelAction','syncIntelWireFilterControls','bindFeedControls','renderFeed'].map(fn).join('\n')}
    window.view=items=>{const rows=items.filter(e=>__intelWireCountryFilter==='all'||e.country===__intelWireCountryFilter);
      return {baseEvents:items,filteredEvents:rows,total:items.length,filteredTotal:rows.length,countryOptions:[...new Set(items.map(e=>e.country))].map(value=>({value,label:value.toUpperCase()})),hasActiveFilters:__intelWireCountryFilter!=='all'};};
    window.articles=Array.from({length:70},(_,i)=>({id:'article-'+i,title:'Intel '+i,country:i%2?'us':'gb'}));
    window.refresh=()=>renderFeed(window.view(window.articles));
    window.state=()=>({shown:document.querySelectorAll('.wz-feed-item').length,limit:__feedVisibleCount,opened,
      country:__intelWireCountryFilter,time:__intelWireTimeFilter,more:document.getElementById('live-feed-load-more').textContent});
    window.refresh();` });
  assert.equal((await page.evaluate(() => window.state())).shown, 12);
  for (let i = 0; i < 2; i++) { await page.click('#live-feed-load-more'); await page.waitForFunction(n => window.state().shown === n, 24 + i * 12); }
  await page.evaluate(() => { window.oldNodes=[...document.querySelectorAll('.wz-feed-item')];document.getElementById('live-feed-list').scrollTop=1500; });
  const before = await page.locator('[data-event-id="article-15"]').boundingBox();
  const timing = await page.evaluate(() => {
    window.articles.unshift({id:'new',title:'New report',country:'us'});
    const start=performance.now(); window.refresh();
    return {ms:performance.now()-start,same:window.oldNodes.every(node=>node.isConnected)};
  });
  assert.equal(timing.same, true); assert.equal((await page.evaluate(() => window.state())).shown, 37);
  const after = await page.locator('[data-event-id="article-15"]').boundingBox();
  assert.ok(Math.abs(after.y - before.y) < 1, "reading anchor must not jump when a new article arrives");
  await page.evaluate(() => {document.getElementById('live-feed-list').style.overflowAnchor='auto';window.articles.unshift({id:'new-2',title:'Another report',country:'us'});window.refresh();});
  const nativeAnchor = await page.locator('[data-event-id="article-15"]').boundingBox();
  assert.ok(Math.abs(nativeAnchor.y-before.y)<1,"native browser anchoring must not be applied twice");
  await page.evaluate(() => { for(let i=0;i<30;i++)window.refresh(); });
  assert.equal((await page.evaluate(() => window.state())).shown, 38);
  await page.evaluate(() => {window.articles[3]={...window.articles[3],title:'Corrected'};window.articles.splice(6,1);window.refresh();});
  assert.equal(await page.locator('[data-event-id="article-1"]').textContent(), 'CorrectedRead Full');
  assert.equal(await page.locator('[data-event-id="article-4"]').count(), 0);
  await page.evaluate(() => {document.querySelector('.wz-feed-item button').click();});
  assert.equal((await page.evaluate(() => window.state())).opened, 1);
  await page.selectOption('#wz-feed-filter-country', 'us');
  await page.waitForFunction(() => window.state().country==='us'&&window.state().shown===12);
  await page.evaluate(() => {window.refresh();});
  assert.equal((await page.evaluate(() => window.state())).country, 'us');
  await page.evaluate(() => {document.getElementById('live-feed-load-more').click();window.articles.unshift({id:'concurrent',title:'Concurrent arrival',country:'us'});window.refresh();});
  await page.waitForFunction(()=>window.state().shown>=24);
  assert.equal(await page.locator('.wz-feed-item').first().getAttribute('data-event-id'),'concurrent');
  await page.evaluate(()=>{window.articles=window.articles.filter(e=>e.country!=='us');window.refresh();});
  assert.equal((await page.evaluate(()=>window.state())).country,'us');
  assert.equal((await page.evaluate(()=>window.state())).shown,0);
  assert.deepEqual(errors, []); t.diagnostic(JSON.stringify({refreshMs:timing.ms,retainedCards:timing.same,anchorDeltaPx:after.y-before.y}));
});
