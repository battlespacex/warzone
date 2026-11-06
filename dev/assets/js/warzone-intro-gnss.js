import * as Cesium from "cesium";

// Decorative coverage for the local intro scene only. No operational GNSS data is read here.
// [longitude, latitude, east/west radius km, north/south radius km, density to open, optional link to next seed]
const REGIONS = [
    [[-116, 42, 220, 190, 0], [-95, 37, 230, 190, 0.06], [-82, 25, 190, 170, 0.38], [-136, 58, 180, 160, 0.70], [-107, 51, 220, 180, 0.48], [-72, 43, 190, 160, 0.78]],
    [[-72, -10, 220, 190, 0], [-61, -20, 230, 210, 0.06], [-49, -5, 200, 180, 0.38], [-74, -36, 180, 160, 0.70], [-64, 4, 200, 170, 0.48], [-51, -30, 190, 170, 0.78]],
    [[-3, 50, 220, 180, 0], [18, 51, 230, 190, 0.06], [37, 44, 190, 170, 0.38], [-8, 41, 180, 160, 0.70], [27, 59, 200, 160, 0.48], [11, 43, 180, 150, 0.78]],
    [[44, 33, 220, 190, 0], [56, 24, 230, 190, 0.06], [34, 27, 190, 160, 0.38], [64, 33, 190, 160, 0.70], [45, 25, 190, 160, 0.48], [61, 38, 180, 150, 0.78]],
    [[12, 12, 230, 190, 0], [27, -3, 230, 210, 0.06], [18, -24, 220, 190, 0.38], [-5, 5, 190, 170, 0.70], [9, -8, 220, 180, 0.48], [36, -17, 200, 170, 0.78], [-7, 30, 210, 160, 0.30, true], [9, 28, 210, 160, 0.30], [17, 27, 190, 150, 0.48, true], [31, 27, 190, 150, 0.48]],
    [[67, 40, 230, 180, 0], [78, 27, 230, 190, 0.06], [93, 25, 200, 170, 0.38], [53, 37, 190, 170, 0.70], [72, 32, 210, 180, 0.48], [83, 42, 200, 170, 0.78]],
    [[105, 36, 230, 190, 0], [125, 29, 230, 190, 0.06], [110, 14, 220, 190, 0.38], [136, 39, 190, 170, 0.70], [115, 25, 230, 180, 0.48], [101, 15, 200, 170, 0.78]],
    [[134, -24, 230, 190, 0], [151, -33, 220, 180, 0.06], [145, -6, 190, 170, 0.38], [167, -41, 180, 160, 0.70], [144, -20, 220, 180, 0.48], [115, -23, 190, 170, 0.78]],
];
const SEVERITY_SEQUENCE = ["low", "low", "medium", "low", "high", "low", "medium", "low", "low", "low"];
const MAJOR_FIELD_SCALE = 2.3;
const BATCH_SIZE = 200;
const REVEAL_INTERVAL_MS = 7;
const REVEAL_BATCH_SIZE = 16;
const FADE_MS = 100;

let introGnss = null;

function hash(row, column, region) {
    let value = Math.imul(row + 1000, 374761393) ^ Math.imul(column + 1000, 668265263) ^ Math.imul(region + 1, 2246822519);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return (value ^ (value >>> 16)) >>> 0;
}

function fieldNoise(x, y, scale, seed) {
    const gridX = Math.floor(x / scale);
    const gridY = Math.floor(y / scale);
    const fractionX = x / scale - gridX;
    const fractionY = y / scale - gridY;
    const blendX = fractionX * fractionX * (3 - 2 * fractionX);
    const blendY = fractionY * fractionY * (3 - 2 * fractionY);
    const sample = (offsetX, offsetY) => hash(gridX + offsetX, gridY + offsetY, seed) / 4294967295;
    const top = sample(0, 0) * (1 - blendX) + sample(1, 0) * blendX;
    const bottom = sample(0, 1) * (1 - blendX) + sample(1, 1) * blendX;
    return top * (1 - blendY) + bottom * blendY;
}

function buildCells(sizeKm) {
    const regions = REGIONS.map((clusters, region) => clusters.flatMap(([lon, lat, radiusX, radiusY, opensAt], cluster) => {
        if (cluster === 1 || clusters[cluster - 1]?.[5]) return [];
        const candidates = [];
        const next = cluster === 0 || clusters[cluster][5] ? clusters[cluster + 1] : null;
        const travelX = next ? (next[0] - lon) * 111.32 * Math.cos(Cesium.Math.toRadians(lat)) : 0;
        const travelY = next ? (next[1] - lat) * 111.32 : 0;
        const travel = Math.hypot(travelX, travelY);
        const fieldRadiusX = next ? travel / 2 + radiusX * 1.3 : radiusX;
        const fieldRadiusY = next ? radiusY * MAJOR_FIELD_SCALE : radiusY;
        const rowLimit = Math.ceil((next ? Math.abs(travelY) + fieldRadiusY * 2 : fieldRadiusY * 1.6) / (1.5 * sizeKm));
        const columnLimit = Math.ceil((next ? Math.abs(travelX) + fieldRadiusY * 2 : fieldRadiusX * 1.6) / (Math.sqrt(3) * sizeKm)) + 1;
        const seed = cluster >= 6 ? 100 + region * 4 + cluster :
            cluster < 4 ? region * 4 + cluster : REGIONS.length * 4 + region * 2 + cluster - 4;
        const coarseScale = Math.max(110, Math.min(fieldRadiusX, fieldRadiusY) * 0.65);
        for (let row = -rowLimit; row <= rowLimit; row += 1) {
            const y = row * 1.5 * sizeKm;
            for (let column = -columnLimit; column <= columnLimit; column += 1) {
                const x = (column + (Math.abs(row) % 2) / 2) * Math.sqrt(3) * sizeKm;
                const warpX = (fieldNoise(x, y, coarseScale, seed + 101) - 0.5) * fieldRadiusX * 0.55;
                const warpY = (fieldNoise(x, y, coarseScale, seed + 102) - 0.5) * fieldRadiusY * 0.55;
                const along = next ? (x * travelX + y * travelY) / travel - travel / 2 : x;
                const across = next ? (y * travelX - x * travelY) / travel : y;
                const distance = ((along + warpX) / fieldRadiusX) ** 2 +
                    ((across + warpY + (next ? fieldRadiusY * 0.3 * Math.sin(along / fieldRadiusX * 3 + seed) : 0)) / fieldRadiusY) ** 2;
                const angle = Math.atan2(across / fieldRadiusY, along / fieldRadiusX);
                const boundary = 1 + 0.45 * Math.sin(2 * angle + seed * 1.9) +
                    0.22 * Math.sin(5 * angle - seed * 0.7) +
                    1.0 * (fieldNoise(x, y, coarseScale, seed + 103) - 0.5) +
                    0.55 * (fieldNoise(x, y, coarseScale * 0.45, seed + 104) - 0.5);
                const rank = hash(row, column, seed);
                if (distance > boundary || rank % 29 < 2 ||
                    (distance > 0.12 && fieldNoise(x, y, coarseScale * 0.55, seed + 105) < 0.28)) continue;
                const cellLat = lat + y / 111.32;
                const cellLon = lon + x / (111.32 * Math.cos(Cesium.Math.toRadians(cellLat)));
                const texture = fieldNoise(x, y, coarseScale * 0.75, seed + 106);
                candidates.push({ lat: cellLat, lon: cellLon, distance, texture, rank, region, cluster, opensAt });
            }
        }
        const maxDistance = Math.max(...candidates.map((cell) => cell.distance), 0.01);
        candidates.forEach((cell) => {
            const growth = 0.5 * cell.distance / maxDistance + 0.35 * (1 - cell.texture) +
                0.15 * (cell.rank % 1000) / 999;
            cell.threshold = Math.min(1, opensAt + (1 - opensAt) * growth * 0.8);
        });
        return candidates;
    }));
    regions.forEach((cells) => {
        cells.sort((a, b) => a.threshold - b.threshold || a.rank - b.rank);
        cells.forEach((cell, order) => {
            cell.order = order;
            cell.severity = SEVERITY_SEQUENCE[order % SEVERITY_SEQUENCE.length];
            cell.initialSeverity = cell.severity;
            cell.position = Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat);
            cell.direction = Cesium.Cartesian3.normalize(cell.position, new Cesium.Cartesian3());
            cell.opacity = 0;
            cell.revealed = false;
        });
    });
    return regions;
}

function readPalette() {
    const css = getComputedStyle(document.documentElement);
    const color = (name, fallback) => Cesium.Color.fromCssColorString(css.getPropertyValue(name).trim()) || Cesium.Color.fromCssColorString(fallback);
    const palette = {};
    for (const [severity, fallback] of [["low", "13, 233, 79"], ["medium", "252, 255, 77"], ["high", "138, 67, 254"]]) {
        palette[severity] = {
            fill: color(`--gnss-cell-fill-${severity}`, `rgba(${fallback}, 0.2)`),
            outline: color(`--gnss-cell-outline-${severity}`, `rgba(${fallback}, 0.1)`),
        };
    }
    const outlineWidth = Number(css.getPropertyValue("--gnss-cell-outline-width"));
    const sizeKm = Number(css.getPropertyValue("--gnss-cell-size-km"));
    return {
        palette,
        outlineWidth: Number.isFinite(outlineWidth) ? Math.max(0, outlineWidth) : 1,
        sizeKm: Number.isFinite(sizeKm) && sizeKm > 0 ? sizeKm : 28,
    };
}

function hexPositions(cell, sizeKm) {
    const radiusMeters = sizeKm * 1000;
    const latDelta = radiusMeters / 111320;
    const lonScale = 111320 * Math.cos(Cesium.Math.toRadians(cell.lat));
    const degrees = [];
    for (let corner = 0; corner < 6; corner += 1) {
        const angle = Cesium.Math.toRadians(60 * corner - 30);
        degrees.push(cell.lon + Math.cos(angle) * radiusMeters / lonScale, cell.lat + Math.sin(angle) * latDelta);
    }
    return Cesium.Cartesian3.fromDegreesArray(degrees);
}

function addBatch(state, cells, sizeKm, assignCurrent = true, primitives = state.primitives) {
    const fillInstances = [];
    const outlineInstances = [];
    for (const cell of cells) {
        const positions = hexPositions(cell, sizeKm);
        const colors = state.style.palette[cell.severity];
        cell.fillId = `intro-gnss-fill-${cell.region}-${cell.order}`;
        fillInstances.push(new Cesium.GeometryInstance({
            id: cell.fillId,
            geometry: new Cesium.PolygonGeometry({
                polygonHierarchy: new Cesium.PolygonHierarchy(positions),
                vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(colors.fill.withAlpha(0)),
                show: new Cesium.ShowGeometryInstanceAttribute(false),
            },
        }));
        if (state.style.outlineWidth > 0) {
            cell.outlineId = `intro-gnss-outline-${cell.region}-${cell.order}`;
            outlineInstances.push(new Cesium.GeometryInstance({
                id: cell.outlineId,
                geometry: new Cesium.GroundPolylineGeometry({ positions, loop: true, width: state.style.outlineWidth }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(colors.outline.withAlpha(0)),
                    show: new Cesium.ShowGeometryInstanceAttribute(false),
                },
            }));
        }
    }
    const collection = state.viewer.scene.groundPrimitives;
    const fill = collection.add(new Cesium.GroundPrimitive({
        geometryInstances: fillInstances,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
        classificationType: Cesium.ClassificationType.TERRAIN,
        asynchronous: true,
        allowPicking: false,
        releaseGeometryInstances: true,
    }));
    primitives.push(fill);
    let outline = null;
    if (outlineInstances.length) {
        outline = collection.add(new Cesium.GroundPolylinePrimitive({
            geometryInstances: outlineInstances,
            appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
            classificationType: Cesium.ClassificationType.TERRAIN,
            asynchronous: true,
            allowPicking: false,
            releaseGeometryInstances: true,
        }));
        primitives.push(outline);
    }
    if (assignCurrent) cells.forEach((cell) => {
        cell.fillPrimitive = fill;
        cell.outlinePrimitive = outline;
    });
    state.viewer.scene.requestRender();
    return { cells, fill, outline };
}

function setOpacity(state, cell, opacity, fillPrimitive = cell.fillPrimitive, outlinePrimitive = cell.outlinePrimitive) {
    if (!fillPrimitive?.ready || (outlinePrimitive && !outlinePrimitive.ready)) return false;
    const show = opacity > 0;
    const colors = state.style.palette[cell.severity];
    const nextColors = cell.nextSeverity ? state.style.palette[cell.nextSeverity] : null;
    const fillColor = nextColors ? Cesium.Color.lerp(colors.fill, nextColors.fill, cell.colorBlend, state.fillColorScratch) : colors.fill;
    const outlineColor = nextColors ? Cesium.Color.lerp(colors.outline, nextColors.outline, cell.colorBlend, state.outlineColorScratch) : colors.outline;
    const fill = fillPrimitive.getGeometryInstanceAttributes(cell.fillId);
    fill.color = Cesium.ColorGeometryInstanceAttribute.toValue(fillColor.withAlpha(fillColor.alpha * opacity));
    fill.show = Cesium.ShowGeometryInstanceAttribute.toValue(show);
    if (outlinePrimitive) {
        const outline = outlinePrimitive.getGeometryInstanceAttributes(cell.outlineId);
        outline.color = Cesium.ColorGeometryInstanceAttribute.toValue(outlineColor.withAlpha(outlineColor.alpha * opacity));
        outline.show = Cesium.ShowGeometryInstanceAttribute.toValue(show);
    }
    cell.opacity = opacity;
    return true;
}

function cancelPendingSize(state) {
    const pending = state.pendingSize;
    if (!pending) return;
    cancelAnimationFrame(pending.frame);
    if (!state.viewer.isDestroyed()) {
        const collection = state.viewer.scene.groundPrimitives;
        pending.primitives.forEach((primitive) => collection.remove(primitive));
    }
    state.pendingSize = null;
}

function buildSize(state) {
    if (state.destroyed || !state.initialComplete) return;
    cancelPendingSize(state);
    if (state.sizePercent === state.renderedSizePercent) return;
    const pending = { primitives: [], batches: [], cursor: 0, frame: 0, built: false, percent: state.sizePercent };
    state.pendingSize = pending;
    pending.buildNext = () => {
        pending.frame = 0;
        if (state.destroyed || state.pendingSize !== pending || document.hidden) return;
        const end = Math.min(pending.cursor + BATCH_SIZE, state.cells.length);
        const batch = addBatch(state, state.cells.slice(pending.cursor, end), state.style.sizeKm * pending.percent / 100, false, pending.primitives);
        pending.batches.push(batch);
        pending.cursor = end;
        if (end < state.cells.length) pending.frame = requestAnimationFrame(pending.buildNext);
        else pending.built = true;
    };
    pending.frame = requestAnimationFrame(pending.buildNext);
}

function completeSize(state) {
    const pending = state.pendingSize;
    if (pending && pending.percent !== state.sizePercent) return;
    if (!pending?.built || pending.batches.some((batch) => !batch.fill.ready || (batch.outline && !batch.outline.ready))) return;
    for (const batch of pending.batches) {
        for (const cell of batch.cells) {
            setOpacity(state, cell, cell.opacity, batch.fill, batch.outline);
            cell.fillPrimitive = batch.fill;
            cell.outlinePrimitive = batch.outline;
        }
    }
    const collection = state.viewer.scene.groundPrimitives;
    state.primitives.forEach((primitive) => collection.remove(primitive));
    state.primitives = pending.primitives;
    state.renderedSizePercent = pending.percent;
    state.pendingSize = null;
    state.viewer.scene.requestRender();
    if (state.sizePercent !== state.renderedSizePercent) buildSize(state);
}

function planCycleWave(state) {
    const now = performance.now();
    const current = state.cycleCoverage;
    const deepFade = current > 0.5 && Math.random() < 0.18;
    const rising = current < 0.45 || (current < 0.8 && Math.random() < 0.55);
    const amount = rising && current < 0.45 ? 0.12 + Math.random() * 0.16 : 0.04 + Math.random() * 0.12;
    const next = deepFade ? 0.02 + Math.random() * 0.06 :
        Math.max(0.08, Math.min(0.96, current + (rising ? 1 : -1) * amount));
    const spread = deepFade ? 9000 + Math.random() * 8000 : 1800 + Math.random() * 3600;
    const longestFade = deepFade ? 4500 : 3200;
    const groups = new Map();
    for (const cell of state.cells) {
        const key = `${cell.region}:${cell.cluster}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(cell);
    }
    for (const cells of groups.values()) {
        const target = Math.max(0, Math.min(cells.length, Math.round(cells.length *
            (next + (Math.random() - 0.5) * (deepFade ? 0.04 : 0.18)))));
        const visible = cells.filter((cell) => !cell.cycleHidden);
        const changing = target < visible.length ? visible : cells.filter((cell) => cell.cycleHidden);
        const count = Math.min(changing.length, Math.abs(target - visible.length));
        for (let index = 0; index < count; index += 1) {
            const pick = index + Math.floor(Math.random() * (changing.length - index));
            [changing[index], changing[pick]] = [changing[pick], changing[index]];
            const cell = changing[index];
            cell.cyclePendingHidden = target < visible.length;
            cell.cycleStart = now + Math.random() * spread;
            cell.cycleFadeMs = deepFade ? 900 + Math.random() * 3600 : 600 + Math.random() * 2600;
        }
        const green = cells.filter((cell) => cell.severity === "low" && !cell.cycleHidden &&
            !(cell.cycleStart && cell.cyclePendingHidden) && !cell.nextSeverity);
        const accent = cells.filter((cell) => cell.severity !== "low" && !cell.cycleHidden &&
            !(cell.cycleStart && cell.cyclePendingHidden) && !cell.nextSeverity);
        const swaps = Math.min(green.length, accent.length, Math.round(cells.length * 0.06));
        const draw = (pool) => {
            const index = Math.floor(Math.random() * pool.length);
            const cell = pool[index];
            pool[index] = pool[pool.length - 1];
            pool.pop();
            return cell;
        };
        for (let index = 0; index < swaps; index += 1) {
            const first = draw(green);
            const second = draw(accent);
            first.nextSeverity = second.severity;
            second.nextSeverity = first.severity;
            for (const cell of [first, second]) {
                cell.colorStart = now + Math.random() * spread;
                cell.colorDuration = 300 + Math.random() * 3600;
                cell.colorBlend = 0;
            }
        }
    }
    state.cycleCoverage = next;
    state.cycleWave += 1;
    state.viewer.scene.requestRender();
    return spread + longestFade + 900 + Math.random() * 3000;
}

function scheduleCycle(state, remaining = 8000 + Math.random() * 6000) {
    state.cycleRemaining = remaining;
    if (state.destroyed || document.hidden) return;
    state.cycleDeadline = performance.now() + remaining;
    state.cycleTimer = setTimeout(() => {
        state.cycleTimer = 0;
        if (state.destroyed || state.viewer.isDestroyed()) return;
        scheduleCycle(state, planCycleWave(state));
    }, remaining);
}

function pauseCycle(state) {
    if (!state.cycleTimer) return;
    clearTimeout(state.cycleTimer);
    state.cycleTimer = 0;
    state.cycleRemaining = Math.max(0, state.cycleDeadline - performance.now());
}

function tick(state) {
    if (state.destroyed || document.hidden || state.viewer.isDestroyed()) return;
    completeSize(state);
    const now = performance.now();
    const cameraDirection = Cesium.Cartesian3.normalize(state.viewer.camera.positionWC, state.cameraDirection);
    const horizonDot = Math.max(0, Cesium.Ellipsoid.WGS84.maximumRadius /
        Cesium.Cartesian3.magnitude(state.viewer.camera.positionWC) - 0.08);
    let reveals = now - state.lastReveal >= REVEAL_INTERVAL_MS ? REVEAL_BATCH_SIZE : 0;
    let fading = false;
    let pendingVisible = false;
    let pendingCycle = false;
    for (const cell of state.cells) {
        if (cell.cycleStart) {
            if (now >= cell.cycleStart) {
                cell.cycleHidden = cell.cyclePendingHidden;
                cell.cycleStart = 0;
                if (cell.cycleHidden) cell.revealed = false;
            } else if (state.enabled && state.density > 0 && cell.threshold <= state.density / 100) pendingCycle = true;
        }
        let colorChanging = false;
        if (cell.nextSeverity) {
            if (now >= cell.colorStart) {
                cell.colorBlend = Math.min(1, (now - cell.colorStart) / cell.colorDuration);
                colorChanging = true;
            } else if (state.enabled && state.density > 0 && cell.threshold <= state.density / 100) pendingCycle = true;
        }
        const selected = state.enabled && !cell.cycleHidden && state.density > 0 && cell.threshold <= state.density / 100;
        if (!selected) cell.revealed = false;
        if (selected && !cell.revealed && cell.fillPrimitive?.ready &&
            (!cell.outlinePrimitive || cell.outlinePrimitive.ready) &&
            Cesium.Cartesian3.dot(cell.direction, cameraDirection) > horizonDot) {
            if (reveals > 0) {
                cell.revealed = true;
                reveals -= 1;
            } else {
                pendingVisible = true;
            }
        }
        const target = cell.revealed ? 1 : 0;
        if (cell.opacity === target && !colorChanging) continue;
        const elapsed = Math.min(now - state.lastTick, 50);
        const fadeMs = !state.enabled || cell.threshold > state.density / 100 ? FADE_MS : cell.cycleFadeMs || FADE_MS;
        const next = Math.max(0, Math.min(1, cell.opacity + (target ? 1 : -1) * elapsed / fadeMs));
        if (setOpacity(state, cell, next)) {
            fading = true;
            if (colorChanging && cell.colorBlend === 1) {
                cell.severity = cell.nextSeverity;
                cell.nextSeverity = null;
                cell.colorStart = 0;
                cell.colorBlend = 0;
            }
        } else if (colorChanging) pendingCycle = true;
    }
    if (reveals < REVEAL_BATCH_SIZE) state.lastReveal = now;
    state.lastTick = now;
    if (fading || pendingVisible || pendingCycle || state.pendingSize?.built) state.viewer.scene.requestRender();
}

/**
 * Rewind decorative GNSS reveal without rebuilding Cesium geometry.
 * Preserves current enabled/density/size settings, including tuner changes.
 */
export function restartIntroGnssCoverage() {
    const state = introGnss;
    if (!state || state.destroyed || state.viewer.isDestroyed()) return false;

    // Cancel the previous coverage-wave timer before scheduling a fresh cycle.
    clearTimeout(state.cycleTimer);
    state.cycleTimer = 0;
    state.cycleDeadline = 0;
    state.cycleCoverage = 1;
    state.cycleWave = 0;
    state.cycleRemaining = 8000 + Math.random() * 6000;

    const now = performance.now();
    state.lastTick = now;
    state.lastReveal = now;

    for (const cell of state.cells) {
        // Immediately hide any already-rendered geometry, then reveal it again
        // through the existing batch-limited postRender loop.
        if (cell.opacity > 0 && cell.fillPrimitive?.ready &&
            (!cell.outlinePrimitive || cell.outlinePrimitive.ready)) {
            setOpacity(state, cell, 0);
        }
        cell.opacity = 0;
        cell.revealed = false;
        cell.cycleHidden = false;
        cell.cyclePendingHidden = false;
        cell.cycleStart = 0;
        cell.cycleFadeMs = 0;
        cell.severity = cell.initialSeverity ?? cell.severity;
        cell.nextSeverity = null;
        cell.colorStart = 0;
        cell.colorDuration = 0;
        cell.colorBlend = 0;
    }

    // The build may still be in progress during an early R press.
    // It is already scheduled, so don't create a second build loop.
    if (state.initialComplete) scheduleCycle(state, state.cycleRemaining);
    state.viewer.scene.requestRender();
    return true;
}

export function setIntroGnssDensity(value) {
    if (!introGnss) return;
    const number = Number(value);
    introGnss.density = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50;
    introGnss.viewer.scene.requestRender();
}

export function setIntroGnssEnabled(value) {
    const state = introGnss;
    if (!state) return;
    state.enabled = Number(value) !== 0;
    if (!state.enabled) state.cells.forEach((cell) => { cell.revealed = false; });
    state.viewer.scene.requestRender();
}

export function setIntroGnssSize(value) {
    const state = introGnss;
    if (!state) return;
    const number = Number(value);
    const percent = Number.isFinite(number) ? Math.max(25, Math.min(200, number)) : 100;
    if (state.sizePercent === percent) return;
    state.sizePercent = percent;
    if (!state.sizeTimer) {
        state.sizeTimer = setTimeout(() => {
            state.sizeTimer = 0;
            buildSize(state);
        }, 90);
    }
}

function coverageStats(state) {
    const scene = state.viewer.scene;
    const cameraPosition = state.viewer.camera.positionWC;
    const cameraDirection = Cesium.Cartesian3.normalize(cameraPosition, new Cesium.Cartesian3());
    const horizonDot = Math.max(0, Cesium.Ellipsoid.WGS84.maximumRadius /
        Cesium.Cartesian3.magnitude(cameraPosition) - 0.08);
    const canvas = scene.canvas;
    const windowPoint = new Cesium.Cartesian2();
    let selected = 0;
    let frontFacing = 0;
    let projectedSelected = 0;
    let geometryReady = 0;
    let revealQueued = 0;
    let cesiumShown = 0;
    let projectedOnScreen = 0;
    for (const cell of state.cells) {
        if (!state.enabled || cell.cycleHidden || state.density === 0 || cell.threshold > state.density / 100) continue;
        selected += 1;
        let onScreen = false;
        if (Cesium.Cartesian3.dot(cell.direction, cameraDirection) > horizonDot) {
            frontFacing += 1;
            if (canvas && scene.frameState) {
                const point = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cell.position, windowPoint);
                onScreen = Boolean(point && point.x >= 0 && point.y >= 0 &&
                    point.x <= canvas.clientWidth && point.y <= canvas.clientHeight);
                if (onScreen) projectedSelected += 1;
            }
        }
        if (!cell.fillPrimitive?.ready || (cell.outlinePrimitive && !cell.outlinePrimitive.ready)) continue;
        geometryReady += 1;
        if (!cell.revealed) revealQueued += 1;
        if (!cell.opacity || cell.fillPrimitive.getGeometryInstanceAttributes(cell.fillId)?.show?.[0] !== 1) continue;
        cesiumShown += 1;
        if (onScreen) projectedOnScreen += 1;
    }
    return {
        enabled: state.enabled, cycleCoverage: state.cycleCoverage, cycleWave: state.cycleWave,
        density: state.density, sizePercent: state.sizePercent,
        generated: state.cells.length, selected, frontFacing, projectedSelected,
        geometryReady, geometryPending: selected - geometryReady, revealQueued,
        cesiumShown, projectedOnScreen, primitiveCount: state.primitives.length,
    };
}

export function initIntroGnssCoverage(viewer) {
    if (!viewer || viewer.isDestroyed()) return;
    if (introGnss?.viewer === viewer) return;
    destroyIntroGnssCoverage();
    const style = readPalette();
    const regions = buildCells(style.sizeKm);
    const cells = [];
    for (let order = 0; order < Math.max(...regions.map((region) => region.length)); order += 1) {
        regions.forEach((region) => { if (region[order]) cells.push(region[order]); });
    }
    const state = {
        viewer, regions, cells, style, primitives: [], pendingSize: null,
        enabled: true, cycleCoverage: 1, cycleWave: 0, cycleTimer: 0, cycleRemaining: 8000 + Math.random() * 6000,
        density: 100, sizePercent: 100, renderedSizePercent: 100, sizeTimer: 0,
        lastTick: performance.now(), lastReveal: 0, initialComplete: false,
        cameraDirection: new Cesium.Cartesian3(), fillColorScratch: new Cesium.Color(),
        outlineColorScratch: new Cesium.Color(), frame: 0, destroyed: false,
    };
    introGnss = state;
    state.getStats = () => coverageStats(state);
    viewer.__warzoneIntroGnssStats = state.getStats;
    const cssEnabled = Number(getComputedStyle(document.documentElement).getPropertyValue("--wz-intro-gnss-enabled"));
    setIntroGnssEnabled(cssEnabled);
    const cssDensity = Number(getComputedStyle(document.documentElement).getPropertyValue("--wz-intro-gnss-density"));
    setIntroGnssDensity(cssDensity);
    const cssSize = Number(getComputedStyle(document.documentElement).getPropertyValue("--wz-intro-gnss-size"));
    setIntroGnssSize(cssSize);
    let cursor = 0;
    const buildNext = () => {
        state.frame = 0;
        if (state.destroyed || document.hidden) return;
        const end = Math.min(cursor + BATCH_SIZE, cells.length);
        if (end > cursor) addBatch(state, cells.slice(cursor, end), style.sizeKm);
        cursor = end;
        if (cursor < cells.length) state.frame = requestAnimationFrame(buildNext);
        else {
            state.initialComplete = true;
            scheduleCycle(state, state.cycleRemaining);
            if (state.sizePercent !== state.renderedSizePercent) {
                clearTimeout(state.sizeTimer);
                state.sizeTimer = 0;
                buildSize(state);
            }
        }
    };
    state.frame = requestAnimationFrame(buildNext);
    state.onPostRender = () => tick(state);
    state.onVisible = () => {
        if (document.hidden) {
            pauseCycle(state);
            state.hiddenAt = performance.now();
            cancelAnimationFrame(state.frame);
            state.frame = 0;
            if (state.pendingSize) {
                cancelAnimationFrame(state.pendingSize.frame);
                state.pendingSize.frame = 0;
            }
        } else {
            if (state.hiddenAt) {
                const pause = performance.now() - state.hiddenAt;
                state.cells.forEach((cell) => {
                    if (cell.cycleStart) cell.cycleStart += pause;
                    if (cell.nextSeverity) cell.colorStart += pause;
                });
                state.hiddenAt = 0;
            }
            if (state.initialComplete && !state.cycleTimer) scheduleCycle(state, state.cycleRemaining);
            if (cursor < cells.length && !state.frame) state.frame = requestAnimationFrame(buildNext);
            const pending = state.pendingSize;
            if (pending && !pending.built && !pending.frame) pending.frame = requestAnimationFrame(pending.buildNext);
            state.viewer.scene.requestRender();
        }
    };
    viewer.scene.postRender.addEventListener(state.onPostRender);
    document.addEventListener("visibilitychange", state.onVisible);
    viewer.scene.requestRender();
}

export function destroyIntroGnssCoverage() {
    const state = introGnss;
    if (!state) return;
    introGnss = null;
    state.destroyed = true;
    if (state.viewer.__warzoneIntroGnssStats === state.getStats) delete state.viewer.__warzoneIntroGnssStats;
    cancelAnimationFrame(state.frame);
    clearTimeout(state.sizeTimer);
    clearTimeout(state.cycleTimer);
    cancelPendingSize(state);
    document.removeEventListener("visibilitychange", state.onVisible);
    state.viewer.scene.postRender.removeEventListener(state.onPostRender);
    if (!state.viewer.isDestroyed()) {
        const collection = state.viewer.scene.groundPrimitives;
        state.primitives.forEach((primitive) => collection.remove(primitive));
        state.viewer.scene.requestRender();
    }
}
