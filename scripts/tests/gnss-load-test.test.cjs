const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateConfig, sanitizeHar, isWorker, isGnssApi } = require("../gnss-load-test.cjs");
const config = { baseUrl: "https://stratops-staging.battlespacex.com", flow: "flow.cjs", outputDirectory: "output" };
test("load runner rejects production, credentials and unsupported concurrency", () => {
    for (const baseUrl of ["https://stratops.battlespacex.com", "https://api.battlespacex.com", "https://other.example", "https://user:password@stratops-staging.battlespacex.com"]) {
        assert.throws(() => validateConfig({ ...config, baseUrl }), /permitted/);
    }
    assert.throws(() => validateConfig({ ...config, counts: [100] }), /Counts/);
    const value = validateConfig(config);
    assert.deepEqual(value.counts, [1, 10, 20, 30]);
    assert.equal(value.caches.length * value.scenarios.length * value.counts.length, 16);
});
test("HAR artifact removes credentials, cookie values, body data and signed query parameters", () => {
    const har = { log: { entries: [{ request: { url: "https://example.test/api?access_token=secret&date=72h",
        queryString: [], headers: [{ name: "Authorization", value: "secret" }], cookies: ["secret"], postData: { text: "secret" } },
        response: { headers: [{ name: "Set-Cookie", value: "secret" }, { name: "X-Amz-Cf-Id", value: "request-id" }],
            cookies: ["secret"], content: { text: "secret" } } }] } };
    const sanitized = sanitizeHar(har);
    assert.doesNotMatch(JSON.stringify(sanitized), /secret/);
    assert.match(JSON.stringify(sanitized), /request-id/);
    assert.match(JSON.stringify(sanitized), /72h/);
});
test("network classification includes legacy and versioned worker URLs separately from GNSS APIs", () => {
    assert.ok(isWorker("https://example.test/assets/cesium/Workers/chunk-x.js"));
    assert.ok(isWorker("https://example.test/assets/cesium/releases/release/Workers/createPolygonGeometry.js"));
    assert.ok(isGnssApi("https://example.test/api/events/gnss-interference?date=72h"));
    assert.equal(isWorker("https://example.test/api/events/gnss-interference"), false);
});

test("early API adapters and app config use the staging base while retaining production and localhost defaults", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../dev/assets/js/supabase.js"), "utf8");
    const baseSource = source.slice(source.indexOf("const isLocalhost ="), source.indexOf("const EVENTS_HISTORY_WINDOW_HOURS"));
    const index = fs.readFileSync(path.resolve(__dirname, "../../dev/assets/js/index.js"), "utf8");
    const indexSource = index.slice(index.indexOf("const isLocalDevHost ="), index.indexOf("const compiledTacticalMapBaseUrl"));
    for (const [host, compiled, expected] of [
        ["localhost", undefined, "/api"],
        ["stratops.battlespacex.com", undefined, "https://api.battlespacex.com"],
        ["stratops-staging.battlespacex.com", "https://api-staging.example.test", "https://api-staging.example.test"],
    ]) {
        const context = vm.createContext({ window: { location: { hostname: host } } });
        if (compiled) context.STRATOPS_API_BASE_URL = compiled;
        const bases = vm.runInContext(baseSource + ";[API_BASE, INTEL_FEED_API_BASE, GNSS_API_BASE, REPORTS_API_BASE]", context);
        assert.ok(bases.every((base) => base === expected));
        const boot = vm.createContext({ window: { location: { hostname: host } } });
        if (compiled) boot.STRATOPS_API_BASE_URL = compiled;
        assert.equal(vm.runInContext(indexSource + ";STRATOPS_API_BASE", boot), expected);
    }
});
