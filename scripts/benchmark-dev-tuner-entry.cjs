// Runs real tuner initializers with an instrumented DOM fixture.
// Counts JS operations, not browser layout/recalculation time.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { parse, parseExpressionAt } = require('acorn');
const root = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(root, 'dev/assets/js/warzone-dev-panel.js'), 'utf8');
const baseline = path.join(root, '.generated/dev-tuner-entry/before.js');
const groups = ['DEV_MAP_TUNER_FIELDS', 'DEV_EVENT_UI_COLOR_FIELDS', 'DEV_EVENT_UI_NUMERIC_FIELDS',
    'DEV_EVENT_UI_TOGGLE_FIELDS', 'DEV_ORBITAL_UI_NUMERIC_FIELDS', 'DEV_STARTUP_SCENE_CSS_FIELDS',
    'DEV_STARTUP_SCENE_CONFIG_FIELDS', 'DEV_LIVE_ASSET_FIELDS'];
function harness(source = current, overrides = {}) {
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const parts = [];
    for (const item of tree.body) {
        const node = item.declaration || item;
        if (node.type === 'FunctionDeclaration') parts.push(source.slice(node.start, node.end));
        else if (node.type === 'VariableDeclaration' && node.declarations.some(decl =>
            groups.includes(decl.id.name) || decl.id.name.startsWith('DEV_LIVE_') ||
            decl.id.name.startsWith('__devTunerBatch'))) parts.push(source.slice(node.start, node.end));
    }
    const stats = { styleWrites: 0, computedReads: 0, readAfterWrite: 0, outputWrites: 0, eventRefreshes: 0, orbitalRefreshes: 0 };
    const values = new Map(), defaults = new Map(), elements = new Map(), writes = [];
    let dirty = false;
    const element = id => {
        if (!elements.has(id)) {
            let value = '';
            elements.set(id, { id, dataset: {}, checked: false, listeners: {},
                get value() { return value; }, set value(next) { value = next; if (id.includes('output')) stats.outputWrites++; },
                addEventListener(type, fn) { this.listeners[type] = fn; }, closest: () => null });
        }
        return elements.get(id);
    };
    const document = { documentElement: { style: { setProperty(name, value) {
        stats.styleWrites++; values.set(name, String(value)); writes.push([name, String(value)]); dirty = true;
    } } }, getElementById: id => elements.get(id) || null };
    const c = vm.createContext({ document, window: { __stratopsConfig: {}, __warzoneViewer: { scene: { requestRender() {} } } },
        getComputedStyle: () => ({ getPropertyValue(name) {
            stats.computedReads++; if (dirty) { stats.readAfterWrite++; dirty = false; }
            return values.get(name) ?? defaults.get(name) ?? '';
        } }), console });
    vm.runInContext(parts.join('\n'), c);
    const fields = Object.fromEntries(groups.map(group => [group, vm.runInContext(group, c)]));
    for (const list of Object.values(fields)) for (const def of list) if (def.cssVar) {
        defaults.set(def.cssVar, String(overrides[def.cssVar] ?? def.fallback ?? 0));
    }
    for (const id of ['wz-dev-map-tuner', 'wz-dev-event-ui-tuner', 'wz-dev-orbital-ui-tuner',
        'wz-dev-startup-scene-tuner', 'wz-live-asset-css-output', 'wz-map-css-output',
        'wz-event-css-output', 'wz-orbital-css-output', 'wz-startup-scene-output']) element(id);
    for (const [group, prefix] of [['DEV_MAP_TUNER_FIELDS','wz-map'], ['DEV_EVENT_UI_NUMERIC_FIELDS','wz-event'],
        ['DEV_EVENT_UI_COLOR_FIELDS','wz-event'], ['DEV_EVENT_UI_TOGGLE_FIELDS','wz-event'],
        ['DEV_ORBITAL_UI_NUMERIC_FIELDS','wz-orbital'], ['DEV_STARTUP_SCENE_CSS_FIELDS','wz-startup'],
        ['DEV_STARTUP_SCENE_CONFIG_FIELDS','wz-startup'], ['DEV_LIVE_ASSET_FIELDS','wz-live-asset']]) {
        for (const def of fields[group]) { element(`${prefix}-${def.key}-range`); element(`${prefix}-${def.key}-input`); }
    }
    element('wz-event-marker-color-input'); element('wz-event-marker-color-picker');
    for (const id of ['wz-map-load-current', 'wz-live-asset-load-current', 'wz-orbital-load-current',
        'wz-startup-scene-load-current']) element(id);
    Object.assign(c, { ensureDevEventUiTunerDynamicControls() {}, ensureDevLiveAssetTunerRoot: () => element('live-root'),
        getResolvedColorHex: value => value, requestMapOnlyRefresh() {}, requestLiveAssetVisualRefresh() {},
        refreshLiveAssetVisualsNow() {},
        setDevStaticTunerSelection() {}, __devStaticTunerSelected: '',
        refreshEventMarkerTuning() { stats.eventRefreshes++; }, __devEventUiPreviewVisible: false,
        refreshLiveTrackFocusCamera() {}, refreshStartupScenePreview() {} });
    c.window.refreshWarzoneMilSatsScale = () => { stats.orbitalRefreshes++; };
    const initialize = ({ batch = true } = {}) => {
        const run = () => { c.initMapTunerControls(); c.initDevEventUiTunerControls(); c.initDevOrbitalUiTunerControls();
            c.initDevStartupSceneTunerControls(); c.initIntroStartupSceneTunerControls(); c.initLiveAssetTunerControls(); };
        if (batch && c.batchDevTunerInitialization) c.batchDevTunerInitialization(run); else run();
    };
    return { c, stats, values, writes, elements, initialize, fields };
}
function report(source) {
    const h = harness(source); h.initialize();
    const first = { ...h.stats, rootCustomProperties: h.values.size };
    h.initialize();
    return { ...first, secondInitializationExtraWrites: h.stats.styleWrites - first.styleWrites,
        liveModelRefreshPasses: modelRefreshPasses(source) };
}
function modelRefreshPasses(source) {
    const frames = new Map(); let next = 0, passes = 0;
    const c = vm.createContext({ applyLiveAssetRendererQuality() {}, getLiveTrackSelection: () => null,
        refreshLiveTrackVisualStyles() { passes++; }, refreshNavalVisualStyles() {},
        requestAnimationFrame: fn => { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id),
        window: { __warzoneViewer: { scene: { requestRender() {} } } } });
    vm.runInContext('let __devLiveAssetRefreshRaf=0;', c);
    for (const name of ['refreshLiveAssetVisualsNow', 'requestLiveAssetVisualRefresh']) {
        const start = source.indexOf(`function ${name}(`);
        vm.runInContext(source.slice(start, parseExpressionAt(source, start, { ecmaVersion: 'latest' }).end), c);
    }
    for (let i = 0; i < 66; i++) c.requestLiveAssetVisualRefresh();
    c.refreshLiveAssetVisualsNow();
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
    return passes;
}
if (require.main === module) {
    if (process.argv.includes('--capture-baseline')) {
        fs.mkdirSync(path.dirname(baseline), { recursive: true }); fs.writeFileSync(baseline, current);
    }
    console.log(JSON.stringify({ note: 'Real initializer functions; synthetic DOM, no measured browser style/layout durations',
        before: fs.existsSync(baseline) ? report(fs.readFileSync(baseline, 'utf8')) : null, after: report(current) }, null, 2));
}
module.exports = { harness, baseline };
