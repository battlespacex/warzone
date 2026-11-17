// Local Cesium/WebGL fixture using the production capture module, styles and logos.
// Does not sign in, contact intelligence APIs, or change application data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('../apps/worker/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.generated/notice-capture');

(async () => {
    const app = express();
    app.get('/dev/assets/js/warzone-notice-capture.js', (_req, res) => res.type('js').send(
        fs.readFileSync(path.join(root, 'dev/assets/js/warzone-notice-capture.js'), 'utf8')
            .replace("import * as Cesium from 'cesium';", 'const Cesium = window.Cesium;')));
    app.get('/fixture', (_req, res) => res.send(`<!doctype html><html><head>
        <link rel="stylesheet" href="/assets/css/style.css">
        <link rel="stylesheet" href="/node_modules/cesium/Build/Cesium/Widgets/widgets.css">
        <style>#map{position:absolute;inset:0}#wz-map-layers-pane{position:absolute;left:0;top:100px;width:240px;height:800px;background:#202631}</style>
        <script>window.CESIUM_BASE_URL='/node_modules/cesium/Build/Cesium/';</script>
        <script src="/node_modules/cesium/Build/Cesium/Cesium.js"></script></head><body>
        <div id="map"></div><aside id="wz-map-layers-pane" aria-hidden="false">Map Layers fixture</aside>
        <script type="module">
        import * as capture from '/dev/assets/js/warzone-notice-capture.js';
        Cesium.Ion.defaultAccessToken=undefined;
        const viewer=new Cesium.Viewer('map',{baseLayer:false,baseLayerPicker:false,geocoder:false,animation:false,timeline:false,homeButton:false,navigationHelpButton:false,sceneModePicker:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,skyAtmosphere:false});
        viewer.useBrowserRecommendedResolution=false;viewer.scene.globe.baseColor=Cesium.Color.fromCssColorString('#24485b');viewer.clock.shouldAnimate=false;
        viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(65,24,800000)});
        const entity=viewer.entities.add({position:Cesium.Cartesian3.fromDegrees(65,24),point:{pixelSize:16,color:Cesium.Color.CYAN},ellipse:{semiMajorAxis:100000,semiMinorAxis:80000,material:Cesium.Color.YELLOW.withAlpha(.2)}});
        const notice={sourceId:'A0672/26',noticeType:'NOTAM',region:'Al Farwaniyah',country:'Kuwait',provider:'Fixture source',geometry:{type:'Point',coordinates:[65,24]},effectiveFrom:'2026-11-01T00:00:00Z',effectiveUntil:null,metadata:{permanent:true}};
        Object.assign(window,{capture,viewer,notice,entity});window.showSaveFilePicker=undefined;
        </script></body></html>`));
    app.use(express.static(root));
    app.use(express.static(path.join(root, 'dev')));
    const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
    let browser;
    try {
        fs.mkdirSync(output, { recursive: true });
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
        for (const [dpr, resolutionScale] of [[1,1],[2,1],[2,.75]]) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: dpr, acceptDownloads: true });
            const page = await context.newPage(), errors=[];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
            await page.waitForFunction(() => window.viewer && window.capture);
            await page.evaluate(async scale => { viewer.resolutionScale=scale;viewer.resize();await document.fonts.ready;await new Promise(resolve=>{const remove=viewer.scene.postRender.addEventListener(()=>{remove();resolve();});viewer.scene.requestRender();}); }, resolutionScale);
            const initial = await page.evaluate(() => {
                window.originalViewer=viewer;window.originalCamera=viewer.camera.position.clone();
                window.closeCapture=capture.startNoticeCapture(viewer,notice,{entity});
                const box=document.querySelector('.wz-notice-capture__selection').getBoundingClientRect();
                return { ratio:document.querySelector('.wz-notice-capture select').value,x:box.x,inputs:viewer.scene.screenSpaceCameraController.enableInputs };
            });
            assert.equal(initial.ratio,'1:1');assert.ok(initial.x>=240);assert.equal(initial.inputs,false);
            const ratios=[['1:1',720,720],['16:9',912,513],['9:16',513,912],['custom',512,512]];
            for (const [aspect,width,height] of ratios) {
                await page.getByLabel('Capture aspect ratio').selectOption(aspect);
                const geometry=await page.evaluate(() => {
                    const box=document.querySelector('.wz-notice-capture__selection').getBoundingClientRect(),bar=document.querySelector('.wz-notice-capture__toolbar').getBoundingClientRect(),map=viewer.scene.canvas.getBoundingClientRect(),r=Math.min(viewer.scene.canvas.width/map.width,viewer.scene.canvas.height/map.height);
                    return {width:Math.round(box.width*r),height:Math.round(box.height*r),visible:bar.left>=0&&bar.top>=0&&bar.right<=innerWidth&&bar.bottom<=innerHeight};
                });
                assert.equal(geometry.width,width);assert.equal(geometry.height,height);assert.ok(geometry.visible);
                // Actual composition: real WebGL frame, computed CSS, SVG logos, encoded PNG.
                const result=await page.evaluate(async aspect => {
                    const overlay=document.querySelector('.wz-notice-capture'),box=overlay.querySelector('.wz-notice-capture__selection'),map=viewer.scene.canvas.getBoundingClientRect();
                    // Center on the fixture's notice while preserving selection dimensions.
                    box.style.left=(map.width-parseFloat(box.style.width))/2+'px';box.style.top=(map.height-parseFloat(box.style.height))/2+'px';
                    const selection={x:parseFloat(box.style.left),y:parseFloat(box.style.top),width:parseFloat(box.style.width),height:parseFloat(box.style.height)},now=new Date('2026-11-16T19:08:06Z');
                    const first=await capture.composeNoticeCapture(viewer,notice,selection,{entity,aspect,now});
                    overlay.hidden=true;const clean=await capture.composeNoticeCapture(viewer,notice,selection,{entity,aspect,now});overlay.hidden=false;
                    const a=new Uint8Array(await first.arrayBuffer()),b=new Uint8Array(await clean.arrayBuffer()),bitmap=await createImageBitmap(first),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);
                    const corners=[[0,0],[bitmap.width-1,0],[0,bitmap.height-1],[bitmap.width-1,bitmap.height-1]].map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
                    let binary='';for(const value of a)binary+=String.fromCharCode(value);
                    return {width:bitmap.width,height:bitmap.height,clean:a.length===b.length&&a.every((v,i)=>v===b[i]),corners,png:btoa(binary)};
                },aspect);
                assert.equal(result.width,width);assert.equal(result.height,height);assert.ok(result.clean,'Toolbar, border and handles must not affect exported pixels');
                for(const corner of result.corners){assert.equal(corner[3],255);assert.ok(corner.slice(0,3).some(v=>v>0));}
                fs.writeFileSync(path.join(output,`${aspect.replace(':','-')}-dpr-${dpr}-scale-${resolutionScale}.png`),Buffer.from(result.png,'base64'));
                console.log(`PASS DPR ${dpr}, resolutionScale ${resolutionScale}: ${aspect} ${width}x${height}, clean PNG, opaque corners, toolbar visible`);
            }
            // Exercise real pointer drawing, movement, minimum clamp, enlargement, Reset and Escape.
            await page.getByLabel('Capture aspect ratio').selectOption('custom');
            await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(301,301);await page.mouse.up();
            const small=await page.locator('.wz-notice-capture__selection').boundingBox();
            const scale=await page.evaluate(()=>{const r=viewer.scene.canvas.getBoundingClientRect();return Math.min(viewer.scene.canvas.width/r.width,viewer.scene.canvas.height/r.height);});
            assert.ok(Math.abs(small.width*scale-512)<1);
            await page.mouse.move(small.x+30,small.y+30);await page.mouse.down();await page.mouse.move(small.x+70,small.y+50);await page.mouse.up();
            const moved=await page.locator('.wz-notice-capture__selection').boundingBox();assert.ok(Math.abs(moved.x-small.x-40)<1);
            const handle=await page.locator('.wz-notice-capture__resize').boundingBox();
            await page.mouse.move(handle.x+7,handle.y+7);await page.mouse.down();await page.mouse.move(handle.x+87,handle.y+67);await page.mouse.up();
            const enlarged=await page.locator('.wz-notice-capture__selection').boundingBox();assert.ok(enlarged.width>moved.width);
            await page.getByRole('button',{name:'RESET',exact:true}).click();
            await page.getByRole('button',{name:'DRAW',exact:true}).click();await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(900,800);await page.keyboard.press('Escape');await page.mouse.up();
            assert.equal(await page.locator('.wz-notice-capture').count(),1);
            await page.keyboard.press('Escape');assert.equal(await page.locator('.wz-notice-capture').count(),0);
            assert.equal(await page.evaluate(()=>viewer===originalViewer&&viewer.scene.screenSpaceCameraController.enableInputs&&Cesium.Cartesian3.equals(viewer.camera.position,originalCamera)),true);
            // Existing Save As fallback must produce a downloadable PNG and exit capture mode.
            await page.evaluate(()=>capture.startNoticeCapture(viewer,notice,{entity}));
            await page.screenshot({path:path.join(output,`toolbar-dpr-${dpr}-scale-${resolutionScale}.png`)});
            const download=page.waitForEvent('download');await page.getByRole('button',{name:'SAVE AS',exact:true}).click();
            await (await download).saveAs(path.join(output,`saved-dpr-${dpr}-scale-${resolutionScale}.png`));
            await page.waitForFunction(()=>!document.querySelector('.wz-notice-capture'));
            // Too-small framebuffer: explain, disable Save, and allow Cancel.
            await page.evaluate(()=>{viewer.resolutionScale=.25;viewer.resize();capture.startNoticeCapture(viewer,notice,{entity});});
            assert.equal(await page.getByRole('button',{name:'SAVE AS',exact:true}).isDisabled(),true);
            assert.match(await page.locator('.wz-notice-capture__toolbar span').textContent(),/needs at least 720 × 720/);
            await page.getByRole('button',{name:'CANCEL',exact:true}).click();
            assert.deepEqual(errors,[]);await context.close();
        }
    } finally {
        if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
