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
export function createTrackUpdateQueue({ process, schedule, cancel, now = clock, frameBudgetMs = 4, maxRecordsPerFrame = 4, onError = () => {} }) {
    const pending = new Map();
    let scheduled = null;
    let depth = 0;
    let coalescedUpdates = 0;
    function requestDrain() {
        if (scheduled === null && depth) scheduled = schedule(drain);
    }
    function drain() {
        scheduled = null;
        const startedAt = now();
        let processed = 0;
        while (depth && processed < maxRecordsPerFrame && (processed === 0 || now() - startedAt < frameBudgetMs)) {
            const [key, group] = pending.entries().next().value;
            const payload = group.items[group.index++];
            const last = group.index === group.items.length;
            if (last) pending.delete(key);
            else {
                // Round-robin across aircraft and release already processed rows.
                if (group.index >= 128) { group.items = group.items.slice(group.index); group.index = 0; }
                pending.delete(key);
                pending.set(key, group);
            }
            depth -= 1;
            const type = String(payload?.eventType || payload?.event || "").toUpperCase();
            // DELETE is an ordered lifecycle barrier. Intermediate upserts still
            // enter history; only their Cesium/render work is coalesced.
            const dataOnly = !last && type !== "DELETE";
            if (dataOnly) coalescedUpdates += 1;
            const at = now();
            const previousChannel = activeChannel;
            activeChannel = "tracks-live";
            try { process(payload, { dataOnly }); }
            catch (error) { onError(error); }
            if (diagnosticsEnabled()) retainSample(reconciliationDurations, now() - at);
            recordRealtimeWork("tracksProcessed", 1, key);
            activeChannel = previousChannel;
            processed += 1;
        }
        requestDrain();
    }
    const queue = {
        enqueue(payload) {
            const row = payload?.new || payload?.old;
            const key = String(row?.track_key || row?.id || "");
            if (!key) return false;
            let group = pending.get(key);
            if (!group) pending.set(key, group = { items: [], index: 0 });
            group.items.push(payload);
            depth += 1;
            requestDrain();
            return true;
        },
        clear() {
            if (scheduled !== null) cancel(scheduled);
            scheduled = null;
            pending.clear();
            depth = 0;
        },
        getStats: () => ({ queueDepth: depth, uniquePendingTracks: pending.size, coalescedUpdates, scheduled: scheduled !== null }),
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
        uniqueTracksUpdatedPerSecond: uniqueTrackSeconds / 5,
        tracksProcessedPerSecond: rate("tracksProcessed"),
        cesiumTrackUpdatesPerSecond: rate("cesiumTrackUpdates"),
        domUpdatesPerSecond: rate("domUpdates"), widgetFullRefreshesPerSecond: rate("widgetFullRefreshes"),
        longTasks: longTasks.slice(-60), channelErrors: heartbeatErrors.slice(-30),
    };
}
