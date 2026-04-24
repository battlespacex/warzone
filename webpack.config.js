// webpack.config.js
const fs = require("fs");
const path = require("path");
const webpack = require("webpack");
const dotenv = require("dotenv");

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
    const SEO_DIR = path.resolve(ROOT_DIR, "seo");
    const PARTIALS_DIR = path.resolve(DEV_DIR, "partials");
    const SITE_PATH = path.resolve(SEO_DIR, "site.js");
    const PAGE_META_PATH = path.resolve(SEO_DIR, "pages.js");
    const SCHEMA_PATH = path.resolve(SEO_DIR, "schema.js");

    const pages = ["index", "404"];

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

        entry: path.resolve(DEV_DIR, "assets/js/index.js"),

        output: {
            path: PROD_DIR,
            filename: isDev ? "assets/js/bundle.js" : "assets/js/bundle.[contenthash:8].js",
            publicPath: "/",
            clean: {
                keep: (assetPath) => {
                    const p = assetPath.replace(/\\/g, "/").toLowerCase();

                    if (p.startsWith("assets/images/")) return true;
                    if (p.startsWith("assets/fonts/")) return true;
                    if (p.startsWith("assets/mp3/")) return true;
                    if (p.startsWith("assets/audio/")) return true;
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
                filename: isDev ? "assets/css/style.css" : "assets/css/style.[contenthash:8].css",
            }),

            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: path.resolve(ROOT_DIR, "node_modules/cesium/Build/Cesium"),
                        to: path.resolve(PROD_DIR, "assets/cesium"),
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
                ],
            }),

            ...pages.map((name) => {
                return new HtmlWebpackPlugin({
                    filename: `pages/${name}.html`,
                    template: path.resolve(DEV_DIR, "pages", `${name}.html`),
                    cache: !isDev,
                    inject: "head",
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
                        const AIRCRAFT_FEED_URL = "https://api.adsb.one/v2/mil";
                        let cachedPayload = "";
                        let cachedStatus = 0;
                        let cachedAt = 0;
                        let inFlightPromise = null;
                        const CACHE_TTL_MS = 2500;

                        devServer.app.get("/__warzone/aircraft-feed/mil", async (_req, res) => {
                            const now = Date.now();
                            if (cachedPayload && cachedStatus === 200 && (now - cachedAt) < CACHE_TTL_MS) {
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
                                        cachedStatus = Number(response.status || 0);
                                        if (response.ok && payload) {
                                            cachedPayload = payload;
                                            cachedAt = Date.now();
                                        }
                                        return { ok: response.ok, status: response.status, payload };
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
                                if (cachedPayload && cachedStatus === 200) {
                                    res.set("Cache-Control", "no-store, max-age=0");
                                    res.type("application/json").send(cachedPayload);
                                    return;
                                }
                                res.status(result?.status || 502).json({ error: "Aircraft feed unavailable" });
                            } catch {
                                if (cachedPayload && cachedStatus === 200) {
                                    res.set("Cache-Control", "no-store, max-age=0");
                                    res.type("application/json").send(cachedPayload);
                                    return;
                                }
                                res.status(502).json({ error: "Aircraft feed unavailable" });
                            }
                        });

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
                            { from: /^\/$/, to: "/pages/index.html" },
                            { from: /^\/404\/?$/, to: "/pages/404.html" },
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
