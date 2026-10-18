"use strict";

// Development only. Hook spans include asynchronous waiting, not CPU attribution.
module.exports = function installStartupTiming(compiler) {
    console.info("[dev-timing] compiler-created=" + Math.round(process.uptime() * 1000) + "ms process uptime");
    const name = "StratOpsDevelopmentTiming";
    const now = () => Number(process.hrtime.bigint()) / 1e6;
    let runStarted = now();
    let current = null;
    compiler.hooks.watchRun.tap(name, () => {
        runStarted = now();
        console.info("[dev-timing] watch-run=" + Math.round(process.uptime() * 1000) + "ms process uptime");
    });
    compiler.hooks.normalModuleFactory.tap(name, (factory) => {
        const starts = new WeakMap();
        factory.hooks.beforeResolve.tap(name, (data) => {
            if (data) starts.set(data, now());
        });
        factory.hooks.afterResolve.tap(name, (data) => {
            const started = starts.get(data);
            if (current && started != null) retain(current.resolution, {
                request: String(data.request).slice(0, 240), ms: Math.round(now() - started),
            });
        });
    });
    function retain(list, value) {
        list.push(value);
        list.sort((a, b) => b.ms - a.ms);
        if (list.length > 5) list.length = 5;
    }
    compiler.hooks.thisCompilation.tap(name, (compilation) => {
        const state = current = { start: now(), modulesFinished: null, seal: null, built: 0, build: [], resolution: [] };
        const starts = new WeakMap();
        compilation.hooks.buildModule.tap(name, (module) => { starts.set(module, now()); });
        compilation.hooks.succeedModule.tap(name, (module) => {
            const started = starts.get(module);
            state.built++;
            if (started != null) retain(state.build, {
                module: module.identifier().replace(compiler.context, ".").slice(-240), ms: Math.round(now() - started),
            });
        });
        compilation.hooks.finishModules.tap(name, () => { state.modulesFinished = now(); });
        compilation.hooks.seal.tap(name, () => { state.seal = now(); });
    });
    compiler.hooks.done.tap(name, (stats) => {
        const state = current;
        const end = now();
        const initialAssets = new Set();
        for (const entrypoint of stats.compilation.entrypoints.values()) {
            for (const file of entrypoint.getFiles()) initialAssets.add(file);
        }
        let bytes = 0;
        for (const file of initialAssets) bytes += stats.compilation.getAsset(file)?.source.size() || 0;
        console.info("[dev-timing] compile=" + (stats.endTime - stats.startTime) +
            "ms watch-run-to-done=" + Math.round(end - runStarted) +
            "ms processUptime=" + Math.round(process.uptime() * 1000) +
            "ms changedFiles=" + (compiler.modifiedFiles?.size || 0) + " errors=" + stats.compilation.errors.length);
        if (state) console.info("[dev-timing] stages=" + JSON.stringify({
            moduleGraphMs: state.modulesFinished == null ? null : Math.round(state.modulesFinished - state.start),
            sealingAndEmissionMs: state.seal == null ? null : Math.round(end - state.seal),
            builtModules: state.built, totalModules: stats.compilation.modules.size,
            allEntrypointsUncompressedBytes: bytes, slowestModuleBuildSpans: state.build,
            slowestResolutionSpans: state.resolution,
        }));
    });
};
