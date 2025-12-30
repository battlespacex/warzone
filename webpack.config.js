// webpack.config.js
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (env, argv) => {
    const isDev = argv.mode === "development";

    return {
        mode: isDev ? "development" : "production",

        entry: "./assets/scripts/index.js",

        output: {
            filename: "bundle.min.js",
            path: path.resolve(__dirname, "dist"),
            publicPath: "/dist/",
            clean: true,
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
                            options: { url: false },
                        },
                    ],
                },
            ],
        },

        plugins: [
            new MiniCssExtractPlugin({
                filename: "style.min.css",
            }),
        ],

        optimization: {
            minimize: !isDev,
            minimizer: [
                new TerserPlugin({ extractComments: false }),
                new CssMinimizerPlugin(),
            ],
        },

        // ONLY attach devServer in dev
        ...(isDev
            ? {
                devServer: {
                    open: {
                        target: ["http://localhost:4173/"],
                        app: { name: "chrome" },
                    },
                    static: {
                        directory: path.join(__dirname),
                        publicPath: "/",
                    },
                    historyApiFallback: {
                        rewrites: [
                            { from: /^\/about$/, to: "/about.html" },
                            { from: /^\/gear$/, to: "/gear.html" },
                            { from: /^\/contact$/, to: "/contact.html" },
                        ],
                    },
                    // IMPORTANT: don't write dev output to disk
                    devMiddleware: {
                        writeToDisk: false,
                    },
                    port: 4173,
                    hot: false,
                    compress: true,
                    client: {
                        overlay: true,
                    },
                    watchFiles: [
                        "index.html",
                        "about.html",
                        "gear.html",
                        "contact.html",
                        "assets/**/*.css",
                        "assets/**/*.js",
                        "assets/images/**/*",
                    ],
                },
            }
            : {}),

        performance: { hints: false },
    };
};
