const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { sha256, getCesiumRelease, verifyBuild, verifyLive, CesiumAssetManifestPlugin } = require("../cesium-assets.cjs");

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stratops-cesium-release-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const release = "1.143.0-0123456789abcdef-standard";
    const baseUrl = `/assets/cesium/releases/${release}`;
    const workerDirectory = path.join(directory, baseUrl.slice(1), "Workers");
    fs.mkdirSync(workerDirectory, { recursive: true });
    const files = ["createGeometry", "createPolygonGeometry", "createGroundPolylineGeometry", "combineGeometry", "createEllipseGeometry", "chunk-test"]
        .map((name) => {
            const bytes = Buffer.from(name === "createGeometry" ? 'import "./chunk-test.js"; export default {};' : "export default {};");
            fs.writeFileSync(path.join(workerDirectory, name + ".js"), bytes);
            return { path: `Workers/${name}.js`, bytes: bytes.length, sha256: sha256(bytes) };
        });
    const manifest = { schemaVersion: 1, release, baseUrl, variant: "standard", files };
    const save = () => fs.writeFileSync(path.join(directory, "cesium-assets.json"), JSON.stringify(manifest));
    save();
    return { directory, workerDirectory, manifest, save };
}

test("release identity is deterministic, independent of checkout path, and changes with vendor/config/variant inputs", (t) => {
    const f = fixture(t);
    function inputs(root) {
        for (const [relative, contents] of Object.entries({
            "node_modules/cesium/package.json": '{"version":"1.143.0"}',
            "node_modules/cesium/Build/Cesium/Workers/createGeometry.js": "vendor-bytes",
            "package-lock.json": "lock", "webpack.config.js": "config",
            "scripts/cesium-assets.cjs": "manifest-plugin", "scripts/build-cesium-compact.cjs": "compact-builder",
            "scripts/cesium-worker-dynamic-import-loader.cjs": "loader",
            "node_modules/webpack/package.json": '{"version":"5.0.0"}',
            "node_modules/terser-webpack-plugin/package.json": '{"version":"5.0.0"}',
            "node_modules/terser/package.json": '{"version":"5.0.0"}' })) {
            const filename = path.join(root, relative);
            fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, contents);
        }
    }
    const first = path.join(f.directory, "first"), second = path.join(f.directory, "second");
    inputs(first); inputs(second);
    const initial = getCesiumRelease(first).release;
    assert.equal(initial, getCesiumRelease(first).release);
    assert.equal(initial, getCesiumRelease(second).release);
    assert.notEqual(initial, getCesiumRelease(first, "compact").release);
    fs.appendFileSync(path.join(first, "webpack.config.js"), "changed");
    assert.notEqual(initial, getCesiumRelease(first).release);
    fs.appendFileSync(path.join(second, "node_modules/cesium/Build/Cesium/Workers/createGeometry.js"), "changed");
    assert.notEqual(initial, getCesiumRelease(second).release);
});

test("manifest describes final emitted bytes after vendor minification", () => {
    let callback, output;
    const release = { release: "test", baseUrl: "/assets/cesium/releases/test", source: "private-build-path" };
    const compiler = { webpack: { Compilation: { PROCESS_ASSETS_STAGE_REPORT: 5000 }, sources: { RawSource: class { constructor(value) { this.value = value; } } } },
        hooks: { thisCompilation: { tap(_, fn) { fn({ hooks: { processAssets: { tap(options, fn) { assert.equal(options.stage, 5000); callback = fn; } } },
            getAssets: () => [{ name: "assets/cesium/releases/test/Workers/x.js", source: { buffer: () => Buffer.from("final-minified") } }],
            emitAsset: (name, source) => { assert.equal(name, "cesium-assets.json"); output = JSON.parse(source.value); } }); } } } };
    new CesiumAssetManifestPlugin(release).apply(compiler); callback();
    assert.equal(output.source, undefined);
    assert.equal(output.files[0].sha256, sha256(Buffer.from("final-minified")));
});

test("production CopyPlugin treats dotted release names as directories and manifest verifies actual output", async (t) => {
    const f = fixture(t);
    const root = path.resolve(__dirname, "../..");
    const config = require("../../webpack.config.js")({}, { mode: "production" });
    const productionPattern = config.plugins.find((plugin) => plugin.constructor.name === "CopyPlugin")
        .patterns.find((pattern) => pattern.from.includes("cesium"));
    assert.equal(productionPattern.toType, "dir");
    const webpack = require("webpack");
    const CopyPlugin = require("copy-webpack-plugin");
    const output = path.join(f.directory, "output");
    const release = { ...f.manifest }; delete release.files;
    const stats = await new Promise((resolve, reject) => webpack({ context: root, mode: "production", entry: {},
        output: { path: output }, plugins: [new CopyPlugin({ patterns: [{ ...productionPattern,
            from: path.dirname(f.workerDirectory), to: path.join(output, release.baseUrl.slice(1)) }] }),
            new CesiumAssetManifestPlugin(release)], performance: { hints: false } }, (error, stats) => error ? reject(error) : resolve(stats)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    assert.equal(verifyBuild(output).files.length, 6);
});

test("verification rejects missing dependencies and altered bytes before release publication", (t) => {
    const f = fixture(t);
    assert.equal(verifyBuild(f.directory).files.length, 6);
    f.manifest.files = f.manifest.files.filter((file) => !file.path.endsWith("chunk-test.js")); f.save();
    assert.throws(() => verifyBuild(f.directory), /Missing worker dependency/);
    const g = fixture(t);
    fs.appendFileSync(path.join(g.workerDirectory, "createPolygonGeometry.js"), "// changed");
    assert.throws(() => verifyBuild(g.directory), /integrity mismatch/);
});

test("manifest cannot escape the release directory or omit principal workers", (t) => {
    const f = fixture(t); f.manifest.files[0].path = "../outside.js"; f.save();
    assert.throws(() => verifyBuild(f.directory), /Invalid Cesium manifest/);
    const g = fixture(t); g.manifest.files.shift(); g.save();
    assert.throws(() => verifyBuild(g.directory), /Missing Cesium worker/);
});

test("live gate accepts complete release, rejects 503, wrong MIME, missing cache header and corruption", async (t) => {
    const f = fixture(t);
    let mode = "ok";
    const server = http.createServer((req, res) => {
        res.setHeader("Cache-Control", mode === "cache" ? "public, max-age=300" : "public, max-age=31536000, immutable");
        res.setHeader("Content-Type", mode === "mime" ? "text/html" : "application/javascript");
        if (mode === "503") { res.writeHead(503, { "X-Cache": "LimitExceeded from cloudfront", "X-Amz-Cf-Id": "test-request" }); return res.end("Unavailable"); }
        const data = fs.readFileSync(path.join(f.directory, req.url.slice(1)));
        res.end(mode === "corrupt" ? Buffer.from("wrong") : data);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await verifyLive(f.directory, origin)).files.length, 6);
    for (const [value, error] of [["503", /HTTP 503.*LimitExceeded.*test-request/], ["mime", /MIME/], ["cache", /cache header/], ["corrupt", /integrity mismatch/]]) {
        mode = value; await assert.rejects(verifyLive(f.directory, origin), error);
    }
});
