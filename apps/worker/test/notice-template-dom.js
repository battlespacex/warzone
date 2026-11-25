// Extend the existing lightweight DOM fixtures with real static HTML parsing.
// This deliberately does not pretend to implement browser layout or Cesium.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseDocument } = require('htmlparser2');
const source = fs.readFileSync(new URL('../../../dev/assets/js/warzone-notice-templates.js', import.meta.url), 'utf8');

export function installNoticeTemplates(context) {
    const document = context.document, create = document.createElement.bind(document);
    const matches = (el, selector) => {
        const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attr) return el.getAttribute(attr[1]) !== null && (attr[2] === undefined || el.getAttribute(attr[1]) === attr[2]);
        if (selector[0] === '.') return (el.className || '').split(/\s+/).includes(selector.slice(1));
        return (el.tagName || el.tag || '').toLowerCase() === selector;
    };
    function element(tag) {
        const el = create(tag), attrs = {};
        let textValue = '';
        Object.defineProperty(el, 'textContent', {
            get: () => textValue,
            set(value) { textValue = String(value); if (tag === 'button') el.children = []; },
        });
        Object.defineProperty(el, 'childNodes', { get() {
            return [...el.children, { nodeType: 3, get nodeValue() { return textValue; }, set nodeValue(value) { textValue = value; } }];
        } });
        const set = el.setAttribute?.bind(el), remove = el.remove?.bind(el), append = el.append.bind(el);
        el.setAttribute = (name, value) => { attrs[name] = String(value); set?.(name, value); };
        el.getAttribute = name => attrs[name] ?? null;
        el.append = (...nodes) => { for (const node of nodes) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = el; append(node); } };
        el.remove = () => { if (el.parent) { el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; } remove?.(); };
        el.replaceChildren = (...nodes) => { for (const node of [...el.children]) node.remove(); el.append(...nodes); };
        el.querySelectorAll = selector => {
            const found = [], selectors = selector.split(',').map(s => s.trim());
            const visit = parent => { for (const child of parent.children || []) { if (selectors.some(s => matches(child, s))) found.push(child); visit(child); } }; visit(el); return found;
        };
        el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
        el.cloneNode = () => {
            const clone = element(tag); clone.className = el.className;
            for (const [key, value] of Object.entries(attrs)) clone.setAttribute(key, value);
            if (el.hidden) clone.hidden = true;
            clone.textContent = el.textContent;
            for (const child of el.children) clone.append(child.cloneNode(true));
            return clone;
        };
        return el;
    }
    document.createElement = tag => {
        if (tag !== 'template') return element(tag);
        const template = {};
        Object.defineProperty(template, 'innerHTML', { set(html) {
            const convert = node => {
                const el = element(node.name);
                for (const [name, value] of Object.entries(node.attribs)) {
                    el.setAttribute(name, value);
                    if (name === 'class') el.className = value;
                    if (name === 'hidden') el.hidden = true;
                    if (name === 'value') el.value = value;
                }
                el.textContent = (node.children || []).filter(n => n.type === 'text').map(n => n.data).join('').trim();
                for (const child of node.children || []) if (child.type === 'tag') el.append(convert(child));
                return el;
            };
            template.content = { firstElementChild: convert(parseDocument(html).children.find(n => n.type === 'tag')) };
        } });
        return template;
    };
    vm.runInContext(source.replace(/\bexport /g, ''), context);
}
