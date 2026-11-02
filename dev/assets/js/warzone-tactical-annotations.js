// Screen-space labels for the existing missile geographic markers. No new Cesium entities.
const managers = new WeakMap();
const SLOTS = [
    { x: 0, y: -18, h: .5, v: 1 },
    { x: 18, y: 0, h: 0, v: .5 },
    { x: -18, y: 0, h: 1, v: .5 },
    { x: 0, y: 18, h: .5, v: 0 },
    { x: 20, y: -18, h: 0, v: 1 },
    { x: -20, y: -18, h: 1, v: 1 },
    { x: 20, y: 18, h: 0, v: 0 },
    { x: -20, y: 18, h: 1, v: 0 },
];

export function layoutTacticalAnnotations(items, width, height, gap = 8) {
    const occupied = [];
    const result = new Map();
    const ordered = [...items].sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    for (const item of ordered) {
        const slots = item.slot == null ? SLOTS.map((_, index) => index)
            : [item.slot, ...SLOTS.map((_, index) => index).filter((index) => index !== item.slot)];
        let placed = null;
        for (const slotIndex of slots) {
            const slot = SLOTS[slotIndex];
            const left = item.x + slot.x - item.width * slot.h;
            const top = item.y + slot.y - item.height * slot.v;
            const box = { left, top, right: left + item.width, bottom: top + item.height };
            if (box.left < gap || box.top < gap || box.right > width - gap || box.bottom > height - gap) continue;
            if (occupied.some((other) => box.left < other.right + gap && box.right + gap > other.left
                && box.top < other.bottom + gap && box.bottom + gap > other.top)) continue;
            occupied.push(box);
            placed = { ...box, slot: slotIndex };
            break;
        }
        result.set(item.id, placed);
    }
    return result;
}

export function createTacticalAnnotationManager(viewer, Cesium) {
    const existing = managers.get(viewer);
    if (existing) return existing;
    const root = document.createElement("div");
    root.className = "wz-tactical-annotation-layer";
    viewer.container.appendChild(root);
    const entries = new Map();
    let lastWidth = 0;
    let lastHeight = 0;
    let dirty = true;
    const project = Cesium.SceneTransforms.worldToWindowCoordinates
        || Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    function sync() {
        if (!entries.size || !root.isConnected) return;
        const canvasRect = viewer.scene.canvas.getBoundingClientRect();
        const layerRect = root.getBoundingClientRect();
        const width = layerRect.width;
        const height = layerRect.height;
        if (!width || !height) return;
        if (width !== lastWidth || height !== lastHeight) {
            dirty = true;
            lastWidth = width;
            lastHeight = height;
        }
        const cameraPosition = viewer.camera.positionWC;
        const occluder = cameraPosition && viewer.scene.globe?.ellipsoid
            ? new Cesium.EllipsoidalOccluder(viewer.scene.globe.ellipsoid, cameraPosition)
            : null;
        const visible = [];
        for (const entry of entries.values()) {
            if (occluder && !occluder.isPointVisible(entry.position)) {
                entry.label.style.visibility = "hidden";
                entry.leader.hidden = true;
                if (entry.visible) dirty = true;
                entry.visible = false;
                continue;
            }
            const screen = project(viewer.scene, entry.position);
            if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                entry.label.style.visibility = "hidden";
                entry.leader.hidden = true;
                if (entry.visible) dirty = true;
                entry.visible = false;
                continue;
            }
            const x = screen.x + canvasRect.left - layerRect.left;
            const y = screen.y + canvasRect.top - layerRect.top;
            if (x < 0 || y < 0 || x > width || y > height) {
                entry.label.style.visibility = "hidden";
                entry.leader.hidden = true;
                if (entry.visible) dirty = true;
                entry.visible = false;
                continue;
            }
            if (Math.abs(x - entry.x) >= .5 || Math.abs(y - entry.y) >= .5) dirty = true;
            entry.x = x;
            entry.y = y;
            if (!entry.visible) dirty = true;
            entry.visible = true;
            visible.push(entry);
        }
        if (!dirty) return;
        const placements = layoutTacticalAnnotations(visible.map((entry) => ({
            id: entry.id, x: entry.x, y: entry.y, width: entry.label.offsetWidth,
            height: entry.label.offsetHeight, priority: entry.priority, slot: entry.slot,
        })), width, height);
        for (const entry of visible) {
            const box = placements.get(entry.id);
            if (!box) {
                entry.label.style.visibility = "hidden";
                entry.leader.hidden = true;
                if (entry.visible) dirty = true;
                entry.visible = false;
                continue;
            }
            entry.slot = box.slot;
            entry.label.style.visibility = "visible";
            entry.label.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
            const endX = Math.max(box.left + 8, Math.min(box.right - 8, entry.x));
            const endY = Math.max(box.top + 8, Math.min(box.bottom - 8, entry.y));
            const distance = Math.hypot(endX - entry.x, endY - entry.y);
            entry.leader.hidden = distance < 8;
            if (distance >= 8) {
                entry.leader.style.width = `${distance}px`;
                entry.leader.style.transform = `translate3d(${entry.x}px, ${entry.y}px, 0) rotate(${Math.atan2(endY - entry.y, endX - entry.x)}rad)`;
            }
        }
        dirty = false;
    }

    const removeRenderListener = viewer.scene.postRender.addEventListener(sync);
    const manager = {
        add(id, position, text, accent, priority = 0) {
            const previous = entries.get(id);
            if (previous) { previous.leader.remove(); previous.label.remove(); entries.delete(id); }
            const leader = document.createElement("div");
            leader.className = "wz-tactical-annotation__leader";
            leader.style.setProperty("--wz-tactical-accent", accent);
            const label = document.createElement("div");
            label.className = `wz-tactical-annotation${String(text).length > 34 ? " wz-tactical-annotation--description" : ""}`;
            label.textContent = String(text || "ACTIVITY");
            label.style.visibility = "hidden";
            label.style.setProperty("--wz-tactical-accent", accent);
            root.append(leader, label);
            entries.set(id, { id, position, leader, label, priority, slot: null, x: NaN, y: NaN, visible: false });
            dirty = true;
            viewer.scene.requestRender();
        },
        setOpacity(ids, opacity) {
            for (const id of ids) {
                const entry = entries.get(id);
                if (entry) { entry.label.style.opacity = opacity; entry.leader.style.opacity = opacity; }
            }
        },
        remove(id) {
            const entry = entries.get(id);
            if (!entry) return;
            entry.leader.remove();
            entry.label.remove();
            entries.delete(id);
            dirty = true;
            if (!entries.size) {
                removeRenderListener();
                root.remove();
                managers.delete(viewer);
            }
        },
    };
    managers.set(viewer, manager);
    return manager;
}