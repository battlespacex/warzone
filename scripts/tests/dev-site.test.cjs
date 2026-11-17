const test = require('node:test');
const assert = require('node:assert/strict');
const { startSites, hasLocalPortal } = require('../dev-site.cjs');

function harness({ reused = false, failPublic = false } = {}) {
    const compilers = [], servers = [];
    const app = { name: 'app', devServer: { port: 4173, open: true } };
    const marketing = { name: 'marketing', mode: 'production', devServer: { port: 4174, open: { target: ['/'] } } };
    return { app, marketing, compilers, servers, options: {
        probe: async () => reused, appConfig: () => app, marketingConfig: () => marketing,
        webpack(config) { const compiler = { config, closed: 0, close(done) { this.closed++; done(); } }; compilers.push(compiler); return compiler; },
        DevServer: class {
            constructor(options, compiler) { Object.assign(this, { options, compiler, stopped: 0 }); servers.push(this); }
            async start() { if (failPublic && this.compiler.config.name === 'marketing') throw Error('public startup failed'); }
            async stop() { this.stopped++; }
        }
    } };
}

test('one local command starts independent website/app compilers and stops each owned server once', async () => {
    const h = harness(), sites = await startSites(h.options);
    assert.deepEqual(h.servers.map(server => server.options.port), [4173, 4174]);
    assert.notEqual(h.servers[0].compiler, h.servers[1].compiler);
    assert.equal(h.servers[0].options.open, false); assert.deepEqual(h.servers[1].options.open, { target: ['/'] });
    assert.ok(h.servers.every(server => server.options.setupExitSignals === false));
    assert.ok(h.compilers.every(compiler => compiler.config.mode === 'development'));
    assert.equal(h.marketing.mode, 'production'); assert.equal(h.app.devServer.open, true);
    await Promise.all([sites.stop(), sites.stop()]);
    assert.ok(h.servers.every(server => server.stopped === 1)); assert.ok(h.compilers.every(compiler => compiler.closed === 1));
});

test('an existing recognized app is reused and never stopped by the website launcher', async () => {
    const h = harness({ reused: true }), sites = await startSites({ ...h.options, noOpen: true, port: 4186 });
    assert.equal(sites.reusedApp, true); assert.equal(h.servers.length, 1);
    assert.equal(h.servers[0].options.port, 4186); assert.equal(h.servers[0].options.open, false);
    await sites.stop(); assert.equal(h.compilers.length, 1);
});

test('a partial startup failure cleans up both owned compilers and servers', async () => {
    const h = harness({ failPublic: true });
    await assert.rejects(startSites(h.options), /public startup failed/);
    assert.ok(h.servers.every(server => server.stopped === 1)); assert.ok(h.compilers.every(compiler => compiler.closed === 1));
});

test('local portal probe distinguishes a real app, absent server and conflicting server without external calls', async t => {
    const original = global.fetch; t.after(() => { global.fetch = original; });
    let mode = 'portal';
    global.fetch = async url => {
        assert.equal(url, 'http://localhost:4173/');
        if (mode === 'absent') throw Object.assign(Error('offline'), { cause: { code: 'ECONNREFUSED' } });
        if (mode === 'timeout') throw Error('timeout');
        return new Response(mode === 'portal' ? '<div id="wz-intro-modal">' : 'other service');
    };
    assert.equal(await hasLocalPortal(), true);
    mode = 'absent'; assert.equal(await hasLocalPortal(), false);
    mode = 'other'; await assert.rejects(hasLocalPortal(), /unrecognized server/);
    mode = 'timeout'; await assert.rejects(hasLocalPortal(), /Cannot verify/);
});
