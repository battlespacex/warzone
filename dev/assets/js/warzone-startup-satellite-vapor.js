import * as Cesium from "cesium";

// Entry-scene decorative satellites only. Two feathered textures replace all
// segmented polyline geometry, eliminating the hard white/glittery artifacts.
const CSS = {
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
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smoothstep = (t) => t * t * (3 - 2 * t);

function readSettings() {
    const style = getComputedStyle(document.documentElement);
    const out = {};
    for (const [key, [name, fallback]] of Object.entries(CSS)) {
        const value = parseFloat(style.getPropertyValue(name).trim());
        out[key] = Number.isFinite(value) ? value : fallback;
    }
    out.count = Math.round(clamp(out.count, 1, 5));
    out.duration = clamp(out.duration, 0.2, 10);
    out.delay = clamp(out.delay, 0.2, 30);
    out.length = clamp(out.length, 0, 2000000);
    out.width = clamp(out.width, 0, 250000);
    out.headSize = clamp(out.headSize, 0, 200000);
    out.blur = clamp(out.blur, 0, 6);
    out.flash = clamp(out.flash, 0, 5);
    out.fadePower = clamp(out.fadePower, 0.2, 5);
    out.spread = clamp(out.spread, 0, 1);
    out.jitter = clamp(out.jitter, 0, 1);
    for (const key of ["coreOpacity", "tailOpacity", "glowOpacity"]) {
        out[key] = clamp(out[key], 0, 1);
    }
    for (const key of ["red", "green", "blue"]) out[key] = clamp(out[key], 0, 255);
    return out;
}

function makeTrailTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    // The brightest tip sits at the exact center of this image.
    // The right half remains transparent; Cesium rotates around the anchor.
    ctx.translate(36, 0);
    // The tail fades smoothly into the left half.
    // Blurred envelope and tapered interior are continuous, not polyline segments.
    const gradient = ctx.createLinearGradient(10, 0, 475, 0);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.24, "rgba(255,255,255,0.035)");
    gradient.addColorStop(0.56, "rgba(255,255,255,0.13)");
    gradient.addColorStop(0.79, "rgba(255,255,255,0.34)");
    gradient.addColorStop(0.96, "rgba(255,255,255,0.82)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.filter = "blur(15px)";
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(10, 80);
    ctx.bezierCurveTo(140, 72, 290, 34, 470, 74);
    ctx.quadraticCurveTo(482, 80, 470, 86);
    ctx.bezierCurveTo(290, 126, 140, 88, 10, 80);
    ctx.fill();
    ctx.restore();

    const core = ctx.createLinearGradient(30, 0, 476, 0);
    core.addColorStop(0, "rgba(255,255,255,0)");
    core.addColorStop(0.40, "rgba(255,255,255,0.035)");
    core.addColorStop(0.70, "rgba(255,255,255,0.2)");
    core.addColorStop(0.89, "rgba(255,255,255,0.54)");
    core.addColorStop(0.99, "rgba(255,255,255,0.85)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.filter = "blur(5px)";
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.moveTo(30, 80);
    ctx.bezierCurveTo(240, 77, 380, 69, 475, 77);
    ctx.lineTo(475, 83);
    ctx.bezierCurveTo(380, 91, 240, 83, 30, 80);
    ctx.fill();
    ctx.restore();
    return canvas;
}

function makeFlashTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.08, "rgba(255,255,255,0.9)");
    glow.addColorStop(0.25, "rgba(255,255,255,0.32)");
    glow.addColorStop(0.60, "rgba(255,255,255,0.04)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);
    return canvas;
}

export function createStartupSatelliteVapor(viewer) {
    const scene = viewer.scene;
    const billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene }));
    const trailTexture = makeTrailTexture();
    const flashTexture = makeFlashTexture();
    const active = [];
    const previousIds = new Set();
    let settings = readSettings();
    let settingsReadAt = -Infinity;
    let phase = "idle";
    let burstAt = 0;
    let phaseEndsAt = 0;
    let disposed = false;

    function clear() {
        for (const item of active) {
            billboards.remove(item.trail);
            billboards.remove(item.flash);
        }
        active.length = 0;
    }

    function select(groups) {
        const { clientWidth, clientHeight } = scene.canvas;
        const visible = groups.filter((group) => {
            const position = group.entity?.position?.getValue?.(Cesium.JulianDate.now());
            if (!position || group.entity.show === false) return false;
            const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
            return screen && screen.x >= 0 && screen.x <= clientWidth &&
                screen.y >= 0 && screen.y <= clientHeight;
        });
        const fresh = visible.filter((group) => !previousIds.has(group.satDef.id));
        const pool = fresh.length >= settings.count ? fresh : visible;
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const chosen = shuffled.slice(0, settings.count);
        previousIds.clear();
        chosen.forEach((group) => previousIds.add(group.satDef.id));
        return chosen;
    }

    function add(group) {
        const position = group.entity.position.getValue(Cesium.JulianDate.now());
        active.push({
            id: group.satDef.id,
            trail: billboards.add({
                show: false, image: trailTexture, position,
                // Texture tip and rotation center share the satellite anchor.
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                width: 1, height: 1, color: Cesium.Color.WHITE,
            }),
            flash: billboards.add({
                show: false, image: flashTexture, position,
                width: 1, height: 1, color: Cesium.Color.WHITE,
            }),
        });
    }

    function draw(item, group, progress) {
        const position = group.entity?.position?.getValue?.(Cesium.JulianDate.now());
        if (!position) {
            item.trail.show = false;
            item.flash.show = false;
            return;
        }
        const coords = Cesium.Cartographic.fromCartesian(position);
        const ahead = Cesium.Cartesian3.fromRadians(
            coords.longitude - Cesium.Math.toRadians(0.3), coords.latitude, coords.height
        );
        const screen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, position);
        const forwardScreen = Cesium.SceneTransforms.worldToWindowCoordinates(scene, ahead);
        if (!screen || !forwardScreen) return;
        const dx = forwardScreen.x - screen.x;
        const dy = forwardScreen.y - screen.y;
        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.01) return;
        const ux = dx / magnitude;
        const uy = dy / magnitude;
        const distance = Cesium.Cartesian3.distance(scene.camera.positionWC, position);
        const frustum = scene.camera.frustum;
        const fovY = Number(frustum.fovy) || Cesium.Math.toRadians(60);
        const metersPerPixel = Math.max(1, (2 * distance * Math.tan(fovY / 2)) /
            Math.max(1, scene.canvas.clientHeight));
        const appearing = smoothstep(clamp(progress / 0.14, 0, 1));
        const disappearing = Math.pow(1 - smoothstep(clamp((progress - 0.50) / 0.50, 0, 1)),
            settings.fadePower);
        const envelope = appearing * disappearing;
        const flashBoost = 1 + settings.flash * Math.exp(-progress * 15);
        const length = clamp(settings.length / metersPerPixel, 8, 320) *
            smoothstep(clamp(progress / 0.20, 0, 1));
        const tailHeight = clamp(settings.width / metersPerPixel, 3, 48) *
            (1.4 + settings.blur * 0.65 + settings.spread * 0.3);
        // Both sprites use the identical satellite world-space anchor.
        item.trail.position = position;
        item.trail.pixelOffset = Cesium.Cartesian2.ZERO;
        item.trail.rotation = Math.atan2(-uy, ux);
        // The right half is transparent; visible tail length remains length.
        item.trail.width = Math.max(1, length * 2);
        item.trail.height = Math.max(1, tailHeight);
        const tint = Cesium.Color.fromBytes(settings.red, settings.green, settings.blue);
        item.trail.color = tint.withAlpha(clamp(
            envelope * settings.tailOpacity * (0.8 + settings.glowOpacity * 0.8), 0, 1
        ));
        item.trail.show = envelope > 0.005 && settings.length > 0;

        const headSize = clamp(settings.headSize / metersPerPixel, 3, 70) *
            (1 + settings.blur * 0.35) * (1 + settings.flash * 0.30);
        item.flash.position = position;
        item.flash.width = headSize;
        item.flash.height = headSize;
        item.flash.color = tint.withAlpha(clamp(envelope * settings.coreOpacity * flashBoost, 0, 1));
        item.flash.show = envelope > 0.005 && settings.headSize > 0;
    }

    function update(groups, now) {
        if (disposed) return;
        if (now - settingsReadAt >= 100) {
            settings = readSettings();
            settingsReadAt = now;
        }
        if (settings.enabled === 0 || settings.length <= 0) {
            clear();
            phase = "idle";
            phaseEndsAt = now + settings.delay * 1000;
            return;
        }
        if (phase === "idle" && now >= phaseEndsAt) {
            clear();
            const chosen = select(groups);
            chosen.forEach(add);
            if (active.length) {
                phase = "burst";
                burstAt = now;
                phaseEndsAt = now + settings.duration * 1000;
            } else {
                phaseEndsAt = now + 1000;
            }
        }
        if (phase === "burst") {
            const progress = clamp((now - burstAt) / (settings.duration * 1000), 0, 1);
            const lookup = new Map(groups.map((group) => [group.satDef.id, group]));
            for (const item of active) {
                const group = lookup.get(item.id);
                if (group) draw(item, group, progress);
            }
            if (now >= phaseEndsAt) {
                clear();
                phase = "idle";
                phaseEndsAt = now + settings.delay * 1000;
            }
        }
    }

    return {
        update,
        reset() {
            clear();
            previousIds.clear();
            phase = "idle";
            phaseEndsAt = 0;
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            clear();
            scene.primitives.remove(billboards);
        },
    };
}
