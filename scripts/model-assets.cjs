const fs = require('node:fs');
const path = require('node:path');
const { listFiles, sha256 } = require('./cesium-assets.cjs');
const source = path.resolve(__dirname, '../dev/assets/images/models');

function validateGlb(bytes, name) {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
        || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a
        || bytes.readUInt32LE(12) > bytes.length - 20) throw new Error(`Invalid GLB container: ${name}`);
    let json;
    try { json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()); }
    catch { throw new Error(`Invalid GLB JSON: ${name}`); }
    if (json.asset?.version !== '2.0') throw new Error(`Unsupported GLB version: ${name}`);
}

function verifyBuild(directory, sourceDirectory = source) {
    const files = listFiles(sourceDirectory).filter(file => /\.glb$/i.test(file));
    if (!files.length) throw new Error('Expected source GLB models');
    return files.map(file => {
        const relative = 'assets/images/models/' + file;
        const original = fs.readFileSync(path.join(sourceDirectory, file));
        validateGlb(original, relative);
        const filename = path.join(directory, relative);
        if (!fs.statSync(filename, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing model asset: ${relative}`);
        const built = fs.readFileSync(filename);
        if (!built.equals(original)) throw new Error(`Model build bytes differ: ${relative}`);
        return { path: relative, bytes: original.length, sha256: sha256(original) };
    });
}

async function verifyLive(directory, origin, sourceDirectory = source) {
    const site = new URL(origin);
    if (site.username || site.password || site.search || site.hash || site.pathname !== '/'
        || (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(site.hostname)))) throw new Error('Expected HTTPS site origin or loopback test origin');
    const assets = verifyBuild(directory, sourceDirectory);
    for (const asset of assets) {
        const response = await fetch(new URL('/' + asset.path, site), { redirect: 'error', signal: AbortSignal.timeout(30000) });
        const context = `${asset.path} (HTTP ${response.status}, ${response.headers.get('x-cache') || 'no X-Cache'})`;
        if (response.status !== 200) throw new Error(`Model delivery failed: ${context}`);
        if (!/^(?:model\/gltf-binary|application\/octet-stream)\b/i.test(response.headers.get('content-type') || '')) throw new Error(`Model MIME type invalid: ${context}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`Model live integrity mismatch: ${context}`);
    }
    return assets;
}
module.exports = { validateGlb, verifyBuild, verifyLive };
if (require.main === module) {
    const [command, directory, origin, ...extra] = process.argv.slice(2);
    (async () => {
        if (extra.length || !directory || !['--verify', '--verify-live'].includes(command) || (command === '--verify-live') !== Boolean(origin)) throw new Error('Usage: model-assets.cjs --verify <build-dir> | --verify-live <build-dir> <site-origin>');
        const files = command === '--verify' ? verifyBuild(directory) : await verifyLive(directory, origin);
        console.info(`Verified ${files.length} GLB model assets`);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
