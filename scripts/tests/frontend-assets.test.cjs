const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { verifyBuild, verifyLive } = require('../frontend-assets.cjs');

test('production font copy includes the report icon stylesheet and every referenced font', async (t) => {
    const root = path.resolve(__dirname, '../..');
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'stratops-font-copy-'));
    t.after(() => fs.rmSync(output, { recursive: true, force: true }));
    const config = require('../../webpack.config.js')({}, { mode: 'production' });
    const pattern = config.plugins.find((plugin) => plugin.constructor.name === 'CopyPlugin')
        .patterns.find((candidate) => candidate.from === path.join(root, 'dev/assets/fonts'));
    assert.ok(pattern, 'Use the actual production font-copy pattern');
    const compiler = require('webpack')({ context: root, mode: 'production', entry: {}, output: { path: output },
        plugins: [new (require('copy-webpack-plugin'))({ patterns: [{ ...pattern, to: path.join(output, 'assets/fonts') }] })],
        performance: { hints: false } });
    t.after(() => new Promise((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve())));
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    const template = fs.readFileSync(path.join(root, 'dev/pages/report.html'), 'utf8');
    const reference = template.match(/href="(\/assets\/fonts\/stratops\/style\.css)"/)[1];
    const css = fs.readFileSync(path.join(output, reference.slice(1)), 'utf8');
    assert.equal(css, fs.readFileSync(path.join(root, 'dev', reference.slice(1)), 'utf8'));
    const fontPaths = [...new Set([...css.matchAll(/url\(['"]?([^'"\s)]+)['"]?\)/g)]
        .map((match) => new URL(match[1], 'https://build.invalid' + reference).pathname.slice(1)))];
    assert.equal(fontPaths.length, 4);
    for (const font of fontPaths) {
        assert.deepEqual(fs.readFileSync(path.join(output, font)), fs.readFileSync(path.join(root, 'dev', font)));
    }
});

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratops-frontend-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const files = {
        'pages/index.html': '<script src="/assets/js/main.12345678.js"></script><link href="/assets/css/main.12345678.css">',
        'assets/js/main.12345678.js': 'console.log("main");',
        'assets/js/named-lazy.abcdef12.js': 'console.log("lazy");',
        'assets/css/main.12345678.css': 'body { color: white; }',
        'assets/css/lazy.abcdef12.css': '.lazy { color: blue; }',
        'assets/pdfjs/pdf.worker.min.mjs': 'export default {};',
    };
    for (const [name, contents] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
        fs.writeFileSync(path.join(directory, name), contents);
    }
    return { directory, files };
}

test('frontend inventory includes named JS and lazy CSS and rejects missing HTML references', (t) => {
    const f = fixture(t);
    assert.equal(verifyBuild(f.directory).length, 5);
    fs.appendFileSync(path.join(f.directory, 'pages/index.html'), '<script src="/missing.js"></script>');
    assert.throws(() => verifyBuild(f.directory), /Missing frontend asset/);
});

test('pre-publication frontend gate checks status, MIME, redirects and exact bytes for every chunk', async (t) => {
    const f = fixture(t);
    let mode = 'ok';
    let failedAsset = 'named-lazy';
    const server = http.createServer((request, response) => {
        const name = request.url.slice(1);
        const target = name.includes(failedAsset);
        response.statusCode = target && mode === '503' ? 503 : target && mode === 'redirect' ? 302 : 200;
        response.setHeader('Content-Type', target && mode === 'mime' ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript');
        if (mode === 'redirect') response.setHeader('Location', '/assets/js/main.12345678.js');
        response.end(target && mode === 'corrupt' ? 'wrong bytes' : f.files[name]);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await verifyLive(f.directory, origin)).length, 5);
    for (failedAsset of ['named-lazy', 'lazy.abcdef12.css', 'pdf.worker']) {
        for (const failure of ['503', 'mime', 'corrupt', 'redirect']) {
            mode = failure;
            await assert.rejects(verifyLive(f.directory, origin));
        }
    }
});
