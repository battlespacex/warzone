// Deterministic scheduling simulation, not browser FPS or a GPU benchmark.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../dev/assets/js/essential.js'), 'utf8');
const current = source.match(/function forceForegroundViewerWake\([^]*?\n}/)[0];
const baseline = path.join(__dirname, '../.generated/session-resume/wake-before.js');
if (process.argv.includes('--capture-baseline')) {
    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    fs.writeFileSync(baseline, current);
}
function simulate(code, originalMode = true, cycles = 2) {
    let next = 0, clock = 0;
    const timers = new Map();
    const scene = { requestRenderMode: originalMode, requestRender() {} };
    const context = vm.createContext({
        __foregroundRenderModeRestoreTimer: 0,
        isDocumentHidden: () => false,
        performance: { now: () => clock },
        startForegroundRenderWakeBurst() {},
        clearTimeout: id => timers.delete(id),
        window: { __warzoneViewer: { scene, resize() {} },
            __warzoneLifecycle: { requestRenderBurst() {} },
            setTimeout: fn => { timers.set(++next, fn); return next; } },
    });
    vm.runInContext(code, context);
    for (let cycle = 0; cycle < cycles; cycle++) {
        // Frozen tabs do not execute the pending restore between resume events.
        clock += 48 * 60 * 60 * 1000;
        context.forceForegroundViewerWake({ backgroundIdleMs: 48 * 60 * 60 * 1000 });
    }
    const pendingRestoreTimers = timers.size;
    for (const fn of timers.values()) fn();
    return { originalMode, requestRenderModeAfterResume: scene.requestRenderMode,
        pendingRestoreTimers,
        // Count only idle renders caused by requestRenderMode, after wake bursts end.
        idleRendersOver600SimulatedFrames: scene.requestRenderMode ? 0 : 600 };
}
console.log(JSON.stringify({ description: 'Two 48-hour frozen-timer cycles; no actual browser elapsed time',
    before: fs.existsSync(baseline) ? simulate(fs.readFileSync(baseline, 'utf8')) : null,
    after: simulate(current), intentionalContinuousMode: simulate(current, false) }, null, 2));
module.exports = { simulate };
