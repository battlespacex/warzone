import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseDocument } from 'htmlparser2';
import { selectAll, selectOne } from 'css-select';
import { textContent } from 'domutils';
import { getNavalContactStatus, matchesNavalContactStatus } from '../../shared/naval-contact-lifecycle.js';

const read = (file) => fs.readFileSync(new URL('../../../' + file, import.meta.url), 'utf8');
const essential = read('dev/assets/js/essential.js');
const capture = read('dev/assets/js/warzone-capture-shot.js');
function sourceFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, source.indexOf('\n}', start) + 2);
}

// Small DOM adapter for handler tests. This does not emulate browser layout, canvas security or native selects.
function reportHarness() {
    const html = read('dev/pages/index.html').replace(/<%= partials\("popups"\) %>/g, () => read('dev/partials/popups.html'));
    const tree = parseDocument(html);
    const adapted = new WeakSet();
    function adapt(node) {
        if (!node || adapted.has(node)) return node;
        adapted.add(node);
        node.style = { removeProperty(name) { delete this[name]; } };
        node.listeners = {};
        node.addEventListener = (name, callback) => (node.listeners[name] ||= []).push(callback);
        node.querySelector = (selector) => adapt(selectOne(selector, node.children || []));
        node.querySelectorAll = (selector) => selectAll(selector, node.children || []).map(adapt);
        node.getAttribute = (name) => node.attribs?.[name] ?? null;
        node.setAttribute = (name, value) => { node.attribs[name] = String(value); };
        node.removeAttribute = (name) => { delete node.attribs[name]; };
        node.dataset = {};
        node.classList = { add() {}, remove() {}, toggle() {} };
        node.contains = (other) => { for (let p = other; p; p = p.parent) if (p === node) return true; return false; };
        node.appendChild = (child) => { child.parent = node; node.children.push(child); return child; };
        node.replaceChildren = (...children) => { node.children = []; children.forEach(node.appendChild); };
        node.remove = () => { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); };
        node.focus = () => { document.activeElement = node; };
        for (const name of ['hidden', 'disabled', 'inert']) Object.defineProperty(node, name, {
            get: () => Object.hasOwn(node.attribs, name),
            set: (value) => { if (value) node.attribs[name] = ''; else delete node.attribs[name]; },
        });
        Object.defineProperty(node, 'textContent', {
            get: () => textContent(node),
            set: (value) => { node.children = [{ type: 'text', data: String(value), parent: node }]; },
        });
        return node;
    }
    const downloads = [];
    const document = {
        getElementById: (id) => adapt(selectOne('#' + id, tree.children)),
        querySelector: (selector) => adapt(selectOne(selector, tree.children)),
        querySelectorAll: (selector) => selectAll(selector, tree.children).map(adapt),
        createElement: (tag) => {
            const node = adapt(parseDocument(`<${tag}></${tag}>`).children[0]);
            node.click = () => downloads.push({ href: node.href, download: node.download });
            return node;
        },
        activeElement: { focus() {} },
    };
    document.body = document.querySelector('body');
    function Option(label, value) { const node = document.createElement('option'); node.textContent = label; node.value = value; return node; }
    const state = { isOpen: true, availableReports: [], selectedReport: null, selectedReportId: '',
        historySequence: 0, loadSequence: 0, loadTimer: 0, inertEntries: [], cameraInputsEnabled: null };
    const viewer = { scene: { screenSpaceCameraController: { enableInputs: true } } };
    const context = vm.createContext({ document, Option, URL, __operationalReportsState: state,
        __reportsModalBound: false, __reportsModalCloseTimer: 0, console: { warn() {} },
        window: { location: { origin: 'http://localhost:4173', href: 'http://localhost:4173/' }, __warzoneViewer: viewer,
            setTimeout: () => 1 }, clearTimeout() {}, isStratOpsFeatureEnabled: () => true,
        applyStratOpsFeatureVisibility() {}, observeOperationalReportPreviewLayout() {}, stopOperationalReportPreviewLayout() {},
        syncOperationalReportPreviewLayout() {},
        openSharedModal: (modal) => { modal.hidden = false; }, closeSharedModal: (modal, done) => { modal.hidden = true; done(); },
        api: { getOperationalReports: async () => ({ data: [] }),
            getOperationalReportHtmlUrl: (report) => report.html_url || '',
            getOperationalReportViewerUrl: (report) => report.pdf_url || '',
            getOperationalReportDownloadUrl: (report) => report.pdf_url || '' },
        fetch: async () => ({ ok: true, headers: new Map([['content-type', 'text/html']]) }),
    });
    const helpers = ['isOperationalReportHtmlPreviewEnabled', 'getOperationalReportPreviewUrl', 'getOperationalReportFrameUrl',
        'setReportsStatus', 'resetOperationalReportViewer', 'formatOperationalReportDate', 'formatOperationalReportPeriod',
        'getOperationalReportFilename', 'setOperationalReportDownloadState', 'setOperationalReportPeriod',
        'canLoadOperationalReportPreview', 'openOperationalReportViewer', 'populateOperationalReportSelector', 'loadOperationalReportHistory',
        'downloadSelectedOperationalReport', 'getOperationalReportBackgroundTargets', 'setOperationalReportBackgroundBlocked',
        'handleOperationalReportKeydown', 'closeMobileDockMenuAfterReportsOpen', 'openOperationalReportsModal',
        'closeOperationalReportsModal', 'initOperationalReportsModal'];
    vm.runInContext(helpers.map((name) => sourceFunction(essential, name)).join('\n'), context);
    const type = document.getElementById('wz-operational-reports-type'); type.value = '72hour';
    return { tree, document, context, state, viewer, downloads };
}

test('main template mounts one gate/report modal and retains all three real report types', () => {
    const h = reportHarness();
    for (const id of ['warzone-gate-layer', 'wz-operational-reports-modal', 'wz-operational-reports-type', 'wz-operational-report-viewer-frame']) {
        assert.equal(h.document.querySelectorAll('#' + id).length, 1, id);
    }
    assert.deepEqual(h.document.querySelectorAll('#wz-operational-reports-type option').map((node) => node.attribs.value), ['72hour', 'daily', 'weekly']);
    const modal = h.document.getElementById('wz-operational-reports-modal');
    h.context.setOperationalReportBackgroundBlocked(true);
    for (let p = modal; p?.attribs; p = p.parent) assert.notEqual(p.inert, true, 'Report ancestors stay interactive');
    assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs, false);
    h.context.setOperationalReportBackgroundBlocked(false);
    assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs, true);
});

test('empty, authorization and API errors remain visible without leaving the date selector falsely loading', async () => {
    for (const failure of [null, new Error('Reports fetch failed (401)'), new Error('Reports fetch failed (403)'), new Error('offline')]) {
        const h = reportHarness();
        h.context.api.getOperationalReports = async () => { if (failure) throw failure; return { data: [] }; };
        await h.context.loadOperationalReportHistory();
        const loader = h.document.getElementById('wz-operational-report-loader');
        const status = h.document.getElementById('wz-operational-reports-status');
        assert.equal(loader.hidden, false);
        assert.equal(status.hidden, false);
        assert.equal(loader.querySelector('.wz-operational-report-loader__gif').style.display, 'none');
        assert.match(status.textContent, failure?.message.includes('401') ? /SIGN IN REQUIRED/ : failure?.message.includes('403') ? /ACCESS REQUIRED/ : /REPORT UNAVAILABLE/);
        assert.equal(h.document.getElementById('wz-operational-reports-select').disabled, true);
        assert.doesNotMatch(h.document.getElementById('wz-operational-reports-select').textContent, /Loading/);
        assert.equal(h.document.getElementById('wz-operational-reports-download').disabled, true);
    }
});

test('type changes clear stale reports, ignore out-of-order history and load the selected actual URL contract', async () => {
    const h = reportHarness();
    let resolveOld;
    h.state.selectedReport = { id: 'old' };
    h.context.api.getOperationalReports = () => new Promise((resolve) => { resolveOld = resolve; });
    const old = h.context.loadOperationalReportHistory();
    assert.equal(h.state.selectedReport, null);
    assert.equal(h.document.getElementById('wz-operational-reports-select').disabled, true);
    const fixture = { id: 'test-report', report_type: '72hour', html_url: '/test/report.html', pdf_url: '/test/report.pdf', period_start: '2026-01-01', period_end: '2026-01-04' };
    const calls = [];
    h.context.api.getOperationalReports = async (type, scope) => { calls.push([type, scope]); return { data: [fixture] }; };
    await h.context.loadOperationalReportHistory();
    await Promise.resolve();
    resolveOld({ data: [] }); await old;
    assert.equal(h.state.availableReports[0].id, fixture.id);
    assert.deepEqual(calls, [['72hour', 'global']]);
    const frame = h.document.getElementById('wz-operational-report-viewer-frame');
    assert.equal(frame.src, fixture.html_url);
    frame.onload();
    assert.equal(frame.hidden, false);
    assert.equal(h.document.getElementById('wz-operational-reports-download').disabled, false);
    h.context.downloadSelectedOperationalReport();
    assert.equal(h.downloads[0].href, fixture.pdf_url);
    assert.match(h.downloads[0].download, /72-Hour-Operational-Report/);
    h.context.setOperationalReportDownloadState({ ...fixture, pdf_available: false }, true);
    assert.equal(h.document.getElementById('wz-operational-reports-download').disabled, true);
});

test('report initialization binds once; selectors use daily/weekly types; Escape restores camera inputs and focus', async () => {
    const h = reportHarness();
    h.context.initOperationalReportsModal(); h.context.initOperationalReportsModal();
    const type = h.document.getElementById('wz-operational-reports-type');
    assert.equal(type.listeners.change.length, 1);
    const seen = [];
    h.context.api.getOperationalReports = async (value) => { seen.push(value); return { data: [] }; };
    for (const value of ['daily', 'weekly']) { type.value = value; type.listeners.change[0](); await Promise.resolve(); }
    assert.deepEqual(seen, ['daily', 'weekly']);
    h.context.openOperationalReportsModal();
    assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs, false);
    h.context.handleOperationalReportKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(h.state.isOpen, false);
    assert.equal(h.viewer.scene.screenSpaceCameraController.enableInputs, true);
});

function captureHarness({ taint = '', rasterError = false, brandingError = false } = {}) {
    const canvases = [], images = [], listeners = new Set();
    const sourceCanvas = { width: 1920, height: 1080, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) };
    const style = () => ({ setProperty() {} });
    const layer = { hidden: false, children: [], getBoundingClientRect: () => ({ left: 20, top: 25, width: 100, height: 60 }),
        cloneNode: () => ({ style: style(), children: [], removeAttribute() {}, setAttribute() {} }) };
    const document = { querySelector: () => layer, createElement: (tag) => {
        if (tag !== 'canvas') return { style: style(), setAttribute() {}, appendChild() {} };
        const canvas = { width: 0, height: 0, draws: [], tainted: false };
        const ctx = { drawImage(image, ...geometry) {
            canvas.draws.push({ image, geometry });
            if ((taint === 'map' && image === sourceCanvas) || (taint === 'overlay' && image.src?.startsWith('data:'))) canvas.tainted = true;
        }, getImageData() { if (canvas.tainted) throw new DOMException('tainted', 'SecurityError'); return { data: new Uint8Array(4) }; }, save() {}, restore() {} };
        canvas.getContext = () => ctx;
        canvas.toBlob = (done, type) => done(new Blob(['unit-test-output'], { type }));
        canvases.push(canvas); return canvas;
    } };
    class Image {
        naturalWidth = 100; naturalHeight = 30;
        set src(value) { this._src = value; images.push(value); queueMicrotask(() => {
            if ((rasterError && value.startsWith('data:')) || (brandingError && !value.startsWith('data:'))) this.onerror(); else this.onload();
        }); }
        get src() { return this._src; }
    }
    const context = vm.createContext({ document, Image, Blob, URL, DOMException, console,
        XMLSerializer: class { serializeToString() { return '<div xmlns="http://www.w3.org/1999/xhtml">Overlay Ω</div>'; } },
        window: { requestAnimationFrame: (done) => done(), setTimeout, clearTimeout, getComputedStyle: () => ({ length: 0, display: 'block', visibility: 'visible', opacity: '1' }) },
    });
    vm.runInContext(capture.replace(/^export /gm, ''), context);
    const viewer = { scene: { canvas: sourceCanvas,
        postRender: { addEventListener: (done) => { listeners.add(done); return () => listeners.delete(done); } },
        requestRender: () => queueMicrotask(() => [...listeners].forEach((done) => done())),
    } };
    return { context, viewer, sourceCanvas, canvases, images, listeners };
}

test('capture retains full canvas resolution, both operational overlays and branding in the PNG pipeline', async () => {
    const h = captureHarness();
    const blob = await h.context.composeCaptureBlob(h.viewer);
    assert.equal(blob.type, 'image/png');
    assert.equal(h.canvases[0].width, 1920); assert.equal(h.canvases[0].height, 1080);
    assert.equal(h.canvases[0].draws.length, 5);
    assert.equal(h.canvases[0].draws[0].image, h.sourceCanvas);
    assert.equal(h.listeners.size, 0);
    const overlays = h.images.filter((url) => url.startsWith('data:image/svg+xml'));
    assert.equal(overlays.length, 2);
    assert.match(decodeURIComponent(overlays[0]), /foreignObject.*Overlay Ω/);
});

test('capture distinguishes map taint, overlay taint/raster failure and branding failures without silent partial success', async () => {
    for (const [options, stage] of [[{ taint: 'map' }, 'map imagery'], [{ taint: 'overlay' }, '#warzone-hotspot-layer'],
        [{ rasterError: true }, '#warzone-hotspot-layer'], [{ brandingError: true }, 'branding']]) {
        const h = captureHarness(options);
        await assert.rejects(h.context.composeCaptureBlob(h.viewer), (error) => {
            assert.equal(error.captureStage, stage);
            if (options.taint) assert.equal(error.name, 'SecurityError');
            return true;
        });
        assert.equal(h.listeners.size, 0);
    }
});

test('naval UI exposes four retained states and keeps bounded private history separate from local list pagination', () => {
    const tree = parseDocument(read('dev/partials/widgets.html'));
    assert.deepEqual(selectAll('#wz-naval-filter-status option', tree.children).map((node) => node.attribs.value), ['recent', 'live', 'delayed', 'last_known']);
    assert.equal(selectAll('#wz-naval-history-search, #wz-naval-history-more', tree.children).length, 0);
    const now = Date.now();
    const statuses = [5, 30, 120, 1500].map((minutes) => getNavalContactStatus(now - minutes * 60000, now));
    assert.deepEqual(statuses.filter((status) => matchesNavalContactStatus(status, 'recent')), ['LIVE', 'DELAYED', 'LAST KNOWN']);
    assert.equal(statuses.filter((status) => matchesNavalContactStatus(status, 'last_known')).length, 1);
    const calls = [];
    const context = vm.createContext({ __navalWidgetStatusFilter: 'recent', isNavalTrackingFeatureEnabled: () => true,
        isLayerEnabled: () => true, cancelNavalHistoryRequest: () => calls.push('clear'), requestNavalWidgetRender() {},
        api: { getNavalHistory: () => { throw new Error('Retained filters must not fetch private history'); } } });
    vm.runInContext(sourceFunction(essential, 'refreshPrivateNavalHistory'), context);
    for (const filter of ['recent', 'live', 'delayed', 'last_known']) {
        context.__navalWidgetStatusFilter = filter; context.refreshPrivateNavalHistory();
    }
    assert.equal(calls.length, 4);
    assert.match(sourceFunction(essential, 'bindAircraftMovementsWidget'), /data-naval-load-more[\s\S]*?__navalWidgetPage \+= 1/);
    assert.match(read('dev/assets/js/warzone-live-naval.js'), /loadMoreBtn\.dataset\.navalLoadMore/);
});
