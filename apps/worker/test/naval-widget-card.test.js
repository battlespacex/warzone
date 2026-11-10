import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Handler-level DOM fixture; browser layout and native interaction are not emulated.
class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.className = ''; this.attributes = {}; this._text = ''; }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    insertBefore(child, reference) {
        if (!reference) return this.appendChild(child);
        child.remove();
        const index = this.children.indexOf(reference);
        assert.ok(index >= 0);
        child.parentNode = this; this.children.splice(index, 0, child); return child;
    }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    replaceChildren(...children) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; this._text = ''; this.append(...children); }
    get childElementCount() { return this.children.filter((child) => child.tagName !== '#text').length; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    get classList() { return { toggle: (name, on) => { this.className = this.className.split(/\s+/).filter((item) => item && item !== name).concat(on ? [name] : []).join(' '); } }; }
    querySelectorAll(selector) {
        const matches = (node) => selector.startsWith('.')
            ? selector.slice(1).split('.').every((name) => node.className.split(/\s+/).includes(name))
            : selector.startsWith('[data-')
                ? selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in node.dataset
                : node.tagName === selector;
        return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness() {
    const source = fs.readFileSync(new URL('../../../dev/assets/js/warzone-live-naval.js', import.meta.url), 'utf8');
    const start = source.indexOf('function updateNavalWidgetCard(');
    const context = vm.createContext({ document: {
        createElement: (tag) => new Element(tag),
        createTextNode: (value) => { const node = new Element('#text'); node.textContent = value; return node; },
    }, __navalState: { collapsedDetailsKey: '' }, blocked: false,
        getNavalDisplayName: (vessel) => vessel.vessel_name,
        getNavalWidgetDetailLabel: () => 'Naval', getNavalWidgetCountryOperatorLabel: () => 'Unknown Navy',
        formatNavalSpeed: () => '12 kt', formatNavalHeading: () => '090°', getNavalCoordinatesLabel: () => '30, 40',
        formatNavalTimeAgo: () => 'Now', getNavalContactStatus: () => 'LIVE', resolveNavalModelUri: () => '',
        isNavalFocusBlocked: () => context.blocked,
    });
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
    const vessel = { track_key: 'test-vessel', vessel_name: 'Test vessel', last_seen_at: Date.parse('2026-11-10T12:00:00Z'), lat: 30, lon: 40 };
    return { context, vessel, card: new Element('article') };
}

test('naval updater creates the focus action when a reused card already has a footer without it', () => {
    const { context, vessel, card } = harness();
    const foot = new Element(); foot.className = 'wz-naval-item__foot'; card.appendChild(foot);
    context.updateNavalWidgetCard(card, vessel);
    const action = card.querySelector('.wz-naval-action');
    assert.ok(action);
    assert.equal(action.disabled, false);
    assert.equal(action.dataset.navalTrackToggle, vessel.track_key);
    assert.equal(card.querySelector('.wz-naval-item__foot'), foot);
    assert.equal(action.textContent, 'Focus');
    assert.equal(card.querySelectorAll('.wz-naval-action').length, 1);
});

test('unchanged naval snapshots repair a removed action and preserve focus/details/collapse state', () => {
    const { context, vessel, card } = harness();
    context.updateNavalWidgetCard(card, vessel, vessel.track_key);
    const foot = card.querySelector('.wz-naval-item__foot');
    const details = card.querySelector('.wz-naval-technical-details');
    card.querySelector('.wz-naval-action').remove();
    context.updateNavalWidgetCard(card, vessel, vessel.track_key);
    const action = card.querySelector('.wz-naval-action');
    assert.ok(action);
    assert.equal(action.textContent, 'Unfocus');
    assert.equal(details.hidden, false);
    context.__navalState.collapsedDetailsKey = vessel.track_key;
    context.updateNavalWidgetCard(card, vessel, vessel.track_key);
    assert.equal(details.hidden, true);
    assert.equal(card.querySelector('.wz-naval-action'), action);
    assert.equal(card.querySelector('.wz-naval-item__foot'), foot);
    assert.equal(card.querySelectorAll('.wz-naval-action').length, 1);
    context.blocked = true;
    context.updateNavalWidgetCard(card, vessel, 'another-vessel');
    assert.equal(action.disabled, true);
    assert.equal(action.hidden, true);
});
