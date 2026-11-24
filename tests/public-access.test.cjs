const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');
function application(publicAccess = true) {
    const classes = new Set();
    const context = vm.createContext({
        __STRATOPS_DEV_TOOLS__: false,
        window: { STRATOPS_PUBLIC_ACCESS: publicAccess, location: { hostname: 'app.stratops.space' } },
        document: { body: { classList: {
            contains: name => classes.has(name),
            toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        } }, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null },
        localStorage: { getItem: () => null, setItem() {} },
    });
    vm.runInContext(read('dev/assets/js/stratops-feature-config.js').replace(/\bexport /g, ''), context);
    vm.runInContext(read('dev/assets/js/warzone-layers.js')
        .replace(/^import[\s\S]*?from "[^"]+";\r?\n/m, '')
        .replace(/import\.meta\.env\?\.DEV/g, 'false')
        .replace(/export \{[^}]+\};/g, '').replace(/\bexport /g, ''), context);
    return context;
}
test('anonymous public mode enables formerly paid layers without inventing an identity', () => {
    const c = application();
    c.applyStratOpsFeatureVisibility();
    assert.equal(c.document.body.classList.contains('is-public-access'), true);
    assert.equal(c.window.__stratopsAuthState, undefined);
    for (const id of vm.runInContext('LAYER_DEFS.map(l => l.id)', c)) {
        assert.equal(c.canUseLayer(id), true, id);
        assert.equal(c.renderLayerBadge({ premium: true }), '');
    }
    for (const id of ['gnss', 'aircraft', 'naval', 'orbital-assets', 'satellite-imagery']) {
        c.resetLayerStateForFreshLoad();
        c.setLayer(id, true);
        assert.equal(c.isLayerEnabled(id), true, id);
    }
    for (const path of ['header.login', 'system.authentication', 'system.billing']) {
        assert.equal(c.isStratOpsFeatureEnabled(path), false, path);
    }
    assert.equal(c.isStratOpsFeatureEnabled('reports.reportGeneration'), false);
    assert.equal(c.isStratOpsFeatureEnabled('system.devPanel'), false);
});
test('runtime switch restores account gates while operational feature switches still apply', () => {
    const c = application(false);
    assert.equal(c.canUseLayer('aircraft'), false);
    assert.equal(c.isStratOpsFeatureEnabled('system.authentication'), true);
    assert.match(c.renderLayerBadge({ premium: true }), /Premium/);
    c.window.STRATOPS_PUBLIC_ACCESS = true;
    c.window.STRATOPS_FEATURES.mapLayers.gnss = false;
    assert.equal(c.canUseLayer('aircraft'), true);
    assert.equal(c.isStratOpsFeatureEnabled('mapLayers.gnss'), false);
});
test('public auth entry points return without requests, timers, redirects or fake sessions', async () => {
    const source = read('dev/assets/js/essential.js');
    const c = vm.createContext({ isStratOpsPublicAccessEnabled: () => true, window: {} });
    for (const name of ['stratopsCheckAuth', 'showLoginModal', 'scheduleDelayedLoginPopup']) {
        const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
        assert.ok(match, name);
        vm.runInContext(match[0], c);
    }
    assert.equal(await c.stratopsCheckAuth(), false);
    c.showLoginModal(); c.scheduleDelayedLoginPopup();
    c.window.__stratopsAuthState = { isAuthenticated: true, user: { id: 'existing' } };
    assert.equal(await c.stratopsCheckAuth(), true);
    assert.equal(c.window.__stratopsAuthState.user.id, 'existing');
});

test('entry still requires acknowledgment before showing region selection', async () => {
    const source = read('dev/assets/js/essential.js');
    const handler = source.match(/async function handleEnter\([^]*?\n    }/)[0];
    let consent = false, shown = 0;
    const c = vm.createContext({
        hasIntroConsent: () => consent, introModal: null,
        localStorage: { setItem() {} }, window: { __warzoneShowRegionModal: () => shown++ },
    });
    vm.runInContext(handler, c);
    await c.handleEnter(); assert.equal(shown, 0);
    consent = true;
    await c.handleEnter(); assert.equal(shown, 1);
});
