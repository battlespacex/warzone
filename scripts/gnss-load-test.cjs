// Opt-in browser acceptance runner. Never targets the production site.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const PRODUCTION_HOSTS = ["stratops.battlespacex.com", "api.battlespacex.com"];
const isWorker = (url) => /\/assets\/cesium\/(?:releases\/[^/]+\/)?Workers\/[^?]+\.js(?:\?|$)/.test(url);
const isGnssApi = (url) => /\/events\/gnss-interference(?:\?|$)/.test(url);

function safeUrl(value) {
    try {
        const url = new URL(value);
        url.username = ""; url.password = "";
        for (const key of url.searchParams.keys()) {
            if (/token|key|auth|signature|credential|secret/i.test(key)) url.searchParams.set(key, "REDACTED");
        }
        return url.href;
    } catch { return "invalid-url"; }
}
function sanitizeHar(har) {
    for (const entry of har.log.entries) {
        entry.request.url = safeUrl(entry.request.url);
        entry.request.queryString = [...new URL(entry.request.url).searchParams].map(([name, value]) => ({ name, value }));
        for (const side of [entry.request, entry.response]) {
            side.cookies = [];
            side.headers = side.headers.filter((header) => /^(content-type|content-length|cache-control|age|x-cache|x-amz-cf-id|x-amz-cf-pop|etag|last-modified|accept|range)$/i.test(header.name));
        }
        delete entry.request.postData;
        if (entry.response.content) delete entry.response.content.text;
        if (entry.response.redirectURL) entry.response.redirectURL = safeUrl(entry.response.redirectURL);
    }
    return har;
}
function validateConfig(config) {
    const url = new URL(config.baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!local && url.origin !== "https://stratops-staging.battlespacex.com") || url.username || url.password
        || !/^https?:$/.test(url.protocol)) throw new Error("Only localhost or https://stratops-staging.battlespacex.com is permitted");
    const counts = config.counts || [1, 10, 20, 30];
    if (!counts.length || counts.some((n) => ![1, 10, 20, 30].includes(n))) throw new Error("Counts must be selected from 1, 10, 20, 30");
    if (!config.flow || !config.outputDirectory) throw new Error("flow and outputDirectory are required");
    return { ...config, counts, caches: ["cold", "warm"], scenarios: ["simultaneous-load", "gnss-after-load"],
        timeoutMs: config.timeoutMs || 90000, observeMs: config.observeMs ?? 10000 };
}

function createRecorder(context, page) {
    let current = null;
    const tasks = [];
    const owners = new WeakMap();
    const target = () => current;
    context.on("request", (request) => {
        const record = target(); if (!record) return;
        owners.set(request, record);
        const url = request.url();
        record.activeRequests++;
        if (isWorker(url)) record.activeWorkerRequests++;
        record.peakConcurrentRequests = Math.max(record.peakConcurrentRequests, record.activeRequests);
        record.requests.push({ url: safeUrl(url), method: request.method(), type: request.resourceType(),
            startMs: performance.now() - record.started, worker: isWorker(url), gnssApi: isGnssApi(url),
            staticAsset: request.resourceType() !== "xhr" && request.resourceType() !== "fetch" });
    });
    context.on("response", (response) => {
        const record = owners.get(response.request()); if (!record || record.stopped) return;
        const headers = response.headers();
        const status = response.status(), url = response.url();
        const worker = isWorker(url), gnssApi = isGnssApi(url);
        record.responses.push({ url: safeUrl(url), status, worker, gnssApi,
            cacheControl: headers["cache-control"], xCache: headers["x-cache"],
            pop: headers["x-amz-cf-pop"], requestId: headers["x-amz-cf-id"], contentType: headers["content-type"] });
        if (status === 503) record.http503++;
        if (status === 503 && /cloudfront/i.test(headers["x-cache"] || headers.via || "")) record.cloudfront503++;
        if (status === 503 && /LimitExceeded/i.test(headers["x-cache"] || "")) record.limitExceeded503++;
        if (worker && (status >= 400 || (status !== 304 && !/^(application|text)\/(?:x-)?javascript\b/.test(headers["content-type"] || "")))) record.workerHttpFailures++;
        if (gnssApi && status >= 400) record.gnssApiHttpFailures++;
    });
    context.on("requestfinished", (request) => {
        const record = owners.get(request); if (!record || record.stopped) return;
        owners.delete(request); record.activeRequests--;
        if (isWorker(request.url())) record.activeWorkerRequests--;
        tasks.push(request.sizes().then((sizes) => { record.responseBodyBytes += sizes.responseBodySize; }).catch(() => {}));
    });
    context.on("requestfailed", (request) => {
        const record = owners.get(request); if (!record || record.stopped) return;
        owners.delete(request); record.activeRequests--;
        if (isWorker(request.url())) record.activeWorkerRequests--;
        record.failedRequests.push({ url: safeUrl(request.url()), error: request.failure()?.errorText });
        if (isWorker(request.url())) record.workerNetworkFailures++;
    });
    page.on("worker", (worker) => { target()?.workers.push(safeUrl(worker.url())); });
    page.on("pageerror", (error) => { target()?.pageErrors.push(error.message); });
    page.on("crash", () => { if (target()) target().crashed = true; });
    return {
        start: () => {
            current = { started: performance.now(), startedUtc: new Date().toISOString(), requests: [], responses: [], workers: [], failedRequests: [], pageErrors: [],
                http503: 0, cloudfront503: 0, limitExceeded503: 0, workerHttpFailures: 0, workerNetworkFailures: 0,
                gnssApiHttpFailures: 0, responseBodyBytes: 0, activeRequests: 0, activeWorkerRequests: 0, peakConcurrentRequests: 0 };
            return current;
        },
        stop: async () => { await Promise.allSettled(tasks); if (current) current.stopped = true; current = null; },
    };
}

async function attachSceneProbe(page, timeoutMs) {
    await page.waitForFunction(() => Boolean(window.__warzoneViewer?.scene), null, { timeout: timeoutMs });
    await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        const probe = window.__gnssAcceptanceProbe = { viewer, renderErrors: [], frames: 0 };
        viewer.scene.renderError.addEventListener((scene, error) => probe.renderErrors.push(String(error?.stack || error)));
        viewer.scene.postRender.addEventListener(() => probe.frames++);
    });
}
async function snapshot(page) {
    return page.evaluate(() => {
        const viewer = window.__warzoneViewer, probe = window.__gnssAcceptanceProbe;
        return { utc: new Date().toISOString(), sameViewer: viewer === probe?.viewer,
            renderLoop: viewer?.cesiumWidget?.useDefaultRenderLoop === true,
            renderErrors: probe?.renderErrors || [], frames: probe?.frames || 0,
            hidden: document.hidden, canvasCount: document.querySelectorAll("#warzone-globe .cesium-widget canvas").length,
            diagnostics: window.__getStratOpsPerformanceDiagnostics?.() || null,
            hardwareConcurrency: navigator.hardwareConcurrency,
            heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null };
    });
}
async function runScenario(config, flow, count, cache, scenario, chromium) {
    const label = `${count}-${cache}-${scenario}`;
    const directory = path.resolve(config.outputDirectory, label);
    fs.mkdirSync(directory, { recursive: true });
    const sessions = [];
    const results = [];
    try {
        // Separate browser processes avoid shared HTTP caches and one process's foreground-tab policy.
        for (let index = 0; index < count; index++) {
            const browser = await chromium.launch({ channel: config.channel || "chrome", headless: config.headless !== false,
                args: [`--host-resolver-rules=${PRODUCTION_HOSTS.map((host) => `MAP ${host} ~NOTFOUND`).join(", ")}`] });
            const session = { browser, index }; sessions.push(session);
            const context = session.context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
                storageState: config.storageStates?.[index],
                recordHar: { path: path.join(directory, `session-${index + 1}.har`), content: "omit", mode: "full" } });
            const page = session.page = await context.newPage();
            page.setDefaultTimeout(config.timeoutMs);
            session.recorder = createRecorder(context, page);
            if (cache === "warm") {
                await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
                await flow.prepare(page, config, index);
                await flow.enableGnss(page, config, index);
                await flow.waitForGnss(page, config, index);
            }
        }
        const prepare = async (session) => {
            session.result = session.recorder.start();
            session.result.session = session.index + 1;
            session.result.browserVersion = session.browser.version();
            await session.page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
            if (new URL(session.page.url()).origin !== new URL(config.baseUrl).origin) throw new Error("Navigation left staging origin");
            await flow.prepare(session.page, config, session.index);
            await attachSceneProbe(session.page, config.timeoutMs);
            session.result.preparedMs = performance.now() - session.result.started;
            await session.page.screenshot({ path: path.join(directory, `session-${session.index + 1}-before-gnss.png`) });
        };
        const exercise = async (session) => {
            const start = performance.now();
            await flow.enableGnss(session.page, config, session.index);
            await flow.waitForGnss(session.page, config, session.index);
            session.result.gnssInitializationMs = performance.now() - start;
            session.result.before = await snapshot(session.page);
            session.result.featureChecks = await flow.exercise(session.page, config, session.index);
            // Observation window measures continued rendering/network health; it doesn't delay app code.
            await session.page.waitForTimeout(config.observeMs);
            const frames = await session.page.evaluate(() => {
                const previous = window.__gnssAcceptanceProbe.frames;
                window.__warzoneViewer.scene.requestRender();
                return previous;
            });
            await session.page.waitForFunction((previous) => window.__gnssAcceptanceProbe.frames > previous, frames);
            session.result.after = await snapshot(session.page);
            await session.page.screenshot({ path: path.join(directory, `session-${session.index + 1}-after-gnss.png`) });
        };
        if (scenario === "gnss-after-load") {
            // Preparation is sequential in this scenario; only GNSS activation shares the barrier below.
            for (const session of sessions) await prepare(session);
        }
        await Promise.all(sessions.map(async (session) => {
            try {
                if (scenario === "simultaneous-load") await prepare(session);
                await exercise(session);
            } catch (error) {
                session.result ||= session.recorder.start();
                session.result.error = error.message;
            } finally {
                await session.recorder.stop();
                results.push(session.result);
            }
        }));
    } catch (error) {
        results.push({ error: `Scenario setup failed: ${error.message}` });
    } finally {
        for (const session of sessions) {
            if (session.context) await session.context.close().catch(() => {});
            await session.browser.close();
            const harPath = path.join(directory, `session-${session.index + 1}.har`);
            if (fs.existsSync(harPath)) fs.writeFileSync(harPath, JSON.stringify(sanitizeHar(JSON.parse(fs.readFileSync(harPath, "utf8")))));
        }
    }
    const automatedPass = results.length === count && results.every((r) => !r.error && !r.crashed && r.after?.renderLoop
        && r.after.sameViewer && r.after.canvasCount === 1 && !r.after.hidden && !r.after.renderErrors.length && !r.pageErrors.length
        && r.workerHttpFailures === 0 && r.workerNetworkFailures === 0 && r.activeWorkerRequests === 0 && r.http503 === 0 && r.gnssApiHttpFailures === 0
        && r.after.diagnostics?.gnss?.visible && r.after.diagnostics.gnss.activeCellEntities > 0
        && r.requests.some((request) => request.worker) && r.featureChecks?.gnss === true);
    const result = { label, count, cache, scenario, automatedPass,
        acceptance: automatedPass ? "pending-visual-and-other-feature-review" : "failed-or-inconclusive",
        blackGlobeIncidents: null, functionalSatelliteRegressions: null, radarRegressions: null,
        sessions: results.sort((a, b) => a.session - b.session) };
    const requests = results.flatMap((session) => session.requests || []);
    const firstStart = Math.min(...results.map((session) => session.started).filter(Number.isFinite));
    const buckets = new Map();
    for (const session of results) for (const request of session.requests || []) {
        const second = Math.floor((session.started + request.startMs - firstStart) / 1000);
        buckets.set(second, (buckets.get(second) || 0) + 1);
    }
    result.metrics = { requests: requests.length, workerRequests: requests.filter((request) => request.worker).length,
        gnssApiRequests: requests.filter((request) => request.gnssApi).length,
        peakOneSecondBucketRequests: Math.max(0, ...buckets.values()),
        workerHttpFailures: results.reduce((sum, session) => sum + (session.workerHttpFailures || 0), 0),
        workerNetworkFailures: results.reduce((sum, session) => sum + (session.workerNetworkFailures || 0), 0),
        http503: results.reduce((sum, session) => sum + (session.http503 || 0), 0),
        cloudfrontDelivered503: results.reduce((sum, session) => sum + (session.cloudfront503 || 0), 0),
        limitExceeded503: results.reduce((sum, session) => sum + (session.limitExceeded503 || 0), 0),
        gnssApiHttpFailures: results.reduce((sum, session) => sum + (session.gnssApiHttpFailures || 0), 0) };
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(result, null, 2));
    return { label, automatedPass, acceptance: result.acceptance, artifactDirectory: directory };
}

async function main(args) {
    if (args.length < 2 || args[0] !== "--config" || args.slice(2).some((arg) => arg !== "--execute")) {
        throw new Error("Usage: node scripts/gnss-load-test.cjs --config <config.json> [--execute]");
    }
    const config = validateConfig(JSON.parse(fs.readFileSync(path.resolve(args[1]), "utf8").replace(/^\uFEFF/, "")));
    const matrix = config.counts.flatMap((count) => config.caches.flatMap((cache) => config.scenarios.map((scenario) => ({ count, cache, scenario }))));
    if (!args.includes("--execute")) { console.info(JSON.stringify({ mode: "plan-only; no browser or network traffic", baseUrl: config.baseUrl, matrix }, null, 2)); return; }
    if ((config.storageStates || []).length < Math.max(...config.counts)) throw new Error("Provide one authenticated storage-state file per session; no auth bypass is supported");
    if (new Set(config.storageStates.map((file) => path.resolve(file))).size < Math.max(...config.counts)) {
        throw new Error("Use distinct storage-state files for the concurrent sessions");
    }
    for (const file of config.storageStates) if (!fs.existsSync(file)) throw new Error(`Missing storage-state file: ${file}`);
    const flow = require(path.resolve(config.flow));
    for (const name of ["prepare", "enableGnss", "waitForGnss", "exercise"]) if (typeof flow[name] !== "function") throw new Error(`Flow must export ${name}`);
    const { chromium } = require("../apps/worker/node_modules/playwright");
    fs.mkdirSync(config.outputDirectory, { recursive: true });
    config.outputDirectory = fs.mkdtempSync(path.join(config.outputDirectory, "run-"));
    const summaries = [];
    for (const entry of matrix) {
        const result = await runScenario(config, flow, entry.count, entry.cache, entry.scenario, chromium);
        summaries.push(result); console.info(JSON.stringify(result));
        // Stop at the first failure; don't amplify an outage by continuing larger cohorts.
        if (!result.automatedPass) break;
    }
    fs.writeFileSync(path.join(config.outputDirectory, "matrix-results.json"), JSON.stringify({ planned: matrix, completed: summaries }, null, 2));
    if (summaries.length !== matrix.length || summaries.some((result) => !result.automatedPass)) process.exitCode = 1;
}
module.exports = { validateConfig, safeUrl, sanitizeHar, isWorker, isGnssApi };
if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
