const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MANIFEST = "cesium-assets.json";
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function listFiles(directory, prefix = "") {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const relative = prefix + entry.name;
        return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative + "/") : [relative];
    }).sort();
}

function getCesiumRelease(root, variant = "standard") {
    const source = path.join(root, "node_modules/cesium/Build/Cesium");
    const version = require(path.join(root, "node_modules/cesium/package.json")).version;
    const hash = crypto.createHash("sha256").update(variant);
    // Include inputs that can change the emitted vendor bytes, not app source or machine paths.
    for (const relative of listFiles(source)) {
        hash.update(relative + "\0" + sha256(fs.readFileSync(path.join(source, relative))) + "\0");
    }
    for (const relative of ["package-lock.json", "webpack.config.js", "scripts/cesium-assets.cjs",
        "scripts/build-cesium-compact.cjs", "scripts/cesium-worker-dynamic-import-loader.cjs"]) {
        hash.update(relative + "\0" + fs.readFileSync(path.join(root, relative)));
    }
    for (const name of ["webpack", "terser-webpack-plugin", "terser"]) {
        hash.update(name + ":" + require(require.resolve(name + "/package.json", { paths: [root] })).version);
    }
    const release = `${version}-${hash.digest("hex").slice(0, 16)}-${variant}`;
    return { schemaVersion: 1, release, variant, cesiumVersion: version,
        baseUrl: `/assets/cesium/releases/${release}`, source };
}

class CesiumAssetManifestPlugin {
    constructor(release) { this.release = release; }
    apply(compiler) {
        compiler.hooks.thisCompilation.tap("CesiumAssetManifest", (compilation) => {
            compilation.hooks.processAssets.tap({ name: "CesiumAssetManifest",
                stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
                const prefix = this.release.baseUrl.slice(1) + "/";
                const files = compilation.getAssets().filter((asset) => asset.name.startsWith(prefix))
                    .map((asset) => {
                        const bytes = Buffer.from(asset.source.buffer());
                        return { path: asset.name.slice(prefix.length), bytes: bytes.length, sha256: sha256(bytes) };
                    }).sort((a, b) => a.path.localeCompare(b.path));
                if (!files.length) throw new Error("Cesium release contains no emitted files; check the copy destination");
                const { source, ...release } = this.release;
                compilation.emitAsset(MANIFEST, new compiler.webpack.sources.RawSource(
                    JSON.stringify({ ...release, files }, null, 2) + "\n"));
            });
        });
    }
}

function readManifest(buildDirectory) {
    const manifest = JSON.parse(fs.readFileSync(path.join(buildDirectory, MANIFEST), "utf8"));
    if (manifest.schemaVersion !== 1 || !/^\d+\.\d+\.\d+-[a-f0-9]{16}-(standard|compact)$/.test(manifest.release)
        || manifest.baseUrl !== `/assets/cesium/releases/${manifest.release}`
        || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Invalid Cesium asset manifest");
    const seen = new Set();
    for (const file of manifest.files) {
        if (!file.path || file.path.split("/").some((part) => !part || part === "." || part === "..")
            || /[\\:?#]/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)
            || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || seen.has(file.path)) {
            throw new Error("Invalid Cesium manifest file entry");
        }
        seen.add(file.path);
    }
    for (const name of ["createGeometry", "createPolygonGeometry", "createGroundPolylineGeometry", "combineGeometry", "createEllipseGeometry"]) {
        if (!seen.has(`Workers/${name}.js`)) throw new Error(`Missing Cesium worker in manifest: ${name}`);
    }
    return manifest;
}

function verifyBuild(buildDirectory) {
    const manifest = readManifest(buildDirectory);
    const directory = path.join(buildDirectory, manifest.baseUrl.slice(1));
    const known = new Set(manifest.files.map((file) => file.path));
    for (const file of manifest.files) {
        const bytes = fs.readFileSync(path.join(directory, file.path));
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Cesium integrity mismatch: ${file.path}`);
        if (!file.path.startsWith("Workers/") || !file.path.endsWith(".js")) continue;
        for (const match of bytes.toString("utf8").matchAll(/["'](\.\/[^"']+\.js)["']/g)) {
            const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), match[1]));
            if (!known.has(dependency)) throw new Error(`Missing worker dependency: ${file.path} -> ${dependency}`);
        }
    }
    return manifest;
}

async function verifyLive(buildDirectory, baseUrl) {
    const manifest = verifyBuild(buildDirectory);
    const origin = new URL(baseUrl);
    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || origin.search || origin.hash
        || origin.pathname !== "/") throw new Error("Expected a site origin URL");
    // Sequential pre-publication checks, not a load test. Include request IDs in errors for AWS.
    for (const file of manifest.files) {
        const response = await fetch(new URL(`${manifest.baseUrl}/${file.path}`, origin), {
            redirect: "error", signal: AbortSignal.timeout(30000),
        });
        const context = `${file.path} (HTTP ${response.status}, ${response.headers.get("x-cache") || "no X-Cache"}, ` +
            `request ${response.headers.get("x-amz-cf-id") || "unknown"})`;
        if (response.status !== 200) throw new Error(`Cesium delivery failed: ${context}`);
        if (!/\bimmutable\b/i.test(response.headers.get("cache-control") || "")
            || !/\bmax-age=31536000\b/.test(response.headers.get("cache-control") || "")) {
            throw new Error(`Cesium immutable cache header missing: ${context}`);
        }
        if (file.path.endsWith(".js") && !/^(application|text)\/(?:x-)?javascript\b/i.test(response.headers.get("content-type") || "")) {
            throw new Error(`Cesium JavaScript MIME type invalid: ${context}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Cesium live integrity mismatch: ${context}`);
    }
    return manifest;
}

module.exports = { MANIFEST, sha256, listFiles, getCesiumRelease, CesiumAssetManifestPlugin, readManifest, verifyBuild, verifyLive };
if (require.main === module) {
    const [command, directory, origin, ...extra] = process.argv.slice(2);
    (async () => {
        if (extra.length || !directory || !["--verify", "--verify-live"].includes(command)
            || (command === "--verify-live") !== Boolean(origin)) {
            throw new Error("Usage: node scripts/cesium-assets.cjs --verify <build-dir> | --verify-live <build-dir> <site-origin>");
        }
        const manifest = command === "--verify" ? verifyBuild(directory) : await verifyLive(directory, origin);
        console.info(`Verified ${manifest.files.length} Cesium assets: ${manifest.baseUrl}`);
    })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
