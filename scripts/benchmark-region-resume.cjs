// Executes the real foreground/lifecycle functions with fake clocks and feeds.
// Operation counts only: not a Chrome FPS, GPU-memory or elapsed-time benchmark.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { parseExpressionAt } = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../dev/assets/js/essential.js'), 'utf8');
const aircraft = fs.readFileSync(path.join(__dirname, '../dev/assets/js/warzone-live-airforce.js'), 'utf8');
const start = source.indexOf('() => {', source.indexOf('const onForeground ='));
const currentHandler = source.slice(start, parseExpressionAt(source, start, { ecmaVersion: 'latest' }).end);
const baselinePath = path.join(__dirname, '../.generated/region-resume/foreground-before.js');
const extract = (name, input = source) => input.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
function harness(handler = currentHandler) {
    let clock = 10000, wallOffset = 48 * 60 * 60 * 1000, hidden = false;
    const counts = { pipelineResumes: 0, lifecycleResumes: 0, aircraftMotionResets: 0, viewportSchedules: 0 };
    const entities = new Map(Array.from({ length: 1000 }, (_, i) => [i, {
        position: {}, set __liveTrackMotionState(value) { counts.aircraftMotionResets++; },
    }]));
    const callbacks = new Map([['aircraft', { resume() { counts.lifecycleResumes++; context.resumeLiveTrackMotionAfterVisibility(); } }]]);
    const context = vm.createContext({
        Date: { now: () => wallOffset + clock }, performance: { now: () => clock },
        document: { get visibilityState() { return hidden ? 'hidden' : 'visible'; } },
        __liveTrackEntities: entities, __liveTrackActiveMotionEntities: new Set(entities.values()),
        __liveTrackLifecyclePaused: true, __liveTrackReplayState: { mode: '' }, __liveTrackLastFocusCameraSyncAt: 0,
        getPositionCartesian: entity => entity.position, requestWarzoneRenderBatched() {},
        isDocumentHidden: () => hidden, __warzoneLifecycleCallbacks: callbacks,
        FOREGROUND_RECOVERY_THROTTLE_MS: 1500, requestWarzoneLifecycleRenderBurst() {},
        resumeForegroundLivePipelines() { counts.pipelineResumes++; vm.runInContext('__visibilityPipelinesSuspended=false', context); },
        forceForegroundViewerWake() {}, endForegroundRecoveryLoader() {},
        syncFocusAwareBackgroundLoops() {}, scheduleViewportFetch() { counts.viewportSchedules++; },
        requestAircraftMovementsWidgetRender() {}, requestNavalWidgetRender() {}, isLayerEnabled: () => false,
        syncHotspotLayerEvents() {}, scheduleForegroundAdaptiveRecovery() {},
        window: { __warzoneViewer: { resize() {}, scene: { requestRender() {} } } }, console,
    });
    vm.runInContext(`let __warzoneLifecyclePaused=true,__warzoneLifecyclePausedAt=1,__visibilityPipelinesSuspended=true;
        let __lastBackgroundAt=1,__lastForegroundRecoveryAt=0,__foregroundRecoverySeq=0;
        let __pollInFlight=false,__pollInFlightSince=0,__lastViewportKey='';
        ${['notifyWarzoneLifecycle', 'pauseWarzoneLifecycle', 'resumeWarzoneLifecycle'].map(name => extract(name)).join('\n')}
        ${extract('resetLiveTrackRuntimeForLifecycle', aircraft)}
        ${extract('resumeLiveTrackMotionAfterVisibility', aircraft)}
        function lifecycleState(){return {paused:__warzoneLifecyclePaused};}
        globalThis.onForeground=${handler};`, context);
    context.window.__warzoneLifecycle = { observeViewer() {}, resume: context.resumeWarzoneLifecycle, getState: context.lifecycleState };
    return { counts, foreground: () => context.onForeground(), advance: ms => { clock += ms; },
        adjustWall: ms => { wallOffset += ms; },
        suspend() { hidden = true; context.pauseWarzoneLifecycle('test'); vm.runInContext('__visibilityPipelinesSuspended=true', context); },
        show() { hidden = false; }, context };
}
function simulate(handler) {
    const h = harness(handler);
    // One browser restoration commonly emits visibilitychange, focus and pageshow.
    for (let i = 0; i < 3; i++) { h.foreground(); h.advance(20); }
    return h.counts;
}
if (require.main === module) {
    if (process.argv.includes('--capture-baseline')) {
        fs.mkdirSync(path.dirname(baselinePath), { recursive: true }); fs.writeFileSync(baselinePath, currentHandler);
    }
    console.log(JSON.stringify({ scenario: 'Three foreground notifications after simulated 48-hour inactivity; 1000 synthetic aircraft',
        before: fs.existsSync(baselinePath) ? simulate(fs.readFileSync(baselinePath, 'utf8')) : null,
        after: simulate(currentHandler) }, null, 2));
}
module.exports = { harness };
