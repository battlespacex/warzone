const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const TerserPlugin = require("terser-webpack-plugin");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "node_modules/cesium/Build/Cesium/Workers");
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--cleanup") &&
    !(args.length === 2 && args[0] === "--out-dir" && args[1])) {
    throw new Error("Usage: node scripts/build-cesium-compact.cjs [--out-dir <directory> | --cleanup]");
}
const { MANIFEST, readManifest, listFiles, sha256 } = require("./cesium-assets.cjs");
const buildDir = path.join(root, "production");
const manifest = args[0] === "--out-dir" ? null : readManifest(buildDir);
if (manifest && args[0] !== "--cleanup" && manifest.variant !== "compact") {
    throw new Error("Use npm run build:cesium-compact; refusing to overwrite a standard immutable Cesium release");
}
const releaseDir = manifest ? path.join(buildDir, manifest.baseUrl.slice(1)) : null;
const outputDir = args[0] === "--out-dir"
    ? path.resolve(args[1]) : path.join(releaseDir, "Workers");
if (args[0] === "--cleanup") {
    const entry = fs.readFileSync(path.join(outputDir, "createGeometry.js"), "utf8");
    if (entry.includes("cesium-geometry-shared.")) {
        throw new Error("Rebuild the default Cesium workers before removing their shared module");
    }
    for (const name of fs.readdirSync(outputDir)) {
        if (/^cesium-geometry-shared\.[0-9a-f]{8}\.js$/.test(name)) {
            fs.rmSync(path.join(outputDir, name));
        }
    }
    console.info("Removed unused compact Cesium shared modules");
    process.exit(0);
}
const names = ["createGeometry", "createPolygonGeometry", "createGroundPolylineGeometry", "combineGeometry"];
for (const name of names) {
    if (!fs.existsSync(path.join(sourceDir, `${name}.js`))) {
        throw new Error(`Missing Cesium worker: ${name}.js`);
    }
}

const config = {
    mode: "production",
    target: "webworker",
    entry: Object.fromEntries(names.map((name) => [name, {
        import: path.join(sourceDir, `${name}.js`),
        filename: `${name}.js`,
    }])),
    output: {
        path: outputDir,
        filename: "[name].[contenthash:8].js",
        chunkFilename: "[name].[contenthash:8].js",
        module: true,
        library: { type: "module" },
        clean: false,
    },
    experiments: { outputModule: true },
    devtool: false,
    module: { rules: [
        { test: /Workers[\\/].*\.js$/, type: "javascript/esm" },
        {
            test: /Workers[\\/]createGeometry\.js$/,
            use: path.join(__dirname, "cesium-worker-dynamic-import-loader.cjs"),
        },
    ] },
    optimization: {
        runtimeChunk: false,
        minimizer: [new TerserPlugin({
            extractComments: false,
            terserOptions: { format: { comments: /@license|@preserve/ } },
        })],
        splitChunks: {
            chunks: "all",
            cacheGroups: {
                geometryShared: {
                    test: /Workers[\\/]/,
                    minChunks: 2,
                    name: "cesium-geometry-shared",
                    enforce: true,
                },
            },
        },
    },
    performance: { hints: false },
};

webpack(config, (error, stats) => {
    if (error || stats.hasErrors()) {
        console.error(error || stats.toString({ all: false, errors: true }));
        process.exitCode = 1;
        return;
    }
    const assets = stats.toJson({ all: false, assets: true }).assets || [];
    const scripts = assets.map((asset) => asset.name).filter((name) => name.endsWith(".js"));
    if (scripts.length !== 5 || names.some((name) => !scripts.includes(`${name}.js`)) ||
        !scripts.some((name) => /^cesium-geometry-shared\.[0-9a-f]{8}\.js$/.test(name))) {
        console.error(`Unexpected compact Cesium worker output: ${scripts.join(", ")}`);
        process.exitCode = 1;
        return;
    }
    console.info(`Compact Cesium workers: ${scripts.length} JavaScript files, ` +
        `${scripts.reduce((sum, name) => sum + fs.statSync(path.join(outputDir, name)).size, 0)} bytes in ${outputDir}`);
    if (manifest) {
        manifest.files = listFiles(releaseDir).map((relative) => {
            const bytes = fs.readFileSync(path.join(releaseDir, relative));
            return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
        });
        fs.writeFileSync(path.join(buildDir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    }
});
