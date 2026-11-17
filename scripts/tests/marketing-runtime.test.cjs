const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness({ mobile = false, reduced = false, saveData = false } = {}) {
    function element() {
        const attrs = {}, listeners = {}, classes = new Set();
        return { attrs, listeners, textContent: '', tabIndex: 0,
            setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k],
            addEventListener(k, fn) { listeners[k] = fn; }, focus() {},
            classList: { remove: k => classes.delete(k), toggle(k, on) { if (on) classes.add(k); else classes.delete(k); }, contains: k => classes.has(k) }
        };
    }
    const menu = element(), nav = element(), panel = element(), film = element(), toggle = element(), year = element();
    const fields = { span: element(), h3: element(), p: element() };
    panel.querySelector = k => fields[k];
    const tabs = ['focus', 'aoi', 'notices', 'reports'].map(key => Object.assign(element(), { id: 'tool-' + key, dataset: { tool: key } }));
    let plays = 0, observer;
    Object.assign(film, { paused: true, src: '', dataset: { src: '/assets/stratops-startup-v1.mp4' },
        async play() { this.paused = false; plays++; }, pause() { this.paused = true; } });
    const motion = { matches: reduced, addEventListener() {} };
    const doc = { hidden: false, listeners: {}, querySelector: () => menu,
        querySelectorAll: () => tabs, getElementById: id => ({ 'public-nav': nav, 'tool-panel': panel, 'public-film': film, 'public-film-toggle': toggle, 'public-year': year })[id],
        addEventListener(k, fn) { this.listeners[k] = fn; } };
    class IntersectionObserver { constructor(fn) { observer = fn; } observe() {} }
    const source = fs.readFileSync('dev/marketing/site.js', 'utf8').replace(/^import .*;\r?\n/gm, '');
    vm.runInNewContext(source, { document: doc, navigator: { connection: { saveData } },
        matchMedia: query => query.includes('reduced-motion') ? motion : { matches: mobile },
        IntersectionObserver, window: { IntersectionObserver }, Date });
    return { menu, nav, panel, fields, tabs, film, toggle, doc, get plays() { return plays; }, visible(on) { observer([{ isIntersecting: on }]); } };
}

test('mobile, reduced-motion and save-data do not download the film automatically; explicit play works', async () => {
    for (const options of [{ mobile: true }, { reduced: true }, { saveData: true }]) {
        const h = harness(options); h.visible(true);
        assert.equal(h.film.src, ''); assert.equal(h.plays, 0);
        h.toggle.listeners.click(); await Promise.resolve();
        assert.equal(h.plays, 1); assert.match(h.film.src, /stratops-startup/);
    }
});

test('offscreen and hidden documents pause video and visibility changes cannot restart offscreen playback', async () => {
    const h = harness(); h.visible(true); await Promise.resolve(); assert.equal(h.plays, 1);
    h.visible(false); assert.equal(h.film.paused, true);
    h.doc.listeners.visibilitychange(); assert.equal(h.plays, 1);
    h.visible(true); await Promise.resolve(); assert.equal(h.plays, 2);
    h.toggle.listeners.click(); h.visible(false); h.visible(true); assert.equal(h.plays, 2);
});

test('menu and tool tabs update their existing elements and accessible state', () => {
    const h = harness({ mobile: true }); h.menu.listeners.click();
    assert.equal(h.menu.attrs['aria-expanded'], 'true'); assert.equal(h.nav.classList.contains('is-open'), true);
    h.doc.listeners.keydown({ key: 'Escape' }); assert.equal(h.menu.attrs['aria-expanded'], 'false');
    h.tabs[0].listeners.keydown({ key: 'End', preventDefault() {} });
    assert.equal(h.tabs[3].attrs['aria-selected'], 'true'); assert.equal(h.panel.attrs['aria-labelledby'], 'tool-reports');
    assert.match(h.fields.h3.textContent, /report/);
});
