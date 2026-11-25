const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseExpressionAt } = require('acorn');
const source = fs.readFileSync('dev/assets/js/warzone-dev-panel.js', 'utf8');
function element() {
    const classes = new Set(), listeners = {}, attributes = {};
    return { dataset: {}, listeners, attributes, children: [], hidden: false,
        classList: { contains: value => classes.has(value), toggle(value, on) { if(on) classes.add(value); else classes.delete(value); } },
        addEventListener(name, fn) { assert.equal(listeners[name], undefined, 'no duplicate handlers'); listeners[name] = fn; },
        setAttribute(name, value) { attributes[name] = value; }, focus() { this.focused = true; } };
}
function harness() {
    const panel = element(), body = element(), toggle = element(), close = element(), keyboard = {}, timers = new Map();
    const slider = { value: '175' }, accordion = { open: true }, section = { value: 'naval' };
    body.children.push(slider, accordion, section); body.scrollTop = 300;
    const operations = { aircraft: new Set(['bomber']), naval: new Set(['vessel']), events: new Set(['event']) };
    const camera = { trackedEntity: { id: 'bomber' }, position: { x: 1, y: 2, z: 3 } };
    let starts = 0, initialStops = 0;
    const document = { body: { classList: { contains: () => false } },
        getElementById: id => ({'wz-dev-panel':panel,'wz-dev-body':body,'wz-dev-toggle':toggle,'wz-dev-close':close}[id]),
        addEventListener: (name, fn) => { assert.equal(keyboard[name], undefined); keyboard[name] = fn; }, dispatchEvent() {} };
    const c = vm.createContext({ document, window: { __warzoneViewer: { camera }, setTimeout: fn => { timers.set(1,fn);return 1; }, clearTimeout: key => timers.delete(key) },
        isLocalDeveloperFeatureEnabled: feature => !feature, __devPanelOpen:false, __devPanelGeneration:7,
        __devPanelSimulationKeys:operations.aircraft, __devPanelNavalKeys:operations.naval,__devPanelEventKeys:operations.events,
        __devPanelPendingSimulationStarts:new Map(), stopDevTrackSimulation:()=>initialStops++, startDevTrackSimulation:()=>starts++,
        CustomEvent:class {}, devLog() {} });
    const start = source.indexOf('export function initDevPanel()');
    const end = source.indexOf('    document.querySelectorAll(".wz-dev-btn[data-event]")',start);
    vm.runInContext(source.slice(start,end).replace('export ','')+'    setOpen(true);\n}',c);
    const restart = source.indexOf('function restartDevSimulation(');
    vm.runInContext(source.slice(restart,parseExpressionAt(source,restart,{ecmaVersion:'latest'}).end),c);
    c.initDevPanel();
    return {c,panel,body,toggle,close,keyboard,timers,operations,camera,slider,accordion,section,get starts(){return starts;},get initialStops(){return initialStops;}};
}
test('Close/Open only changes visibility and accessibility, preserving mounted controls and active state',()=>{
    const h=harness(), children=h.body.children, tracked=h.camera.trackedEntity, position=h.camera.position;
    for(let i=0;i<20;i++) {
        h.close.listeners.click(); assert.equal(h.panel.classList.contains('dev-panel-collapsed'),true);
        assert.equal(h.body.hidden,false);assert.equal(h.body.inert,true);assert.equal(h.body.attributes['aria-hidden'],'true');
        assert.equal(h.toggle.attributes['aria-expanded'],'false');assert.equal(h.toggle.focused,true);
        assert.equal(h.c.__devPanelOpen,true);assert.equal(h.c.__devPanelGeneration,7);
        assert.deepEqual([...h.operations.aircraft],['bomber']);assert.deepEqual([...h.operations.naval],['vessel']);assert.deepEqual([...h.operations.events],['event']);
        h.toggle.listeners.click();assert.equal(h.panel.classList.contains('dev-panel-collapsed'),false);assert.equal(h.body.inert,false);
        assert.equal(h.body.children,children);assert.equal(h.slider.value,'175');assert.equal(h.accordion.open,true);assert.equal(h.section.value,'naval');assert.equal(h.body.scrollTop,300);
        assert.equal(h.camera.trackedEntity,tracked);assert.equal(h.camera.position,position);
        h.c.initDevPanel(); // The existing mounted-panel guard must avoid rebinding.
    }
});
test('a pending simulation restart still completes while hidden; keyboard toggles remain reversible',()=>{
    const h=harness();h.c.restartDevSimulation({track_key:'bomber'});assert.equal(h.initialStops,1);
    h.close.listeners.click();assert.equal(h.timers.size,1);h.timers.get(1)();assert.equal(h.starts,1);
    for(const key of ['`','~']) {h.keyboard.keydown({ctrlKey:true,shiftKey:true,key,preventDefault(){}});}
    assert.equal(h.panel.classList.contains('dev-panel-collapsed'),true);assert.equal(h.c.__devPanelGeneration,7);
});
test('collapsed control styles do not replace expanded dimensions or intercept the globe',()=>{
    const css=fs.readFileSync('dev/assets/css/warzone-dev-panel.css','utf8');
    const rule=css.match(/\.wz-dev-panel\.dev-panel-collapsed \.wz-dev-body\s*\{([^}]+)\}/)[1];
    for(const property of ['opacity','height','width','min-height','min-width'])assert.match(rule,new RegExp(`${property}:\\s*0;`));
    assert.match(rule,/overflow:\s*hidden/);assert.match(rule,/pointer-events:\s*none/);
    assert.match(css,/\.wz-dev-panel\.dev-panel-collapsed\s*\{\s*pointer-events:\s*none/);
    assert.match(css,/\.wz-dev-panel\.dev-panel-collapsed \.wz-dev-toggle\s*\{\s*pointer-events:\s*auto/);
});
