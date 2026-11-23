"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const site = read('dev/marketing/assets/js/site.js');
const home = read('dev/marketing/pages/index.html');
const partialHeader = read('dev/marketing/partials/header.html');
const partialFooter = read('dev/marketing/partials/footer.html');

test('marketing presentation is isolated from operational trackers', () => {
  assert.match(site, /prefers-reduced-motion/);
  assert.match(site, /saveData/);
  assert.doesNotMatch(site, /\bfetch\s*\(|\bsetInterval\s*\(|Cesium|supabase|warzone-globe/);
  assert.match(read('dev/marketing/assets/js/contact.js'), /\/challenge/);
});

test('homepage exposes video opt-in controls with lazy loading', () => {
  assert.match(home, /id="hero-video"/);
  assert.match(home, /id="video-toggle"/);
  assert.match(site, /video\.dataset\.src/);
  assert.match(site, /videoInView/);
  assert.match(site, /manuallyPaused/);
  assert.match(site, /document\.hidden/);
  assert.match(site, /videoToggle\.addEventListener\("click"/);
});

test('shared header and footer provide navigation and local SVG sprite references', () => {
  assert.match(partialHeader, /href="\/capabilities\/"/);
  assert.match(partialHeader, /href="\/intelligence\/"/);
  assert.match(partialHeader, /href="\/contact\/"/);
  assert.match(partialFooter, /href="\/contact\/"/);
  assert.doesNotMatch(partialFooter, /mailto:bravo@battlespacex\.com/);
  assert.doesNotMatch(partialFooter, /\{\{HOME_PREFIX\}\}#icon-/);
  assert.match(partialFooter, /href="#icon-arrow"/);
});
