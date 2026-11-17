const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const webpack = require('webpack');
const DevServer = require('webpack-dev-server');
const HtmlPlugin = require('html-webpack-plugin');

test('real dev server watches repeated CSS saves and emits in-place style updates without expiring a stylesheet URL', { timeout: 45000 }, async t => {
    const parent = path.resolve(__dirname, '../../.generated/domain-migration');
    fs.mkdirSync(parent, { recursive: true });
    const directory = fs.mkdtempSync(path.join(parent, 'css-hmr-'));
    const css = path.join(directory, 'fixture.css');
    fs.writeFileSync(path.join(directory, 'entry.js'), "import './fixture.css';");
    fs.writeFileSync(css, ':root{--qa-revision:revision-zero}');
    const config = require('../../webpack.marketing.config.cjs')({}, { mode: 'development' });
    const compiler = webpack({ ...config,
        entry: path.join(directory, 'entry.js'), output: { ...config.output, path: path.join(directory, 'output') },
        // Use the real development CSS loader/watch policy, with isolated test sources and no large media copy.
        plugins: [new HtmlPlugin({ templateContent: '<!doctype html><html><body>CSS watch probe</body></html>' })],
        performance: false, stats: 'errors-only'
    });
    const server = new DevServer({ ...config.devServer, host: '127.0.0.1', port: 0, open: false,
        setupExitSignals: false, devMiddleware: { stats: 'errors-only' }, client: false }, compiler);
    t.after(async () => {
        try { await server.stop(); } catch { /* Startup may have failed. */ }
        await new Promise(resolve => compiler.close(resolve));
        assert.ok(path.resolve(directory).startsWith(parent + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    let completion;
    compiler.hooks.done.tap('CssWatchTest', stats => completion?.(stats));
    function nextBuild() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('CSS watcher did not recompile')), 15000);
            completion = stats => {
                clearTimeout(timer); completion = null;
                if (stats.hasErrors()) reject(Error(stats.toString({ all: false, errors: true })));
                else resolve(stats);
            };
        });
    }
    const ready = nextBuild();
    await server.start(); await ready;
    const origin = 'http://127.0.0.1:' + server.server.address().port;
    const html = await (await fetch(origin)).text();
    assert.match(html, /assets\/site\.js/);
    assert.doesNotMatch(html, /<link[^>]+\.css/);
    const first = await fetch(origin + '/assets/site.js');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    const source = await first.text();
    assert.match(source, /style-loader/); assert.match(source, /revision-zero/);
    for (const revision of ['revision-one', 'revision-two']) {
        const changed = nextBuild();
        // Atomic replacement models editor safe-save behavior without touching the user's stylesheet.
        const staged = css + '.new'; fs.writeFileSync(staged, `:root{--qa-revision:${revision}}`); fs.renameSync(staged, css);
        const stats = await changed;
        const updates = stats.compilation.getAssets().map(asset => asset.name).filter(name => name.endsWith('.hot-update.js'));
        assert.ok(updates.length, 'CSS save should emit an HMR payload');
        const payloads = await Promise.all(updates.map(async name => {
            const response = await fetch(origin + '/' + name); assert.equal(response.status, 200); return response.text();
        }));
        assert.ok(payloads.some(payload => payload.includes(revision)), 'Hot update contains the latest CSS');
        const current = await fetch(origin + '/assets/site.js');
        assert.equal(current.status, 200); assert.match(await current.text(), new RegExp(revision));
        assert.doesNotMatch(await (await fetch(origin)).text(), /<link[^>]+\.css/);
    }
});
