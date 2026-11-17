const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyBuild, verifyLive } = require('../marketing-assets.cjs');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratops-public-integrity-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.mkdirSync(path.join(directory, 'assets'));
    const contents = { 'index.html': '<body class="stratops-public"><script src="/assets/site.12345678.js"></script><link href="/assets/site.12345678.css" rel="stylesheet"></body>',
        '404.html': '<h1>Not found</h1>', 'robots.txt': 'User-agent: *', 'sitemap.xml': '<urlset/>',
        'assets/site.12345678.js': 'console.log("public")',
        'assets/site.12345678.css': '@font-face{font-family:test;src:url(/assets/test.ttf)}', 'assets/test.ttf': 'test-font-bytes' };
    for (const [filename, bytes] of Object.entries(contents)) fs.writeFileSync(path.join(directory, filename), bytes);
    return { directory, contents };
}

test('public gate verifies JS/CSS and their font dependency and rejects operational output', t => {
    const { directory } = fixture(t); assert.equal(verifyBuild(directory).length, 3);
    fs.unlinkSync(path.join(directory, 'assets/test.ttf'));
    assert.throws(() => verifyBuild(directory), /Missing public asset/);
    fs.writeFileSync(path.join(directory, 'cesium-assets.json'), '{}');
    assert.throws(() => verifyBuild(directory), /separate public marketing build/);
});

test('public live gate rejects HTTP errors, wrong MIME, missing metadata and changed bytes before HTML publication', async t => {
    const { directory, contents } = fixture(t), original = global.fetch;
    t.after(() => { global.fetch = original; });
    let mode = 'ok', calls = [];
    global.fetch = async url => {
        const filename = new URL(url).pathname.slice(1); calls.push(filename);
        return new Response(mode === 'bytes' ? 'altered' : contents[filename], { status: mode === '503' ? 503 : 200, headers: {
            'content-type': mode === 'mime' ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'font/ttf',
            ...(mode === 'cache' ? {} : { 'cache-control': 'public, max-age=31536000, immutable' })
        } });
    };
    assert.equal((await verifyLive(directory, 'https://public.example.test')).length, 3);
    assert.equal(calls.length, 3); assert.ok(calls.every(filename => filename.startsWith('assets/')));
    for (mode of ['503', 'mime', 'cache', 'bytes']) await assert.rejects(verifyLive(directory, 'https://public.example.test'), /HTTP 503|MIME|cache header|byte mismatch/);
});
