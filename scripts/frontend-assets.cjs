const fs = require('node:fs');
const path = require('node:path');
const { listFiles, sha256 } = require('./cesium-assets.cjs');

// Include every emitted chunk, including named/dynamic chunks absent from entry HTML.
function verifyBuild(directory) {
    const root = path.resolve(directory);
    const files = listFiles(root);
    const assets = new Set(files.filter((file) => /\.(?:js|mjs|css)$/i.test(file) && !/^assets\/cesium\//i.test(file)));
    for (const html of files.filter((file) => file.endsWith('.html') && !/^(?:assets|partials)\//.test(file))) {
        const content = fs.readFileSync(path.join(root, html), 'utf8');
        for (const match of content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
            const reference = match[1];
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
            const url = new URL(reference, `https://build.invalid/${html}`);
            const relative = decodeURIComponent(url.pathname).slice(1);
            if (!/\.(?:js|mjs|css)$/i.test(relative)) continue;
            const absolute = path.resolve(root, relative);
            if (!absolute.startsWith(root + path.sep) || !fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
                throw new Error(`Missing frontend asset: ${html} -> ${reference}`);
            }
            assets.add(relative);
        }
    }
    if (![...assets].some((file) => /\.m?js$/i.test(file)) || ![...assets].some((file) => /\.css$/i.test(file))) {
        throw new Error('Expected generated application JavaScript and CSS');
    }
    return [...assets].sort().map((file) => {
        const bytes = fs.readFileSync(path.join(root, file));
        return { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    });
}

async function verifyLive(directory, baseUrl) {
    const assets = verifyBuild(directory);
    const origin = new URL(baseUrl);
    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
        throw new Error('Expected a site origin URL');
    }
    for (const asset of assets) {
        const response = await fetch(new URL('/' + asset.path, origin), { redirect: 'error', signal: AbortSignal.timeout(30000) });
        const context = `${asset.path} (HTTP ${response.status}, ${response.headers.get('x-cache') || 'no X-Cache'})`;
        if (response.status !== 200) throw new Error(`Frontend delivery failed: ${context}`);
        const mime = /\.css$/i.test(asset.path) ? /^text\/css\b/i : /^(?:application|text)\/(?:x-)?javascript\b/i;
        if (!mime.test(response.headers.get('content-type') || '')) throw new Error(`Frontend MIME type invalid: ${context}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error(`Frontend live integrity mismatch: ${context}`);
    }
    return assets;
}

module.exports = { verifyBuild, verifyLive };
if (require.main === module) {
    const [command, directory, origin, ...extra] = process.argv.slice(2);
    (async () => {
        if (extra.length || !directory || !['--verify', '--verify-live'].includes(command) || (command === '--verify-live') !== Boolean(origin)) {
            throw new Error('Usage: frontend-assets.cjs --verify <build-dir> | --verify-live <build-dir> <site-origin>');
        }
        const assets = command === '--verify' ? verifyBuild(directory) : await verifyLive(directory, origin);
        console.info(`Verified ${assets.length} application JavaScript/CSS assets`);
    })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
