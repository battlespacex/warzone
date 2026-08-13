// webpack.config.js
const fs = require("fs");
const path = require("path");
const express = require("express");
const webpack = require("webpack");
const dotenv = require("dotenv");
const { createGeneratedReportPreviewRouter } = require("./server/generated-report-preview");

const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
    const isDev = argv.mode === "development";

    // Load .env.local for dev, .env.production for prod
    const envFile = isDev ? ".env.local" : ".env.production";
    const envPath = path.resolve(__dirname, envFile);
    const envVars = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
    const cesiumToken = envVars.CESIUM_ION_TOKEN || "";

    const ROOT_DIR = __dirname;
    const PROD_DIR = path.resolve(ROOT_DIR, "production");
    const DEV_DIR = path.resolve(ROOT_DIR, "dev");
    const GENERATED_REPORT_DIR = path.resolve(ROOT_DIR, ".generated", "reports");
    const SEO_DIR = path.resolve(ROOT_DIR, "seo");
    const PARTIALS_DIR = path.resolve(DEV_DIR, "partials");
    const SITE_PATH = path.resolve(SEO_DIR, "site.js");
    const PAGE_META_PATH = path.resolve(SEO_DIR, "pages.js");
    const SCHEMA_PATH = path.resolve(SEO_DIR, "schema.js");

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
    };

    return {
        mode: isDev ? "development" : "production",

        entry: {
            main: path.resolve(DEV_DIR, "assets/js/index.js"),
            poster: path.resolve(DEV_DIR, "assets/js/poster-generator.js"),
            reportCapture: path.resolve(DEV_DIR, "assets/js/report-capture.js"),
            reportPdfViewer: path.resolve(DEV_DIR, "assets/js/report-pdf-viewer.js"),
        },

        output: {
            path: PROD_DIR,
            filename: (pathData) => {
                const name = pathData.chunk?.name || "main";
                if (name === "main") {
                    return isDev ? "assets/js/bundle.js" : "assets/js/bundle.[contenthash:8].js";
                }
                return isDev ? `assets/js/${name}.js` : `assets/js/${name}.[contenthash:8].js`;
            },
            chunkFilename: isDev ? "assets/js/[id].bundle.js" : "assets/js/[id].bundle.[contenthash:8].js",
            publicPath: "/",
            clean: {
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

        devtool: false,

        module: {
            rules: [
                {
                    test: /\.js$/i,
                    exclude: /node_modules/,
                    use: {
                        loader: "babel-loader",
                        options: {
                            presets: ["@babel/preset-env"],
                        },
                    },
                },
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
            new webpack.DefinePlugin({
                CESIUM_BASE_URL: JSON.stringify("/assets/cesium"),
                CESIUM_ION_TOKEN: JSON.stringify(cesiumToken),
            }),

            new MiniCssExtractPlugin({
                filename: (pathData) => {
                    if (!isDev) return "assets/css/style.[contenthash:8].css";
                    return pathData.chunk?.name === "main"
                        ? "assets/css/style.css"
                        : `assets/css/${pathData.chunk?.name || "entry"}.css`;
                },
            }),

            new CopyWebpackPlugin({
                patterns: [
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
            }),

            new HtmlWebpackPlugin({
                filename: "pages/report-pdf-viewer.html",
                template: path.resolve(DEV_DIR, "pages/report-pdf-viewer.html"),
                cache: !isDev,
                inject: "head",
                chunks: ["reportPdfViewer"],
                scriptLoading: "defer",
            }),

            new HtmlWebpackPlugin({
                filename: "poster/index.html",
                template: path.resolve(DEV_DIR, "pages/poster.html"),
                cache: !isDev,
                inject: "head",
                chunks: ["poster"],
                scriptLoading: "defer",
            }),

            ...pages.map((name) => {
                return new HtmlWebpackPlugin({
                    filename: `pages/${name}.html`,
                    template: path.resolve(DEV_DIR, "pages", `${name}.html`),
                    cache: !isDev,
                    inject: name === "report" ? false : "head",
                    chunks: name === "report"
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
            minimize: !isDev,
            minimizer: [
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

                    open: {
                        target: ["http://localhost:4173/"],
                        app: { name: "chrome" },
                    },

                    client: {
                        logging: "none",
                        overlay: true,
                    },

                    static: [
                        {
                            directory: path.resolve(DEV_DIR, "public"),
                            publicPath: "/",
                            watch: true,
                            serveIndex: false,
                        },
                        {
                            directory: path.resolve(DEV_DIR, "assets"),
                            publicPath: "/assets",
                            watch: true,
                        },
                        {
                            directory: path.resolve(DEV_DIR, "partials"),
                            publicPath: "/partials",
                            watch: true,
                        },
                        {
                            directory: path.resolve(PROD_DIR, "assets/cesium"),
                            publicPath: "/assets/cesium",
                            watch: false,
                        },
                    ],

                    setupMiddlewares: (middlewares, devServer) => {
                        if (!devServer) return middlewares;
                        const AIRCRAFT_FEED_URL = process.env.AIRCRAFT_FEED_URL || "https://api.adsb.lol/v2/mil";
                        const apiTargets = [
                            "http://localhost:8080",
                            "http://localhost:3000",
                            process.env.API_UPSTREAM_URL,
                            "https://api.battlespacex.com",
                        ].filter(Boolean);
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

                            for (const target of apiTargets) {
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
                                    if (response.status === 404) {
                                        continue;
                                    }
                                    const shouldReturnResponse = response.ok || response.status !== 404 || isJsonResponse;
                                    if (shouldReturnResponse) {
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
                                    // try next target
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

                    watchFiles: {
                        paths: [
                            path.resolve(DEV_DIR, "pages/**/*.html"),
                            path.resolve(DEV_DIR, "partials/**/*.html"),
                            path.resolve(DEV_DIR, "assets/css/**/*.css"),
                            path.resolve(DEV_DIR, "assets/js/**/*.js"),
                            path.resolve(DEV_DIR, "assets/images/**/*"),
                            path.resolve(DEV_DIR, "assets/audio/**/*"),
                            path.resolve(DEV_DIR, "assets/others/**/*"),
                            path.resolve(DEV_DIR, "public/**/*"),
                            path.resolve(ROOT_DIR, "seo/**/*.js"),
                        ],
                        options: {
                            usePolling: true,
                            interval: 250,
                            ignored: /node_modules/,
                        },
                    },

                    historyApiFallback: {
                        rewrites: [
                            { from: /^\/(?:warzone\/?)?$/, to: "/pages/index.html" },
                            { from: /^\/poster\/?$/, to: "/poster/index.html" },
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
