const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const frontend = require('./frontend-assets.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function verifyBuild(directory) {
    const root = path.resolve(directory), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    if (!html.includes('stratops-public') || fs.existsSync(path.join(root, 'cesium-assets.json'))) throw Error('Expected the separate public marketing build');
    frontend.verifyBuild(root);
    function walk(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
            const absolute = path.join(dir, item.name);
            if (item.isSymbolicLink()) throw Error('Symlinks are not public release assets');
            return item.isDirectory() ? walk(absolute) : [absolute];
        });
    }
    const files = walk(path.join(root, 'assets')).map(absolute => {
        const bytes = fs.readFileSync(absolute);
        return { path: path.relative(root, absolute).replace(/\\/g, '/'), bytes: bytes.length, sha256: digest(bytes) };
    });
    const known = new Set(files.map(file => '/' + file.path));
    // Includes the lazily assigned movie source, poster and stylesheet/script references.
    const references = [...html.matchAll(/(?:src|href|poster|data-src)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
    const css = files.filter(file => file.path.endsWith('.css')).map(file => fs.readFileSync(path.join(root, file.path), 'utf8')).join('\n');
    // Unused custom-property URL tokens in root.css are not fetched; validate actual font-face sources.
    for (const face of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
        for (const url of face[0].matchAll(/url\(["']?(\/assets\/[^)'"\s]+)["']?\)/g)) references.push(url[1]);
    }
    for (const reference of references) if (!known.has(reference)) throw Error(`Missing public asset: ${reference}`);
    for (const filename of ['404.html', 'robots.txt', 'sitemap.xml']) if (!fs.statSync(path.join(root, filename), { throwIfNoEntry: false })?.isFile()) throw Error(`Missing public entry: ${filename}`);
    return files;
}

async function verifyLive(directory, origin) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Expected an HTTPS public site origin');
    const files = verifyBuild(directory);
    const types = { '.js': /^(application|text)\/javascript\b/i, '.css': /^text\/css\b/i, '.svg': /^image\/svg\+xml\b/i,
        '.jpg': /^image\/jpeg\b/i, '.mp4': /^video\/mp4\b/i, '.ttf': /^(font\/ttf|application\/(x-font-ttf|octet-stream))\b/i, '.txt': /^text\/plain\b/i };
    for (const file of files) {
        const response = await fetch(new URL('/' + file.path, url), { redirect: 'error', signal: AbortSignal.timeout(120000) });
        if (response.status !== 200) throw Error(`Public delivery HTTP ${response.status}: ${file.path}`);
        const mime = types[path.extname(file.path)];
        if (!mime || !mime.test(response.headers.get('content-type') || '')) throw Error(`Public MIME mismatch: ${file.path}`);
        const cache = response.headers.get('cache-control') || '';
        if (!/\bmax-age=\d+/.test(cache)) throw Error(`Public cache header missing: ${file.path}`);
        if (/\/site\.[a-f0-9]{8}\.(js|css)$/.test(file.path) && !/immutable/.test(cache)) throw Error(`Public hashed asset must be immutable: ${file.path}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw Error(`Public byte mismatch: ${file.path}`);
    }
    return files;
}

module.exports = { verifyBuild, verifyLive };
if (require.main === module) {
    const [command, directory, origin, ...extra] = process.argv.slice(2);
    (async () => {
        if (!directory || extra.length || !['--verify', '--verify-live'].includes(command) || (command === '--verify-live') !== Boolean(origin)) throw Error('Usage: marketing-assets.cjs --verify <public-build> | --verify-live <public-build> <https-origin>');
        const files = origin ? await verifyLive(directory, origin) : verifyBuild(directory);
        console.log(`Verified ${files.length} public assets, including movie, posters, logos and fonts`);
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
