const fs = require('node:fs');
const path = require('node:path');
const { validateConfig, isWorker, isGnssRaster } = require('./gnss-load-test.cjs');
const OPS = ['naval', 'aircraft', 'gnss', 'orbital-assets'];

function validate(config) {
    const checked = validateConfig({ ...config, counts: [1] });
    const cycles = config.cycles ?? 10, settleMs = config.settleMs ?? 5000;
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10 || !Number.isFinite(settleMs) || settleMs < 1000 || settleMs > 60000) throw new Error('Use 1-10 cycles and settleMs 1000-60000');
    return { ...checked, cycles, settleMs };
}
function summarize(samples) {
    const off = samples.filter(s => s.phase.endsWith('off'));
    const heaps = off.map(s => s.cdpMetrics?.JSHeapUsedSize ?? s.heap?.usedJSHeapSize).filter(Number.isFinite);
    return { samples: samples.length, offHeapBytes: heaps, offHeapGrowthBytes: heaps.length > 1 ? heaps.at(-1) - heaps[0] : null,
        memoryAcceptance: 'requires measured plateau review; heap growth alone does not identify a leak or GPU memory',
        browserRssBytes: null, gpuMemoryBytes: null };
}
async function layer(page, id, enabled) {
    const row = page.locator(`.wz-layer-item[data-layer="${id}"]`);
    if (await row.getAttribute('data-locked') === 'true') throw new Error(`Staging account cannot use ${id}`);
    if ((await row.getAttribute('class')).split(/\s+/).includes('is-on') === enabled) return;
    await row.click();
    await page.waitForFunction(({ id, enabled }) => document.querySelector(`.wz-layer-item[data-layer="${id}"]`)?.classList.contains('is-on') === enabled
        || document.getElementById('wz-layer-warning-modal')?.getAttribute('aria-hidden') === 'false', { id, enabled });
    if (await page.locator('#wz-layer-warning-modal').isVisible()) await page.locator('#wz-layer-warning-confirm').click();
    await page.waitForFunction(({ id, enabled }) => document.querySelector(`.wz-layer-item[data-layer="${id}"]`)?.classList.contains('is-on') === enabled, { id, enabled });
}
async function execute(config) {
    const { chromium } = require('../apps/worker/node_modules/playwright');
    const directory = path.resolve(config.outputDirectory, `tracker-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(directory, { recursive: true });
    let browser, page, cdp;
    const samples = [], failures = [], pageErrors = [];
    let started = false, complete = false, currentPhase = '';
    try {
        browser = await chromium.launch({ channel: config.channel || 'chrome', headless: config.headless !== false,
            args: ['--host-resolver-rules=MAP stratops.battlespacex.com ~NOTFOUND, MAP api.battlespacex.com ~NOTFOUND'] });
        const context = await browser.newContext({ storageState: config.storageStates?.[0] });
        page = await context.newPage(); page.setDefaultTimeout(config.timeoutMs);
        page.on('pageerror', error => pageErrors.push({ phase: currentPhase, message: error.message }));
        page.on('response', response => {
            if ((isWorker(response.url()) || isGnssRaster(response.url()) || /\.glb(?:\?|$)/i.test(response.url())) && response.status() >= 400) failures.push({ phase: currentPhase, status: response.status(), kind: isWorker(response.url()) ? 'worker' : isGnssRaster(response.url()) ? 'gnss-raster' : 'glb' });
        });
        await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded' });
        if (new URL(page.url()).origin !== new URL(config.baseUrl).origin) throw new Error('Navigation left approved local/staging origin');
        await require(path.resolve(config.flow)).prepare(page, config, 0);
        cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
        await page.evaluate(() => {
            const viewer = window.__warzoneViewer;
            const probe = window.__trackerStabilityProbe = { viewer, frames: [], longTasks: [], errors: [] };
            probe.removeFrame = viewer.scene.postRender.addEventListener(() => probe.frames.push(performance.now()));
            probe.removeError = viewer.scene.renderError.addEventListener((_scene, error) => probe.errors.push(String(error.message || error)));
            if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
                probe.observer = new PerformanceObserver(list => probe.longTasks.push(...list.getEntries().map(entry => entry.duration)));
                probe.observer.observe({ entryTypes: ['longtask'] });
            }
        });
        started = true;
        const capture = async phase => {
            currentPhase = phase;
            // Observation interval only; no application timers, fake data or forced rendering.
            await page.waitForTimeout(config.settleMs);
            if (config.forceGc === true) await cdp.send('HeapProfiler.collectGarbage');
            const value = await page.evaluate(() => {
                const p = window.__trackerStabilityProbe, viewer = window.__warzoneViewer;
                const intervals = p.frames.slice(1).map((time, i) => time - p.frames[i]).sort((a, b) => a - b);
                const at = q => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * q))] : null;
                const heap = performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null;
                const diagnostics = window.__getStratOpsPerformanceDiagnostics?.();
                const assigned = { aircraft: 0, naval: 0, orbital: 0 }, ready = { aircraft: 0, naval: 0, orbital: 0 };
                for (const e of viewer.entities.values) {
                    const kind = e.id.startsWith('track-') ? 'aircraft' : e.id.startsWith('naval-') ? 'naval' : e.id.startsWith('wz-orbital-') ? 'orbital' : '';
                    if (kind && e.model && e.show) assigned[kind]++;
                }
                const visit = collection => {
                    for (let i = 0; i < collection.length; i++) {
                        const model = collection.get(i);
                        if (typeof model.get === 'function' && Number.isInteger(model.length)) { visit(model); continue; }
                        const id = String(model.id?.id || '');
                        const kind = id.startsWith('track-') ? 'aircraft' : id.startsWith('naval-') ? 'naval' : id.startsWith('wz-orbital-') ? 'orbital' : '';
                        if (kind && model.ready === true && model.show !== false) ready[kind]++;
                    }
                };
                visit(viewer.scene.primitives);
                const result = { heap, sameViewer: p.viewer === viewer, defaultLoop: viewer.cesiumWidget.useDefaultRenderLoop,
                    canvasCount: viewer.container.querySelectorAll('canvas').length, assigned, ready, diagnostics,
                    frameIntervals: { count: intervals.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: intervals.at(-1) ?? null,
                        note: 'Intervals between requested render frames, not FPS while idle' },
                    longTasks: p.longTasks.slice(), renderErrors: p.errors.slice(),
                    basemap: document.querySelector('.wz-layer-item[data-layer="terrain"]')?.classList.contains('is-on'),
                    borders: document.querySelector('.wz-layer-item[data-layer="country-borders"]')?.classList.contains('is-on') };
                p.frames.length = 0; p.longTasks.length = 0;
                return result;
            });
            value.phase = phase; value.utc = new Date().toISOString(); value.forcedGc = config.forceGc === true;
            value.dom = await cdp.send('Memory.getDOMCounters');
            value.cdpMetrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(m => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents', 'JSEventListeners'].includes(m.name)).map(m => [m.name, m.value]));
            samples.push(value); fs.writeFileSync(path.join(directory, 'samples.json'), JSON.stringify(samples, null, 2));
            if (!value.sameViewer || !value.defaultLoop || value.renderErrors.length || (!value.basemap && !value.borders) || pageErrors.length || failures.length) throw new Error(`Runtime failure at ${phase}; inspect private artifacts`);
            return value;
        };
        for (const id of OPS) await layer(page, id, false);
        await capture('startup-off'); await layer(page, 'terrain', false);
        for (let i = 1; i <= config.cycles; i++) {
            await layer(page, 'naval', true); await layer(page, 'aircraft', true); await capture(`${i}-air-naval`);
            await layer(page, 'aircraft', false); await layer(page, 'naval', false); await layer(page, 'gnss', true); await capture(`${i}-gnss`);
            await layer(page, 'gnss', false); await layer(page, 'orbital-assets', true); await capture(`${i}-orbital`);
            for (const id of ['aircraft', 'naval', 'gnss']) await layer(page, id, true);
            const combined = await capture(`${i}-combined`);
            if (Object.keys(combined.assigned).some(kind => !combined.assigned[kind] || combined.ready[kind] < combined.assigned[kind])
                || !combined.diagnostics?.gnss?.visible) throw new Error('Inconclusive: genuine coverage or ready GLBs missing; never substitute observations');
            if (combined.basemap) throw new Error('Operational layers changed basemap preference');
            for (const id of OPS) await layer(page, id, false);
            const off = await capture(`${i}-off`);
            if (Object.values(off.assigned).some(Boolean) || Object.values(off.ready).some(Boolean)) throw new Error('Operational models retained after OFF');
        }
        await layer(page, 'country-borders', false); await capture('border-fallback');
        await layer(page, 'country-borders', true); await capture('both-base-layers');
        complete = true;
    } finally {
        if (started) await page.evaluate(() => { const p = window.__trackerStabilityProbe; p?.removeFrame?.(); p?.removeError?.(); p?.observer?.disconnect(); delete window.__trackerStabilityProbe; }).catch(() => {});
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ ...summarize(samples), failures, pageErrors,
            acceptance: complete ? 'pending-browser-memory-plateau-and-visual-review' : 'failed-or-inconclusive', samplesCompleted: samples.length }, null, 2));
        await browser?.close();
    }
    return directory;
}
module.exports = { validate, summarize };
if (require.main === module) (async () => {
    const args = process.argv.slice(2), file = args.indexOf('--config');
    if (file < 0 || !args[file + 1] || args.some((value, i) => !['--config', '--execute'].includes(value) && i !== file + 1)) throw new Error('Usage: tracker-stability-test.cjs --config <private staging config> [--execute]');
    const config = validate(JSON.parse(fs.readFileSync(path.resolve(args[file + 1]), 'utf8').replace(/^\uFEFF/, '')));
    if (!args.includes('--execute')) { console.info(JSON.stringify({ mode: 'plan-only; no browser/network traffic', baseUrl: config.baseUrl, cycles: config.cycles, settleMs: config.settleMs, phases: ['startup-off', 'air-naval', 'gnss', 'orbital', 'combined', 'off', 'border-fallback', 'both-base-layers'] }, null, 2)); return; }
    console.info(await execute(config));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
