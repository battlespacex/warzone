import * as Cesium from 'cesium';
import { copyNextSceneFrame, assertCaptureReadable, loadImage, downloadBlob, canUseSavePicker } from './warzone-capture-shot.js';
import { noticeGeometryPoints, noticeStatus } from '../../../apps/shared/geospatial-notices.js';
let activeCancel = null;
export function captureRectangle(start, end, width, height) {
    const clamp = (v, max) => Math.max(0, Math.min(max, v)); const x1 = clamp(start.x, width), x2 = clamp(end.x, width), y1 = clamp(start.y, height), y2 = clamp(end.y, height);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export const NOTICE_CAPTURE_RATIOS = Object.freeze({
    '1:1': { label: '1:1 – Square', width: 1, height: 1, minWidth: 720, minHeight: 720 },
    '16:9': { label: '16:9 – Landscape', width: 16, height: 9, minWidth: 912, minHeight: 513 },
    '9:16': { label: '9:16 – Portrait', width: 9, height: 16, minWidth: 513, minHeight: 912 },
    custom: { label: 'Custom – Freeform', minWidth: 512, minHeight: 512 }
});
// Use the actual framebuffer, which already includes Cesium resolutionScale and DPR.
export function noticeCaptureLimits(canvas, bounds, aspect = 'custom', maxPixels = 16000000) {
    const preset = NOTICE_CAPTURE_RATIOS[aspect]; if (!preset) throw Error('Choose a supported capture aspect ratio.');
    const sx = canvas.width / bounds.width, sy = canvas.height / bounds.height, ratio = Math.min(sx, sy);
    if (!(Number.isFinite(ratio) && ratio > 0 && Number.isFinite(maxPixels) && maxPixels > 0)) throw Error('The map capture resolution is unavailable.');
    const maxWidth = Math.floor(bounds.width * ratio), maxHeight = Math.floor(bounds.height * ratio);
    if (maxWidth < preset.minWidth || maxHeight < preset.minHeight || preset.minWidth * preset.minHeight > maxPixels) throw Error(`${preset.label} needs at least ${preset.minWidth} × ${preset.minHeight} exported pixels; this viewport supports ${maxWidth} × ${maxHeight} (limit ${maxPixels.toLocaleString()} pixels). Enlarge the map viewport or choose another ratio.`);
    return { ...preset, ratio, sx, sy, maxWidth, maxHeight, maxPixels };
}
export function constrainedNoticeRectangle(start, end, bounds, limits) {
    const { ratio, minWidth, minHeight, maxPixels } = limits;
    let width = Math.max(minWidth, Math.min(limits.maxWidth, Math.round(Math.abs(end.x - start.x) * ratio))), height = Math.max(minHeight, Math.min(limits.maxHeight, Math.round(Math.abs(end.y - start.y) * ratio)));
    if (limits.width) {
        const min = Math.ceil(Math.max(minWidth / limits.width, minHeight / limits.height));
        const max = Math.floor(Math.min(limits.maxWidth / limits.width, limits.maxHeight / limits.height, Math.sqrt(maxPixels / (limits.width * limits.height))));
        const size = Math.max(min, Math.min(max, Math.round(Math.max(width / limits.width, height / limits.height))));
        width = size * limits.width; height = size * limits.height;
    } else if (width * height > maxPixels) {
        const scale = Math.sqrt(maxPixels / (width * height)); width = Math.max(minWidth, Math.floor(width * scale)); height = Math.max(minHeight, Math.floor(height * scale));
        width = Math.min(width, Math.floor(maxPixels / minHeight)); height = Math.min(height, Math.floor(maxPixels / width));
    }
    width /= ratio; height /= ratio;
    return { x: Math.max(0, Math.min(bounds.width - width, end.x < start.x ? start.x - width : start.x)), y: Math.max(0, Math.min(bounds.height - height, end.y < start.y ? start.y - height : start.y)), width, height };
}
function captureMaxPixels() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wz-notice-export-max-pixels')); }
export function noticeCaptureAnchor(notice) {
    const points = noticeGeometryPoints(notice.geometry); if (!points.length) return null;
    if (notice.geometry.type === 'Point') return Cesium.Cartesian3.fromDegrees(...points[0]);
    const sphere = Cesium.BoundingSphere.fromPoints(points.map(p => Cesium.Cartesian3.fromDegrees(...p)));
    return Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(sphere.center);
}
export function noticeExportDate(value, { dateOnly = false } = {}) {
    if (typeof value !== 'string' || !value.trim() || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return 'N/A';
    const day = new Date(value.slice(0, 10) + 'T00:00:00Z'); if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return 'N/A';
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return 'N/A';
    return dateOnly ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' }).format(date).toUpperCase() : date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}
function exportComponent(notice, logos, capturedAt, width, height, anchor) {
    const root = document.createElement('div'); root.className = 'notam-export';
    const css = getComputedStyle(document.documentElement), number = name => parseFloat(css.getPropertyValue(name));
    const minWidth = number('--notam-export-layout-min-width'), minHeight = number('--notam-export-layout-min-height');
    if (!(minWidth > 0 && minHeight > 0)) throw Error('NOTAM export stylesheet is unavailable.');
    // Composition uses exported pixels. Keep the editable CSS typography readable.
    const scale = 1;
    Object.assign(root.style, { width: width / scale + 'px', height: height / scale + 'px' });
    const add = (name, text, parent = root) => { const el = document.createElement('div'); el.className = 'notam-export__' + name; if (text !== undefined) { el.textContent = text; el.setAttribute('data-export-text', ''); } parent.append(el); return el; };
    const top = document.createElement('img'); top.className = 'notam-export__stratops-logo'; top.src = logos[0].src; top.alt = 'StratOps'; root.append(top);
    add('timestamp', capturedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    const info = add('intelligence'); add('identifier', notice.sourceId || notice.title || 'N/A', info); add('type', notice.noticeType || 'NOTAM', info);
    const details = add('details', undefined, info);
    for (const [key, value] of Object.entries({ STATUS: noticeStatus(notice, capturedAt.getTime()), AREA: notice.region || notice.fir || 'N/A', PLACE: notice.country || 'N/A', DATES: noticeExportDate(notice.effectiveFrom, { dateOnly: true }) + ' – ' + noticeExportDate(notice.effectiveUntil, { dateOnly: true }), UNTIL: noticeExportDate(notice.effectiveUntil) })) add('detail', key + ': ' + value, details);
    add('source', 'Source: ' + (notice.provider || notice.source_name || notice.issuer || 'N/A'));
    const bottom = document.createElement('img'); bottom.className = 'notam-export__battlespacex-logo'; bottom.src = logos[1].src; bottom.alt = 'BattlespaceX'; root.append(bottom);
    const marker = add('marker'); Object.assign(marker.style, { left: anchor.x / scale + 'px', top: anchor.y / scale + 'px' });
    document.body.append(root); return { root, scale, images: [top, bottom] };
}
function polygonPath(ctx, clip, box, inset = 0) {
    const match = clip.match(/^polygon\((.*)\)$/); if (!match) throw Error('NOTAM export clip-path must be a polygon.');
    const points = match[1].split(',').map(pair => pair.trim().split(/\s+/));
    ctx.beginPath(); points.forEach((pair, i) => { if (pair.length !== 2) throw Error('Invalid NOTAM export polygon.'); const coords = pair.map((v, axis) => { if (!/^-?[\d.]+(?:%|px)?$/.test(v)) throw Error('Use percentage or pixel export polygon coordinates.'); return parseFloat(v) * (v.endsWith('%') ? (axis ? box.height : box.width) - 2 * inset : 100) / 100; }); const x = box.x + inset + coords[0], y = box.y + inset + coords[1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath();
}
// Use browser layout and computed CSS rather than a second set of Canvas design values.
// Only this small export component is measured, once per user-requested capture.
export async function paintNoticeExport(ctx, notice, logos, capturedAt, width, height, anchor, pixelRatio = 1) {
    const component = exportComponent(notice, logos, capturedAt, width, height, anchor), { root, scale, images } = component;
    try {
        await Promise.all(images.map(image => image.decode())); await document.fonts?.ready;
        const origin = root.getBoundingClientRect(), nodes = [...root.querySelectorAll('[data-export-text], img, .notam-export__marker')];
        const overlaps = (a, b) => a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5;
        const timestamp = nodes.find(el => el.className === 'notam-export__timestamp'), logo = images[0], gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--notam-export-info-gap')) || 4;
        // Narrow exports need a second header row, without shrinking either element.
        if (overlaps(timestamp.getBoundingClientRect(), logo.getBoundingClientRect())) timestamp.style.top = logo.getBoundingClientRect().bottom - origin.top + gap + 'px';
        const source = nodes.find(el => el.className === 'notam-export__source'), info = [...root.children].find(el => el.className === 'notam-export__intelligence');
        if (overlaps(source.getBoundingClientRect(), info.getBoundingClientRect())) info.style.bottom = origin.bottom - source.getBoundingClientRect().top + gap + 'px';
        const content = nodes.filter(el => el.className !== 'notam-export__marker');
        for (let i = 0; i < content.length; i++)for (let j = i + 1; j < content.length; j++)if (overlaps(content[i].getBoundingClientRect(), content[j].getBoundingClientRect())) throw Error('Notice text and branding need more room. Enlarge the capture rectangle or adjust the export CSS margins.');
        ctx.save(); ctx.scale(scale * pixelRatio, scale * pixelRatio);
        for (const el of nodes) {
            const css = getComputedStyle(el), rect = el.getBoundingClientRect(), box = { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height };
            if (el.className !== 'notam-export__marker' && (box.x < -.5 || box.y < -.5 || box.x + box.width > origin.width + .5 || box.y + box.height > origin.height + .5)) throw Error('Export styling exceeds the selection. Adjust export margins or sizes.');
            ctx.save(); ctx.globalAlpha = parseFloat(css.opacity); const clip = css.clipPath;
            if (clip && clip !== 'none') { polygonPath(ctx, clip, box); ctx.clip(); }
            ctx.fillStyle = css.backgroundColor; ctx.fillRect(box.x, box.y, box.width, box.height);
            if (el.tagName === 'IMG') {
                const image = logos[images.indexOf(el)], ratio = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight), w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
                ctx.drawImage(image, box.x + (box.width - w) / 2, box.y + (box.height - h) / 2, w, h);
            } else if (el.className === 'notam-export__marker') {
                const border = parseFloat(css.borderTopWidth); polygonPath(ctx, clip, box, border / 2); ctx.strokeStyle = css.borderTopColor; ctx.lineWidth = border; ctx.stroke();
            } else {
                ctx.font = [css.fontStyle, css.fontWeight, css.fontSize, css.fontFamily].join(' '); ctx.fillStyle = css.color; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = css.letterSpacing === 'normal' ? '0px' : css.letterSpacing;
                const text = el.firstChild, range = document.createRange(), lines = [];
                // Range positions preserve actual wrapping, padding, alignment and font metrics.
                for (let i = 0; i < text.length; i++) { range.setStart(text, i); range.setEnd(text, i + 1); const r = range.getBoundingClientRect(); let line = lines.at(-1); if (!line || Math.abs(line.top - r.top) > .5) { line = { top: r.top, left: r.left, height: r.height, text: '' }; lines.push(line); } line.text += text.textContent[i]; }
                for (const line of lines) {
                    const value = css.textTransform === 'uppercase' ? line.text.toUpperCase() : line.text, metrics = ctx.measureText(value), ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
                    ctx.fillText(value, line.left - origin.left, line.top - origin.top + (line.height - ascent - descent) / 2 + ascent);
                }
            } ctx.restore();
        } ctx.restore();
    } finally { root.remove(); }
}
export async function composeNoticeCapture(viewer, notice, selection, { entity = null, now = null, aspect = 'custom' } = {}) {
    let capturedAt = now || new Date();
    const canvas = viewer.scene.canvas, rect = canvas.getBoundingClientRect();
    if (!selection || ![selection.x, selection.y, selection.width, selection.height].every(Number.isFinite)) throw Error('Draw a valid screenshot rectangle.');
    if (viewer.scene.globe?.tilesLoaded === false) throw Error('Map imagery is still loading. Wait before saving.');
    if (['expired', 'cancelled', 'superseded'].includes(noticeStatus(notice, capturedAt.getTime()))) throw Error('This notice is no longer current. Refresh notices before capturing it.');
    const { sx, sy, ratio, minWidth, minHeight, maxPixels } = noticeCaptureLimits(canvas, rect, aspect, captureMaxPixels());
    if (!(sx > 0 && sy > 0) || selection.x < 0 || selection.y < 0 || selection.x + selection.width > rect.width + .5 || selection.y + selection.height > rect.height + .5) throw Error('The viewport changed. Redraw the selection.');
    const width = Math.round(selection.width * ratio), height = Math.round(selection.height * ratio), preset = NOTICE_CAPTURE_RATIOS[aspect];
    if (width < minWidth || height < minHeight) throw Error(`Select at least ${minWidth} × ${minHeight} exported pixels.`);
    if (preset.width && (width * preset.height !== height * preset.width || Math.abs(selection.width / selection.height - preset.width / preset.height) > 1e-8)) throw Error('The selection no longer matches the chosen aspect ratio. Reset the rectangle.');
    if (width * height > maxPixels) throw Error('Selection exceeds the export pixel limit. Select a smaller region.');
    const frameWidth = canvas.width, frameHeight = canvas.height;
    const logos = await Promise.all([loadImage('/assets/images/web/logo-stratops-battlespacex.svg'), loadImage('/assets/images/web/Battlespacex-full-logo.svg')]);
    if (logos.some(logo => !logo)) throw Error('Capture branding could not be loaded.');
    let projected;
    const frame = await copyNextSceneFrame(viewer, () => {
        const current = canvas.getBoundingClientRect(); if (canvas.width !== frameWidth || canvas.height !== frameHeight || current.width !== rect.width || current.height !== rect.height || current.left !== rect.left || current.top !== rect.top) throw Error('The map capture resolution changed. Reset the rectangle before saving.');
        capturedAt = now || new Date(); if (['expired', 'cancelled', 'superseded'].includes(noticeStatus(notice, capturedAt.getTime()))) throw Error('Notice expired before the capture frame.');
        if (entity && viewer.dataSourceDisplay?.getBoundingSphere) { const state = viewer.dataSourceDisplay.getBoundingSphere(entity, false, new Cesium.BoundingSphere()); if (state !== Cesium.BoundingSphereState.DONE) throw Error('Notice geometry is not ready. Wait before saving.'); }
        const anchor = entity?.position?.getValue?.(Cesium.JulianDate.now()) || noticeCaptureAnchor(notice); projected = anchor && Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, anchor);
        if (projected) projected = { x: projected.x * rect.width / (canvas.clientWidth || rect.width), y: projected.y * rect.height / (canvas.clientHeight || rect.height) };
    });
    assertCaptureReadable(frame, 'NOTAM map frame');
    if (!projected || projected.x < selection.x || projected.y < selection.y || projected.x > selection.x + selection.width || projected.y > selection.y + selection.height) throw Error('Include the selected notice location inside the screenshot rectangle.');
    const output = document.createElement('canvas'); output.width = width; output.height = height; const ctx = output.getContext('2d'); if (!ctx) throw Error('Canvas export is unavailable.');
    ctx.drawImage(frame, selection.x * sx, selection.y * sy, selection.width * sx, selection.height * sy, 0, 0, width, height);
    const anchor = { x: (projected.x - selection.x) * ratio, y: (projected.y - selection.y) * ratio };
    await paintNoticeExport(ctx, notice, logos, capturedAt, width, height, anchor, 1);
    assertCaptureReadable(output, 'NOTAM annotations and branding');
    return new Promise((resolve, reject) => { output.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG encoding failed; no image was saved.')), 'image/png'); });
}
export function startNoticeCapture(viewer, notice, { entity = null, onClose = () => { } } = {}) {
    activeCancel?.(); const controller = viewer?.scene?.screenSpaceCameraController, canvas = viewer?.scene?.canvas;
    if (!canvas || controller?.enableInputs === false) throw Error('Finish the current map drawing or camera transition before TAKE SHOT.');
    const previous = controller?.enableInputs; if (controller) controller.enableInputs = false;
    const bounds = canvas.getBoundingClientRect(), overlay = document.createElement('div'); overlay.className = 'wz-notice-capture'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', 'Select NOTAM screenshot area');
    Object.assign(overlay.style, { left: bounds.left + 'px', top: bounds.top + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
    const selectionBox = document.createElement('div'); selectionBox.className = 'wz-notice-capture__selection'; selectionBox.hidden = true;
    const resize = document.createElement('span'); resize.className = 'wz-notice-capture__resize'; selectionBox.append(resize); overlay.append(selectionBox);
    const toolbar = document.createElement('div'); toolbar.className = 'wz-notice-capture__toolbar';
    const status = document.createElement('span'); status.setAttribute('aria-live', 'polite'); toolbar.append(status);
    const aspects = document.createElement('select'); aspects.setAttribute('aria-label', 'Capture aspect ratio');
    for (const [value, preset] of Object.entries(NOTICE_CAPTURE_RATIOS)) { const option = document.createElement('option'); option.value = value; option.textContent = preset.label; aspects.append(option); } aspects.value = '1:1'; toolbar.append(aspects);
    let selection = null, gesture = null, pointer = null, draw = false, closed = false, saving = false, limits = null, limitation = '', message = '', obstacles = [];
    const previousFocus = document.activeElement;
    const buttons = {}; for (const label of ['DRAW', 'RESET', 'CANCEL', 'SAVE AS']) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-secondary white'; b.textContent = label; buttons[label] = b; toolbar.append(b); }
    buttons['SAVE AS'].disabled = true; overlay.append(toolbar); document.body.append(overlay);
    const point = e => ({ x: Math.max(0, Math.min(bounds.width, e.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, e.clientY - bounds.top)) });
    function blockers() { return [...document.querySelectorAll('#wz-map-layers-pane, #warzone-notice-panel, .wz-dock, .wz-header')].filter(el => el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.left - bounds.left - 8), y: Math.max(0, r.top - bounds.top - 8), right: Math.min(bounds.width, r.right - bounds.left + 8), bottom: Math.min(bounds.height, r.bottom - bounds.top + 8) }; }).filter(r => r.right > r.x && r.bottom > r.y); }
    function defaultSelection() {
        const minimum = constrainedNoticeRectangle({ x: 0, y: 0 }, { x: 0, y: 0 }, bounds, limits);
        let spaces = [{ x: 0, y: 0, width: bounds.width, height: bounds.height }];
        for (const b of obstacles) spaces = spaces.flatMap(r => {
            const right = r.x + r.width, bottom = r.y + r.height; if (b.right <= r.x || b.x >= right || b.bottom <= r.y || b.y >= bottom) return [r];
            return [{ ...r, width: b.x - r.x }, { ...r, x: b.right, width: right - b.right }, { ...r, height: b.y - r.y }, { ...r, y: b.bottom, height: bottom - b.bottom }].filter(s => s.width >= minimum.width && s.height >= minimum.height);
        });
        const space = spaces.sort((a, b) => b.width * b.height - a.width * a.height)[0] || { x: 0, y: 0, width: bounds.width, height: bounds.height };
        return { ...minimum, x: space.x + (space.width - minimum.width) / 2, y: space.y + (space.height - minimum.height) / 2 };
    }
    function positionToolbar() {
        const { width, height } = toolbar.getBoundingClientRect(), gap = 12, pad = Math.min(8, bounds.width / 2, bounds.height / 2);
        const clamp = (v, max) => Math.max(pad, Math.min(Math.max(pad, max - pad), v));
        const x = selection ? selection.x + (selection.width - width) / 2 : (bounds.width - width) / 2;
        const below = selection ? selection.y + selection.height + gap : pad, above = selection ? selection.y - height - gap : pad;
        const candidates = [{ x: clamp(x, bounds.width - width), y: below }, { x: clamp(x, bounds.width - width), y: above }];
        const fits = p => p.y >= pad && p.y + height <= bounds.height - pad && !obstacles.some(b => p.x < b.right && p.x + width > b.x && p.y < b.bottom && p.y + height > b.y);
        const placed = candidates.find(fits) || { x: candidates[0].x, y: clamp(above, bounds.height - height) };
        Object.assign(toolbar.style, { left: placed.x + 'px', top: placed.y + 'px' });
    }
    function render() {
        selectionBox.hidden = !selection; overlay.classList.toggle('has-selection', Boolean(selection)); overlay.classList.toggle('is-drawing', draw);
        aspects.disabled = saving; buttons.DRAW.disabled = saving || !limits; buttons.RESET.disabled = saving; buttons['SAVE AS'].disabled = saving || !selection || !limits;
        buttons.DRAW.textContent = draw ? 'RESIZE' : 'DRAW';
        if (selection) Object.assign(selectionBox.style, { left: selection.x + 'px', top: selection.y + 'px', width: selection.width + 'px', height: selection.height + 'px' });
        const size = selection ? `${Math.round(selection.width * limits.ratio)} × ${Math.round(selection.height * limits.ratio)} px` : '', minimum = limits ? `Minimum ${limits.minWidth} × ${limits.minHeight}` : '';
        const text = limitation || message || `${size} · ${minimum}${selection && (Math.round(selection.width * limits.ratio) === limits.minWidth || Math.round(selection.height * limits.ratio) === limits.minHeight) ? ' (minimum reached)' : ''}. ${draw ? 'Drag to draw; Escape restores selection.' : 'Move or resize; include the notice.'}`;
        if (status.textContent !== text) status.textContent = text; positionToolbar();
    }
    function finishGesture(restore = false) { if (gesture && restore) selection = gesture.original; gesture = null; const id = pointer; pointer = null; if (id !== null && overlay.hasPointerCapture?.(id)) overlay.releasePointerCapture(id); }
    function reset() { finishGesture(); draw = false; message = ''; limitation = ''; try { limits = noticeCaptureLimits(canvas, bounds, aspects.value, captureMaxPixels()); obstacles = blockers(); selection = defaultSelection(); } catch (error) { limits = null; selection = null; limitation = error.message; } render(); }
    function cancel() { if (closed) return; closed = true; finishGesture(); overlay.remove(); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', cancel); if (controller) controller.enableInputs = previous; activeCancel = null; previousFocus?.focus?.({ preventScroll: true }); onClose(); }
    function escape(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (gesture || draw) { finishGesture(true); draw = false; message = ''; render(); } else cancel(); } }
    overlay.addEventListener('pointerdown', e => {
        e.stopPropagation(); if (saving || !limits || gesture || e.button > 0) return; e.preventDefault(); pointer = e.pointerId; overlay.setPointerCapture?.(pointer); const p = point(e); message = '';
        gesture = { start: p, original: selection && { ...selection }, mode: e.target === resize ? 'resize' : !draw && e.target === selectionBox ? 'move' : 'draw' }; if (gesture.mode === 'draw') selection = constrainedNoticeRectangle(p, p, bounds, limits); render();
    });
    overlay.addEventListener('pointermove', e => {
        e.stopPropagation(); if (saving || !gesture || e.pointerId !== pointer) return; e.preventDefault(); const p = point(e), g = gesture;
        if (g.mode === 'move') { selection = { ...g.original, x: Math.max(0, Math.min(bounds.width - g.original.width, g.original.x + p.x - g.start.x)), y: Math.max(0, Math.min(bounds.height - g.original.height, g.original.y + p.y - g.start.y)) }; }
        else selection = constrainedNoticeRectangle(g.mode === 'resize' ? { x: g.original.x, y: g.original.y } : g.start, p, bounds, limits); render();
    });
    const up = e => { e.stopPropagation(); if (e.pointerId !== pointer) return; finishGesture(e.type === 'pointercancel'); draw = false; render(); };
    overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', up);
    toolbar.addEventListener('pointerdown', e => e.stopPropagation()); toolbar.addEventListener('click', e => e.stopPropagation());
    aspects.onchange = () => { reset(); if (limits && aspects.value === 'custom') { draw = true; render(); } };
    buttons.DRAW.onclick = () => { finishGesture(true); draw = !draw; message = ''; render(); };
    buttons.RESET.onclick = reset; buttons.CANCEL.onclick = cancel;
    buttons['SAVE AS'].onclick = async () => {
        if (saving || gesture || buttons['SAVE AS'].disabled) return; let handle = null; const chosen = { ...selection }, aspect = aspects.value, now = new Date(), filename = 'StratOps_NOTAM_' + now.toISOString().slice(0, 10) + '_' + now.toISOString().slice(11, 19).replaceAll(':', '') + 'Z.png';
        saving = true; render(); try {
            if (canUseSavePicker()) handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }] });
            if (closed) return; const blob = await composeNoticeCapture(viewer, notice, chosen, { entity, aspect }); if (closed) return;
            if (handle) { const writer = await handle.createWritable(); await writer.write(blob); await writer.close(); } else downloadBlob(blob, filename); cancel();
        } catch (error) { if (!closed && error.name !== 'AbortError') message = 'Capture failed: ' + error.message + ' No complete image was saved.'; } finally { saving = false; if (!closed) render(); }
    };
    document.addEventListener('keydown', escape, true); window.addEventListener('resize', cancel); activeCancel = cancel; reset(); aspects.focus?.({ preventScroll: true }); return cancel;
}
