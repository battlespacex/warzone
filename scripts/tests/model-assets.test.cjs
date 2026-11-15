const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { validateGlb, verifyBuild, verifyLive } = require('../model-assets.cjs');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratops-model-delivery-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'), build = path.join(root, 'build');
    fs.mkdirSync(source); fs.mkdirSync(path.join(build, 'assets/images/models'), { recursive: true });
    const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
    const bytes = Buffer.alloc(20 + json.length, 32);
    bytes.writeUInt32LE(0x46546c67); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
    fs.writeFileSync(path.join(source, 'Assigned.glb'), bytes);
    const output = path.join(build, 'assets/images/models/Assigned.glb'); fs.writeFileSync(output, bytes);
    return { source, build, bytes, output };
}
test('local model gate rejects missing, altered and invalid GLBs without touching source assets', t => {
    const f = fixture(t); assert.equal(verifyBuild(f.build, f.source).length, 1);
    fs.unlinkSync(f.output); assert.throws(() => verifyBuild(f.build, f.source), /Missing model/);
    fs.writeFileSync(f.output, Buffer.from('not the assigned model')); assert.throws(() => verifyBuild(f.build, f.source), /bytes differ/);
    assert.throws(() => validateGlb(Buffer.alloc(20), 'bad.glb'), /Invalid GLB/);
});
test('sequential live model gate rejects 503, HTML fallback and corruption before publication', async t => {
    const f = fixture(t); let mode = 'ok';
    const server = http.createServer((_req, res) => {
        res.statusCode = mode === '503' ? 503 : 200;
        res.setHeader('Content-Type', mode === 'html' ? 'text/html' : 'model/gltf-binary');
        res.end(mode === 'corrupt' ? Buffer.from('corrupt') : f.bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await verifyLive(f.build, origin, f.source)).length, 1);
    for (const [value, error] of [['503', /HTTP 503/], ['html', /MIME/], ['corrupt', /integrity/]]) {
        mode = value; await assert.rejects(verifyLive(f.build, origin, f.source), error);
    }
    await assert.rejects(verifyLive(f.build, 'https://user:password@example.test', f.source), /origin/);
});
