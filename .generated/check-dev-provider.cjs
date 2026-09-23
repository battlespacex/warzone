const { chromium } = require('../apps/worker/node_modules/playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Users/wirfa/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
  page.on('console',m=>{if(m.type()==='error') errors.push(`console: ${m.text()}`)});
  await page.goto('http://127.0.0.1:4173/pages/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(8000);
  const state=await page.evaluate(()=>({
    config:window.__stratopsConfig?.basemap,
    terrain:window.__stratopsConfig?.terrain,
    viewer:Boolean(window.__warzoneViewer),
    canvas:document.querySelectorAll('.cesium-widget canvas').length,
    title:document.title,
  }));
  console.log(JSON.stringify({state,errors},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
