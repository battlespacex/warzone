// Presentation only: no geometry, observations, workers or API requests are created here.
export function createOperationalGnssReveal(viewer, options = {}) {
    const scene = viewer.scene;
    const now = options.now || (() => performance.now());
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const documentRef = options.document || (typeof document === "undefined" ? null : document);
    const batches = [];
    const removers = [];
    const supported = Boolean(scene.postRender?.addEventListener);
    const total = options.total || 0;
    const group = total <= 12 ? 1 : 4;
    const duration = total < 60 ? Math.max(300, Math.min(1800, total * 45)) : 2400;
    const frameLimit = Math.min(512, Math.max(group, Math.ceil(total / 60)));
    let visible = true, disposed = false, sealed = false, timer = null, listening = false;
    let lastTime = null, credit = group, roundRobin = 0, activeMs = 0;
    let gateMs = 0, fallback = !supported;
    let revealed = 0, failed = 0, maxCellsPerFrame = 0;
    let status = supported ? "waiting" : "normal-visibility";
    let fallbackReason = supported ? null : "scheduler-unavailable";

    function alive(primitive) { return primitive && !primitive.isDestroyed?.(); }
    function listen(event, callback) {
        event.addEventListener(callback);
        removers.push(() => event.removeEventListener(callback));
    }
    function detach() {
        while (removers.length) removers.pop()();
        listening = false;
        if (timer !== null) clearTimer(timer);
        timer = null;
        lastTime = null;
    }
    function unfinished() { return batches.some((batch) => batch.cursor < batch.records.length); }
    function report(reason) {
        status = reason;
        options.warn?.(`[gnss] Progressive reveal fallback: ${reason}; geometry may be incomplete.`);
    }
    // Resolve both attributes before writing either one. The original fill ID object
    // is required by Cesium's identity lookup and remains the object returned by picking.
    function showRecord(batch, record) {
        const fill = batch.fill.getGeometryInstanceAttributes(record.fillId);
        const outline = batch.outline?.getGeometryInstanceAttributes(record.outlineId);
        if (!fill?.show || (batch.outline && !outline?.show)) throw new Error("missing show attribute");
        fill.show = new Uint8Array([1]);
        if (outline) outline.show = new Uint8Array([1]);
    }
    function ready(batch) {
        return batch.fill.ready && (!batch.outline || batch.outline.ready);
    }
    function restoreBatch(batch) {
        // In failure mode restore each successful side once, including a ready fill
        // whose outline worker is still pending. Pending/failed pairs remain explicit.
        const state = batch.fallback ||= { start: batch.cursor, fill: false, outline: !batch.outline, errors: new Set() };
        let count = 0, changed = false;
        for (const [side, primitive, key] of [["fill", batch.fill, "fillId"], ["outline", batch.outline, "outlineId"]]) {
            if (state[side]) continue;
            const destroyed = !alive(primitive);
            if (!destroyed && !primitive.ready) continue;
            for (let i = state.start; i < batch.records.length; i++) {
                try {
                    if (destroyed) throw new Error("destroyed geometry");
                    const attributes = primitive.getGeometryInstanceAttributes(batch.records[i][key]);
                    if (!attributes?.show) throw new Error("missing show attribute");
                    attributes.show = new Uint8Array([1]);
                    changed = true;
                    if (side === "fill") { revealed++; count++; }
                } catch { state.errors.add(i); }
            }
            state[side] = true;
        }
        if (state.fill && state.outline) {
            failed += state.errors.size;
            batch.cursor = batch.records.length;
        }
        return { count, changed };
    }
    function finishIfDone() {
        if (!sealed || unfinished()) return false;
        status = failed ? "incomplete" : fallback ? "fallback-visible" : "complete";
        detach();
        scene.requestRender?.(); // upload the last attribute changes on the next frame
        return true;
    }
    function enterFallback(reason) {
        if (disposed) return;
        fallback = true;
        fallbackReason = reason;
        report(reason);
        if (timer !== null) clearTimer(timer);
        timer = null;
        tick();
        // Late successful geometry is restored by a passive, owned postRender listener.
        // No polling timer or self-requested frames continue while waiting for it.
    }
    function tick() {
        if (disposed || !visible || documentRef?.hidden) { lastTime = null; return; }
        if (viewer.isDestroyed?.()) { dispose(); return; }
        const time = now();
        const elapsed = lastTime === null ? 0 : Math.max(0, time - lastTime);
        const dt = Math.min(50, elapsed);
        lastTime = time;
        let count = 0, changed = false;
        if (fallback) {
            for (const batch of batches) {
                if (batch.cursor < batch.records.length) {
                    const restored = restoreBatch(batch);
                    count += restored.count;
                    changed ||= restored.changed;
                }
            }
        } else {
            if (batches.some((batch) => batch.cursor < batch.records.length
                && (!alive(batch.fill) || (batch.outline && !alive(batch.outline))))) {
                enterFallback("destroyed-geometry");
                return;
            }
            gateMs += elapsed;
            if (gateMs < 5500 && options.cameraSettled && !options.cameraSettled()) {
                scene.requestRender?.();
                return;
            }
            const available = batches.filter((batch) => batch.cursor < batch.records.length && ready(batch));
            if (available.length) {
                activeMs += dt;
                // Preserve a fractional group's credit without allowing a catch-up burst.
                credit = Math.min(frameLimit + group, credit + total * dt / duration);
                const budget = Math.min(Math.floor(frameLimit / group), Math.floor(credit / group)) * group;
                while (count < budget && available.length) {
                    const index = roundRobin++ % available.length;
                    const batch = available[index];
                    for (let i = 0; i < group && count < budget && batch.cursor < batch.records.length; i++) {
                        const record = batch.records[batch.cursor];
                        try { showRecord(batch, record); }
                        catch { enterFallback("attribute-error"); return; }
                        batch.cursor++; revealed++; count++;
                    }
                    if (batch.cursor === batch.records.length) available.splice(index, 1);
                }
                credit -= count;
                status = "revealing";
            }
        }
        maxCellsPerFrame = Math.max(maxCellsPerFrame, count);
        if (finishIfDone()) return;
        if (count || changed || !fallback) scene.requestRender?.();
    }
    function attach() {
        if (disposed || !visible || !supported || listening || (sealed && !unfinished())) return;
        listening = true;
        listen(scene.postRender, tick);
        if (scene.renderError?.addEventListener) listen(scene.renderError, (_scene, error) => {
            enterFallback("render-error");
            if (error) options.warn?.(error);
        });
        if (!fallback) timer = setTimer(() => enterFallback("readiness-timeout"), 30000);
    }
    function visibilityChanged() {
        lastTime = null;
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (!documentRef.hidden && visible && !disposed) {
            if (!fallback && listening) timer = setTimer(() => enterFallback("readiness-timeout"), 30000);
            scene.requestRender?.();
        }
    }
    documentRef?.addEventListener?.("visibilitychange", visibilityChanged);
    function dispose() {
        disposed = true;
        detach();
        documentRef?.removeEventListener?.("visibilitychange", visibilityChanged);
        batches.length = 0;
        status = "cancelled";
    }
    return {
        initialShow: !supported,
        addBatch(fill, outline, records) {
            if (disposed) return;
            // One linear shuffle at construction, then O(batch count + revealed cells)
            // per rendered frame. No geographic scan or per-cell timers.
            const order = records.slice();
            let seed = batches.length + 1;
            for (let i = order.length - 1; i > 0; i--) {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                const j = seed % (i + 1);
                [order[i], order[j]] = [order[j], order[i]];
            }
            batches.push({ fill, outline, records: order, cursor: supported ? 0 : records.length });
            if (!supported) revealed += records.length;
            attach();
        },
        seal() {
            sealed = true;
            const constructed = batches.reduce((n, batch) => n + batch.records.length, 0);
            if (constructed < total) { failed += total - constructed; report("unconstructed-cells"); }
            finishIfDone();
        },
        setVisible(value) {
            visible = value;
            for (const batch of batches) {
                if (alive(batch.fill)) batch.fill.show = value;
                if (alive(batch.outline)) batch.outline.show = value;
            }
            if (!value) detach(); else { attach(); scene.requestRender?.(); }
        },
        dispose,
        diagnostics: () => ({ status, fallbackReason, expected: total, constructed: batches.reduce((n, b) => n + b.records.length, 0),
            revealed, failed, pending: batches.reduce((n, b) => n + b.records.length - b.cursor, 0),
            activeMs, targetMs: duration, maxCellsPerFrame, batchCount: batches.length }),
    };
}
