import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NOTICE_TEMPLATES, setNoticeButtonLabel } from '../../../dev/assets/js/warzone-notice-templates.js';
const { parseDocument } = createRequire(import.meta.url)('htmlparser2');

test('every NOTAM template button keeps all nested elements when its label changes', () => {
    let checked = 0;
    for (const html of Object.values(NOTICE_TEMPLATES)) {
        const visit = node => {
            if (node.name === 'button') {
                // DOM-equivalent childNodes: replacing button.textContent would
                // destroy these children, whereas text.nodeValue preserves them.
                const children = node.children.map(child => child.type === 'text'
                    ? { nodeType: 3, nodeValue: child.data }
                    : { nodeType: 1, markup: child });
                const button = { childNodes: children, ownerDocument: { createTextNode: text => ({ nodeType: 3, nodeValue: text }) },
                    append(child) { this.childNodes.push(child); },
                    set textContent(text) { this.childNodes = [{ nodeType: 3, nodeValue: text }]; } };
                const elements = children.filter(child => child.nodeType === 1);
                for (const label of ['DRAW','RESIZE','DRAW','Saving…','SAVE','']) {
                    setNoticeButtonLabel(button,label);
                    assert.deepEqual(button.childNodes.filter(child => child.nodeType === 1),elements);
                    assert.equal(button.childNodes.filter(child => child.nodeType === 3).map(child => child.nodeValue).join('').trim(),label);
                }
                checked++;
            }
            for (const child of node.children || []) visit(child);
        };
        visit(parseDocument(html));
    }
    assert.ok(checked >= 10);
});
