// webpack.config.js
const configEnteredAt = Date.now();
if (process.env.STRATOPS_DEV_TIMING) {
    console.info("[dev-timing] config-enter=" + (configEnteredAt - Number(process.env.STRATOPS_DEV_LAUNCH_STARTED_AT)) + "ms since launcher");
}
const fs = require("fs");
const path = require("path");
const express = require("express");
const webpack = require("webpack");
const dotenv = require("dotenv");
const { createGeneratedReportPreviewRouter } = require("./server/generated-report-preview");

const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = (env, argv) => {
    const isDev = argv.mode === "development";
    const developmentEnvironment = isDev ? require("./scripts/dev-environment.cjs").getDevelopmentEnvironment(__dirname) : null;
    if (isDev) console.info("[dev-timing] config-requires=" + (Date.now() - configEnteredAt) + "ms");
    const CopyWebpackPlugin = isDev ? null : require("copy-webpack-plugin");
    const TerserPlugin = isDev ? null : require("terser-webpack-plugin");
    const CssMinimizerPlugin = isDev ? null : require("css-minimizer-webpack-plugin");
    const devOnlyModulePattern = /^\.\/warzone-formation-tuner\.js$/;

    // Load .env.local for dev, .env.production for prod
    const envFile = isDev ? ".env.local" : ".env.production";
    const envPath = path.resolve(__dirname, envFile);
    const envVars = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
    const cesiumToken = envVars.CESIUM_ION_TOKEN || "";
    const perfEmptyGlobe = isDev && /^(?:1|true|yes|on)$/i.test(String(
        envVars.STRATOPS_PERF_EMPTY_GLOBE || process.env.STRATOPS_PERF_EMPTY_GLOBE || ""
    ).trim());
    const requestedBasemapProvider = String(envVars.STRATOPS_BASEMAP_PROVIDER || process.env.STRATOPS_BASEMAP_PROVIDER || "esri").trim().toLowerCase();
    const readBooleanEnv = (name, fallback = false) => /^(?:1|true|yes|on)$/i.test(String(
        envVars[name] ?? process.env[name] ?? (fallback ? "true" : "false")
    ).trim());
    const enableGoogleMap = readBooleanEnv("STRATOPS_ENABLE_GOOGLE_MAP");
    const enableTacticalMap = readBooleanEnv("STRATOPS_ENABLE_TACTICAL_MAP");
    const googleMapsApiKey = String(
        envVars.STRATOPS_GOOGLE_MAPS_API_KEY || process.env.STRATOPS_GOOGLE_MAPS_API_KEY || ""
    ).trim();
    const requestedTerrainProvider = String(envVars.STRATOPS_TERRAIN_PROVIDER || process.env.STRATOPS_TERRAIN_PROVIDER || "legacy").trim().toLowerCase();
    const requestedMapBaseUrl = String(envVars.STRATOPS_MAP_BASE_URL || process.env.STRATOPS_MAP_BASE_URL || "").trim();
    const requestedTacticalMapBaseUrl = String(envVars.STRATOPS_TACTICAL_MAP_BASE_URL || process.env.STRATOPS_TACTICAL_MAP_BASE_URL || "").trim();
    const requestedTerrainBaseUrl = String(envVars.STRATOPS_TERRAIN_BASE_URL || process.env.STRATOPS_TERRAIN_BASE_URL || "").trim();
    const isPublicHttpsUrl = (value) => {
        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase();
            const privateIpv4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
            return url.protocol === "https:" && host !== "localhost" && host !== "::1" &&
                !host.endsWith(".local") && !privateIpv4;
        } catch {
            return false;
        }
    };
    const mapUrlAllowed = isDev || isPublicHttpsUrl(requestedMapBaseUrl);
    const tacticalMapUrlAllowed = isDev || isPublicHttpsUrl(requestedTacticalMapBaseUrl);
    const terrainUrlAllowed = isDev || isPublicHttpsUrl(requestedTerrainBaseUrl);
    const basemapProvider = ["esri", "google", "tactical"].includes(requestedBasemapProvider)
        ? requestedBasemapProvider
        : "esri";
    const terrainProvider = requestedTerrainProvider === "selfhosted"
        ? (terrainUrlAllowed ? "selfhosted" : "none")
        : requestedTerrainProvider;
    const mapBaseUrl = mapUrlAllowed ? requestedMapBaseUrl : "";
    const localTacticalMapBaseUrl = "/assets/map/tactical/v1";
    const tacticalMapBaseUrl = tacticalMapUrlAllowed
        ? (requestedTacticalMapBaseUrl || (isDev ? localTacticalMapBaseUrl : ""))
        : "";
    const terrainBaseUrl = terrainUrlAllowed ? requestedTerrainBaseUrl : "";
    if (!isDev && requestedTerrainProvider === "selfhosted" && !terrainUrlAllowed) {
        console.warn("[terrain] Production self-hosted terrain URL must be a public HTTPS URL; compiling terrain=none.");
    }
    if (!isDev && requestedTacticalMapBaseUrl && !tacticalMapUrlAllowed) {
        console.warn("[map-style] Production tactical map URL must be a public HTTPS URL; tactical mode will fall back to Satellite/Esri.");
    }

    const ROOT_DIR = __dirname;
    const PROD_DIR = path.resolve(ROOT_DIR, "production");
    const DEV_DIR = path.resolve(ROOT_DIR, "dev");
    // Keep hot cache traffic off mapped/Dropbox drives; separate each checkout.
    const cacheRoot = developmentEnvironment?.cacheDirectory;
    // Watchpack normalizes separators. Reject ancestor/missing dependencies before
    // they create directory watchers (e.g. Z:/package.json would scan all of Z:/).
    const watchRootPattern = ROOT_DIR.replace(/\\/g, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const watchIgnored = new RegExp(
        `^(?!${watchRootPattern}/)|` +
        String.raw`(?:[\\/]assets[\\/](?:images[\\/]models|cesium|three|pdfjs)(?:[\\/]|$))|` +
        String.raw`(?:[\\/](?:node_modules|production|dist|build|\.git|\.generated|\.cache|\.dropbox(?:\.cache)?|\.dropbox\.attr|__pycache__)(?:[\\/]|$))|(?:\.(?:glb|gltf|bin|wasm|mp4|webm|mp3|wav|ogg|pdf|zip|log|tmp)$)`,
        "i"
    );
    const GENERATED_REPORT_DIR = path.resolve(ROOT_DIR, ".generated", "reports");
    const SEO_DIR = path.resolve(ROOT_DIR, "seo");
    const PARTIALS_DIR = path.resolve(DEV_DIR, "partials");
    const SITE_PATH = path.resolve(SEO_DIR, "site.js");
    const PAGE_META_PATH = path.resolve(SEO_DIR, "pages.js");
    const SCHEMA_PATH = path.resolve(SEO_DIR, "schema.js");
    const STARTUP_DIAGNOSTICS_PATH = path.join(DEV_DIR, "assets/js/warzone-startup-diagnostics.js");

    const pages = ["index", "404", "report", "report-capture"];

    // -----------------------------
    // helpers
    // -----------------------------
    const stripSlashEnd = (s) => String(s || "").replace(/\/+$/, "");
    const ensureSlashStart = (s) => (String(s || "").startsWith("/") ? String(s) : `/${s}`);
    const joinUrl = (base, p) => {
        const b = stripSlashEnd(base);
        const pathPart = String(p || "/");
        return pathPart === "/" ? `${b}/` : `${b}${ensureSlashStart(pathPart)}`;
    };

    const readPartial = (relPath, fallback = "") => {
        try {
            return fs.readFileSync(path.resolve(DEV_DIR, relPath), "utf8").replace(/^\uFEFF/, "");
        } catch {
            return fallback;
        }
    };

    const partials = (name) => readPartial(`partials/${name}.html`);

    const loadFreshModule = (modulePath) => {
        const resolvedPath = require.resolve(modulePath);
        delete require.cache[resolvedPath];
        return require(resolvedPath);
    };

    const registerHtmlDependencies = (compilation) => {
        compilation.contextDependencies.add(PARTIALS_DIR);
        compilation.contextDependencies.add(SEO_DIR);
        compilation.fileDependencies.add(SITE_PATH);
        compilation.fileDependencies.add(PAGE_META_PATH);
        compilation.fileDependencies.add(SCHEMA_PATH);
        if (isDev) compilation.fileDependencies.add(STARTUP_DIAGNOSTICS_PATH);
    };

    return {
        context: ROOT_DIR,
        mode: isDev ? "development" : "production",
        ...(isDev ? {
            cache: {
                type: "filesystem",
                cacheDirectory: cacheRoot,
                name: "development",
                compression: false,
                buildDependencies: { config: [__filename, path.join(ROOT_DIR, "package.json"),
                    path.join(ROOT_DIR, "scripts/dev-environment.cjs"), path.join(ROOT_DIR, "scripts/webpack-startup-timing.cjs"),
                    path.join(ROOT_DIR, "package-lock.json"), ...(fs.existsSync(envPath) ? [envPath] : [])] },
            },
            watchOptions: { ...developmentEnvironment.watchOptions, ignored: watchIgnored },
        } : {}),

        entry: {
            main: isDev ? [path.resolve(DEV_DIR, "assets/js/warzone-development-entry.js"),
                path.resolve(DEV_DIR, "assets/js/index.js")] : path.resolve(DEV_DIR, "assets/js/index.js"),
            reportCapture: path.resolve(DEV_DIR, "assets/js/report-capture.js"),
            reportPdfViewer: path.resolve(DEV_DIR, "assets/js/report-pdf-viewer.js"),
        },

        output: {
            path: isDev ? path.join(cacheRoot, "output") : PROD_DIR,
            filename: (pathData) => {
                const name = pathData.chunk?.name;

                // splitChunks also emits unnamed initial chunks through filename,
                // not chunkFilename. Never alias those vendor chunks to main.
                if (!name) {
                    return isDev ? "assets/js/[id].bundle.js" : "assets/js/[id].bundle.[contenthash:8].js";
                }

                if (name === "main") {
                    return isDev ? "assets/js/bundle.js" : "assets/js/bundle.[contenthash:8].js";
                }

                return isDev ? `assets/js/${name}.js` : `assets/js/${name}.[contenthash:8].js`;
            },
            chunkFilename: isDev ? "assets/js/[id].bundle.js" : "assets/js/[id].bundle.[contenthash:8].js",
            publicPath: "/",
            clean: isDev ? false : {
                keep: (assetPath) => {
                    const p = assetPath.replace(/\\/g, "/").toLowerCase();

                    if (p.startsWith("assets/images/")) return true;
                    if (p.startsWith("assets/fonts/")) return true;
                    if (p.startsWith("assets/mp3/")) return true;
                    if (p.startsWith("assets/audio/")) return true;
                    if (p.startsWith("assets/videos/")) return true;
                    if (p.startsWith("assets/others/")) return true;
                    if (p.startsWith("assets/data/")) return true;
                    if (p.startsWith("assets/cesium/")) return true;

                    if (
                        p === "robots.txt" ||
                        p === "sitemap.xml" ||
                        p === "web.config"
                    ) {
                        return true;
                    }

                    return false;
                },
            },
        },

        devtool: isDev ? (developmentEnvironment.network ? "eval" : "eval-cheap-module-source-map") : false,

        module: {
            rules: [
                // Modern Chrome development needs no preset-env transformation.
                // Keep the production compatibility pipeline unchanged.
                ...(!isDev ? [{
                    test: /\.js$/i,
                    exclude: /node_modules/,
                    include: [path.join(DEV_DIR, "assets/js"), path.join(ROOT_DIR, "apps/shared")],
                    use: {
                        loader: "babel-loader",
                        options: {
                            presets: ["@babel/preset-env"],
                        },
                    },
                }] : []),
                {
                    test: /\.css$/i,
                    use: [
                        MiniCssExtractPlugin.loader,
                        {
                            loader: "css-loader",
                            options: {
                                url: false,
                                import: true,
                            },
                        },
                    ],
                },
            ],
        },

        plugins: [
            ...(isDev ? [{
                apply(compiler) {
                    compiler.hooks.compilation.tap("StratOpsStartupDiagnostics", (compilation) => {
                        HtmlWebpackPlugin.getHooks(compilation).alterAssetTagGroups.tap(
                            "StratOpsStartupDiagnostics",
                            (data) => {
                                if (data.outputName === "pages/index.html") {
                                    data.headTags.unshift({
                                        tagName: "script",
                                        voidTag: false,
                                        attributes: {},
                                        innerHTML: fs.readFileSync(STARTUP_DIAGNOSTICS_PATH, "utf8").replace(/^\uFEFF/, ""),
                                        meta: { plugin: "StratOpsStartupDiagnostics" },
                                    });
                                }
                                return data;
                            }
                        );
                    });
                    require("./scripts/webpack-startup-timing.cjs")(compiler);
                },
            }] : []),
            new webpack.DefinePlugin({
                CESIUM_BASE_URL: JSON.stringify("/assets/cesium"),
                CESIUM_ION_TOKEN: JSON.stringify(cesiumToken),
                STRATOPS_BASEMAP_PROVIDER: JSON.stringify(basemapProvider),
                STRATOPS_ENABLE_GOOGLE_MAP: JSON.stringify(enableGoogleMap),
                STRATOPS_ENABLE_TACTICAL_MAP: JSON.stringify(enableTacticalMap),
                STRATOPS_GOOGLE_MAPS_API_KEY: JSON.stringify(googleMapsApiKey),
                STRATOPS_TERRAIN_PROVIDER: JSON.stringify(["selfhosted", "none"].includes(terrainProvider) ? terrainProvider : "legacy"),
                STRATOPS_MAP_BASE_URL: JSON.stringify(mapBaseUrl),
                STRATOPS_TACTICAL_MAP_BASE_URL: JSON.stringify(tacticalMapBaseUrl),
                STRATOPS_TERRAIN_BASE_URL: JSON.stringify(terrainBaseUrl),
                STRATOPS_PERF_EMPTY_GLOBE: JSON.stringify(perfEmptyGlobe),
                __STRATOPS_DEV_TOOLS__: JSON.stringify(isDev),
            }),

            ...(!isDev
                ? [
                    new webpack.IgnorePlugin({
                        resourceRegExp: devOnlyModulePattern,
                        contextRegExp: /dev[\\/]assets[\\/]js$/,
                    }),
                ]
                : []),

            new MiniCssExtractPlugin({
                filename: (pathData) => {
                    const name = pathData.chunk?.name || "entry";

                    if (!isDev) return "assets/css/style.[contenthash:8].css";

                    return name === "main"
                        ? "assets/css/style.css"
                        : `assets/css/${name}.css`;
                },
            }),

            ...(!isDev ? [new CopyWebpackPlugin({
                patterns: [
                    {
                        from: path.resolve(ROOT_DIR, "node_modules/three/examples/jsm/libs/draco/gltf"),
                        to: path.resolve(PROD_DIR, "assets/three/draco"),
                        noErrorOnMissing: false,
                    },
                    {
                        from: path.resolve(ROOT_DIR, "node_modules/cesium/Build/Cesium"),
                        to: path.resolve(PROD_DIR, "assets/cesium"),
                        noErrorOnMissing: false,
                    },
                    {
                        // PDF.js worker.
                        // Rename .mjs -> .js so S3 serves it with a JavaScript MIME type.
                        from: path.resolve(
                            ROOT_DIR,
                            "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"
                        ),
                        to: path.resolve(
                            PROD_DIR,
                            "assets/pdfjs/pdf.worker.min.js"
                        ),
                        noErrorOnMissing: false,
                    },
                    {
                        // PDF.js viewer image resources.
                        from: path.resolve(
                            ROOT_DIR,
                            "node_modules/pdfjs-dist/web/images"
                        ),
                        to: path.resolve(
                            PROD_DIR,
                            "assets/pdfjs/images"
                        ),
                        noErrorOnMissing: false,
                    },
                    {
                        from: path.resolve(DEV_DIR, "public"),
                        to: PROD_DIR,
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(DEV_DIR, "partials"),
                        to: path.resolve(PROD_DIR, "partials"),
                        noErrorOnMissing: true,
                        globOptions: {
                            ignore: isDev
                                ? []
                                : ["**/dev-panel.html", "**/entry-scene-tuner.html"],
                        },
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/others"),
                        to: path.resolve(PROD_DIR, "assets/others"),
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/data"),
                        to: path.resolve(PROD_DIR, "assets/data"),
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/audio"),
                        to: path.resolve(PROD_DIR, "assets/audio"),
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/videos"),
                        to: path.resolve(PROD_DIR, "assets/videos"),
                        noErrorOnMissing: false,
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/images"),
                        to: path.resolve(PROD_DIR, "assets/images"),
                        noErrorOnMissing: true,
                    },
                    {
                        from: path.resolve(DEV_DIR, "assets/fonts"),
                        to: path.resolve(PROD_DIR, "assets/fonts"),
                        noErrorOnMissing: true,
                        globOptions: {
                            ignore: ["**/*.css", "**/*.json"],
                        },
                    },
                    {
                        from: path.resolve(ROOT_DIR, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
                        to: path.resolve(PROD_DIR, "assets/pdfjs/pdf.worker.min.mjs"),
                        noErrorOnMissing: false,
                    },
                    {
                        from: path.resolve(ROOT_DIR, "node_modules/pdfjs-dist/web/images"),
                        to: path.resolve(PROD_DIR, "assets/pdfjs/images"),
                        noErrorOnMissing: false,
                    },
                ],
            })] : []),

            new HtmlWebpackPlugin({
                filename: "pages/report-pdf-viewer.html",
                template: path.resolve(DEV_DIR, "pages/report-pdf-viewer.html"),
                cache: !isDev,
                inject: "head",
                chunks: ["reportPdfViewer"],
                scriptLoading: "defer",
            }),

            new HtmlWebpackPlugin({
                filename: "pages/poster.html",
                template: path.resolve(DEV_DIR, "pages/poster.html"),
                cache: !isDev,
                inject: "head",
                chunks: ["main"],
                scriptLoading: "defer",
            }),

            new HtmlWebpackPlugin({
                filename: "poster/index.html",
                template: path.resolve(DEV_DIR, "pages/poster.html"),
                cache: !isDev,
                inject: "head",
                chunks: ["main"],
                scriptLoading: "defer",
            }),

            ...pages.map((name) => {
                return new HtmlWebpackPlugin({
                    filename: `pages/${name}.html`,
                    template: path.resolve(DEV_DIR, "pages", `${name}.html`),
                    cache: !isDev,
                    inject: ["report", "404"].includes(name) ? false : "head",
                    chunks: ["report", "404"].includes(name)
                        ? []
                        : (name === "report-capture" ? ["reportCapture"] : ["main"]),
                    scriptLoading: "defer",
                    templateParameters: (compilation) => {
                        registerHtmlDependencies(compilation);

                        const SITE = loadFreshModule(SITE_PATH);
                        const pageMeta = loadFreshModule(PAGE_META_PATH);
                        const { buildJsonLd } = loadFreshModule(SCHEMA_PATH);

                        const m = pageMeta[name] || {};
                        const defaultOg = SITE.defaultOg || SITE.defaultOgImage || "/assets/images/web/warzone-og-preview.jpg";
                        const canonical = joinUrl(SITE.baseUrl, m.path || "/");
                        const robots =
                            m.robots ||
                            "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";

                        const ogCandidate = m.ogImage || defaultOg;
                        const ogImageAbs = String(ogCandidate).startsWith("http")
                            ? ogCandidate
                            : joinUrl(SITE.baseUrl, ensureSlashStart(ogCandidate));

                        const meta = {
                            title: m.title || "Warzone",
                            description: m.description || "",

                            canonical,
                            robots,
                            hreflang: canonical,

                            ogUrl: canonical,
                            ogTitle: m.title || "Warzone",
                            ogDescription: m.description || "",
                            ogImage: ogImageAbs,
                            ogAlt: m.ogAlt || "Warzone",

                            twTitle: m.title || "Warzone",
                            twDescription: m.description || "",
                            twImage: ogImageAbs,
                            twAlt: m.ogAlt || "Warzone",

                            preload: m.preload || [],
                            development: isDev,

                            jsonLd: buildJsonLd({
                                site: SITE,
                                page: m,
                                ogImageAbs,
                            }),
                        };

                        const preloadLinks = (meta.preload || [])
                            .map((p) => {
                                const href = p && p.href ? String(p.href) : "";
                                if (!href) return "";
                                const mediaAttr = p.media ? ` media="${String(p.media)}"` : "";
                                return `<link rel="preload" as="image" href="${href}"${mediaAttr} fetchpriority="high" />`;
                            })
                            .filter(Boolean)
                            .join("\n");

                        return {
                            meta,
                            partials,
                            preloadLinks,
                        };
                    },
                });
            }),
        ],

        optimization: {
            ...(isDev ? { moduleIds: "deterministic", chunkIds: "deterministic",
                usedExports: true,
                splitChunks: { chunks: "all", cacheGroups: {
                    // A fixed name merges lazy Viewer dependencies into the initial
                    // Cesium utility chunk. Preserve distinct dependency groups.
                    cesium: { test: /[\\/]node_modules[\\/](?:@cesium|cesium)[\\/]/, name: false, priority: 30, reuseExistingChunk: true },
                } } } : {}),
            minimize: !isDev,
            minimizer: isDev ? [] : [
                new TerserPlugin({
                    extractComments: false,
                }),
                new CssMinimizerPlugin(),
            ],
        },

        ...(isDev
            ? {
                devServer: {
                    port: 4173,
                    compress: true,
                    hot: true,
                    liveReload: true,
                    devMiddleware: { writeToDisk: false },
                    onListening() {
                        console.info("[dev-timing] server-listening=" + Math.round(process.uptime() * 1000) +
                            "ms process uptime (compilation readiness is logged separately)");
                    },

                    open: {
                        target: ["http://localhost:4173/"],
                        app: { name: "chrome" },
                    },

                    client: {
                        logging: "none",
                        overlay: true,
                    },

                    static: [
                        { directory: path.join(ROOT_DIR, "node_modules/cesium/Build/Cesium"), publicPath: "/assets/cesium", watch: false },
                        { directory: path.join(ROOT_DIR, "node_modules/three/examples/jsm/libs/draco/gltf"), publicPath: "/assets/three/draco", watch: false },
                        { directory: path.join(ROOT_DIR, "node_modules/pdfjs-dist/build"), publicPath: "/assets/pdfjs", watch: false },
                        { directory: path.join(ROOT_DIR, "node_modules/pdfjs-dist/web/images"), publicPath: "/assets/pdfjs/images", watch: false },
                        {
                            directory: path.resolve(ROOT_DIR, ".generated", "selfhosted", "output", "map", "tactical", "v1"),
                            publicPath: localTacticalMapBaseUrl,
                            watch: false,
                            serveIndex: false,
                        },
                        {
                            directory: path.resolve(DEV_DIR, "public"),
                            publicPath: "/",
                            watch: false,
                            serveIndex: false,
                        },
                        {
                            directory: path.resolve(DEV_DIR, "assets"),
                            publicPath: "/assets",
                            watch: false,
                        },
                        {
                            directory: path.resolve(DEV_DIR, "partials"),
                            publicPath: "/partials",
                            // Already watched by the HTML compilation's context dependency.
                            watch: false,
                        },
                        {
                            directory: path.resolve(PROD_DIR, "assets/cesium"),
                            publicPath: "/assets/cesium",
                            watch: false,
                        },
                    ],

                    setupMiddlewares: (middlewares, devServer) => {
                        if (!devServer) return middlewares;
                        devServer.app.get("/assets/pdfjs/pdf.worker.min.js", (_req, res) => {
                            res.type("application/javascript").sendFile(path.join(ROOT_DIR, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
                        });
                        const AIRCRAFT_FEED_URL = process.env.AIRCRAFT_FEED_URL || "https://api.adsb.lol/v2/mil";
                        const apiTargets = [...new Set([
                            process.env.API_UPSTREAM_URL,
                            "http://localhost:8080",
                            "http://localhost:3000",
                            "https://api.battlespacex.com",
                        ].filter(Boolean))];
                        const READ_TIMEOUT_MS = Math.max(1000, Number(process.env.STRATOPS_DEV_READ_TIMEOUT_MS) || 8000);
                        const preferredReadTargets = new Map();
                        let cachedPayload = "";
                        let cachedAt = 0;
                        let inFlightPromise = null;
                        const CACHE_TTL_MS = 2500;
                        const CACHE_STALE_IF_ERROR_MS = 5 * 60 * 1000;
                        let lastLoggedFailureStatus = 0;

                        async function handleAircraftFeedProxy(_req, res) {
                            const now = Date.now();
                            if (cachedPayload && (now - cachedAt) < CACHE_TTL_MS) {
                                res.set("Cache-Control", "no-store, max-age=0");
                                res.type("application/json").send(cachedPayload);
                                return;
                            }
                            if (!inFlightPromise) {
                                inFlightPromise = fetch(AIRCRAFT_FEED_URL, {
                                    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
                                    headers: {
                                        Accept: "application/json",
                                        "User-Agent": "stratops-warzone-dev/1.0",
                                        "Cache-Control": "no-store",
                                    },
                                })
                                    .then(async (response) => {
                                        const payload = await response.text();
                                        if (response.ok && payload) {
                                            cachedPayload = payload;
                                            cachedAt = Date.now();
                                            lastLoggedFailureStatus = 0;
                                        } else if (lastLoggedFailureStatus !== response.status) {
                                            lastLoggedFailureStatus = response.status;
                                            const responseSummary = String(payload || "")
                                                .replace(/\s+/g, " ")
                                                .trim()
                                                .slice(0, 240);
                                            console.warn(
                                                `[aircraft-feed] upstream status=${response.status}` +
                                                (responseSummary ? ` body=${responseSummary}` : "")
                                            );
                                        }
                                        return {
                                            ok: response.ok,
                                            status: response.status,
                                            payload,
                                            retryAfter: response.headers.get("retry-after") || "",
                                        };
                                    })
                                    .finally(() => {
                                        inFlightPromise = null;
                                    });
                            }
                            try {
                                const result = await inFlightPromise;
                                if (result?.ok && result.payload) {
                                    res.set("Cache-Control", "no-store, max-age=0");
                                    res.type("application/json").send(result.payload);
                                    return;
                                }
                                if (cachedPayload && (Date.now() - cachedAt) < CACHE_STALE_IF_ERROR_MS) {
                                    res.set("Cache-Control", "no-store, max-age=0");
                                    res.set("X-Warzone-Cache", "stale-if-error");
                                    res.type("application/json").send(cachedPayload);
                                    return;
                                }
                                const upstreamStatus = Number(result?.status || 0);
                                res.set("Cache-Control", "no-store, max-age=0");
                                res.set("X-Warzone-Upstream-Status", String(upstreamStatus));
                                res.set("Retry-After", result?.retryAfter || (upstreamStatus === 401 || upstreamStatus === 403 ? "30" : "5"));
                                res.status(503).json({ error: "Aircraft feed temporarily unavailable" });
                            } catch {
                                if (cachedPayload && (Date.now() - cachedAt) < CACHE_STALE_IF_ERROR_MS) {
                                    res.set("Cache-Control", "no-store, max-age=0");
                                    res.set("X-Warzone-Cache", "stale-if-error");
                                    res.type("application/json").send(cachedPayload);
                                    return;
                                }
                                res.set("Cache-Control", "no-store, max-age=0");
                                res.set("X-Warzone-Upstream-Status", "0");
                                res.set("Retry-After", "5");
                                res.status(502).json({ error: "Aircraft feed unavailable" });
                            }
                        }

                        async function handleTerrariumTileProxy(req, res) {
                            const z = Math.max(0, Math.min(15, Number.parseInt(req.params.z, 10)));
                            const x = Math.max(0, Number.parseInt(req.params.x, 10));
                            const y = Math.max(0, Number.parseInt(req.params.y, 10));
                            if (![z, x, y].every(Number.isFinite)) {
                                res.status(400).json({ error: "Invalid terrain tile" });
                                return;
                            }
                            try {
                                const upstream = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
                                const response = await fetch(upstream, {
                                    headers: {
                                        Accept: "image/png,image/*;q=0.8",
                                        "User-Agent": "stratops-warzone-terrain-dev/1.0",
                                    },
                                });
                                if (!response.ok) {
                                    res.status(response.status).json({ error: "Terrain tile unavailable" });
                                    return;
                                }
                                const arrayBuffer = await response.arrayBuffer();
                                res.set("Cache-Control", "public, max-age=86400, immutable");
                                res.type("image/png").send(Buffer.from(arrayBuffer));
                            } catch {
                                res.status(502).json({ error: "Terrain tile proxy unavailable" });
                            }
                        }

                        async function readRequestBody(req) {
                            if (req.method === "GET" || req.method === "HEAD") {
                                return null;
                            }
                            const chunks = [];
                            for await (const chunk of req) {
                                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                            }
                            return chunks.length ? Buffer.concat(chunks) : null;
                        }

                        async function handleApiProxy(req, res) {
                            const upstreamPath = req.originalUrl.replace(/^\/api/, "") || "/";
                            const bodyBuffer = await readRequestBody(req);
                            let lastPayload = "";
                            let lastStatus = 502;
                            let lastType = "application/json";

                            const readOnly = req.method === "GET" || req.method === "HEAD";
                            const routeKey = upstreamPath.split("?")[0];
                            const preferred = preferredReadTargets.get(routeKey);
                            const preferredReadTarget = preferred?.until > Date.now() ? preferred.target : null;
                            const targets = readOnly && preferredReadTarget
                                ? [preferredReadTarget, ...apiTargets.filter((target) => target !== preferredReadTarget)] : apiTargets;
                            for (const target of targets) {
                                if (res.destroyed) return;
                                const controller = readOnly ? new AbortController() : null;
                                const disconnect = () => controller?.abort();
                                // Report/PDF downloads may legitimately outlive a metadata read.
                                const deadline = readOnly && !upstreamPath.startsWith("/stratops/reports")
                                    ? setTimeout(() => controller.abort(), READ_TIMEOUT_MS) : null;
                                if (controller) res.once("close", disconnect);
                                try {
                                    const upstream = new URL(upstreamPath, target);
                                    const headers = {
                                        Accept: req.get("accept") || "application/json",
                                        "User-Agent": "stratops-warzone-dev/1.0",
                                        "X-Forwarded-Host": req.get("host") || "",
                                        "X-Forwarded-Proto": req.protocol || "http",
                                        "X-Forwarded-Prefix": "/api",
                                    };
                                    const range = req.get("range");
                                    if (range) headers.Range = range;
                                    if (upstream.pathname.startsWith("/stratops/reports/internal/capture/")) {
                                        const captureAuthorization = req.get("authorization");
                                        if (captureAuthorization) headers.Authorization = captureAuthorization;
                                    }
                                    const contentType = req.get("content-type");
                                    if (contentType) {
                                        headers["Content-Type"] = contentType;
                                    }
                                    const response = await fetch(upstream, {
                                        method: req.method,
                                        signal: controller?.signal,
                                        headers,
                                        body: bodyBuffer,
                                    });
                                    const responseType = response.headers.get("content-type") || "application/json";
                                    const isPdfResponse = /\bapplication\/pdf\b/i.test(responseType);
                                    const payload = isPdfResponse
                                        ? Buffer.from(await response.arrayBuffer())
                                        : await response.text();
                                    lastPayload = payload;
                                    lastStatus = response.status;
                                    lastType = responseType;
                                    const isJsonResponse = /\bjson\b/i.test(lastType);
                                    const isWorkerHealthText =
                                        !isJsonResponse &&
                                        /warzone worker running/i.test(String(payload || ""));
                                    if (isWorkerHealthText) {
                                        continue;
                                    }
                                    if (response.status === 404 && !(isJsonResponse && upstream.pathname === "/events/aircraft/lookup")) {
                                        continue;
                                    }
                                    const shouldReturnResponse = response.ok || response.status !== 404 || isJsonResponse;
                                    if (shouldReturnResponse) {
                                        if (readOnly && response.ok && preferredReadTarget !== target) {
                                            if (preferredReadTargets.size >= 128 && !preferredReadTargets.has(routeKey)) {
                                                preferredReadTargets.delete(preferredReadTargets.keys().next().value);
                                            }
                                            // Reprobe periodically so a newly started local API can take over.
                                            preferredReadTargets.set(routeKey, { target, until: Date.now() + 30000 });
                                        }
                                        res.status(response.status);
                                        res.set("Cache-Control", "no-store, max-age=0");
                                        res.set("Content-Type", lastType);
                                        if (isPdfResponse) {
                                            [
                                                "content-disposition",
                                                "content-range",
                                                "accept-ranges",
                                                "content-security-policy",
                                                "x-frame-options",
                                                "cross-origin-resource-policy",
                                                "x-content-type-options",
                                            ].forEach((header) => {
                                                const value = response.headers.get(header);
                                                if (value) res.set(header, value);
                                            });
                                        }
                                        if (req.method === "HEAD") {
                                            res.end();
                                            return;
                                        }
                                        res.send(payload);
                                        return;
                                    }
                                } catch {
                                    if (res.destroyed) return;
                                    // try next target
                                } finally {
                                    if (deadline) clearTimeout(deadline);
                                    if (controller) res.removeListener("close", disconnect);
                                }
                            }

                            res.status(lastStatus || 502);
                            res.set("Cache-Control", "no-store, max-age=0");
                            res.type(lastType).send(lastPayload || JSON.stringify({ error: "API unavailable" }));
                        }

                        middlewares.unshift(
                            {
                                name: "generated-report-preview",
                                path: "/generated-reports",
                                middleware: createGeneratedReportPreviewRouter({ root: GENERATED_REPORT_DIR }),
                            },
                            {
                                name: "warzone-generated-report-preview",
                                path: "/warzone/generated-reports",
                                middleware: createGeneratedReportPreviewRouter({ root: GENERATED_REPORT_DIR }),
                            },
                        );
                        devServer.app.get("/__warzone/aircraft-feed/mil", handleAircraftFeedProxy);
                        devServer.app.get("/warzone/aircraft-feed/mil", handleAircraftFeedProxy);
                        devServer.app.get("/__warzone/terrain/terrarium/:z/:x/:y.png", handleTerrariumTileProxy);
                        devServer.app.get("/warzone/terrain/terrarium/:z/:x/:y.png", handleTerrariumTileProxy);
                        devServer.app.use((req, res, next) => {
                            if (/^\/poster(?:\/|$)/.test(req.path)) {
                                res.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
                                res.set("Cache-Control", "no-store, max-age=0");
                            }
                            next();
                        });
                        devServer.app.get(["/", "/warzone", "/warzone/"], (_req, res) => {
                            res.redirect(302, "/pages/index.html");
                        });
                        devServer.app.get(["/report-capture", "/warzone/report-capture"], (req, res) => {
                            const query = req.originalUrl.includes("?")
                                ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
                                : "";
                            res.redirect(302, `/pages/report-capture.html${query}`);
                        });
                        devServer.app.get("/reports/:slug", (req, res) => {
                            const slug = encodeURIComponent(String(req.params.slug || "").trim());
                            if (!slug) {
                                res.redirect(302, "/pages/404.html");
                                return;
                            }
                            res.sendFile(path.resolve(PROD_DIR, "pages/report.html"));
                        });
                        devServer.app.get("/warzone/reports/:slug", (req, res) => {
                            const slug = encodeURIComponent(String(req.params.slug || "").trim());
                            if (!slug) {
                                res.redirect(302, "/pages/404.html");
                                return;
                            }
                            res.sendFile(path.resolve(PROD_DIR, "pages/report.html"));
                        });
                        devServer.app.all("/api/*", handleApiProxy);

                        return middlewares;
                    },

                    // Compiled JS/CSS/templates belong to Watchpack, not Chokidar.
                    // Watch only unbundled editable assets; prune model subtrees.
                    watchFiles: {
                        paths: [path.resolve(DEV_DIR, "public"), path.resolve(DEV_DIR, "assets/images")],
                        options: { ...developmentEnvironment.staticWatchOptions, ignored: watchIgnored },
                    },
                    historyApiFallback: {
                        rewrites: [
                            // Missing chunks/assets must be real 404s, never HTML fallback pages.
                            { from: /^\/assets\//, to: (context) => context.parsedUrl.pathname },
                            { from: /^\/(?:warzone\/?)?$/, to: "/pages/index.html" },
                            { from: /^\/poster\/?$/, to: "/pages/poster.html" },
                            { from: /^\/404\/?$/, to: "/pages/404.html" },
                            { from: /^\/(?:warzone\/)?reports\/[^/]+\/?$/, to: "/pages/report.html" },
                            { from: /^\/(?:warzone\/)?report-capture\/?$/, to: "/pages/report-capture.html" },
                            { from: /./, to: "/pages/404.html" },
                        ],
                    },
                },
            }
            : {}),

        performance: {
            hints: false,
        },
    };
};
