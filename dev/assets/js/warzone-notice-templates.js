// Presentation only. Static HTML is bundled with the existing JS pipeline:
// no new loader, dependency, runtime fetch, or provider data in HTML strings.
export const NOTICE_TEMPLATES = Object.freeze({
    panel: `
<aside role="dialog" aria-label="Published notice details" tabindex="-1">
    <div class="wz-widget-milbase">
        <header class="wz-widget-header">
            <div class="wz-widget-kicker"><h2 class="wz-widget-title">Published Notice</h2></div>
            <div class="wz-widget-header-actions">
                <button type="button" class="static-icon" aria-label="Close" data-action="close"><span class="stratops-ico-close-1"></span></button>
            </div>
        </header>
        <section class="wz-widget-body"><h3 data-field="title"></h3><ul class="wz-widget-data-list"></ul></section>
    </div>
</aside>`,
    body: `<section class="wz-widget-body"><h3 data-field="title"></h3><ul class="wz-widget-data-list"></ul></section>`,
    collapse: `
<button type="button" class="static-icon" aria-label="Collapse notice widget" aria-expanded="true" data-action="collapse" data-expand-label="Expand notice widget" data-collapse-label="Collapse notice widget">
    <span class="stratops-ico-top-1" aria-hidden="true"></span>
</button>`,
    state: `<p data-field="message"></p>`,
    preview: `
<section>
    <p class="wz-notice-summary"><span data-field="category"></span>
<span data-field="status" data-label="STATUS"></span>
<span data-field="area" data-label="AREA"></span>
<span data-field="validity" data-label="VALID UNTIL"></span></p>
    <div class="wz-notice-actions">
        <button type="button" class="btn-primary" data-action="more">MORE</button>
        <button type="button" class="btn-secondary white" data-action="shot">TAKE SHOT</button>
    </div>
</section>`,
    popup: `
<section>
    <p class="wz-notice-summary" data-field="summary"></p>
    <details><summary>Full notice and provenance</summary><ul class="wz-widget-data-list" data-slot="rows">
        <li><strong>Category</strong><span data-field="Category"></span></li>
        <li><strong>ID</strong><span data-field="ID"></span></li>
        <li><strong>Issuer</strong><span data-field="Issuer"></span></li>
        <li><strong>Country</strong><span data-field="Country"></span></li>
        <li><strong>Region</strong><span data-field="Region"></span></li>
        <li><strong>FIR</strong><span data-field="FIR"></span></li>
        <li><strong>NAVAREA</strong><span data-field="NAVAREA"></span></li>
        <li><strong>Activity</strong><span data-field="Activity"></span></li>
        <li><strong>Status</strong><span data-field="Status"></span></li>
        <li><strong>Issued</strong><span data-field="Issued"></span></li>
        <li><strong>From</strong><span data-field="From"></span></li>
        <li><strong>Until</strong><span data-field="Until"></span></li>
        <li><strong>Schedule</strong><span data-field="Schedule"></span></li>
        <li><strong>Altitude</strong><span data-field="Altitude"></span></li>
        <li><strong>Coordinates</strong><span data-field="Coordinates"></span></li>
        <li><strong>Radius</strong><span data-field="Radius"></span></li>
        <li><strong>Precision</strong><span data-field="Precision"></span></li>
        <li><strong>Confidence</strong><span data-field="Confidence"></span></li>
        <li><strong>Verified</strong><span data-field="Verified"></span></li>
        <li><strong>Fetched</strong><span data-field="Fetched"></span></li>
        <li><strong>Summary</strong><span data-field="Summary"></span></li>
        <li><strong>Original notice</strong><span data-field="Original notice"></span></li>
        <li><strong>Provenance</strong><span data-field="Provenance"></span></li>
    </ul></details>
    <div class="wz-notice-actions">
        <button type="button" class="btn-secondary white" data-action="shot">TAKE SHOT</button>
        <button type="button" class="btn-primary" data-action="focus" data-focus-label="Focus area" data-unfocus-label="Unfocus">Focus area</button>
        <button type="button" class="btn-secondary white" data-action="copy">Copy coordinates</button>
        <button type="button" class="btn-secondary white" data-action="back">Notice list</button>
        <button type="button" class="btn-secondary white" data-action="overlap">Check observed position overlaps</button>
    </div>
</section>`,
    row: `<li><strong data-field="label"></strong><span data-field="value"></span></li>`,
    source: `<a rel="noopener noreferrer" target="_blank" data-field="source">Original source</a>`,
    list: `
<section>
    <p class="wz-notice-summary" data-field="summary"></p>
    <div class="wz-notice-controls">
        <button type="button" class="btn-primary" data-action="unfocus">Unfocus</button>
        <select aria-label="Notice time filter" data-action="status">
            <option value="live">live</option><option value="active">active</option>
            <option value="upcoming">upcoming</option><option value="expired">expired</option>
            <option value="cancelled">cancelled</option><option value="all">all</option>
        </select>
        <button type="button" class="btn-secondary white" data-action="coverage" data-all-label="All notices" data-military-label="Military-related">All notices</button>
        <button type="button" class="btn-secondary white" data-action="previous">Previous</button>
        <button type="button" class="btn-secondary white" data-action="next">Next</button>
    </div>
    <div class="wz-notice-cards" data-slot="cards"></div>
</section>`,
    card: `
<article class="wz-notice-card">
    <div class="wz-notice-card__head"><strong data-field="title"></strong><span class="status-pill status-pill--elevated" data-field="status"></span></div>
    <p data-field="summary"></p>
    <button type="button" class="btn-secondary white" data-action="view">View notice</button>
</article>`,
    unfocus: `<button type="button" class="btn-primary" data-action="unfocus">Unfocus</button>`,
    capture: `
<div class="wz-notice-capture" role="dialog" aria-label="Select NOTAM screenshot area">
    <div class="wz-notice-capture__selection" data-slot="selection" hidden><span class="wz-notice-capture__resize" data-action="resize"></span></div>
    <div class="wz-notice-capture__toolbar">
        <span aria-live="polite" data-field="status" data-draw-instructions="Drag to draw; Escape restores selection." data-resize-instructions="Move or resize; include the notice."></span>
        <select aria-label="Capture aspect ratio" data-action="aspect">
            <option value="1:1">1:1 – Square</option>
            <option value="16:9">16:9 – Landscape</option>
            <option value="9:16">9:16 – Portrait</option>
            <option value="custom">Custom – Freeform</option>
        </select>
        <button type="button" class="btn-secondary white" data-action="draw" data-draw-label="DRAW" data-resize-label="RESIZE">DRAW</button>
        <button type="button" class="btn-secondary white" data-action="reset">RESET</button>
        <button type="button" class="btn-secondary white" data-action="cancel">CANCEL</button>
        <button type="button" class="btn-secondary white" data-action="save">SAVE AS</button>
    </div>
</div>`,
    export: `
<div class="notam-export">
    <img class="notam-export__stratops-logo" data-field="stratops-logo" alt="StratOps">
    <div class="notam-export__timestamp" data-export-text data-field="timestamp"></div>
    <div class="notam-export__intelligence">
        <div class="notam-export__identifier" data-export-text data-field="identifier"></div>
        <div class="notam-export__type" data-export-text data-field="type"></div>
        <div class="notam-export__details">
            <div class="notam-export__detail" data-export-text data-field="STATUS" data-label="STATUS"></div>
            <div class="notam-export__detail" data-export-text data-field="AREA" data-label="AREA"></div>
            <div class="notam-export__detail" data-export-text data-field="PLACE" data-label="PLACE"></div>
            <div class="notam-export__detail" data-export-text data-field="DATES" data-label="DATES"></div>
            <div class="notam-export__detail" data-export-text data-field="UNTIL" data-label="UNTIL"></div>
        </div>
    </div>
    <div class="notam-export__source" data-export-text data-field="source" data-label="Source"></div>
    <img class="notam-export__battlespacex-logo" data-field="battlespacex-logo" alt="BattlespaceX">
    <div class="notam-export__marker" data-field="marker"></div>
</div>`
});

// Only trusted static markup enters innerHTML. Every clone owns its listeners.
const templates = new Map();
export function cloneNoticeTemplate(name) {
    if (!templates.has(name)) {
        if (!Object.hasOwn(NOTICE_TEMPLATES, name)) throw Error('Unknown NOTAM template: ' + name);
        const template = document.createElement('template');
        template.innerHTML = NOTICE_TEMPLATES[name].trim();
        templates.set(name, template);
    }
    return templates.get(name).content.firstElementChild.cloneNode(true);
}

export const noticeField = (root, name) => root.querySelector(`[data-field="${name}"]`);
export const noticeAction = (root, name) => root.querySelector(`[data-action="${name}"]`);
