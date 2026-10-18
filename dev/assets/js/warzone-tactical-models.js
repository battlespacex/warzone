import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

// MapLibre 5.24 globe API, also used by its official globe-3d-model example.
// No MercatorCoordinate transform, second canvas, RAF loop, or data subscription.
const cache = new Map();
const MAX_IDLE_MODELS = 12;
const loader = new GLTFLoader();
let activeLayers = 0;
let pendingLoads = 0;
const draco = new DRACOLoader().setDecoderPath("/assets/three/draco/").setWorkerLimit(2);
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const radians = (v) => (Number(v) || 0) * Math.PI / 180;
const wrap = (v) => ((v + 180) % 360 + 360) % 360 - 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function tacticalAltitude(type, record) {
    if (type === "naval") return 0; // Sea level, never terrain sampling.
    if (type === "satellite") return Math.max(0, Number(record.altitudeKm) * 1000 || 0);
    return Math.max(0, Number(record.altitude_ft) * .3048 || Number(record.altitude_m) || 0);
}

function disposeTemplate(gltf) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    gltf?.scene.traverse((node) => {
        if (node.geometry) geometries.add(node.geometry);
        for (const material of [].concat(node.material || [])) {
            materials.add(material);
            Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
        }
    });
    geometries.forEach((value) => value.dispose());
    materials.forEach((value) => value.dispose());
    textures.forEach((value) => { value.dispose(); value.source?.data?.close?.(); });
}
function trimCache(all = false) {
    const idle = [...cache.entries()].filter(([, value]) => !value.refs)
        .sort((a, b) => a[1].used - b[1].used);
    while (idle.length > (all ? 0 : MAX_IDLE_MODELS)) {
        const [uri, value] = idle.shift();
        cache.delete(uri);
        value.controller.abort();
        disposeTemplate(value.gltf);
    }
}
function acquire(uri) {
    let value = cache.get(uri);
    if (!value) {
        pendingLoads++;
        value = { refs: 0, used: performance.now(), controller: new AbortController(), gltf: null, started: performance.now(), pending: true };
        cache.set(uri, value);
        value.promise = fetch(uri, { signal: value.controller.signal })
            .then((response) => {
                if (!response.ok) throw new Error("GLB HTTP " + response.status + ": " + uri);
                return response.arrayBuffer();
            })
            .then((bytes) => {
                value.downloadMs = performance.now() - value.started;
                return loader.parseAsync(bytes, new URL(".", new URL(uri, location.href)).href);
            })
            .then((gltf) => {
                if (cache.get(uri) !== value) {
                    disposeTemplate(gltf);
                    throw new Error("Model request released");
                }
                value.gltf = gltf;
                value.loadMs = performance.now() - value.started;
                return gltf;
            }).catch((error) => {
                value.failed = true;
                throw error;
            }).finally(() => {
                value.pending = false;
                pendingLoads--;
                if (!activeLayers && !pendingLoads) draco.dispose();
            });
    }
    value.refs++;
    value.used = performance.now();
    return value;
}
function release(uri) {
    const value = cache.get(uri);
    if (value) { value.refs = Math.max(0, value.refs - 1); value.used = performance.now(); }
    if (value && !value.refs && (value.failed || value.pending)) {
        cache.delete(uri);
        value.controller.abort();
    }
    trimCache();
}
function poseOf(asset) {
    if (asset.pose) return asset.pose;
    const r = asset.record;
    return { lon: Number(r.lon), lat: Number(r.lat), altitude: tacticalAltitude(asset.type, r),
        heading: Number(r.heading_deg) || 0, pitch: Number(r.pitch_deg ?? r.metadata?.pitch_deg) || 0,
        roll: Number(r.roll_deg ?? r.metadata?.roll_deg) || 0 };
}
function interpolate(entry, now) {
    const t = clamp((now - entry.started) / entry.duration, 0, 1);
    const a = entry.from, b = entry.to;
    return { lon: a.lon + wrap(b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t,
        altitude: a.altitude + (b.altitude - a.altitude) * t,
        heading: a.heading + wrap(b.heading - a.heading) * t,
        pitch: a.pitch + (b.pitch - a.pitch) * t, roll: a.roll + wrap(b.roll - a.roll) * t };
}

export function createTacticalModelLayer(notice, changed = () => {}) {
    const entries = new Map();
    const reported = new Set();
    let map, renderer, removed = false, contextLost = false;
    let paused = false;
    const camera = new THREE.Camera();
    const projection = new THREE.Matrix4();
    const modelMatrix = new THREE.Matrix4();
    const clip = new THREE.Vector4();
    const scaleVector = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const turn = new THREE.Quaternion();
    const orientation = new THREE.Matrix4();
    const trailScene = new THREE.Scene();
    const trailAnchor = new THREE.Matrix4();
    const trailInverse = new THREE.Matrix4();
    const trailPoint = new THREE.Vector3();
    let trailData = null, trailSignature = "", trailBuiltFor = "";
    let trailHead = null;
    let trailFailed = false;
    function clearTrail() {
        for (const line of [...trailScene.children]) {
            line.geometry.dispose(); line.material.dispose(); trailScene.remove(line);
        }
        trailHead = null;
    }
    function buildTrail() {
        clearTrail();
        const origin = trailData?.segments.find((segment) => segment.coordinates.length > 1)?.coordinates[0];
        if (!origin) return;
        trailAnchor.fromArray(map.transform.getMatrixForModel(origin.slice(0, 2), origin[2]));
        trailInverse.copy(trailAnchor).invert();
        for (const segment of trailData.segments) {
            if (segment.coordinates.length < 2) continue;
            const positions = [];
            for (const coord of segment.coordinates) {
                modelMatrix.fromArray(map.transform.getMatrixForModel(coord.slice(0, 2), coord[2]));
                modelMatrix.premultiply(trailInverse);
                trailPoint.setFromMatrixPosition(modelMatrix);
                positions.push(trailPoint.x, trailPoint.y, trailPoint.z);
            }
            const line = new Line2(new LineGeometry().setPositions(positions), new LineMaterial({
                color: new THREE.Color(trailData.color), linewidth: trailData.width,
                transparent: true, opacity: segment.opacity, depthTest: true, depthWrite: false,
            }));
            line.frustumCulled = false;
            trailScene.add(line);
            if (!trailHead) trailHead = line; // First segment is the solid route ending at the live head.
        }
    }
    function renderTrail(selectedPose) {
        const key = trailSignature + ":" + map.transform.isGlobeRendering;
        if (key !== trailBuiltFor) { buildTrail(); trailBuiltFor = key; }
        if (!trailScene.children.length) return;
        if (selectedPose && trailHead) {
            modelMatrix.fromArray(map.transform.getMatrixForModel([selectedPose.lon, selectedPose.lat], selectedPose.altitude)).premultiply(trailInverse);
            trailPoint.setFromMatrixPosition(modelMatrix);
            const end = trailHead.geometry.getAttribute("instanceEnd");
            end.setXYZ(end.count - 1, trailPoint.x, trailPoint.y, trailPoint.z);
            end.data.needsUpdate = true;
        }
        const canvas = map.getCanvas();
        trailScene.children.forEach((line) => { line.material.linewidth = trailData.width * canvas.width / Math.max(1, canvas.clientWidth); });
        camera.projectionMatrix.copy(projection).multiply(trailAnchor);
        renderer.resetState(); renderer.render(trailScene, camera);
    }
    const ready = (entry) => !removed && entries.get(entry.key) === entry;

    function report(message) {
        if (reported.has(message)) return;
        reported.add(message);
        notice(message);
    }
    function removeEntry(entry) {
        entries.delete(entry.key);
        release(entry.uri);
        entry.mixer?.stopAllAction();
        if (entry.object) entry.mixer?.uncacheRoot(entry.object);
        // Clones share template geometry/materials; never dispose those here.
        entry.object?.traverse((node) => { if (node.isSkinnedMesh) node.skeleton?.dispose(); });
        entry.scene?.clear();
    }
    function attach(entry, gltf) {
        if (!ready(entry)) return;
        entry.object = clone(gltf.scene);
        if (gltf.animations.length) {
            entry.mixer = new THREE.AnimationMixer(entry.object);
            gltf.animations.forEach((clip) => entry.mixer.clipAction(clip).play());
            entry.animationAt = performance.now();
        }
        const box = new THREE.Box3().setFromObject(entry.object);
        const size = box.getSize(new THREE.Vector3());
        entry.size = Math.max(size.x, size.y, size.z, .001);
        // Preserve the exact authored model origin, proportions and waterline.
        entry.scene = new THREE.Scene();
        entry.scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(1, 3, 2);
        entry.scene.add(sun, entry.object);
        changed();
        map.triggerRepaint();
    }
    function load(entry, uri, fallback = false) {
        entry.uri = uri;
        entry.usingFallback = fallback;
        const value = acquire(uri);
        value.promise.then((gltf) => {
            if (!ready(entry)) return;
            if (fallback || entry.descriptor.fallback) {
                report("Fallback 3D visual: " + entry.descriptor.fallback_code + " (not an exact identification).");
            }
            attach(entry, gltf);
        }).catch((error) => {
            if (!ready(entry)) return;
            const next = entry.descriptor.fallback_uri;
            if (!fallback && next && next !== uri) {
                release(uri);
                load(entry, next, true);
                return;
            }
            report("3D model unavailable for " + entry.key + ": " + error.message + ". Satellite remains available.");
            entry.failed = true;
            changed();
        });
    }
    function lost() { contextLost = true; }
    function restored() {
        contextLost = false;
        map.triggerRepaint();
    }
    return {
        id: "tactical-models", type: "custom", renderingMode: "3d",
        onAdd(instance, gl) {
            map = instance;
            if (typeof map.transform.getMatrixForModel !== "function") throw new Error("Globe model transforms unavailable");
            renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
            activeLayers++;
            renderer.autoClear = false;
            map.getCanvas().addEventListener("webglcontextlost", lost);
            map.getCanvas().addEventListener("webglcontextrestored", restored);
        },
        setPaused(value) { paused = Boolean(value); },
        hasModel(key) { const entry = entries.get(key); return Boolean(entry?.object && !entry.failed); },
        screenPosition(key) { return entries.get(key)?.screen || null; },
        setTrail(value) {
            const signature = JSON.stringify(value);
            if (signature === trailSignature) return;
            trailData = value; trailSignature = signature;
            map.triggerRepaint();
        },
        diagnostics() { return { activeModels: entries.size, cachedTemplates: cache.size,
            pendingModels: [...cache.values()].filter((entry) => entry.pending).length,
            loads: [...cache.entries()].map(([uri, entry]) => ({ uri, refs: entry.refs, loadMs: entry.loadMs ?? null,
                downloadMs: entry.downloadMs ?? null,
                decodeAndParseMs: entry.loadMs == null ? null : entry.loadMs - entry.downloadMs })),
            renderer: renderer ? { calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries,
                textures: renderer.info.memory.textures, triangles: renderer.info.render.triangles } : null }; },
        status(key) {
            const entry = entries.get(key);
            if (!entry) return "";
            if (entry.usingFallback || entry.descriptor.fallback) return "Fallback visual: " + entry.descriptor.fallback_code + " (not an exact identification)";
            return entry.descriptor.model_code || "";
        },
        setAssets(assets) {
            if (removed) return;
            const now = performance.now();
            const wanted = new Set();
            for (const asset of assets) {
                const { key, descriptor } = asset;
                if (!descriptor?.model_uri) continue;
                wanted.add(key);
                let entry = entries.get(key);
                if (entry && entry.descriptor.model_uri !== descriptor.model_uri) {
                    removeEntry(entry); entry = null;
                }
                if (!entry) {
                    const pose = poseOf(asset);
                    entry = { ...asset, from: pose, to: pose, started: now, duration: 1 };
                    entries.set(key, entry);
                    load(entry, descriptor.model_uri);
                } else {
                    const pose = poseOf(asset);
                    if (JSON.stringify(pose) !== JSON.stringify(entry.to)) {
                        entry.from = interpolate(entry, now);
                        entry.to = pose;
                        entry.duration = clamp(now - entry.started, 100, 1000);
                        entry.started = now;
                    }
                    entry.selected = asset.selected;
                    entry.descriptor = descriptor;
                    entry.color = asset.color;
                }
            }
            for (const entry of entries.values()) if (!wanted.has(entry.key)) removeEntry(entry);
            map.triggerRepaint();
        },
        render(gl, args) {
            if (removed || paused || contextLost || document.hidden) return;
            projection.fromArray(args.defaultProjectionData.mainMatrix);
            const now = performance.now();
            let animating = false;
            let selectedPose = null;
            renderer.resetState();
            for (const entry of entries.values()) {
                entry.screen = null;
                if (!entry.scene || entry.failed) continue;
                try {
                const pose = interpolate(entry, now);
                if (entry.selected) selectedPose = pose;
                modelMatrix.fromArray(map.transform.getMatrixForModel([pose.lon, pose.lat], pose.altitude));
                camera.projectionMatrix.copy(projection).multiply(modelMatrix);
                clip.set(0, 0, 0, 1).applyMatrix4(camera.projectionMatrix);
                if (clip.w <= 0 || Math.abs(clip.x / clip.w) > 1.3 || Math.abs(clip.y / clip.w) > 1.3) continue;
                const occluded = map.transform.isLocationOccluded({ lng: pose.lon, lat: pose.lat });
                if (occluded) continue;
                animating ||= now < entry.started + entry.duration;
                entry.screen = { x: (clip.x / clip.w + 1) * map.getCanvas().clientWidth / 2,
                    y: (1 - clip.y / clip.w) * map.getCanvas().clientHeight / 2 };
                // Measure a local metre in clip space, valid for globe and Mercator.
                const originX = clip.x / clip.w, originY = clip.y / clip.w;
                let pixelsPerMeter = 0;
                for (const axis of [X, Y, Z]) {
                    clip.set(axis.x, axis.y, axis.z, 1).applyMatrix4(camera.projectionMatrix);
                    const dx = (clip.x / clip.w - originX) * map.getCanvas().clientWidth / 2;
                    const dy = (clip.y / clip.w - originY) * map.getCanvas().clientHeight / 2;
                    pixelsPerMeter = Math.max(pixelsPerMeter, Math.hypot(dx, dy));
                }
                if (!(pixelsPerMeter > 0)) continue;
                const d = entry.descriptor;
                const base = Math.max(.001, Number(d.scale) || 1);
                const minPixels = Math.max(0, Number(d.minimum_pixel_size) || 0);
                const maximum = Math.max(base, Number(d.maximum_scale) || Infinity);
                const scale = Math.min(maximum, Math.max(base, minPixels / (entry.size * pixelsPerMeter)));
                // Cesium HPR is Z(-heading), Y(-pitch), X(roll) in ENU.
                // Convert Y-up glTF to ENU, then back to MapLibre east/up/south.
                rotation.setFromAxisAngle(X, -Math.PI / 2);
                const prefix = entry.usingFallback ? "fallback_" : "";
                rotation.multiply(turn.setFromAxisAngle(Z, -radians(pose.heading + (d[prefix + "heading_offset_degrees"] ?? d.heading_offset_degrees ?? 0))));
                rotation.multiply(turn.setFromAxisAngle(Y, -radians(pose.pitch + (d[prefix + "pitch_offset_degrees"] ?? d.pitch_offset_degrees ?? 0))));
                rotation.multiply(turn.setFromAxisAngle(X, radians(pose.roll + (d[prefix + "roll_offset_degrees"] ?? d.roll_offset_degrees ?? 0))));
                rotation.multiply(turn.setFromAxisAngle(X, Math.PI / 2));
                orientation.makeRotationFromQuaternion(rotation);
                camera.projectionMatrix.multiply(orientation).scale(scaleVector.setScalar(scale));
                camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
                if (entry.mixer) {
                    entry.mixer.update(Math.min(.1, (now - entry.animationAt) / 1000));
                    entry.animationAt = now;
                    animating = true;
                }
                renderer.render(entry.scene, camera);
                } catch (error) {
                    entry.failed = true;
                    entry.screen = null;
                    queueMicrotask(changed);
                    report("3D rendering failed for " + entry.key + ": " + error.message + ". Satellite remains available.");
                } finally {
                    renderer.resetState();
                }
            }
            if (!trailFailed) {
                try { renderTrail(selectedPose); }
                catch (error) {
                    trailFailed = true; clearTrail();
                    report("Focused trail rendering failed: " + error.message + ". Original trails remain available in Satellite.");
                }
            }
            renderer.resetState();
            if (animating) map.triggerRepaint();
        },
        onRemove() {
            removed = true;
            activeLayers = Math.max(0, activeLayers - 1);
            clearTrail();
            for (const entry of entries.values()) removeEntry(entry);
            map.getCanvas().removeEventListener("webglcontextlost", lost);
            map.getCanvas().removeEventListener("webglcontextrestored", restored);
            renderer?.dispose(); // Never forceContextLoss: MapLibre owns this context.
            trimCache(); // Bounded CPU templates survive a Tactical/Satellite round trip.
            if (!activeLayers && !pendingLoads) draco.dispose();
        },
    };
}
