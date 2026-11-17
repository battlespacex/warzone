// Local-only rendered QA. Requires the installed worker Playwright package and Chrome.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('../apps/worker/node_modules/playwright');

(async () => {
    const app = express();
    app.use(express.static(path.resolve(__dirname, '../public-site')));
    app.use((_req, res) => res.status(404).sendFile(path.resolve(__dirname, '../public-site/404.html')));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome' });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const output = path.resolve(__dirname, '../.generated/domain-migration/browser');
        fs.mkdirSync(output, { recursive: true });
        for (const [width, height] of [[320,740],[375,812],[390,844],[430,932],[768,1024],[1024,768],[1440,900],[1920,1080],[844,390]]) {
            // Avoid repeatedly downloading the 98.5 MiB film; playback policy has separate runtime tests.
            const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
            const page = await context.newPage(), errors = [], failed = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
            page.on('requestfailed', request => failed.push(request.url()));
            page.on('request', request => requests.push(request.url()));
            await page.goto(origin, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: horizontal overflow`);
            if (width <= 800) {
                await page.getByRole('button', { name: 'Menu' }).click();
                await page.locator('#public-nav a[href="#tools"]').click();
                assert.equal(await page.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded'), 'false');
            }
            await page.locator('#tool-reports').click();
            assert.equal(await page.locator('#tool-panel').getAttribute('aria-labelledby'), 'tool-reports');
            await page.locator('#tool-reports').press('Home');
            assert.equal(await page.locator('#tool-focus').getAttribute('aria-selected'), 'true');
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: path.join(output, `${width}x${height}.png`), fullPage: true });
            assert.deepEqual(errors, []); assert.deepEqual(failed, []);
            assert.ok(requests.every(url => url.startsWith(origin + '/')), 'No external API/tracker requests');
            assert.ok(!requests.some(url => /\.mp4(?:$|\?)/.test(url)), 'Reduced motion must not download the film');
            console.log(`PASS ${width}x${height}: assets, overflow, menu, tabs, isolated network`);
            await context.close();
        }
        assert.equal((await fetch(origin + '/missing-page')).status, 404);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
