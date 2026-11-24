const path = require('node:path');
const fs = require('node:fs');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const domains = require('./apps/shared/stratops-domains.json');
const contactSettings = require('./dev/marketing/config/contact.json');

// Marketing output is always separate from the operational app's production/ directory.
// Both builds reuse dev/assets/fonts/stratops without modifying that source directory.
module.exports = (_env = {}, argv = {}) => {
  const root = __dirname;
  const isDev = argv.mode === 'development';
  const environment = isDev ? require('./scripts/dev-environment.cjs').getDevelopmentEnvironment(root) : null;
  const siteRoot = path.join(root, 'dev/marketing');
  const output = path.join(root, 'public-site');
  const portalDomains = isDev ? { ...domains, portalOrigin: 'http://localhost:4173' } : domains;
  const configuredContact = (process.env.STRATOPS_CONTACT_API_URL || contactSettings.contactApiBaseUrl || '').trim().replace(/\/+$/, '');
  if (configuredContact && !/^https:\/\/[\w.-]+(?::\d+)?(?:\/[\w/-]*)?$/.test(configuredContact) &&
    !(isDev && /^http:\/\/localhost:\d+$/.test(configuredContact))) {
    throw new Error('STRATOPS_CONTACT_API_URL must be a public HTTPS API base URL (localhost HTTP is allowed for dev only).');
  }
  const partials = (name, page) => {
    if (!['header', 'footer', 'icons'].includes(name)) throw new Error('Unknown marketing partial: ' + name);
    const raw = fs.readFileSync(path.join(siteRoot, 'partials', name + '.html'), 'utf8');
    return raw
      .replace(/{{PORTAL_ORIGIN}}/g, portalDomains.portalOrigin)
      .replace(/{{HOME_PREFIX}}/g, page === 'index' ? '' : '/')
      .replace(/{{DOMAIN_LINK_(\w+)}}/g, (_, domain) => page === 'index' ? '#domains' : '/capabilities/#' + domain)
      .replace(/{{NAV_(HOME|ADVANTAGE|CAPABILITIES|INTELLIGENCE|ABOUT|PARTNERS|CONTACT)}}/g,
        (_, section) => (page === (section === 'HOME' ? 'index' : section.toLowerCase()) ? 'aria-current="page"' : ''));
  };
  const buildPage = (name) => new HtmlWebpackPlugin({
    template: path.join(siteRoot, 'pages', name + '.html'),
    filename: 'pages/' + name + '.html',
    inject: 'body',
    scriptLoading: 'defer',
    templateParameters: () => ({ domains: portalDomains, pageName: name, partials: part => partials(part, name) })
  });
  return {
    mode: isDev ? 'development' : 'production',
    entry: path.join(siteRoot, 'assets/js/site.js'),
    output: { path: output, filename: isDev ? 'assets/site.js' : 'assets/site.[contenthash:8].js', publicPath: '/', clean: true },
    ...(isDev ? { watchOptions: environment.watchOptions } : {}),
    module: { rules: [{ test: /\.css$/i, use: [isDev ? 'style-loader' : MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { url: false, import: true } }] }] },
    optimization: { minimizer: ['...', new CssMinimizerPlugin({ parallel: false })] },
    plugins: [
      new webpack.DefinePlugin({ STRATOPS_CONTACT_API_BASE: JSON.stringify(configuredContact) }),
      ...(!isDev ? [new MiniCssExtractPlugin({ filename: 'assets/site.[contenthash:8].css' })] : []),
      ...['index', 'advantage', 'capabilities', 'intelligence', 'about', 'partners', 'contact'].map(buildPage),
      new HtmlWebpackPlugin({ template: path.join(siteRoot, 'pages/404.html'), filename: 'pages/404.html', inject: false }),
      new CopyPlugin({
        patterns: [
          { from: 'dev/assets/videos/stratops-startup-v1.mp4', to: 'assets/stratops-startup-v1.mp4' },
          { from: 'dev/assets/images/web/stratops-og-preview.jpg', to: 'assets/stratops-og-preview.jpg' },
          { from: 'dev/assets/fonts/Chakra_Petch/ChakraPetch-SemiBold.ttf', to: 'assets/chakra-semibold.ttf' },
          { from: 'dev/assets/fonts/Chakra_Petch/OFL.txt', to: 'assets/chakra-OFL.txt' },
          { from: 'dev/assets/fonts/stratops', to: 'assets/fonts/stratops', globOptions: { ignore: ['**/*.json'] } },
          { from: 'dev/assets/Branding/StratOps-Branding/stratops-full-logo.svg', to: 'assets/stratops.svg' },
          { from: 'dev/assets/Branding/Battlespacex-Branding/battlespacex-full-logo.svg', to: 'assets/battlespacex.svg' },
          // Existing marketing homepage footer references this shared logo.
          { from: 'dev/assets/images/web/Battlespacex-full-logo.svg', to: 'assets/images/web/Battlespacex-full-logo.svg', noErrorOnMissing: true },
          { from: 'dev/marketing/seo/robots.txt', to: 'robots.txt' },
          { from: 'dev/marketing/seo/sitemap.xml', to: 'sitemap.xml' },
          ...['mkt-report-dashboard.webp', 'mkt-notam-shot.webp', 'mkt-military-3d.webp', 'mkt-operational-globe.webp'].map(name => ({
            from: 'dev/assets/images/web/' + name,
            to: 'assets/images/web/' + name,
            noErrorOnMissing: true
          })),
          // Real, user-supplied StratOps screenshots optimized for the marketing website.
          { from: 'dev/marketing/assets/images/web', to: 'assets/images/web', noErrorOnMissing: true },
          { from: 'dev/assets/images/web/mkt-footer-bg-1.jpg', to: 'assets/images/web/mkt-footer-bg-1.jpg'
          },
        ]
      })
    ],
    // App dev server stays on 4173. Marketing dev server stays on 4174.
    devServer: {
      port: 4174, open: { target: ['/'] },
      static: [{ directory: path.join(root, 'dev/assets/fonts/stratops'), publicPath: '/assets/fonts/stratops', watch: false }],
      // Friendly URLs resolve to HTML files in one generated pages/ directory.
      // Keep public URLs and canonical tags unchanged (/about/, /intelligence/, etc.).
      historyApiFallback: {
        disableDotRule: true,
        rewrites: [
          { from: /^\/(?:index\.html)?$/, to: '/pages/index.html' },
          ...['advantage', 'capabilities', 'intelligence', 'about', 'partners', 'contact'].map(name => ({
            from: new RegExp('^/' + name + '/?$'), to: '/pages/' + name + '.html'
          })),
          { from: /^\/404\/?$/, to: '/pages/404.html' }
        ]
      },
      hot: true, liveReload: true, headers: { 'Cache-Control': 'no-store' },
      client: { overlay: { errors: true, warnings: false, runtimeErrors: true } }
    },
    performance: { hints: 'warning' },
    devtool: false
  };
};
