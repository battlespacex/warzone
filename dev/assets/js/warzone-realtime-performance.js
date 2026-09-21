// Realtime ingestion yields between records; visual interpolation owns its own loop.
const channels = new Map();
const counters = new Map();
const uniqueTracks = new Map();
const socketDurations = [];
const reconciliationDurations = [];
const stageDurations = new Map();
const heartbeatErrors = [];
const longTasks = [];
const queues = new Set();
let observerInstalled = false;
let activeChannel = "";
const clock = () => performance.now();
const diagnosticsEnabled = () => typeof window !== "undefined" && (
    ["localhost", "127.0.0.1", "::1"].includes(window.location?.hostname) ||
    window.__WZ_PERF_DIAGNOSTICS === true ||
    window.__stratopsConfig?.enableCesiumPerformanceDiagnostics === true
);
function retainSample(samples, value) {
    samples.push(value);
    if (samples.length > 720) samples.shift();
}
function timing(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    return {
        sampleCount: sorted.length,
        averageMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0,
        maxMs: sorted[sorted.length - 1] || 0,
    };
}
export function recordRealtimeWork(kind, count = 1, trackKey = "") {
    if (!diagnosticsEnabled()) return;
    const second = Math.floor(clock() / 1000);
    let buckets = counters.get(kind);
    if (!buckets) counters.set(kind, buckets = new Map());
    buckets.set(second, (buckets.get(second) || 0) + count);
    for (const key of buckets.keys()) if (key < second - 30) buckets.delete(key);
    if (activeChannel && ["tracksProcessed", "cesiumTrackUpdates", "domUpdates"].includes(kind)) {
        const name = `${activeChannel}:${kind}`;
        let attributed = counters.get(name);
        if (!attributed) counters.set(name, attributed = new Map());
        attributed.set(second, (attributed.get(second) || 0) + count);
        for (const key of attributed.keys()) if (key < second - 30) attributed.delete(key);
    }
    if (trackKey) {
        let keys = uniqueTracks.get(second);
        if (!keys) uniqueTracks.set(second, keys = new Set());
        keys.add(trackKey);
        for (const key of uniqueTracks.keys()) if (key < second - 30) uniqueTracks.delete(key);
    }
}
function rate(kind) {
    const second = Math.floor(clock() / 1000);
    return Array.from(counters.get(kind) || []).reduce((sum, [at, count]) => (
        at >= second - 4 ? sum + count : sum
    ), 0) / 5;
}
export function instrumentRealtimeCallback(channel, callback) {
    return function (payload, ...args) {
        if (!diagnosticsEnabled()) return callback.call(this, payload, ...args);
        installLongTaskObserver();
        const type = String(payload?.eventType || payload?.event || "broadcast");
        const key = `${channel}:${type}`;
        let stats = channels.get(key);
        if (!stats) channels.set(key, stats = { channel, eventType: type, messages: 0, durations: [], payloadBytesEstimate: 0 });
        stats.messages += 1;
        const row = payload?.new || payload?.old;
        stats.itemsPerMessage = Array.isArray(row) ? row.length : (row ? 1 : 0);
        recordRealtimeWork(`channel:${key}`);
        recordRealtimeWork("messages");
        // Sample size only once per second. Never retain or log payload contents.
        const second = Math.floor(clock() / 1000);
        if (stats.sizeSampleSecond !== second) {
            stats.sizeSampleSecond = second;
            try { stats.payloadBytesEstimate = JSON.stringify(payload).length * 2; } catch { }
        }
        const startedAt = clock();
        const previousChannel = activeChannel;
        activeChannel = channel;
        try { return callback.call(this, payload, ...args); }
        finally { activeChannel = previousChannel; retainSample(stats.durations, clock() - startedAt); }
    };
}
export function measureRealtimeStage(name, callback) {
    if (!diagnosticsEnabled()) return callback();
    const at = clock();
    try { return callback(); }
    finally {
        let samples = stageDurations.get(name);
        if (!samples) stageDurations.set(name, samples = []);
        retainSample(samples, clock() - at);
    }
}
function installLongTaskObserver() {
    if (observerInstalled || typeof PerformanceObserver !== "function") return;
    observerInstalled = true;
    try {
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) retainSample(longTasks, { at: entry.startTime, durationMs: entry.duration });
        });
        observer.observe({ type: "longtask", buffered: true });
    } catch { }
}
export function installRealtimeSocketDiagnostics(client) {
    if (!diagnosticsEnabled()) return;
    // PhoenixSocketAdapter forwards getSocket(); do not replace the transport.
    const socket = client?.socketAdapter?.getSocket?.() || client?.socketAdapter;
    if (!socket || typeof socket.onConnMessage !== "function" || socket.__stratopsMessageTimingInstalled) return;
    socket.__stratopsMessageTimingInstalled = true;
    const original = socket.onConnMessage;
    socket.onConnMessage = function (...args) {
        const startedAt = clock();
        try { return original.apply(this, args); }
        finally { retainSample(socketDurations, clock() - startedAt); recordRealtimeWork("socketMessages"); }
    };
    installLongTaskObserver();
}
export function recordRealtimeChannelError(channel, error) {
    if (diagnosticsEnabled()) retainSample(heartbeatErrors, {
        at: clock(), channel, heartbeatTimeout: String(error?.message || error).includes("heartbeat timeout"),
        recentLongTasks: longTasks.filter((entry) => clock() - entry.at < 10000).length,
    });
}
export function createTrackUpdateQueue({ process, reconcile, getSourceTimestamp = () => 0, priorityKey = () => "", schedule, cancel, now = clock, frameBudgetMs = 4, maxRecordsPerFrame = 4, maxQueuedPerTrack = 4, onError = () => {} }) {
    const pending = new Map();
    const deleteBarriers = new Map();
    let scheduled = null;
    let depth = 0;
    let coalescedUpdates = 0;
    let generation = 0;
    let acceptedValidUpdates = 0;
    let staleRejectedUpdates = 0;
    let visualReconciliations = 0;
    let rescuedFinalVisualUpdates = 0;
    function requestDrain() {
        if (scheduled === null && depth) scheduled = schedule(drain);
    }
    function drain() {
        scheduled = null;
        const startedAt = now();
        let processed = 0;
        while (depth && processed < maxRecordsPerFrame && (processed === 0 || now() - startedAt < frameBudgetMs)) {
            const focusedKey = String(priorityKey() || "");
            const [key, group] = focusedKey && pending.has(focusedKey)
                ? [focusedKey, pending.get(focusedKey)]
                : pending.entries().next().value;
            const visualOnly = group.visualOnly === true;
            const payload = visualOnly ? null : group.items[group.index++];
            depth -= 1;
            const type = String(payload?.eventType || payload?.event || "").toUpperCase();
            // DELETE is an ordered lifecycle barrier. Intermediate upserts still
            // enter history; only their Cesium/render work is coalesced.
            const dataOnly = !visualOnly && group.index < group.items.length && type !== "DELETE";
            if (dataOnly) coalescedUpdates += 1;
            const at = now();
            const currentGeneration = generation;
            const previousChannel = activeChannel;
            activeChannel = "tracks-live";
            try {
                if (visualOnly) {
                    group.visualOnly = false;
                    // A rescue is a separate budgeted job, never an inline bulk flush.
                    if (reconcile(group.visualCandidate) !== false) {
                        visualReconciliations += 1;
                        if (group.finalRejected) rescuedFinalVisualUpdates += 1;
                    }
                    group.visualCandidate = null;
                    group.visualOnly = false;
                } else {
                    const sourceTimestamp = Number(getSourceTimestamp(payload) || 0);
                    const barrier = deleteBarriers.get(key) || 0;
                    const result = type !== "DELETE" && sourceTimestamp > 0 && sourceTimestamp <= barrier
                        ? { status: "stale" }
                        : process(payload, { dataOnly });
                    if (generation !== currentGeneration) break;
                    if (type === "DELETE" || result?.status === "deleted") {
                        deleteBarriers.set(key, Math.max(barrier, sourceTimestamp, group.newestValidSourceTimestamp || 0));
                        group.visualCandidate = null;
                        group.finalRejected = false;
                    } else if (result?.status === "accepted" || result?.status === "insignificant") {
                        acceptedValidUpdates += 1;
                        group.newestValidSourceTimestamp = Number(result.sourceTimestamp || sourceTimestamp);
                        if (result.visuallyReconciled) {
                            visualReconciliations += 1;
                            group.visualCandidate = null;
                        } else if (result?.candidate && (result.status === "accepted" || group.visualCandidate)) {
                            group.visualCandidate = result.candidate;
                        }
                        group.finalRejected = false;
                    } else if (result?.status === "stale") {
                        staleRejectedUpdates += 1;
                        group.finalRejected = true;
                    }
                }
            }
            catch (error) { onError(error); }
            finally {
                if (visualOnly) group.visualCandidate = null;
                if (diagnosticsEnabled()) retainSample(reconciliationDurations, now() - at);
                if (!visualOnly) recordRealtimeWork("tracksProcessed", 1, key);
                activeChannel = previousChannel;
            }
            processed += 1;
            if (generation !== currentGeneration) break;
            pending.delete(key);
            if (group.index < group.items.length) {
                // Round-robin across aircraft and release already processed rows.
                if (group.index >= 128) { group.items = group.items.slice(group.index); group.index = 0; }
                pending.set(key, group);
            } else if (group.visualCandidate && reconcile) {
                group.visualOnly = true;
                depth += 1;
                pending.set(key, group);
            }
        }
        requestDrain();
    }
    const queue = {
        enqueue(payload) {
            const row = payload?.new || payload?.old;
            const key = String(row?.track_key || row?.id || "");
            if (!key) return false;
            let group = pending.get(key);
            if (!group) pending.set(key, group = { items: [], index: 0, visualCandidate: null });
            if (group.visualOnly) { group.visualOnly = false; depth -= 1; }
            const type = String(payload?.eventType || payload?.event || "").toUpperCase();
            if (type !== "DELETE") {
                let segmentStart = group.items.length;
                while (segmentStart > group.index &&
                    String(group.items[segmentStart - 1]?.eventType || group.items[segmentStart - 1]?.event || "").toUpperCase() !== "DELETE") {
                    segmentStart -= 1;
                }
                if (group.items.length - segmentStart >= maxQueuedPerTrack) {
                    group.items.splice(segmentStart, 1);
                    depth -= 1;
                    coalescedUpdates += 1;
                }
            }
            group.newestReceivedSourceTimestamp = Number(getSourceTimestamp(payload) || 0);
            group.items.push(payload);
            depth += 1;
            requestDrain();
            return true;
        },
        clear() {
            generation += 1;
            if (scheduled !== null) cancel(scheduled);
            scheduled = null;
            pending.clear();
            deleteBarriers.clear();
            depth = 0;
        },
        getStats: () => ({ queueDepth: depth, uniquePendingTracks: pending.size, coalescedUpdates, scheduled: scheduled !== null,
            acceptedValidUpdates, staleRejectedUpdates, visualReconciliations, rescuedFinalVisualUpdates,
            pendingVisualCandidates: Array.from(pending.values()).filter((group) => group.visualCandidate).length }),
    };
    queues.add(queue);
    return queue;
}
export function getRealtimeStats() {
    const queueStats = Array.from(queues, (queue) => queue.getStats());
    const second = Math.floor(clock() / 1000);
    let uniqueTrackSeconds = 0;
    for (const [at, tracks] of uniqueTracks) if (at >= second - 4) uniqueTrackSeconds += tracks.size;
    return {
        enabled: diagnosticsEnabled(), rateWindowSeconds: 5,
        messagesPerSecond: rate("messages"), socketMessagesPerSecond: rate("socketMessages"),
        socketCallback: timing(socketDurations), reconciliation: timing(reconciliationDurations),
        stages: Object.fromEntries(Array.from(stageDurations, ([name, samples]) => [name, timing(samples)])),
        channels: Array.from(channels, ([key, stats]) => ({
            channel: stats.channel, eventType: stats.eventType, messages: stats.messages,
            messagesPerSecond: rate(`channel:${key}`), payloadBytesEstimate: stats.payloadBytesEstimate,
            itemsPerMessage: stats.itemsPerMessage,
            tracksProcessedPerSecond: rate(`${stats.channel}:tracksProcessed`),
            cesiumTrackUpdatesPerSecond: rate(`${stats.channel}:cesiumTrackUpdates`),
            domUpdatesPerSecond: rate(`${stats.channel}:domUpdates`),
            ...timing(stats.durations),
        })),
        queueDepth: queueStats.reduce((sum, queue) => sum + queue.queueDepth, 0),
        coalescedUpdates: queueStats.reduce((sum, queue) => sum + queue.coalescedUpdates, 0),
        acceptedValidUpdates: queueStats.reduce((sum, queue) => sum + queue.acceptedValidUpdates, 0),
        staleRejectedUpdates: queueStats.reduce((sum, queue) => sum + queue.staleRejectedUpdates, 0),
        pendingVisualCandidates: queueStats.reduce((sum, queue) => sum + queue.pendingVisualCandidates, 0),
        visualReconciliations: queueStats.reduce((sum, queue) => sum + queue.visualReconciliations, 0),
        rescuedFinalVisualUpdates: queueStats.reduce((sum, queue) => sum + queue.rescuedFinalVisualUpdates, 0),
        uniqueTracksUpdatedPerSecond: uniqueTrackSeconds / 5,
        tracksProcessedPerSecond: rate("tracksProcessed"),
        cesiumTrackUpdatesPerSecond: rate("cesiumTrackUpdates"),
        domUpdatesPerSecond: rate("domUpdates"), widgetFullRefreshesPerSecond: rate("widgetFullRefreshes"),
        longTasks: longTasks.slice(-60), channelErrors: heartbeatErrors.slice(-30),
    };
}
