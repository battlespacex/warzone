import * as Cesium from "cesium";

// Cinematic visual only: attached exclusively to the decorative entry-scene satellites.
// Uses the existing postRender callback, without changing satellite motion or the Cesium viewer.
const FIELDS = {
    enabled: ["--wz-startup-vapor-enabled", 1],
    count: ["--wz-startup-vapor-active-count", 2],
    duration: ["--wz-startup-vapor-duration", 2],
    delay: ["--wz-startup-vapor-cycle-delay", 5],
    length: ["--wz-startup-vapor-length", 180000],
    width: ["--wz-startup-vapor-width", 26000],
    headSize: ["--wz-startup-vapor-head-size", 18000],
    coreOpacity: ["--wz-startup-vapor-core-opacity", 0.95],
    tailOpacity: ["--wz-startup-vapor-tail-opacity", 0.62],
    glowOpacity: ["--wz-startup-vapor-glow-opacity", 0.35],
    blur: ["--wz-startup-vapor-blur-strength", 1.8],
    flash: ["--wz-startup-vapor-flash-strength", 1],
    fadePower: ["--wz-startup-vapor-fade-power", 1.6],
    spread: ["--wz-startup-vapor-spread", 0.18],
    jitter: ["--wz-startup-vapor-jitter", 0.08],
    red: ["--wz-startup-vapor-color-r", 255],
    green: ["--wz-startup-vapor-color-g", 245],
    blue: ["--wz-startup-vapor-color-b", 220],
};
const SEGMENTS = 12;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smoothstep = (t) => t * t * (3 - 2 * t);

function getSettings() {
    const css = getComputedStyle(document.documentElement);
    const settings = {};
    for (const [key, [name, fallback]] of Object.entries(FIELDS)) {
        // Number('2s') is NaN; parseFloat works for duration values in root.css.
        const value = parseFloat(css.getPropertyValue(name).trim());
        settings[key] = Number.isFinite(value) ? value : fallback;
    }
    settings.count = Math.round(clamp(settings.count, 1, 5));
    settings.duration = clamp(settings.duration, 0.2, 10);
    settings.delay = clamp(settings.delay, 0.2, 30);
    settings.length = clamp(settings.length, 0, 2000000);
    settings.width = clamp(settings.width, 0, 250000);
    settings.headSize = clamp(settings.headSize, 0, 200000);
    for (const key of ["coreOpacity", "tailOpacity", "glowOpacity"]) {
        settings[key] = clamp(settings[key], 0, 1);
    }
    settings.blur = clamp(settings.blur, 0, 6);
    settings.flash = clamp(settings.flash, 0, 5);
    settings.fadePower = clamp(settings.fadePower, 0.2, 5);
    settings.spread = clamp(settings.spread, 0, 1);
    settings.jitter = clamp(settings.jitter, 0, 1);
    for (const key of ["red", "green", "blue"]) settings[key] = clamp(settings[key], 0, 255);
    return settings;
}

function makeHeadTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.07, "rgba(255,255,255,0.98)");
    gradient.addColorStop(0.17, "rgba(255,255,255,0.6)");
    gradient.addColorStop(0.38, "rgba(255,255,255,0.17)");
    gradient.addColorStop(0.75, "rgba(255,255,255,0.02)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    return canvas;
}

export function createStartupSatelliteVapor(viewer) {
    const scene = viewer.scene;
    const trails = scene.primitives.add(new Cesium.PolylineCollection());
    const heads = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    const texture = makeHeadTexture();
    const active = [];
    const recent = new Set();
    const previousPositions = new Map();
    let phase = "idle";
    let phaseStart = 0;
    let nextPhaseAt = 0;
    let settings = getSettings();
    let settingsReadAt = -Infinity;
    let disposed = false;

    function removeTrail(trail) {
        for (const segment of trail.segments) {
            trails.remove(segment.core);
            trails.remove(segment.glow);
        }
        heads.remove(trail.head);
    }

    function clear() {
        for (const trail of active) removeTrail(trail);
        active.length = 0;
    }

    function select(groups) {
        const width = scene.canvas.clientWidth;
        const height = scene.canvas.clientHeight;
        const visible = groups.filter((group) => {
            const position = group.entity?.position?.getValue?.(Cesium.JulianDate.now());
            if (!position || group.entity.show === false) return false;
            const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
            return screen && screen.x >= 0 && screen.x <= width && screen.y >= 0 && screen.y <= height;
        });
        const newCandidates = visible.filter((group) => !recent.has(group.satDef.id));
        const pool = newCandidates.length >= settings.count ? newCandidates : visible;
        // Fisher-Yates shuffle, so different satellites get selected on each cycle.
        const randomized = [...pool];
        for (let i = randomized.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
        }
        const selected = randomized.slice(0, settings.count);
        recent.clear();
        selected.forEach((group) => recent.add(group.satDef.id));
        return selected;
    }

    function makeTrail(group) {
        const segments = [];
        for (let i = 0; i < SEGMENTS; i++) {
            const glow = trails.add({
                show: false,
                positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
                width: 2,
                material: Cesium.Material.fromType("PolylineGlow", {
                    color: Cesium.Color.WHITE.withAlpha(0),
                    glowPower: 0.45,
                    taperPower: 1,
                }),
            });
            const core = trails.add({
                show: false,
                positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
                width: 1,
                material: Cesium.Material.fromType("Color", {
                    color: Cesium.Color.WHITE.withAlpha(0),
                }),
            });
            segments.push({ glow, core });
        }
        const head = heads.add({
            show: false,
            image: texture,
            position: Cesium.Cartesian3.ZERO,
            width: 1,
            height: 1,
            color: Cesium.Color.WHITE,
        });
        return { id: group.satDef.id, segments, head, direction: null, seed: Math.random() * 100 };
    }

    function paint(trail, position, direction, progress, time) {
        const opacity = smoothstep(clamp(progress / 0.12, 0, 1)) *
            Math.pow(1 - smoothstep(clamp((progress - 0.54) / 0.46, 0, 1)), settings.fadePower);
        if (opacity <= 0.001 || settings.length <= 0) {
            for (const segment of trail.segments) {
                segment.core.show = false;
                segment.glow.show = false;
            }
            trail.head.show = false;
            return;
        }

        const rgb = Cesium.Color.fromBytes(settings.red, settings.green, settings.blue);
        const travel = Cesium.Cartesian3.negate(direction, new Cesium.Cartesian3());
        // The globe-relative tangent perpendicular is stable when the camera rotates.
        let side = Cesium.Cartesian3.cross(position, travel, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.magnitudeSquared(side) < 0.00001) {
            side = Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, travel, side);
        }
        Cesium.Cartesian3.normalize(side, side);
        const points = [];
        const growingLength = settings.length * smoothstep(clamp(progress / 0.18, 0, 1));
        for (let i = 0; i <= SEGMENTS; i++) {
            const t = i / SEGMENTS;
            const base = Cesium.Cartesian3.add(
                position,
                Cesium.Cartesian3.multiplyByScalar(travel, growingLength * t, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            // Small coherent displacement, never independent dots or smoke particles.
            const wobble = (Math.sin(t * 8 + trail.seed + time * 0.006) * 0.55 +
                Math.sin(t * 17 - trail.seed + time * 0.003) * 0.25);
            const sideways = (settings.spread * t * t * settings.width * 0.6) +
                (wobble * settings.jitter * settings.width * t);
            points.push(Cesium.Cartesian3.add(
                base, Cesium.Cartesian3.multiplyByScalar(side, sideways, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            ));
        }

        // Screen-space line widths remain visually useful at different camera distances.
        const distance = Cesium.Cartesian3.distance(scene.camera.positionWC, position);
        const metersPerPixel = Math.max(1, distance * scene.camera.frustum.fovy / Math.max(1, scene.canvas.clientHeight));
        const basePixels = clamp(settings.width / metersPerPixel, 1, 26);
        const tint = rgb;
        for (let i = 0; i < SEGMENTS; i++) {
            const segment = trail.segments[i];
            const t = (i + 0.5) / SEGMENTS;
            const taper = Math.pow(1 - t, 1.4);
            const fade = Math.pow(1 - t, settings.fadePower);
            const coreAlpha = clamp(opacity * settings.tailOpacity * fade, 0, 1);
            const glowAlpha = clamp(opacity * settings.glowOpacity * fade, 0, 1);
            const positions = [points[i], points[i + 1]];
            segment.core.positions = positions;
            segment.glow.positions = positions;
            segment.core.width = Math.max(1, basePixels * taper * 0.35);
            segment.glow.width = Math.max(1, basePixels * (1.5 + settings.blur * 1.4) * taper);
            segment.core.material.uniforms.color = tint.withAlpha(coreAlpha);
            segment.glow.material.uniforms.color = tint.withAlpha(glowAlpha);
            segment.glow.material.uniforms.glowPower = clamp(0.2 + settings.blur * 0.13, 0.05, 0.95);
            segment.core.show = coreAlpha > 0.005;
            segment.glow.show = glowAlpha > 0.005;
        }
        const flashEnvelope = 1 + settings.flash * Math.exp(-progress * 17);
        const headPixels = clamp(settings.headSize / metersPerPixel, 3, 55);
        trail.head.position = position;
        trail.head.width = headPixels * (1 + settings.blur * 0.55) * flashEnvelope;
        trail.head.height = trail.head.width;
        trail.head.color = tint.withAlpha(clamp(opacity * settings.coreOpacity, 0, 1));
        trail.head.show = settings.headSize > 0;
    }

    function update(groups, now) {
        if (disposed) return;
        if (now - settingsReadAt >= 100) {
            settings = getSettings();
            settingsReadAt = now;
        }
        const positions = new Map();
        for (const group of groups) {
            const position = group.entity?.position?.getValue?.(Cesium.JulianDate.now());
            if (position) positions.set(group.satDef.id, position);
        }
        if (settings.enabled === 0 || settings.length === 0) {
            clear();
            phase = "idle";
            nextPhaseAt = now + settings.delay * 1000;
        } else if (phase === "idle" && now >= nextPhaseAt) {
            clear();
            for (const group of select(groups)) active.push(makeTrail(group));
            if (active.length) {
                phase = "burst";
                phaseStart = now;
                nextPhaseAt = now + settings.duration * 1000;
            } else {
                nextPhaseAt = now + 1000;
            }
        } else if (phase === "burst") {
            const progress = clamp((now - phaseStart) / (settings.duration * 1000), 0, 1);
            for (const trail of active) {
                const position = positions.get(trail.id);
                const previous = previousPositions.get(trail.id);
                if (!position) continue;
                if (previous) {
                    const step = Cesium.Cartesian3.subtract(position, previous, new Cesium.Cartesian3());
                    if (Cesium.Cartesian3.magnitudeSquared(step) > 0.01) {
                        trail.direction = Cesium.Cartesian3.normalize(step, step);
                    }
                }
                if (trail.direction) paint(trail, position, trail.direction, progress, now);
            }
            if (now >= nextPhaseAt) {
                clear();
                phase = "idle";
                nextPhaseAt = now + settings.delay * 1000;
            }
        }
        previousPositions.clear();
        for (const [id, position] of positions) previousPositions.set(id, Cesium.Cartesian3.clone(position));
    }

    return {
        update,
        reset() {
            clear();
            recent.clear();
            previousPositions.clear();
            phase = "idle";
            nextPhaseAt = 0;
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            clear();
            previousPositions.clear();
            scene.primitives.remove(trails);
            scene.primitives.remove(heads);
        },
    };
}
