import * as Cesium from "cesium";

// Decorative pre-entry effect only. Uses the existing satellite postRender loop.
const defaults = {
    enabled: 1, count: 2, density: 35, size: 1.5, length: 45,
    opacity: 40, spread: 30, duration: 2, delay: 5, fade: 3,
    red: 245, green: 248, blue: 255,
};
const cssNames = {
    enabled: "--wz-startup-vapor-enabled",
    count: "--wz-startup-vapor-satellites",
    density: "--wz-startup-vapor-density",
    size: "--wz-startup-vapor-size",
    length: "--wz-startup-vapor-length",
    opacity: "--wz-startup-vapor-opacity",
    spread: "--wz-startup-vapor-spread",
    duration: "--wz-startup-vapor-duration",
    delay: "--wz-startup-vapor-delay",
    fade: "--wz-startup-vapor-fade",
    red: "--wz-startup-vapor-red",
    green: "--wz-startup-vapor-green",
    blue: "--wz-startup-vapor-blue",
};
const limit = (value, low, high) => Math.max(low, Math.min(high, value));

function readSettings() {
    const style = getComputedStyle(document.documentElement);
    const settings = {};
    for (const [key, cssVar] of Object.entries(cssNames)) {
        const raw = style.getPropertyValue(cssVar).trim();
        const value = raw === "" ? defaults[key] : Number(raw);
        settings[key] = Number.isFinite(value) ? value : defaults[key];
    }
    settings.count = Math.round(limit(settings.count, 1, 5));
    settings.density = limit(settings.density, 0, 100);
    settings.opacity = limit(settings.opacity, 0, 100);
    settings.fade = limit(settings.fade, 0.5, 8);
    settings.duration = limit(settings.duration, 0.5, 5);
    settings.delay = limit(settings.delay, 1, 15);
    settings.size = limit(settings.size, 0.1, 5);
    settings.length = limit(settings.length, 0, 100);
    settings.spread = limit(settings.spread, 0, 100);
    return settings;
}

function createSoftTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.68)");
    gradient.addColorStop(0.27, "rgba(255,255,255,0.34)");
    gradient.addColorStop(0.65, "rgba(255,255,255,0.09)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return canvas;
}

export function createStartupSatelliteVapor(viewer) {
    const collection = viewer.scene.primitives.add(new Cesium.BillboardCollection({ scene: viewer.scene }));
    const texture = createSoftTexture();
    const particles = [];
    const recent = new Set();
    let selected = [];
    let settings = readSettings();
    let settingsAt = -Infinity;
    let previousAt = null;
    let phaseEndsAt = 0;
    let emitting = false;
    let disposed = false;

    function clearParticles() {
        for (const particle of particles) collection.remove(particle.billboard);
        particles.length = 0;
    }

    function chooseSatellites(groups) {
        const width = viewer.scene.canvas.clientWidth;
        const height = viewer.scene.canvas.clientHeight;
        const visible = groups.filter((group) => {
            if (!group.entity?.show) return false;
            const position = group.entity.position?.getValue?.(Cesium.JulianDate.now());
            if (!position) return false;
            const point = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
            return point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
        });
        const fresh = visible.filter((group) => !recent.has(group.satDef.id));
        const pool = fresh.length >= settings.count ? fresh : visible;
        const randomized = [...pool].sort(() => Math.random() - 0.5);
        selected = randomized.slice(0, settings.count);
        recent.clear();
        selected.forEach((group) => recent.add(group.satDef.id));
    }

    function spawn(group, dt) {
        const current = group.entity?.position?.getValue?.(Cesium.JulianDate.now());
        if (!current || !group.vaporPreviousPosition) return;
        const velocity = Cesium.Cartesian3.subtract(current, group.vaporPreviousPosition, new Cesium.Cartesian3());
        if (Cesium.Cartesian3.magnitudeSquared(velocity) < 0.001) return;
        const backward = Cesium.Cartesian3.negate(
            Cesium.Cartesian3.normalize(velocity, new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
        );
        const amount = Math.min(5, Math.floor(dt * (4 + settings.density * 0.45) + Math.random()));
        for (let i = 0; i < amount && particles.length < 150; i++) {
            const distance = (15000 + Math.random() * 50000) * (settings.length / 45);
            const anchor = Cesium.Cartesian3.add(
                current, Cesium.Cartesian3.multiplyByScalar(backward, distance, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const drift = new Cesium.Cartesian3(
                (Math.random() - 0.5) * settings.spread * 900,
                (Math.random() - 0.5) * settings.spread * 900,
                (Math.random() - 0.5) * settings.spread * 900
            );
            const billboard = collection.add({
                position: anchor,
                image: texture,
                width: 24 * settings.size,
                height: 24 * settings.size,
                color: Cesium.Color.WHITE.withAlpha(0),
                disableDepthTestDistance: 0,
            });
            particles.push({
                billboard, anchor, drift, age: 0,
                lifetime: settings.fade * (0.75 + Math.random() * 0.5),
                radius: 0.7 + Math.random() * 0.8,
            });
        }
    }

    function update(groups, now) {
        if (disposed) return;
        if (now - settingsAt > 100) {
            settings = readSettings();
            settingsAt = now;
        }
        const dt = previousAt === null ? 0 : limit((now - previousAt) / 1000, 0, 0.05);
        previousAt = now;
        if (!settings.enabled || !settings.density || !settings.opacity) {
            if (particles.length) clearParticles();
            emitting = false;
            selected = [];
            phaseEndsAt = now + settings.delay * 1000;
            groups.forEach((group) => {
                group.vaporPreviousPosition = group.entity?.position?.getValue?.(Cesium.JulianDate.now())?.clone();
            });
            return;
        }
        if (!phaseEndsAt) phaseEndsAt = now + 800;
        if (now >= phaseEndsAt) {
            if (emitting) {
                emitting = false;
                selected = [];
                phaseEndsAt = now + settings.delay * 1000;
            } else {
                chooseSatellites(groups);
                emitting = selected.length > 0;
                phaseEndsAt = now + (emitting ? settings.duration * 1000 : 1000);
            }
        }
        const activeIds = new Set(selected.map((group) => group.satDef.id));
        for (const group of groups) {
            if (emitting && activeIds.has(group.satDef.id) && dt > 0) spawn(group, dt);
            group.vaporPreviousPosition = group.entity?.position?.getValue?.(Cesium.JulianDate.now())?.clone();
        }
        for (let i = particles.length - 1; i >= 0; i--) {
            const particle = particles[i];
            particle.age += dt;
            const progress = particle.age / particle.lifetime;
            if (progress >= 1) {
                collection.remove(particle.billboard);
                particles.splice(i, 1);
                continue;
            }
            particle.billboard.position = Cesium.Cartesian3.add(
                particle.anchor,
                Cesium.Cartesian3.multiplyByScalar(particle.drift, progress, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const pixels = 24 * settings.size * particle.radius * (1 + progress * 1.8);
            particle.billboard.width = pixels;
            particle.billboard.height = pixels;
            particle.billboard.color = Cesium.Color.fromBytes(
                settings.red, settings.green, settings.blue,
                Math.round(255 * (settings.opacity / 100) * Math.pow(1 - progress, 1.6))
            );
        }
    }

    return {
        update,
        reset() {
            clearParticles();
            selected = [];
            recent.clear();
            previousAt = null;
            phaseEndsAt = 0;
            emitting = false;
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            clearParticles();
            viewer.scene.primitives.remove(collection);
        },
    };
}
