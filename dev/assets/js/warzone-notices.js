import { cloneNoticeTemplate, noticeField, noticeAction } from './warzone-notice-templates.js';
import * as Cesium from 'cesium';
import { onLayerChange, isLayerEnabled } from './warzone-layers.js';
import { NOTICE_LAYERS, correlateObservation, matchesNoticeLayers, noticeGeometryParts, noticeGeometryPoints, noticeStatus, nextNoticeBoundary } from '../../../apps/shared/geospatial-notices.js';
import { getAllLiveTrackSnapshots } from './warzone-live-airforce.js';
import { getAllNavalSnapshots } from './warzone-live-naval.js';
import { getActiveRegion, onRegionChange } from './warzone-region-selector.js';
import { getAssetFocusController } from './warzone-asset-focus-controller.js';
let owner = null;
export function initNoticeLayers(viewer, { bindFloatingPanel, canRefresh = () => true, showOnInit = true, loadCapture = () => import(/* webpackChunkName: "warzone-notice-capture" */ './warzone-notice-capture.js') } = {}) {
    if (!viewer || owner?.viewer === viewer) return; owner?.dispose();
    let source = null, handler = null, timer = null, controller = null, panel = null, selected = null, generation = 0, frame = 0;
    const records = new Map();
    const renderKeys = new Map();
    let panelKey = '', retryFailures = 0, scopePending = false, scopeTimer = 0, requestKey = '', pointerHeld = false, wheelActive = false, wheelTimer = 0, scenePending = null;
    let widgetRequested = showOnInit;
    let terminalState = false;
    let disposeDrag = null, noticePosition = null;
    let noticeFocus = null, focusButton = null;
    let previewMode = false, previewLeader = null, previewTimer = 0, expiryTimer = 0, captureSequence = 0, cancelCapture = null;
    let mainWidget = null, removePopupTracking = null, popupLayout = '', edgeArmed = false, popupOffset = { x: 16, y: -18 }, popupView = null, popupMeasure = '', popupSize = '', lastAnchor = null;
    const fading = new Map();
    const entityIds = new Map();
    let layerKey = NOTICE_LAYERS.filter(isLayerEnabled).join(',');
    function unfocusNotice({ restore = true } = {}) {
        const previous = noticeFocus; noticeFocus = null;
        if (focusButton) focusButton.textContent = focusButton.getAttribute('data-focus-label');
        if (!restore || !previous || viewer.trackedEntity || getAssetFocusController().getState().assetId) return;
        viewer.camera.cancelFlight?.();
        viewer.camera.flyTo({ destination: previous.view.position, orientation: { direction: previous.view.direction, up: previous.view.up }, endTransform: Cesium.Matrix4.IDENTITY, duration: 1 });
    }
    function focusNotice(n) {
        if (viewer.trackedEntity || getAssetFocusController().getState().assetId) return;
        if (noticeFocus?.id === n.id) { unfocusNotice(); return; }
        const camera = viewer.camera; if (!camera?.positionWC || !camera.directionWC || !camera.upWC) return;
        const coords = noticeGeometryPoints(n.geometry);
        if (!coords.length) return;
        const sphere = Cesium.BoundingSphere.fromPoints(coords.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
        sphere.radius = Math.max(sphere.radius, n.geometry.type === 'Point' ? (n.metadata?.radiusNm || 0) * 1852 : 0, 250);
        const view = noticeFocus?.view || { position: Cesium.Cartesian3.clone(camera.positionWC), direction: Cesium.Cartesian3.clone(camera.directionWC), up: Cesium.Cartesian3.clone(camera.upWC) };
        noticeFocus = { id: n.id, view };
        camera.cancelFlight?.(); camera.flyToBoundingSphere(sphere, { duration: 1 });
        if (focusButton) focusButton.textContent = focusButton.getAttribute('data-unfocus-label');
    }
    // Cached presentation tokens: never parse CSS inside the render loop.
    function readStyle() {
        const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
        const value = (name, fallback) => css?.getPropertyValue('--wz-notice-' + name)?.trim() || fallback;
        const number = (name, fallback, min, max) => { const n = Number.parseFloat(value(name, '')); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
        const color = (name, fallback) => Cesium.Color.fromCssColorString(value(name, fallback)) || Cesium.Color.ORANGE;
        return {
            line: color('line-color', '#ff9f1c'), fill: color('fill-color', '#ff9f1c'), hatch: color('hatch-color', '#ff9f1c'), critical: color('critical-color', '#ff4d4d'),
            opacity: number('fill-opacity', .07, 0, 1), hatchOpacity: number('hatch-opacity', .22, 0, 1), stripes: number('hatch-repeat', 32, 2, 128),
            width: number('line-width', 2, 1, 10), height: number('height', 60, 1, 1000), point: number('marker-size', 9, 3, 32), enclosures: number('show-radius', 0, 0, 1) === 1, previewDistance: number('preview-distance', 1800000, 1000, 20000000), previewDelay: number('preview-delay', 180, 0, 2000), labelDistance: number('label-distance', 500000, 0, 20000000), labelSize: number('label-size', 12, 8, 32), hatchWidth: number('hatch-width', 1, .1, 12), hatchSpacing: number('hatch-spacing', 12, 2, 64), hatchAngle: number('hatch-angle', 45, -180, 180)
        };
    }
    let style = readStyle(), detailOpen = false;
    const materialCache = new Map(); let materialStyle = null;
    const noticeColor = n => ['high', 'critical'].includes(n.metadata?.severity) ? style.critical : style.line;
    const renderKey = n => JSON.stringify([n.geometry, n.metadata?.radiusNm, n.metadata?.radiusSource, n.metadata?.corridorWidthMeters, n.metadata?.severity, style]);
    function createHatchMaterial(hatch = style.hatch, fill = style.fill) {
        const image = document.createElement('canvas'); image.width = image.height = Math.round(style.hatchSpacing);
        const ctx = image.getContext('2d'); if (!ctx) throw Error('NOTAM hatch canvas is unavailable');
        ctx.fillStyle = fill.withAlpha(style.opacity).toCssColorString(); ctx.fillRect(0, 0, image.width, image.height);
        ctx.strokeStyle = hatch.withAlpha(style.hatchOpacity).toCssColorString(); ctx.lineWidth = style.hatchWidth;
        ctx.beginPath(); ctx.moveTo(image.width / 2, 0); ctx.lineTo(image.width / 2, image.height); ctx.stroke();
        return new Cesium.ImageMaterialProperty({ image, transparent: true, repeat: new Cesium.Cartesian2(style.stripes * 12 / style.hatchSpacing, style.stripes * 12 / style.hatchSpacing) });
    }
    function graphics(n) {
        let material; const line = noticeColor(n);
        if (n.geometry?.type === 'Polygon' || (n.geometry?.type === 'LineString' && n.metadata?.corridorWidthMeters) || ((style.enclosures || n.metadata?.radiusSource === 'published') && n.geometry?.type === 'Point' && n.metadata?.radiusNm)) {
            if (materialStyle !== style) { materialCache.clear(); materialStyle = style; }
            const key = line === style.critical ? 'critical' : 'default'; if (!materialCache.has(key)) materialCache.set(key, key === 'critical' ? createHatchMaterial(line, line) : createHatchMaterial()); material = materialCache.get(key);
        }
        if (n.geometry?.type === 'Polygon') {
            const rings = n.geometry.coordinates, positions = ring => Cesium.Cartesian3.fromDegreesArray(ring.flat());
            return {
                polygon: { hierarchy: new Cesium.PolygonHierarchy(positions(rings[0]), rings.slice(1).map(r => new Cesium.PolygonHierarchy(positions(r)))), material, stRotation: style.hatchAngle * Math.PI / 180, outline: false },
                polyline: { positions: positions(rings[0]), clampToGround: true, width: style.width, material: line }
            };
        }
        if (n.geometry?.type === 'Point') {
            const [lon, lat] = n.geometry.coordinates;
            let boundary;
            if ((style.enclosures || n.metadata?.radiusSource === 'published') && n.metadata?.radiusNm) {
                const geometry = Cesium.EllipseOutlineGeometry.createGeometry(new Cesium.EllipseOutlineGeometry({ center: Cesium.Cartesian3.fromDegrees(lon, lat), semiMajorAxis: n.metadata.radiusNm * 1852, semiMinorAxis: n.metadata.radiusNm * 1852, granularity: Cesium.Math.RADIANS_PER_DEGREE * 5 }));
                const values = geometry.attributes.position.values, positions = []; for (let i = 0; i < values.length; i += 3)positions.push(Cesium.Cartesian3.fromArray(values, i)); positions.push(positions[0]); boundary = { positions, clampToGround: true, width: style.width, material: line };
            }
            return {
                position: Cesium.Cartesian3.fromDegrees(lon, lat, style.height), point: { pixelSize: style.point, color: line, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
                ...(boundary ? { ellipse: { semiMajorAxis: n.metadata.radiusNm * 1852, semiMinorAxis: n.metadata.radiusNm * 1852, material, stRotation: style.hatchAngle * Math.PI / 180, outline: false }, polyline: boundary } : {})
            };
        }
        if (n.geometry?.type === 'LineString') { const positions = Cesium.Cartesian3.fromDegreesArray(n.geometry.coordinates.flat()); return n.metadata?.corridorWidthMeters ? { corridor: { positions, width: n.metadata.corridorWidthMeters, material, outline: true, outlineColor: line } } : { polyline: { positions, width: style.width, material: line, clampToGround: true } }; }
        return {};
    }
    function anchor(n) {
        const points = noticeGeometryPoints(n.geometry); if (!points.length) return null;
        const sphere = Cesium.BoundingSphere.fromPoints(points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
        return Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(sphere.center);
    }
    function removeNoticeEntities(id) { for (const key of entityIds.get(id) || [id]) source?.entities.removeById(key); entityIds.delete(id); }
    function applyNoticeGraphics(n) {
        const ids = []; noticeGeometryParts(n.geometry).forEach((geometry, i) => {
            const id = i === 0 ? n.id : n.id + '::part:' + i, part = { ...n, geometry }, next = graphics(part), position = next.position || anchor(part);
            let entity = source.entities.getById(id); if (!entity) entity = source.entities.add({ id });
            entity.__noticeId = n.id; entity.__noticeColor = noticeColor(n); entity.position = position;
            for (const key of ['polygon', 'polyline', 'corridor', 'ellipse', 'point']) entity[key] = next[key];
            if (i === 0 && style.labelDistance > 0) entity.label = {
                text: n.sourceId || n.title, font: style.labelSize + 'px sans-serif', fillColor: noticeColor(n), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(10, -10), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, style.labelDistance)
            };
            ids.push(id);
        }); entityIds.set(n.id, ids);
    }
    function takeShot(n, entity) {
        const ticket = ++captureSequence; cancelCapture?.(); loadCapture().then(module => {
            if (ticket !== captureSequence || !active()) return;
            cancelCapture = module.startNoticeCapture(viewer, n, { entity: entity && source?.entities.getById(entity.id) === entity ? entity : null, onClose: () => { cancelCapture = null; } });
        }).catch(error => { if (ticket === captureSequence && active()) window.alert?.('TAKE SHOT unavailable: ' + error.message); });
    }
    function shotButton(host, n, entity) { const button = noticeAction(host, 'shot'); button.disabled = !n.geometry; button.title = n.geometry ? 'Select a screen-space screenshot rectangle' : 'No published location is available'; button.onclick = () => takeShot(n, entity); }
    function updatePreviewLeader(position) {
        if (!position || !panel?.getBoundingClientRect || !document.createElementNS) return;
        if (!previewLeader) { previewLeader = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); previewLeader.classList.add('wz-notice-preview-leader'); previewLeader.append(document.createElementNS('http://www.w3.org/2000/svg', 'line')); document.body.append(previewLeader); }
        const canvas = viewer.scene.canvas.getBoundingClientRect(), rect = panel.getBoundingClientRect(), x = canvas.left + position.x, y = canvas.top + position.y, line = previewLeader.firstElementChild;
        for (const [key, value] of Object.entries({ x1: x, y1: y, x2: Math.max(rect.left, Math.min(rect.right, x)), y2: Math.max(rect.top, Math.min(rect.bottom, y)) })) line.setAttribute(key, String(value));
        previewLeader.style.display = '';
    }
    function compactPreview(n, entity, position) {
        if (!n) return; const key = 'preview:' + JSON.stringify([n.id, n.title, n.activityType, n.region, n.fir, currentStatus(n), n.effectiveUntil]);
        if (previewMode && panel && panelKey === key) { selected.notice = n; selected.signature = JSON.stringify(n); return; }
        widgetRequested = true; mountPanel(n.title || n.sourceId, true); panelKey = key; detailOpen = true; previewMode = true; selectAnchor(n); panel.className = 'wz-notice-popup wz-notice-preview';
        if (position) { const rect = viewer.scene.canvas.getBoundingClientRect?.() || { left: 0, top: 0 }; panel.style.left = Math.max(8, Math.min(rect.left + position.x + 16, (window.innerWidth || 1024) - (panel.offsetWidth || 280) - 8)) + 'px'; panel.style.top = Math.max(8, Math.min(rect.top + position.y + 16, (window.innerHeight || 768) - (panel.offsetHeight || 220) - 8)) + 'px'; }
        const body = panel.querySelector('.wz-widget-body'); body.querySelector('ul').hidden = true;
        const view = cloneNoticeTemplate('preview');
        noticeField(view, 'category').textContent = n.activityType || n.noticeType;
        for (const [name, value] of Object.entries({ status: currentStatus(n).toUpperCase(), area: n.region || n.fir || n.country || 'Published location', validity: n.effectiveUntil || (n.metadata?.permanent ? 'Permanent' : 'Not published') })) {
            const field = noticeField(view, name); field.textContent = field.getAttribute('data-label') + ': ' + value;
        }
        noticeAction(view, 'more').onclick = () => details(records.get(n.id) || n, entity, position);
        shotButton(view, n, entity); body.append(...view.children); updatePreviewLeader(position);
    }
    function currentStatus(n) { return n.effectiveFrom ? noticeStatus(n) : n.status || 'unknown'; }
    function scheduleExpiry() {
        clearTimeout(expiryTimer); expiryTimer = 0; let next = Infinity, changed = false;
        for (const [id, n] of records) {
            const status = currentStatus(n); if (status !== n.status) { n.status = status; changed = true; }
            if (['live', 'active', 'upcoming'].includes(viewStatus) && ['expired', 'cancelled', 'superseded'].includes(status)) { if (noticeFocus?.id === id) unfocusNotice(); removeNoticeEntities(id); records.delete(id); renderKeys.delete(id); changed = true; continue; }
            next = Math.min(next, nextNoticeBoundary(n));
        }
        if (changed) { panelKey = ''; if (!detailOpen) showList(); viewer.scene.requestRender(); }
        if (Number.isFinite(next)) expiryTimer = setTimeout(scheduleExpiry, Math.min(2147483647, Math.max(1, next - Date.now() + 1)));
    }
    let viewStatus = 'live', militaryOnly = false, offset = 0, total = 0;
    const active = () => NOTICE_LAYERS.some(isLayerEnabled);
    const matches = n => matchesNoticeLayers(n, NOTICE_LAYERS.filter(isLayerEnabled));
    function removePanel(element, fade = false) {
        if (!element) return;
        if (!fade || !element.animate) { element.remove(); return; }
        element.style.pointerEvents = 'none'; element.inert = true; element.setAttribute('aria-hidden', 'true'); const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        fading.set(element, animation); animation.finished.catch(() => { }).then(() => { element.remove(); fading.delete(element); });
    }
    function close(fade = true) {
        restoreHighlight();
        removePopupTracking?.(); removePopupTracking = null; disposeDrag?.(); disposeDrag = null;
        removePanel(panel, fade && detailOpen && active()); panel = null;
        if (mainWidget) { mainWidget.disposeDrag?.(); mainWidget.panel.remove(); mainWidget = null; }
        selected = null; focusButton = null; detailOpen = false; previewMode = false; previewLeader?.remove(); previewLeader = null; panelKey = ''; popupLayout = ''; edgeArmed = false;
    }
    function dismissDetails() {
        const saved = mainWidget; mainWidget = null; close();
        if (saved && active() && widgetRequested) {
            panel = saved.panel; panelKey = saved.key; disposeDrag = saved.disposeDrag; panel.inert = false; panel.style.opacity = '1'; panel.style.pointerEvents = ''; panel.setAttribute('aria-hidden', 'false');
            const controls = panel.querySelector('.wz-notice-controls'), unfocus = noticeAction(controls, 'unfocus');
            if (noticeFocus && !unfocus) { const button = cloneNoticeTemplate('unfocus'); button.onclick = () => { unfocusNotice(); button.remove(); }; controls.append(button); } else if (!noticeFocus) unfocus?.remove();
        }
        else { saved?.disposeDrag?.(); saved?.panel.remove(); if (widgetRequested && active()) showList(); }
    }
    function restoreHighlight() { const entity = selected?.entity; if (entity?.polyline) entity.polyline.material = entity.__noticeColor || style.line; if (entity?.ellipse) entity.ellipse.outlineColor = style.line; }
    function selectAnchor(n) {
        const same = selected?.id === n.id; restoreHighlight();
        selected = { id: n.id, notice: n, world: anchor(n), signature: JSON.stringify(n), entity: source?.entities.getById(n.id) }; popupLayout = ''; popupView = null;
        if (!same) { edgeArmed = false; popupOffset = { x: 16, y: -18 }; popupSize = ''; lastAnchor = null; }
        if (!removePopupTracking) removePopupTracking = viewer.scene.postRender?.addEventListener?.(positionPopup);
        viewer.scene.requestRender();
    }
    function positionPopup() {
        if (!detailOpen || !panel) return;
        if (!selected?.world) { dismissDetails(); return; }
        const scene = viewer.scene, camera = viewer.camera;
        const measure = [panel.offsetWidth, panel.offsetHeight, scene.canvas.clientWidth, scene.canvas.clientHeight, window.innerWidth, window.innerHeight].join('|');
        if (camera?.viewMatrix && popupView && Cesium.Matrix4.equals(camera.viewMatrix, popupView) && measure === popupMeasure) return;
        popupView = camera?.viewMatrix ? Cesium.Matrix4.clone(camera.viewMatrix) : null; popupMeasure = measure;
        if (camera?.positionWC && !new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, camera.positionWC).isPointVisible(selected.world)) { dismissDetails(); return; }
        const point = Cesium.SceneTransforms.worldToWindowCoordinates(scene, selected.world);
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { dismissDetails(); return; }
        const map = scene.canvas.getBoundingClientRect(), x = map.left + point.x, y = map.top + point.y;
        const size = panel.offsetWidth + '|' + panel.offsetHeight;
        // Content expansion/refreshed text gets an initial safe layout, not a navigation exit.
        if (size !== popupSize && lastAnchor?.x === x && lastAnchor?.y === y) edgeArmed = false;
        popupSize = size; lastAnchor = { x, y };
        const key = [x, y, panel.offsetWidth, panel.offsetHeight, window.innerWidth, window.innerHeight, map.left, map.top, map.right, map.bottom].join('|');
        if (key === popupLayout) return; popupLayout = key;
        if (!edgeArmed) {
            popupOffset.x = Math.max(Math.max(0, map.left) + 11, Math.min(x + 16, Math.min(window.innerWidth, map.right) - (panel.offsetWidth || 320) - 11)) - x;
            popupOffset.y = Math.max(Math.max(0, map.top) + 11, Math.min(y - 18, Math.min(window.innerHeight, map.bottom) - (panel.offsetHeight || 220) - 11)) - y;
        }
        panel.style.left = x + popupOffset.x + 'px'; panel.style.top = y + popupOffset.y + 'px'; panel.style.right = 'auto';
        updatePreviewLeader(point);
        const rect = panel.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        const outside = rect.left <= Math.max(0, map.left) + 10 || rect.top <= Math.max(0, map.top) + 10 || rect.right >= Math.min(window.innerWidth, map.right) - 10 || rect.bottom >= Math.min(window.innerHeight, map.bottom) - 10;
        if (edgeArmed && outside) dismissDetails(); else if (!edgeArmed) { edgeArmed = true; viewer.scene.requestRender(); popupLayout = ''; popupView = null; }
    }
    function refreshSelection() {
        if (!selected) return; const next = records.get(selected.id); if (!next || JSON.stringify(next) === selected.signature) return;
        const entity = source?.entities.getById(next.id), compact = previewMode;
        const body = panel.querySelector('.wz-widget-body'), scroll = body.scrollTop, expanded = body.querySelector('details')?.open;
        if (compact) compactPreview(next, entity); else details(next, entity);
        body.scrollTop = scroll; if (!compact) body.querySelector('details').open = expanded;
    }
    function mountPanel(title, popup = false) {
        if (popup && detailOpen && panel) {
            panel.querySelector('.wz-widget-body').replaceChildren(...cloneNoticeTemplate('body').children);
            panel.querySelector('h3').textContent = title; return;
        }
        if (popup && panel) { mainWidget = { panel, key: panelKey, disposeDrag }; panel.inert = true; panel.style.opacity = '0'; panel.style.pointerEvents = 'none'; panel.setAttribute('aria-hidden', 'true'); disposeDrag = null; panel = null; }
        else if (!popup) close();
        panel = cloneNoticeTemplate('panel'); panel.id = popup ? 'warzone-notice-popup' : 'warzone-notice-panel';
        noticeAction(panel, 'close').onclick = () => { if (detailOpen) dismissDetails(); else { widgetRequested = false; close(); } }; panel.querySelector('h3').textContent = title;
        panel.setAttribute('tabindex', '-1'); document.body.append(panel);
        const width = panel.offsetWidth || 448, height = panel.offsetHeight || 260;
        const maxLeft = Math.max(0, (window.innerWidth || 1024) - width), maxTop = Math.max(0, (window.innerHeight || 768) - height);
        panel.style.left = Math.max(0, Math.min(noticePosition?.left ?? maxLeft - 16, maxLeft)) + 'px';
        panel.style.top = Math.max(0, Math.min(noticePosition?.top ?? 100, maxTop)) + 'px';
        if (popup) { for (const type of ['pointerdown', 'click', 'dblclick', 'wheel']) panel.addEventListener?.(type, event => event.stopPropagation()); return; }
        disposeDrag = bindFloatingPanel?.(panel, { headerSelector: '.wz-widget-header', fixed: true, onPosition: position => { noticePosition = position; } });
        const collapse = cloneNoticeTemplate('collapse');
        collapse.onclick = () => { const body = panel?.querySelector('.wz-widget-body'); if (body) { body.hidden = !body.hidden; collapse.setAttribute('aria-expanded', String(!body.hidden)); collapse.setAttribute('aria-label', collapse.getAttribute(body.hidden ? 'data-expand-label' : 'data-collapse-label')); } };
        panel.querySelector('.wz-widget-header-actions').append(collapse);
    }
    function showState(title, message) { if (!widgetRequested || detailOpen) return; const key = title + '|' + message; if (panel && panelKey === key) return; mountPanel(title); panelKey = key; panel.querySelector('ul').hidden = true; const p = cloneNoticeTemplate('state'); p.textContent = message; panel.querySelector('.wz-widget-body').append(p); }
    function details(n, entity, position) {
        if (!n?.id) return; widgetRequested = true; mountPanel(n.title || n.sourceId, true); detailOpen = true; previewMode = false; panel.className = 'wz-notice-popup'; selectAnchor(n); if (entity?.polyline) entity.polyline.material = Cesium.Color.WHITE; if (entity?.ellipse) entity.ellipse.outlineColor = Cesium.Color.WHITE;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) { const rect = viewer.scene.canvas.getBoundingClientRect?.() || { left: 0, top: 0 }; panel.style.left = Math.max(8, Math.min(rect.left + position.x + 16, (window.innerWidth || 1024) - (panel.offsetWidth || 320) - 8)) + 'px'; panel.style.top = Math.max(8, Math.min(rect.top + position.y + 16, (window.innerHeight || 768) - (panel.offsetHeight || 300) - 8)) + 'px'; }
        const body = panel.querySelector('.wz-widget-body'), view = cloneNoticeTemplate('popup');
        body.querySelector('ul').remove();
        const list = view.querySelector('ul'), brief = noticeField(view, 'summary');
        brief.textContent = [n.activityType, n.status, n.country, n.fir, n.effectiveFrom && 'From ' + n.effectiveFrom, n.effectiveUntil && 'Until ' + n.effectiveUntil, n.summary].filter(Boolean).join(' · ');
        const actions = view.querySelector('.wz-notice-actions'); body.append(...view.children);
        shotButton(actions, n, entity);
        for (const [key, value] of Object.entries({ Category: n.noticeType, ID: n.sourceId, Issuer: n.issuer, Country: n.country, Region: n.region, FIR: n.fir, NAVAREA: n.navarea, Activity: n.activityType, Status: n.status, Issued: n.issuedAt, From: n.effectiveFrom, Until: n.effectiveUntil, Schedule: n.schedule, Altitude: [n.lowerAltitude, n.upperAltitude, n.altitudeReference].filter(Boolean).join(' / '), Coordinates: JSON.stringify(n.geometry?.coordinates || null), Radius: n.metadata?.radiusNm ? `${n.metadata.radiusNm} NM` : 'Not published', Precision: [n.geometryAccuracy || 'Location unavailable', n.metadata?.boundaryError].filter(Boolean).join('; '), Confidence: n.geometryConfidence, Verified: n.lastVerifiedAt || 'Unverified', Fetched: n.lastFetchedAt, Summary: n.summary, 'Original notice': n.rawText, Provenance: n.provenance?.extraction })) {
            noticeField(list, key).textContent = value || 'Unknown';
        }
        const link = cloneNoticeTemplate('source'); link.href = n.sourceUrl; list.append(link);
        for (const ref of n.sourceRecords || []) { const li = cloneNoticeTemplate('row'); noticeField(li, 'label').textContent = ref.provider; noticeField(li, 'value').textContent = ref.rawText; list.append(li); }
        if (entity) { focusButton = noticeAction(actions, 'focus'); focusButton.textContent = focusButton.getAttribute(noticeFocus?.id === n.id ? 'data-unfocus-label' : 'data-focus-label'); focusButton.onclick = () => focusNotice(n); } else noticeAction(actions, 'focus').remove();
        const copy = noticeAction(actions, 'copy'); copy.onclick = () => navigator.clipboard?.writeText(JSON.stringify(n.geometry?.coordinates || null));
        if (records.has(n.id)) {
            noticeAction(actions, 'back').onclick = dismissDetails;
            const overlap = noticeAction(actions, 'overlap'); overlap.onclick = () => {
                const observations = [...getAllLiveTrackSnapshots(), ...getAllNavalSnapshots()]; let count = 0;
                for (const row of observations) {
                    const result = correlateObservation(n, { longitude: row.lon ?? row.lng ?? row.longitude, latitude: row.lat ?? row.latitude, observed_at: row.observed_at || row.metadata?.observed_at || row.occurred_at || '' });
                    if (result.geographicOverlap && result.temporalOverlap) count++;
                }
                overlap.textContent = `${count} spatial/time overlaps; participation unverified`;
            };
        } else { noticeAction(actions, 'back').remove(); noticeAction(actions, 'overlap').remove(); }
    }
    function showList(message = 'Published notices') {
        if (!widgetRequested || detailOpen) return;
        const key = JSON.stringify([message, viewStatus, militaryOnly, offset, total, [...records.values()].map(n => [n.id, n.sourceId, n.status, Boolean(n.geometry)])]);
        if (panel && panelKey === key) return;
        mountPanel(message);
        panelKey = key;
        const body = panel.querySelector('.wz-widget-body'); body.querySelector('ul').hidden = true;
        const view = cloneNoticeTemplate('list'), geometrySummary = noticeField(view, 'summary');
        geometrySummary.textContent = `Area notices: ${[...records.values()].filter(n => ['Polygon', 'MultiPolygon'].includes(n.geometry?.type) || n.metadata?.radiusSource === 'published' || n.metadata?.corridorWidthMeters).length} · Location-only notices: ${[...records.values()].filter(n => n.geometry?.type === 'Point' && n.metadata?.radiusSource !== 'published').length}`;
        const controls = view.querySelector('.wz-notice-controls'), cards = view.querySelector('.wz-notice-cards'); body.append(...view.children);
        if (noticeFocus) { const unfocus = noticeAction(controls, 'unfocus'); unfocus.onclick = () => { unfocusNotice(); panelKey = ''; showList(); }; } else noticeAction(controls, 'unfocus').remove();
        const status = noticeAction(controls, 'status'); status.value = viewStatus;
        status.onchange = () => { viewStatus = status.value; offset = 0; void refresh(); };
        const coverage = noticeAction(controls, 'coverage'); coverage.textContent = coverage.getAttribute(militaryOnly ? 'data-military-label' : 'data-all-label'); coverage.onclick = () => { militaryOnly = !militaryOnly; offset = 0; void refresh(); };
        for (const [action, next] of [['previous', offset - 200], ['next', offset + 200]]) {
            const button = noticeAction(controls, action);
            if (next >= 0 && next < total) button.onclick = () => { offset = next; void refresh(); }; else button.remove();
        }
        for (const n of records.values()) {
            const card = cloneNoticeTemplate('card');
            noticeField(card, 'title').textContent = n.sourceId || n.title;
            noticeField(card, 'status').textContent = n.status || 'Unknown';
            const text = noticeField(card, 'summary'); text.textContent = [n.country, n.fir, n.activityType, ['Polygon', 'MultiPolygon'].includes(n.geometry?.type) ? 'Published area boundary' : ['LineString', 'MultiLineString'].includes(n.geometry?.type) ? (n.metadata?.corridorWidthMeters ? 'Published corridor' : 'Published route') : n.metadata?.radiusSource === 'published' ? 'Published circular area' : n.geometry?.type === 'Point' ? 'Location only; no valid published area boundary' : 'Location unavailable'].filter(Boolean).join(' · ');
            const button = noticeAction(card, 'view'); button.onclick = () => details(records.get(n.id) || n, source?.entities.getById(n.id));
            cards.append(card);
        }
    }
    function clear() { for (const [element, animation] of fading) { animation.cancel(); element.remove(); } fading.clear(); ++captureSequence; cancelCapture?.(); cancelCapture = null; clearTimeout(previewTimer); previewTimer = 0; clearTimeout(expiryTimer); expiryTimer = 0; entityIds.clear(); unfocusNotice(); generation++; controller?.abort(); controller = null; requestKey = ''; scenePending = null; clearTimeout(wheelTimer); wheelTimer = 0; wheelActive = false; if (frame) cancelAnimationFrame(frame); frame = 0; clearTimeout(timer); timer = null; clearTimeout(scopeTimer); scopeTimer = 0; scopePending = false; handler?.destroy(); handler = null; close(false); if (source) { viewer.dataSources.remove(source, true); viewer.scene.requestRender(); } source = null; records.clear(); renderKeys.clear(); }
    const interactionBusy = () => pointerHeld || wheelActive;
    function queueSceneWork(work) { scenePending = work; if (interactionBusy() || frame) return; frame = requestAnimationFrame(() => { frame = 0; if (interactionBusy()) return; const next = scenePending; scenePending = null; next?.(); }); }
    async function refresh() {
        style = readStyle(); if (!active()) { clear(); return; } if (terminalState) return; if (!canRefresh() || interactionBusy()) { scopePending = true; return; } scopePending = false;
        const bounds = getActiveRegion()?.bounds || {}, query = new URLSearchParams({ ...bounds, limit: '200', offset: String(offset), layers: NOTICE_LAYERS.filter(isLayerEnabled).join(','), status: viewStatus, military: militaryOnly ? 'related' : 'all' });
        const key = query.toString(); if (controller && requestKey === key && !controller.signal.aborted) return;
        clearTimeout(timer); timer = null; controller?.abort(); controller = new AbortController(); requestKey = key; const current = ++generation;
        let pollDelay = 60000;
        if (frame) cancelAnimationFrame(frame); frame = 0;
        if (!source && !panel) showState('Loading notices', 'Retrieving published notices for the selected area.');
        try {
            const base = window.__stratopsConfig?.apiBase || ((typeof STRATOPS_API_BASE_URL === 'string' && STRATOPS_API_BASE_URL) || 'https://api.battlespacex.com');
            const response = await fetch(base.replace(/\/$/, '') + '/notices?' + query, { signal: controller.signal }); if (!response.ok) { const error = Error('Notice feed unavailable'); error.status = response.status; throw error; } const data = await response.json(); if (current !== generation) return;
            if (data.state === 'unconfigured') { terminalState = true; pollDelay = null; retryFailures = 0; if (source || handler || records.size) clear(); showState('No permitted provider configured', 'Configure an approved notice source or administrator import in the backend.'); return; }
            if (!source) { const candidate = new Cesium.CustomDataSource('published-notices'); await viewer.dataSources.add(candidate); if (current !== generation) { viewer.dataSources.remove(candidate, true); return; } source = candidate; }
            retryFailures = 0;
            // A response arriving mid-drag must not mutate the scene on the input frame.
            const apply = () => {
                if (current !== generation || !source) return;
                total = data.total || 0; const notices = (data.notices || []).filter(matches).filter(n => !['live', 'active', 'upcoming'].includes(viewStatus) || !['expired', 'cancelled', 'superseded'].includes(currentStatus(n))), ids = new Set(notices.map(n => n.id)); source.entities.suspendEvents(); try {
                    for (const entity of source.entities.values.slice()) if (!ids.has(entity.__noticeId || entity.id)) source.entities.remove(entity);
                    for (const id of records.keys()) if (!ids.has(id)) { if (noticeFocus?.id === id) unfocusNotice(); records.delete(id); renderKeys.delete(id); entityIds.delete(id); }
                } finally { source.entities.resumeEvents(); }
                const missing = []; source.entities.suspendEvents(); try { for (const n of notices) { const key = renderKey(n); if (renderKeys.has(n.id) && renderKeys.get(n.id) !== key) { removeNoticeEntities(n.id); } renderKeys.set(n.id, key); records.set(n.id, n); if (n.geometry && !source.entities.getById(n.id)) missing.push(n); } } finally { source.entities.resumeEvents(); } let index = 0;
                const chunk = () => {
                    if (current !== generation || !source) return; if (interactionBusy()) { queueSceneWork(chunk); return; } const start = performance.now(); source.entities.suspendEvents(); try {
                        for (let count = 0; index < missing.length && count < 8; count++, index++) {
                            const n = missing[index]; if (['live', 'active', 'upcoming'].includes(viewStatus) && ['expired', 'cancelled', 'superseded'].includes(currentStatus(n))) continue; records.set(n.id, n); applyNoticeGraphics(n);
                            if (performance.now() - start >= 4) { index++; break; }
                        }
                    } finally { source.entities.resumeEvents(); } if (missing.length) viewer.scene.requestRender(); if (index < missing.length) queueSceneWork(chunk); else refreshSelection();
                }; chunk();
                if (!handler) { handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas); handler.setInputAction(click => { const entity = viewer.scene.pick(click.position)?.id; const n = entity && records.get(entity.__noticeId || entity.id); if (n) compactPreview(n, entity, click.position); }, Cesium.ScreenSpaceEventType.LEFT_CLICK); }
                if (!selected) { if (!notices.length) showList('No notices in selected area'); else showList(`${data.state === 'stale' ? 'Provider temporarily unavailable; cached notices' : 'Published notices'} (${notices.length}${data.total > 200 ? ' of ' + data.total : ''}${data.partial ? '; partial feed' : ''})`); }
                scheduleExpiry();
            }; queueSceneWork(apply);
        } catch (error) { if (error.name !== 'AbortError' && current === generation) { terminalState = [401, 403, 404].includes(error.status); pollDelay = terminalState ? null : Math.min(300000, 60000 * 2 ** retryFailures++); showState([401, 403].includes(error.status) ? 'Notice access denied' : 'Provider temporarily unavailable', `Notice request failed${error.status ? ' (HTTP ' + error.status + ')' : ''}. Existing trackers remain independent.`); } }
        finally { if (current === generation) { controller = null; if (active() && pollDelay !== null) timer = setTimeout(refresh, pollDelay); } }
    }
    function sync() {
        offset = 0; if (active()) {
            // Disabling one notice category must unload it immediately, even if the next request stalls.
            for (const [id, n] of records) if (!matches(n)) { if (noticeFocus?.id === id) unfocusNotice(); removeNoticeEntities(id); records.delete(id); renderKeys.delete(id); }
            if (!panel && widgetRequested) showList('Loading notices');
            viewer.scene.requestRender(); retryFailures = 0; void refresh();
        } else clear();
    }
    const unsubscribe = onLayerChange((id) => { if (id === '*' || NOTICE_LAYERS.includes(id)) { const next = NOTICE_LAYERS.filter(isLayerEnabled).join(','); if (next !== layerKey || (id !== '*' && isLayerEnabled(id))) { widgetRequested = active(); terminalState = false; layerKey = next; if (detailOpen && (!active() || !matches(selected.notice))) dismissDetails(); } sync(); } });
    function resumeScope() { clearTimeout(scopeTimer); scopeTimer = 0; if (interactionBusy()) return; if (scenePending) queueSceneWork(scenePending); if (scopePending && active() && canRefresh()) { scopePending = false; void refresh(); } }
    const unsubscribeRegion = onRegionChange(() => { if (detailOpen) dismissDetails(); unfocusNotice({ restore: false }); if (!active() || terminalState) return; generation++; controller?.abort(); controller = null; scenePending = null; if (frame) cancelAnimationFrame(frame); frame = 0; clearTimeout(timer); timer = null; clearTimeout(scopeTimer); offset = 0; scopePending = true; scopeTimer = setTimeout(resumeScope, 0); });
    function dismiss(event) { if (event.type === 'pointerdown' && event.target === viewer.scene.canvas) pointerHeld = true; }
    function yieldFocus() { if (viewer.trackedEntity || getAssetFocusController().getState().assetId) { const hadFocus = Boolean(noticeFocus); unfocusNotice({ restore: false }); if (hadFocus && !detailOpen && panel) { close(); showList(); } } }
    function releasePointer() { pointerHeld = false; resumeScope(); }
    function wheel(event) { if (event.target !== viewer.scene.canvas || !active()) return; wheelActive = true; clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { wheelTimer = 0; wheelActive = false; resumeScope(); }, 120); }
    function restyle() { const next = readStyle(); if (JSON.stringify(next) === JSON.stringify(style)) return; style = next; for (const n of records.values()) { const entity = source?.entities.getById(n.id); if (!entity) continue; applyNoticeGraphics(n); renderKeys.set(n.id, renderKey(n)); } viewer.scene.requestRender(); }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('wz:asset-focus-changed', yieldFocus);
    document.addEventListener('pointerup', releasePointer);
    document.addEventListener('pointercancel', releasePointer);
    document.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener?.('blur', releasePointer);
    document.addEventListener('keydown', dismiss);
    window.addEventListener?.('resize', restyle);
    document.addEventListener('wz:notice-style-refresh', restyle);
    document.addEventListener('wz:region-camera-settled', resumeScope);
    const removeMoveEnd = viewer.camera?.moveEnd?.addEventListener?.(resumeScope);
    owner = { viewer, dispose() { clear(); unsubscribe?.(); unsubscribeRegion?.(); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('wz:asset-focus-changed', yieldFocus); document.removeEventListener('pointerup', releasePointer); document.removeEventListener('pointercancel', releasePointer); document.removeEventListener('wheel', wheel); window.removeEventListener?.('blur', releasePointer); document.removeEventListener('keydown', dismiss); window.removeEventListener?.('resize', restyle); document.removeEventListener('wz:notice-style-refresh', restyle); document.removeEventListener('wz:region-camera-settled', resumeScope); removeMoveEnd?.(); } }; sync();
}
export function disposeNoticeLayers() { owner?.dispose(); owner = null; }
