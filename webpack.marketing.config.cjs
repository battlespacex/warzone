const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const domains = require('./apps/shared/stratops-domains.json');
module.exports = (_env = {}, argv = {}) => {
    const isDev = argv.mode === 'development';
    const environment = isDev ? require('./scripts/dev-environment.cjs').getDevelopmentEnvironment(__dirname) : null;
    return {
    mode: isDev ? 'development' : 'production',
    entry: path.resolve(__dirname, 'dev/marketing/site.js'),
    output: { path: path.resolve(__dirname, 'public-site'), filename: isDev ? 'assets/site.js' : 'assets/site.[contenthash:8].js', publicPath: '/', clean: true },
    ...(isDev ? { watchOptions: environment.watchOptions } : {}),
    module: { rules: [{ test: /\.css$/, use: [isDev ? 'style-loader' : MiniCssExtractPlugin.loader, {loader:'css-loader',options:{url:false}}] }] },
    optimization: { minimizer: ['...', new CssMinimizerPlugin({ parallel: false })] },
    plugins: [
        ...(!isDev ? [new MiniCssExtractPlugin({ filename: 'assets/site.[contenthash:8].css' })] : []),
        new HtmlWebpackPlugin({ template: 'dev/marketing/index.html', templateParameters: compilation => ({
            domains: compilation.options.mode === 'development'
                ? { ...domains, portalOrigin: 'http://localhost:4173' }
                : domains
        }), filename: 'index.html' }),
        new HtmlWebpackPlugin({ templateContent: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Page not found | StratOps</title><body style="background:#080b0e;color:#fff;font:1.2rem system-ui;padding:10vw"><h1>Page not found.</h1><a style="color:#18e2db" href="/">Return to StratOps</a></body></html>',filename:'404.html',inject:false }),
        new CopyPlugin({ patterns: [
            { from: 'dev/assets/videos/stratops-startup-v1.mp4', to: 'assets/stratops-startup-v1.mp4' },
            { from: 'dev/assets/images/web/stratops-og-preview.jpg', to: 'assets/stratops-og-preview.jpg' },
            { from: 'dev/assets/fonts/Chakra_Petch/ChakraPetch-SemiBold.ttf', to: 'assets/chakra-semibold.ttf' },
            { from: 'dev/assets/fonts/Chakra_Petch/OFL.txt', to: 'assets/chakra-OFL.txt' },
            { from: 'dev/assets/Branding/StratOps-Branding/stratops-full-logo.svg', to: 'assets/stratops.svg' },
            { from: 'dev/assets/Branding/Battlespacex-Branding/battlespacex-full-logo.svg', to: 'assets/battlespacex.svg' },
            { from: 'dev/marketing/robots.txt', to: 'robots.txt' },
            { from: 'dev/marketing/sitemap.xml', to: 'sitemap.xml' }
        ] })
    ],
    // Keep the public dev site separate from the existing operational server on 4173.
    devServer: {
        port: 4174, open: { target: ['/'] }, static: false, historyApiFallback: false,
        hot: true, liveReload: true, headers: { 'Cache-Control': 'no-store' },
        client: { overlay: { errors: true, warnings: false, runtimeErrors: true } }
    },
    performance: { hints: 'warning' },
    devtool: false
    };
};
