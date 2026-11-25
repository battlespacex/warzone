const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseExpressionAt } = require('acorn');
const { parseDocument } = require('htmlparser2');
const source = fs.readFileSync('dev/assets/js/warzone-dev-panel.js','utf8');
function harness() {
    const inputs = new Map(['logo','header','dock','all'].map(key=>[key,{checked:false,dataset:{},listeners:[],
        addEventListener(name,fn){assert.equal(name,'change');this.listeners.push(fn);}}]));
    const targets = new Map(['.warzone-brand','.warzone-commandbar','.wz-dock','.warzone-ui-shell','.tracker','.altitude','.credits','.popup'].map(key=>{
        const classes = new Set();return [key,{classes,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}}];
    }));
    const c = vm.createContext({document:{getElementById:id=>inputs.get(id.replace('wz-dev-hide-','')),
        querySelectorAll:selector=>{assert.ok(['.warzone-brand','.warzone-commandbar','.wz-dock'].includes(selector));return [targets.get(selector)];}}});
    const start=source.indexOf('function initDevUiVisibilityControls(');
    vm.runInContext(source.slice(start,parseExpressionAt(source,start,{ecmaVersion:'latest'}).end),c);
    const change=(key,checked)=>{inputs.get(key).checked=checked;inputs.get(key).listeners.forEach(fn=>fn());};
    return {c,inputs,targets,change,hidden:selector=>targets.get(selector).classes.has('dev-ui-hidden')};
}
test('individual toggles and Hide All synchronize both ways without touching other UI',()=>{
    const h=harness();h.c.initDevUiVisibilityControls();
    for(const input of h.inputs.values())assert.equal(input.checked,false);
    assert.ok([...h.targets.values()].every(target=>target.classes.size===0));
    h.change('logo',true);assert.equal(h.hidden('.warzone-brand'),true);assert.equal(h.hidden('.warzone-commandbar'),false);assert.equal(h.inputs.get('all').checked,false);
    h.change('header',true);h.change('dock',true);assert.equal(h.inputs.get('all').checked,true);
    h.change('header',false);assert.equal(h.inputs.get('all').checked,false);assert.equal(h.hidden('.warzone-brand'),true);assert.equal(h.hidden('.wz-dock'),true);
    for(let i=0;i<20;i++){
        h.change('all',true);for(const input of h.inputs.values())assert.equal(input.checked,true);
        assert.equal(h.hidden('.warzone-brand'),true);assert.equal(h.hidden('.warzone-commandbar'),true);assert.equal(h.hidden('.wz-dock'),true);
        h.change('all',false);for(const input of h.inputs.values())assert.equal(input.checked,false);
        assert.ok([...h.targets.values()].every(target=>target.classes.size===0));
    }
    h.change('all',true);h.c.initDevUiVisibilityControls();for(const input of h.inputs.values()){assert.equal(input.checked,true);assert.equal(input.listeners.length,1);}
    for(const selector of ['.warzone-ui-shell','.tracker','.altitude','.credits','.popup'])assert.equal(h.targets.get(selector).classes.size,0);
});
test('mounted-panel close/open preserves visibility selections and target classes',()=>{
    const h=harness();h.c.initDevUiVisibilityControls();h.change('all',true);
    const classes=new Set();h.c.panel={classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}};
    h.c.body={setAttribute(){}};h.c.toggle={setAttribute(){}};
    const start=source.indexOf('    const setOpen = (open) => {',source.indexOf('export function initDevPanel'));
    const end=source.indexOf('    document.addEventListener("keydown"',start);
    vm.runInContext(source.slice(start,end)+'\nglobalThis.setOpen=setOpen;',h.c);
    for(let i=0;i<20;i++){h.c.setOpen(false);h.c.setOpen(true);}
    for(const input of h.inputs.values())assert.equal(input.checked,true);
    for(const selector of ['.warzone-brand','.warzone-commandbar','.wz-dock'])assert.equal(h.hidden(selector),true);
});
test('markup reuses checkbox/grid styles and sits above the dynamically inserted section dropdown',()=>{
    const html=fs.readFileSync('dev/partials/dev-panel.html','utf8');
    const tree=parseDocument(html),nodes=[];const visit=node=>{nodes.push(node);for(const child of node.children||[])visit(child);};visit(tree);
    const section=nodes.find(node=>node.attribs?.['aria-labelledby']==='wz-dev-ui-visibility-title');
    assert.equal(section.attribs.class,'wz-dev-form-grid');
    const checkboxes=nodes.filter(node=>node.attribs?.id?.startsWith('wz-dev-hide-'));
    assert.equal(checkboxes.length,4);for(const node of checkboxes){assert.equal(node.attribs.type,'checkbox');assert.equal(node.attribs.checked,undefined);assert.match(node.parent.attribs.class,/wz-dev-check/);}
    assert.ok(html.indexOf('wz-dev-ui-visibility-title')>html.indexOf('wz-dev-heading'));
    assert.ok(html.indexOf('wz-dev-ui-visibility-title')<html.indexOf('class="wz-dev-grid"'));
    assert.match(source,/grid\.insertAdjacentElement\("beforebegin", selector\)/);
    for(const [path,selector] of [['dev/partials/header.html','warzone-brand'],['dev/partials/header.html','warzone-commandbar'],['dev/partials/nav.html','wz-dock']])assert.ok(fs.readFileSync(path,'utf8').includes(`class="${selector}"`));
    const headerNodes=[];const collect=node=>{headerNodes.push(node);for(const child of node.children||[])collect(child);};
    collect(parseDocument(fs.readFileSync('dev/partials/header.html','utf8')));
    const altitude=headerNodes.find(node=>node.attribs?.id==='wz-altitude-readout');assert.ok(altitude);
    for(let parent=altitude.parent;parent;parent=parent.parent)assert.ok(!(parent.attribs?.class||'').split(/\s+/).includes('warzone-commandbar'));
    const css=fs.readFileSync('dev/assets/css/warzone-dev-panel.css','utf8');assert.match(css,/\.dev-ui-hidden\s*\{\s*display:\s*none !important;/);
});
