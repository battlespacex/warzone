// webpack.config.js
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
    const isDev = argv.mode === "development";

    const PROD_DIR = path.resolve(__dirname, "production");
    const DEV_DIR = path.resolve(__dirname, "dev");

    const pages = ["index", "contact", "404"];

    return {
        mode: isDev ? "development" : "production",

        entry: path.resolve(DEV_DIR, "assets/scripts/index.js"),

        output: {
            path: PROD_DIR,

            // ✅ NO build/ folder. Bundles go directly into production/assets
            filename: isDev
                ? "assets/bundle.js"
                : "assets/bundle.[contenthash:8].js",

            publicPath: "/",

            // ✅ Clean old bundles, but NEVER delete images/mp3/fonts
            // This also removes old leftover bundles like assets/bundle.*.js and assets/style.*.css
            clean: {
                keep: (assetPath) => {
                    // normalize for Windows + case
                    const p = assetPath.replace(/\\/g, "/").toLowerCase();

                    // keep your static folders
                    if (p.startsWith("assets/images/")) return true;
                    if (p.startsWith("assets/mp3/")) return true;   // (even if unused)
                    if (p.startsWith("assets/fonts/")) return true;

                    // ✅ keep mp3 directly inside /assets (your exact use-case)
                    // e.g. assets/aerocism-aud.mp3
                    if (p === "assets/aerocism-aud.mp3") return true;

                    // OR if you want to protect ANY mp3 in assets root:
                    // if (p.startsWith("assets/") && p.endsWith(".mp3") && !p.includes("/")) return true;

                    // keep root public files copied by CopyWebpackPlugin
                    if (
                        p === "robots.txt" ||
                        p === "sitemap.xml" ||
                        p === "web.config" ||
                        p === "favicon.ico"
                    ) return true;

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
                        options: { presets: ["@babel/preset-env"] },
                    },
                },
                {
                    test: /\.css$/i,
                    use: [
                        MiniCssExtractPlugin.loader,
                        {
                            loader: "css-loader",
                            options: {
                                // ✅ you use absolute URLs like /assets/fonts/.. and /assets/images/..
                                // keep them as-is
                                url: false,
                                import: true,
                            },
                        },
                    ],
                },
            ],
        },

        plugins: [
            new MiniCssExtractPlugin({
                // ✅ NO build/ folder. CSS goes directly into production/assets
                filename: isDev
                    ? "assets/style.css"
                    : "assets/style.[contenthash:8].css",
            }),

            // ✅ IMPORTANT:
            // HtmlWebpackPlugin will inject the correct hashed filenames into each HTML output.
            // Make sure your dev/*.html templates DO NOT hardcode /assets/bundle.js or /assets/style.css.
            ...pages.map((name) => {
                return new HtmlWebpackPlugin({
                    filename: `${name}.html`,
                    template: path.resolve(DEV_DIR, `${name}.html`),
                    inject: "body",
                    scriptLoading: "defer",

                    // Helps ensure the <link> tag is injected too (even if template head is custom)
                    // If your template has a </head>, it will place CSS link inside it.
                    // JS will go before </body> because inject:"body".
                });
            }),

            new CopyWebpackPlugin({
                patterns: [
                    // ✅ root deploy files (robots.txt, sitemap.xml, favicon, web.config, etc.)
                    {
                        from: path.resolve(DEV_DIR, "public"),
                        to: PROD_DIR,
                        noErrorOnMissing: true,
                    },

                    // ✅ copy ONLY font files into production/assets/fonts
                    // (do NOT copy dev/assets/fonts/style.css or selection.json)
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
        ],

        optimization: {
            minimize: !isDev,
            minimizer: [
                new TerserPlugin({ extractComments: false }),
                new CssMinimizerPlugin(),
            ],
        },

        ...(isDev
            ? {
                devServer: {
                    port: 4173,
                    compress: true,
                    hot: false,
                    open: true,

                    // ✅ Serve production folder (real deploy structure)
                    static: [
                        {
                            directory: PROD_DIR,
                            publicPath: "/",
                            watch: true,
                        },
                    ],

                    // Clean URLs
                    historyApiFallback: {
                        rewrites: [
                            { from: /^\/$/, to: "/index.html" },
                            { from: /^\/contact\/?$/, to: "/contact.html" },
                            { from: /^\/404\/?$/, to: "/404.html" },
                            { from: /./, to: "/404.html" },
                        ],
                    },

                },
            }
            : {}),

        performance: { hints: false },
    };
};
