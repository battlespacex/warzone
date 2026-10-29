import fs from 'node:fs/promises';
import {chromium} from '../apps/worker/node_modules/playwright/index.mjs';
const tag=process.argv[2]||'before';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-precise-memory-info']});
try {
 const p=await browser.newPage({viewport:{width:1920,height:1080}});p.setDefaultTimeout(12000);
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://localhost:4173/pages/index.html',{waitUntil:'domcontentloaded'});
 await p.locator('#wz-pre-entry-enter').click();await p.locator('#intro-disclaimer-check').check();await p.locator('#wz-intro-accept').click();await p.locator('[data-region="middle_east"]').click();await p.locator('#wz-region-confirm').click();
 await p.locator('[data-dock-widget="layers"]').click();
 for(const domain of ['aircraft','naval']){
  const layer=p.locator(`.wz-layer-item[data-layer="${domain}"]`);await layer.click();
  const confirm=p.locator('#wz-layer-warning-confirm');if(await confirm.isVisible())await confirm.click();
 }
 await p.waitForTimeout(10000);
 for(const domain of ['aircraft','naval'])if(!await p.locator(`#wz-${domain}-filter-subtype`).isVisible())await p.locator(`[data-dock-widget="${domain}"]`).click();
 await p.evaluate(()=>{
  window.probe={long:[],frames:[],clicks:[],mutations:{aircraft:0,naval:0}};
  new PerformanceObserver(l=>window.probe.long.push(...l.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false});
  let last=performance.now();window.probeFrame=requestAnimationFrame(function tick(t){window.probe.frames.push(t-last);last=t;window.probeFrame=requestAnimationFrame(tick);});
  for(const d of ['aircraft','naval']){const s=document.getElementById(`wz-${d}-filter-subtype`);new MutationObserver(l=>{window.probe.mutations[d]+=l.length;}).observe(s,{subtree:true,childList:true,attributes:true});
   s.addEventListener('pointerdown',()=>{const start=performance.now();requestAnimationFrame(()=>window.probe.clicks.push({domain:d,nextFrame:performance.now()-start,open:s.matches(':open')}));},{capture:true});}
 });
 const cdp=await p.context().newCDPSession(p);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 for(const d of ['aircraft','naval']){
  const s=p.locator(`#wz-${d}-filter-subtype`);
  for(let i=0;i<3;i++){await s.click();await p.waitForTimeout(600);if(i===0)await p.screenshot({path:`.generated/${d}-dropdown-${tag}.png`});
   await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowUp');await p.keyboard.press('Escape');}
 }
 const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(`.generated/dropdown-${tag}.cpuprofile`,JSON.stringify(profile));
 const stats=await p.evaluate(()=>({probe:window.probe,airTitle:document.getElementById('widget-aircraft-title')?.textContent,navTitle:document.getElementById('widget-naval-title')?.textContent,
  options:['aircraft','naval'].map(d=>({domain:d,values:[...document.getElementById(`wz-${d}-filter-subtype`).options].map(o=>o.textContent)})),
  diagnostics:window.__getWarzoneAircraftPipelineDiagnostics?.(),heap:performance.memory?.usedJSHeapSize,renderer:window.__warzoneViewer?.scene?.context?._gl?.getParameter(window.__warzoneViewer.scene.context._gl.RENDERER)}));
 const weights=new Map();profile.samples?.forEach((id,i)=>weights.set(id,(weights.get(id)||0)+(profile.timeDeltas?.[i]||0)));
 stats.topCpu=profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url,ms:(weights.get(n.id)||0)/1000})).sort((a,b)=>b.ms-a.ms).slice(0,18);stats.errors=errors;
 await fs.writeFile(`.generated/dropdown-${tag}-measurements.json`,JSON.stringify(stats,null,2));
 console.log(JSON.stringify({airTitle:stats.airTitle,navTitle:stats.navTitle,options:stats.options,clicks:stats.probe.clicks,mutations:stats.probe.mutations,longTasks:stats.probe.long,topCpu:stats.topCpu,errors}));
}finally{await browser.close();}
