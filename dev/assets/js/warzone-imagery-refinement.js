// Imagery quality policy only: never moves the camera or advances an asset.
const distance = (a, b) => a && b ? Math.hypot(...a.map((v, i) => v - b[i])) : 0;
const angleDegrees = (a, b) => {
    if (!a || !b) return 0;
    const length = Math.hypot(...a) * Math.hypot(...b);
    if (!length) return 0;
    return Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, v, i) => sum + v * b[i], 0) / length))) * 180 / Math.PI;
};

export function createFocusImageryRefinementPolicy({ settleMs = 900 } = {}) {
    let previous = null;
    let referencePose = null;
    let state = { phase: "UNFOCUSED", focusTracking: false, focusSettled: false, userMoving: false };
    return {
        update({ now, active, generation, pose, userInteracting = false, flightActive = false }) {
            if (!active || !pose) {
                previous = null;
                referencePose = null;
                state = { phase: "UNFOCUSED", focusTracking: false, focusSettled: false, userMoving: userInteracting };
                return state;
            }
            const newFocus = !previous || previous.generation !== generation;
            const elapsedSeconds = previous ? Math.max(0, (now - previous.now) / 1000) : 0;
            // lookAt translates its reference frame with the asset. Relative camera
            // pose stays constant: ordinary follow translation is NOT user navigation.
            const positionDelta = distance(pose.position, referencePose?.position);
            const orientationDelta = Math.max(angleDegrees(pose.direction, referencePose?.direction), angleDegrees(pose.up, referencePose?.up));
            const targetDelta = distance(pose.target, previous?.pose.target);
            const range = Math.max(1, pose.range || 0);
            const relativePoseChanged = positionDelta > Math.max(2, range * 0.001) || orientationDelta > 0.1;
            const majorTargetDisplacement = targetDelta > Math.max(500, range * 0.2, elapsedSeconds * 1500);
            const transition = newFocus || userInteracting || flightActive || relativePoseChanged || majorTargetDisplacement;
            const lastMeaningfulDisplacementAt = transition ? now : state.lastMeaningfulDisplacementAt;
            if (transition) referencePose = pose;
            const focusSettled = !userInteracting && !flightActive && now - lastMeaningfulDisplacementAt >= settleMs;
            state = {
                phase: focusSettled ? "FOCUS_SETTLED" : "FOCUS_TRANSITION",
                focusTracking: true,
                focusSettled,
                userMoving: userInteracting,
                flightActive,
                generation,
                range,
                relativePositionDeltaMeters: positionDelta,
                relativeOrientationDeltaDegrees: orientationDelta,
                targetDeltaMeters: targetDelta,
                majorTargetDisplacement,
                lastMeaningfulDisplacementAt,
                lastSampleAt: now,
            };
            previous = { now, generation, pose };
            return state;
        },
    };
}

export function readFocusCameraPose(camera) {
    if (!camera?.position || !camera.direction || !camera.up) return null;
    const xyz = (v) => [v.x, v.y, v.z];
    const transform = camera.transform;
    const target = [transform?.[12] || 0, transform?.[13] || 0, transform?.[14] || 0];
    return {
        position: xyz(camera.position), direction: xyz(camera.direction), up: xyz(camera.up), target,
        range: Math.hypot(...target) > 1 ? Math.hypot(...xyz(camera.position)) : null,
    };
}

export function installFocusImageryRefinementPolicy(viewer, queueQualitySync) {
    if (viewer.__warzoneFocusRefinementInstalled) return;
    viewer.__warzoneFocusRefinementInstalled = true;
    const policy = createFocusImageryRefinementPolicy();
    let sampledAt = -Infinity;
    let inputUntil = 0;
    const pointers = new Set();
    const sample = (force = false) => {
        if (viewer.isDestroyed?.()) return;
        const now = performance.now();
        if (!force && now - sampledAt < 250) return;
        sampledAt = now;
        const focus = window.__warzoneFocusDiagnostics || {};
        const active = focus.state === "active" && Boolean(focus.assetId);
        if (!active && viewer.__warzoneFocusRefinementState?.phase === "UNFOCUSED") return;
        const previousPhase = viewer.__warzoneFocusRefinementState?.phase;
        const state = policy.update({
            now, active, generation: focus.generation, pose: active ? readFocusCameraPose(viewer.camera) : null,
            userInteracting: pointers.size > 0 || now < inputUntil,
            flightActive: Boolean(viewer.camera._currentFlight),
        });
        viewer.__warzoneFocusRefinementState = state;
        if (state.phase !== previousPhase) queueQualitySync();
    };
    const noteInput = () => { inputUntil = performance.now() + 360; sample(true); };
    const canvas = viewer.scene.canvas;
    canvas.addEventListener("pointerdown", (event) => { pointers.add(event.pointerId); noteInput(); }, { passive: true });
    const release = (event) => { if (pointers.delete(event.pointerId)) noteInput(); };
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("blur", () => { pointers.clear(); noteInput(); });
    canvas.addEventListener("wheel", noteInput, { passive: true });
    canvas.addEventListener("keydown", (event) => {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(event.key)) noteInput();
    });
    // Reuse Cesium's update lifecycle (also runs on non-rendered frames).
    // No additional RAF, interval, camera task or tile request is introduced.
    viewer.scene.preUpdate.addEventListener(() => sample());
    document.addEventListener("wz:asset-focus-changed", () => {
        const focus = window.__warzoneFocusDiagnostics || {};
        if (focus.generation !== viewer.__warzoneFocusRefinementState?.generation || focus.state !== "active") sample(true);
    });
    sample(true);
}

export function readTileRefinementSnapshot(globe, baseLayer, focusCoordinates = null) {
    const surface = globe?._surface;
    const quadtree = surface?._tilesToRender ? surface : surface?._tileProvider?._quadtree;
    if (!quadtree) return { available: false, reason: "Cesium quadtree unavailable" };
    const rendered = quadtree._tilesToRender || [];
    const queues = [quadtree._tileLoadQueueHigh || [], quadtree._tileLoadQueueMedium || [], quadtree._tileLoadQueueLow || []];
    const tiles = new Set([...rendered, ...queues.flat()]);
    let retained = quadtree._tileReplacementQueue?.head;
    const visited = new Set();
    while (retained && !visited.has(retained)) {
        visited.add(retained); tiles.add(retained); retained = retained.replacementNext;
    }
    const selected = [...tiles].filter((tile) => tile._lastSelectionResultFrame === quadtree._lastSelectionFrameNumber);
    const relevant = new Set([...selected, ...queues.flat(), ...rendered]);
    const imagery = new Set();
    const renderedLevels = {};
    let highestDesiredLevel = null;
    let parentImageryFallbacks = 0;
    const focusGroundImageryLevels = new Set();
    const focusGroundTerrainLevels = new Set();
    let focusGroundParentFallbacks = 0;
    const containsFocus = (rectangle) => {
        if (!rectangle || !focusCoordinates) return false;
        let longitude = focusCoordinates.longitude;
        let east = rectangle.east;
        if (east < rectangle.west) { east += Math.PI * 2; if (longitude < rectangle.west) longitude += Math.PI * 2; }
        return longitude >= rectangle.west && longitude <= east && focusCoordinates.latitude >= rectangle.south && focusCoordinates.latitude <= rectangle.north;
    };
    for (const tile of relevant) {
        for (const association of tile.data?.imagery || []) {
            for (const image of [association.loadingImagery, association.readyImagery]) {
                if (image && (!baseLayer || image.imageryLayer === baseLayer)) imagery.add(image);
            }
            const loading = association.loadingImagery;
            if (loading && (!baseLayer || loading.imageryLayer === baseLayer)) highestDesiredLevel = Math.max(highestDesiredLevel ?? 0, loading.level);
        }
    }
    for (const tile of rendered) {
        const underFocus = containsFocus(tile.rectangle);
        if (underFocus) focusGroundTerrainLevels.add(tile.level);
        for (const association of tile.data?.imagery || []) {
            const image = association.readyImagery;
            if (!image || (baseLayer && image.imageryLayer !== baseLayer)) continue;
            renderedLevels[image.level] = (renderedLevels[image.level] || 0) + 1;
            if (underFocus) focusGroundImageryLevels.add(image.level);
            highestDesiredLevel = Math.max(highestDesiredLevel ?? 0, image.level);
            if (association.loadingImagery && association.loadingImagery.level > image.level) {
                parentImageryFallbacks += 1;
                if (underFocus) focusGroundParentFallbacks += 1;
            }
        }
    }
    const states = { unloaded: 0, loading: 0, received: 0, textureLoaded: 0, ready: 0, failed: 0, invalid: 0, placeholder: 0 };
    const stateNames = Object.keys(states); // installed Cesium ImageryState 0..7
    for (const image of imagery) { const name = stateNames[image.state]; if (name) states[name] += 1; }
    return {
        available: true,
        tilesSelected: selected.filter((tile) => (tile._lastSelectionResult & 3) >= 2).length,
        tilesVisited: selected.length,
        tilesRendered: rendered.length,
        descendantsKicked: selected.filter((tile) => (tile._lastSelectionResult & 4) !== 0).length,
        tilesWaitingForChildren: new Set(selected.filter((tile) => (tile._lastSelectionResult & 4) !== 0).map((tile) => tile.parent).filter(Boolean)).size,
        waitingForChildrenMeaning: "parents of current-frame descendants kicked by Cesium readiness checks",
        loadQueueHigh: queues[0].length, loadQueueMedium: queues[1].length, loadQueueLow: queues[2].length,
        retainedTerrainTiles: quadtree._tileReplacementQueue?.count ?? null,
        imageryStates: states, parentImageryFallbacks, highestDesiredLevel,
        highestRenderedLevel: Object.keys(renderedLevels).length ? Math.max(...Object.keys(renderedLevels).map(Number)) : null,
        renderedLevels,
        focusGroundImageryLevels: [...focusGroundImageryLevels].sort((a, b) => a - b),
        focusGroundTerrainLevels: [...focusGroundTerrainLevels].sort((a, b) => a - b),
        focusGroundParentFallbacks,
        source: "read-only installed Cesium quadtree/TileImagery internals; unique imagery on current-frame selected or queued tiles",
    };
}
