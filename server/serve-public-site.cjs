const express = require('express');
const path = require('node:path');
const app = express();
// Independent static preview: no environment loading, API proxy, authentication or polling.
const directory = path.resolve(__dirname, '../public-site');
const pages = path.join(directory, 'pages');

// Generated assets and /pages/*.html remain directly accessible.
app.use(express.static(directory, { index: false, redirect: false }));

// Keep public-facing URLs, bookmarks, canonical URLs and navigation unchanged.
app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(pages, 'index.html')));
for (const name of ['advantage', 'capabilities', 'intelligence', 'about', 'partners', 'contact']) {
  app.get([`/${name}`, `/${name}/`], (_req, res) => res.sendFile(path.join(pages, `${name}.html`)));
}
app.get(['/404', '/404/'], (_req, res) => res.status(404).sendFile(path.join(pages, '404.html')));
app.use((_req, res) => res.status(404).sendFile(path.join(pages, '404.html')));
app.listen(4175, '127.0.0.1', () => console.log('Public website preview: http://127.0.0.1:4175'));
