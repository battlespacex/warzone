// Private, synthetic-only Cesium profiling. The HTML and bundle are served solely
// through this Playwright session; no public dev-server route or app entry exists.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const webpack = require("webpack");
const { chromium } = require("../node_modules/playwright");
const { execFile, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../..");
const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), "stratops-phase7-"));
const baseUrl = "http://localhost:4173";

function summarizeCpuProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const self = new Map(), inclusive = new Map(), stacks = new Map();
  profile.samples?.forEach((id, index) => {
    const micros = profile.timeDeltas?.[index] || 0;
    const leaf = nodes.get(id);
    const leafName = leaf?.callFrame?.functionName || "(anonymous)";
    self.set(leafName, (self.get(leafName) || 0) + micros);
    const frames = [];
    let node = leaf;
    while (node && frames.length < 16) {
      const frame = node.callFrame;
      if (frame?.functionName && frame.functionName !== "(root)") {
        const name = frame.functionName;
        frames.push(name);
        inclusive.set(name, (inclusive.get(name) || 0) + micros);
      }
      node = nodes.get(parents.get(node.id));
    }
    if (leafName === "getProgramParameter" || leafName === "(garbage collector)" || leafName === "clone") {
      const stack = frames.slice(0, 8).reverse().join(" > ");
      stacks.set(stack, (stacks.get(stack) || 0) + micros);
    }
  });
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([name, micros]) => ({ name, ms: Math.round(micros / 1000) }));
  return { self: top(self), inclusive: top(inclusive), blockingStacks: top(stacks) };
}

function buildHarness() {
  return new Promise((resolve, reject) => {
    webpack({
      mode: "development",
      devtool: false,
      entry: path.join(__dirname, "phase7-cesium-harness-entry.js"),
      output: { path: outputPath, filename: "harness.js", publicPath: `${baseUrl}/assets/cesium/` },
      resolve: { modules: [path.join(root, "node_modules"), "node_modules"] },
      plugins: [
        new webpack.DefinePlugin({ CESIUM_BASE_URL: JSON.stringify(`${baseUrl}/assets/cesium/`) }),
        new webpack.NormalModuleReplacementPlugin(/warzone-layers\.js$/, resource => {
          resource.request = path.join(__dirname, "phase7-cesium-harness-layers.js");
        }),
      ],
      performance: { hints: false },
    }, (error, stats) => {
      if (error || stats?.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    });
  });
}

async function main() {
  await buildHarness();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const scenarios = [
      ["globe", 0, 0], ["naval", 0, 300],
      ["air-100", 100, 0], ["air-500", 500, 0],
      ["air-1000", 1000, 0], ["air-5000", 5000, 0], ["air-10000", 10000, 0],
      ["naval-100", 0, 100], ["naval-500", 0, 500], ["naval-1000", 0, 1000],
      ["naval-5000", 0, 5000], ["naval-10000", 0, 10000],
      ["balanced-100", 50, 50], ["balanced-500", 250, 250], ["balanced-1000", 500, 500],
      ["balanced-5000", 2500, 2500], ["balanced-10000", 5000, 5000],
      ["air-10000-nolabel", 10000, 0], ["balanced-10000-nolabel", 5000, 5000],
      ["combined-1000", 1000, 300], ["combined-5000", 5000, 300], ["combined-10000", 10000, 300],
      ["models-1000", 1000, 300], ["models-10000", 10000, 300],
      ["release-model-1000", 1000, 300],
      ["interaction-1000", 1000, 300],
      ["interaction-10000", 10000, 300],
      ["interaction-model-1000", 1000, 300],
      ["interaction-repeat-model-1000", 1000, 300],
      ["profile-activation-10000", 10000, 300],
      ["profile-focus-billboard-1000", 1000, 300],
      ["profile-focus-warm-repeat-1000", 1000, 300],
      ["profile-focus-no-dynamic-ibl-1000", 1000, 300],
      ["profile-focus-no-custom-shader-1000", 1000, 300],
      ["profile-focus-parallel-precompile-1000", 1000, 300],
      ["profile-focus-parallel-complete-1000", 1000, 300],
      ["profile-focus-cold-model-1000", 1000, 300],
      ["profile-focus-model-1000", 1000, 300],
      ["profile-focus-single-prewarm-1000", 1000, 300],
      ["profile-focus-billboard-1", 1, 0],
      ["profile-focus-model-1", 1, 0],
      ["focus-moving-model-1", 1, 0],
      ["imagery-revisit-real", 0, 0],
      ["imagery-motion-baseline", 0, 0],
      ["imagery-motion-sharper", 0, 0],
    ];
    const selected = process.argv.slice(2);
    for (const [name, aircraftCount, navalCount] of scenarios) {
      if (selected.length && !selected.includes(name)) continue;
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(`${baseUrl}/__phase7_private_harness`, route => route.fulfill({
        status: 200, contentType: "text/html",
        body: '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#globe{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="globe"></div></body></html>',
      }));
      await page.goto(`${baseUrl}/__phase7_private_harness`);
      await page.addScriptTag({ path: path.join(outputPath, "harness.js") });
      await page.waitForFunction(() => Boolean(window.__phase7Harness), { timeout: 30000 });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      const modelStride = name.startsWith("models-") || name.startsWith("interaction-model-") || name.startsWith("interaction-repeat-model-") || name.startsWith("release-model-") || name.startsWith("profile-focus-model-") || name.startsWith("focus-moving-model-")
        ? (aircraftCount >= 10000 ? 100 : 20) : 0;
      const singlePrewarm = name === "profile-focus-single-prewarm-1000";
      const coldPromote = name === "profile-focus-cold-model-1000" || singlePrewarm;
      const load = await page.evaluate(async ({ aircraftCount, navalCount, modelStride, singlePrewarm, coldPromote }) => {
        const h = window.__phase7Harness;
        const started = performance.now();
        const sourceTime = new Date().toISOString();
        const air = i => ({
          track_key: `synthetic-air-${i}`, title: `Synthetic Aircraft ${i}`,
          source_name: "synthetic", category: "military", subcategory: i % 20 === 0 ? "fighter" : "unknown",
          lat: 8 + (i % 120) * 0.34, lon: 12 + (Math.floor(i / 120) % 200) * 0.42,
          altitude_ft: 25000 + i % 10000, heading_deg: i % 360, status: "active",
          updated_at: sourceTime,
          ...(coldPromote && i === 0
            ? { asset_key: "Fighter-F18", model_code: "Fighter-F18", render_mode: "img" }
            : (singlePrewarm ? i === 1 : modelStride && i % modelStride === 0)
            ? { asset_key: "Fighter-F18", model_code: "Fighter-F18", render_mode: "glb" } : {}),
        });
        const naval = i => ({
          id: `synthetic-naval-${i}`, dedupe_key: `synthetic-naval-${i}`,
          source_name: "ais", category: "naval", title: `Synthetic Vessel ${i}`,
          lat: 10 + (i % 30) * 0.7, lon: 20 + (Math.floor(i / 30) % 100) * 1.3,
          metadata: { mmsi: String(999000000 + i), vessel_name: `Synthetic Vessel ${i}`, vessel_type: "frigate",
            ...(modelStride && i % 20 === 0 ? { render_mode: "glb", asset_key: "Vessel-Frigate" } : {}) },
          updated_at: sourceTime,
        });
        window.__phase7Records = { air, naval };
        window.__phase7SyntheticLayers = { aircraft: aircraftCount > 0, naval: navalCount > 0 };
        if (navalCount) h.setNavalLayerVisible(true);
        for (let i = 0; i < aircraftCount; i += 100) {
          for (let j = i; j < Math.min(i + 100, aircraftCount); j++) h.upsertLiveTrack(air(j));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        for (let i = 0; i < navalCount; i++) h.upsertNavalVessel(naval(i));
        return { loadMs: Math.round(performance.now() - started), aircraft: h.getLiveTrackDiagnostics().activeCesiumAircraftEntities, naval: h.getNavalDiagnostics().activeCesiumNavalEntities };
      }, { aircraftCount, navalCount, modelStride, singlePrewarm, coldPromote });
      if (name.startsWith("imagery-")) {
        const imagery = await page.evaluate(async ({ name }) => {
          const h = window.__phase7Harness;
          h.viewer.destroy();
          document.body.className = "wz-pre-entry-active";
          document.body.innerHTML = '<div id="warzone-globe" style="width:100%;height:100%"></div><div id="warzone-map-credits"></div>';
          document.documentElement.style.setProperty("--warzone-globe-max-screen-space-error", "1.65");
          document.documentElement.style.setProperty("--warzone-globe-close-screen-space-error", "1.25");
          document.documentElement.style.setProperty("--warzone-globe-moving-screen-space-error",
            name === "imagery-motion-sharper" ? "2.15" : "2.65");
          document.documentElement.style.setProperty("--warzone-globe-tile-cache-size", "420");
          document.documentElement.style.setProperty("--warzone-globe-tile-cache-moving", "420");
          document.documentElement.style.setProperty("--warzone-globe-tile-cache-heavy", "220");
          document.documentElement.style.setProperty("--warzone-globe-tile-cache-loading", "420");
          document.documentElement.style.setProperty("--warzone-globe-loading-screen-space-error", "2.4");
          document.documentElement.style.setProperty("--warzone-globe-loading-descendant-limit", "24");
          document.documentElement.style.setProperty("--warzone-globe-loading-descendant-limit-busy", "10");
          document.documentElement.style.setProperty("--warzone-globe-loading-queue-threshold", "10");
          window.__stratopsConfig = {
            enableCesiumPerformanceDiagnostics: true,
            basemap: { provider: "esri" },
            terrain: { provider: "none" },
          };
          const providerClass = h.Cesium.ArcGisMapServerImageryProvider;
          const originalFromUrl = providerClass.fromUrl;
          let providerCreates = 0;
          providerClass.fromUrl = function (...args) {
            providerCreates += 1;
            return originalFromUrl.apply(this, args);
          };
          let viewer;
          try {
            viewer = await h.initWarzoneGlobe({ startStartupRotation: false });
            window.__warzoneViewer = viewer;
            h.viewer = viewer;
            await viewer.__warzoneImageryReadyPromise;
          } finally {
            providerClass.fromUrl = originalFromUrl;
          }
          const waitForTiles = async (timeoutMs = 15000) => {
            const started = performance.now();
            let stableAt = 0;
            while (performance.now() - started < timeoutMs) {
              viewer.scene.requestRender();
              await new Promise(resolve => setTimeout(resolve, 50));
              const idle = Number(viewer.__warzoneTileLoadQueueSize || 0) === 0 && viewer.__warzoneTileLoadBusy !== true;
              if (!idle) stableAt = 0;
              else if (!stableAt) stableAt = performance.now();
              else if (performance.now() - stableAt >= 650) break;
            }
          };
          const gl = viewer.scene.context._gl;
          const originalTexImage2D = gl.texImage2D.bind(gl);
          const originalTexSubImage2D = gl.texSubImage2D.bind(gl);
          let textureUploads = 0;
          gl.texImage2D = (...args) => { textureUploads += 1; return originalTexImage2D(...args); };
          gl.texSubImage2D = (...args) => { textureUploads += 1; return originalTexSubImage2D(...args); };
          const visit = async (label, longitude, latitude) => {
            window.__stratopsPerf.beginImagerySample(label);
            const uploadsBefore = textureUploads;
            viewer.camera.setView({ destination: h.Cesium.Cartesian3.fromDegrees(longitude, latitude, 75000) });
            viewer.scene.requestRender();
            await waitForTiles();
            return { ...window.__stratopsPerf.endImagerySample(), textureUploads: textureUploads - uploadsBefore };
          };
          if (name.startsWith("imagery-motion-")) {
            const startDestination = h.Cesium.Cartesian3.fromDegrees(-73.5673, 45.5019, 75000);
            const rotateFor = (durationMs, onFrame = null) => new Promise(resolve => {
              const started = performance.now();
              const frame = now => {
                viewer.camera.rotateRight(0.0012);
                viewer.scene.requestRender();
                onFrame?.(now);
                if (now - started < durationMs) requestAnimationFrame(frame); else resolve();
              };
              requestAnimationFrame(frame);
            });
            viewer.camera.setView({ destination: startDestination });
            viewer.scene.requestRender();
            await waitForTiles();
            // Warm the exact camera path first so the measured pass compares
            // moving LOD quality rather than different network timing.
            await rotateFor(3000);
            viewer.camera.setView({ destination: startDestination });
            viewer.scene.requestRender();
            await waitForTiles();
            const uploadsBefore = textureUploads;
            window.__stratopsPerf.beginImagerySample(name);
            const intervals = [], levels = [], sse = [], longTasks = [];
            const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
            observer.observe({ entryTypes: ["longtask"] });
            let last = 0;
            await rotateFor(3000, now => {
                if (last) intervals.push(now - last);
                last = now;
                sse.push(viewer.scene.globe.maximumScreenSpaceError);
                const rendered = viewer.scene.globe._surface?._tilesToRender || [];
                for (const tile of rendered) if (Number.isFinite(tile?.level)) levels.push(tile.level);
            });
            observer.disconnect();
            intervals.sort((a, b) => a - b);
            const sample = window.__stratopsPerf.endImagerySample();
            return { providerCreates, sample, textureUploads: textureUploads - uploadsBefore,
              frameP95Ms: +(intervals[Math.floor(intervals.length * .95)] || 0).toFixed(1),
              frameMaxMs: +(intervals.at(-1) || 0).toFixed(1), longTaskMaxMs: +Math.max(0, ...longTasks).toFixed(1),
              renderedLevelAverage: +(levels.reduce((sum, level) => sum + level, 0) / Math.max(1, levels.length)).toFixed(2),
              renderedLevelMax: Math.max(0, ...levels), movingSseAverage: +(sse.reduce((sum, value) => sum + value, 0) / Math.max(1, sse.length)).toFixed(2),
              cache: window.__stratopsPerf.getTileCacheStats(), errors: window.__stratopsPerf.getTileNetworkStats().providerRequests.rejected };
          }
          const firstA = await visit("first-a", -73.5673, 45.5019);
          const b = await visit("b", -79.3832, 43.6532);
          const revisitA = await visit("revisit-a", -73.5673, 45.5019);
          gl.texImage2D = originalTexImage2D;
          gl.texSubImage2D = originalTexSubImage2D;
          return {
            providerCreates,
            firstA,
            b,
            revisitA,
            cache: window.__stratopsPerf.getTileCacheStats(),
            imagery: window.__stratopsPerf.getImageryStats(),
            errors: window.__stratopsPerf.getTileNetworkStats().providerRequests.rejected,
          };
        }, { name });
        const metrics = (await cdp.send("Performance.getMetrics")).metrics;
        const heapMb = +(Number(metrics.find(x => x.name === "JSHeapUsedSize")?.value || 0) / 1048576).toFixed(1);
        console.log(JSON.stringify({ scenario: name, imagery, heapMb, errors }));
        await context.close();
        continue;
      }
      if (name === "focus-moving-model-1") {
        const focusMotion = await page.evaluate(async () => {
          const h = window.__phase7Harness;
          const trackKey = "synthetic-air-0";
          const entityId = `track-${trackKey}`;
          const entityBeforeFocus = h.viewer.entities.getById(entityId);
          const accepted = h.focusLiveTrack(trackKey);
          await new Promise(resolve => setTimeout(resolve, 2600));
          const entityAfterModel = h.viewer.entities.getById(entityId);
          const positionOf = () => entityAfterModel?.position?.getValue?.(h.Cesium.JulianDate.now());
          const cameraTarget = () => {
            const transform = h.viewer.camera.transform;
            return new h.Cesium.Cartesian3(transform[12], transform[13], transform[14]);
          };
          const screenOf = position => h.Cesium.SceneTransforms.worldToWindowCoordinates(h.viewer.scene, position);
          const startPosition = h.Cesium.Cartesian3.clone(positionOf());
          const startTarget = cameraTarget();
          const startScreen = screenOf(startPosition);
          const startView = {
            heading: h.viewer.camera.heading,
            pitch: h.viewer.camera.pitch,
            range: h.Cesium.Cartesian3.magnitude(h.viewer.camera.position),
          };
          const canvas = h.viewer.scene.canvas;
          const cx = Math.round(canvas.clientWidth * 0.5);
          const cy = Math.round(canvas.clientHeight * 0.5);
          canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1, clientX: cx, clientY: cy }));
          canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1, clientX: cx + 120, clientY: cy - 60 }));
          window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, button: 0, clientX: cx + 120, clientY: cy - 60 }));
          canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
          await new Promise(resolve => setTimeout(resolve, 100));
          const selectedView = {
            heading: h.viewer.camera.heading,
            pitch: h.viewer.camera.pitch,
            range: h.Cesium.Cartesian3.magnitude(h.viewer.camera.position),
          };
          const longTasks = [];
          const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
          observer.observe({ entryTypes: ["longtask"] });
          const intervals = [];
          let lastFrame = 0;
          const source = window.__phase7Records.air(0);
          h.upsertLiveTrack({
            ...source,
            lon: source.lon + 0.04,
            heading_deg: 55,
            speed_kts: 420,
            updated_at: new Date(Date.now() + 12000).toISOString(),
          });
          const motionActiveAfterUpdate = Boolean(entityAfterModel.__liveTrackMotionState);
          const modelActiveDuringMotion = Boolean(entityAfterModel.model);
          const motionSamples = [];
          await new Promise(resolve => {
            const started = performance.now();
            const frame = now => {
              if (lastFrame) intervals.push(now - lastFrame);
              lastFrame = now;
              const position = positionOf();
              const target = cameraTarget();
              const screen = screenOf(position);
              motionSamples.push({
                elapsedMs: now - started,
                worldMeters: h.Cesium.Cartesian3.distance(startPosition, position),
                cameraTargetMeters: h.Cesium.Cartesian3.distance(startTarget, target),
                targetErrorMeters: h.Cesium.Cartesian3.distance(position, target),
                screenX: screen?.x,
                screenY: screen?.y,
                headingDeg: entityAfterModel.__currentHeadingDeg,
              });
              if (now - started < 3000) requestAnimationFrame(frame); else resolve();
            };
            requestAnimationFrame(frame);
          });
          observer.disconnect();
          const endPosition = positionOf();
          const endTarget = cameraTarget();
          const endScreen = screenOf(endPosition);
          const endView = {
            heading: h.viewer.camera.heading,
            pitch: h.viewer.camera.pitch,
            range: h.Cesium.Cartesian3.magnitude(h.viewer.camera.position),
          };
          intervals.sort((a, b) => a - b);
          const endSample = motionSamples.at(-1);
          return {
            accepted,
            sameEntityAcrossModelPromotion: entityBeforeFocus === entityAfterModel,
            modelActiveDuringMotion,
            motionActiveAfterUpdate,
            worldDistanceMeters: Math.round(h.Cesium.Cartesian3.distance(startPosition, endPosition)),
            cameraTargetDistanceMeters: Math.round(h.Cesium.Cartesian3.distance(startTarget, endTarget)),
            cameraTargetErrorMeters: +h.Cesium.Cartesian3.distance(endPosition, endTarget).toFixed(2),
            screenDriftPixels: +Math.hypot((endScreen?.x || 0) - (startScreen?.x || 0), (endScreen?.y || 0) - (startScreen?.y || 0)).toFixed(1),
            headingStartDeg: motionSamples[0]?.headingDeg,
            headingEndDeg: endSample?.headingDeg,
            initialView: startView,
            userSelectedView: selectedView,
            finalView: endView,
            frameP95Ms: +(intervals[Math.floor(intervals.length * 0.95)] || 0).toFixed(1),
            frameMaxMs: +(intervals.at(-1) || 0).toFixed(1),
            longTaskMaxMs: +(Math.max(0, ...longTasks)).toFixed(1),
            activeInterpolationsAtEnd: h.getLiveTrackDiagnostics().activeInterpolations,
            trailPresent: Boolean(h.viewer.entities.getById(`track-trail-${trackKey}`)),
          };
        });
        const metrics = (await cdp.send("Performance.getMetrics")).metrics;
        const heapMb = +(Number(metrics.find(x => x.name === "JSHeapUsedSize")?.value || 0) / 1048576).toFixed(1);
        console.log(JSON.stringify({ scenario: name, load, focusMotion, heapMb, errors }));
        await context.close();
        continue;
      }
      if (name.startsWith("profile-")) {
        await page.waitForTimeout(1000);
        if (name === "profile-focus-warm-repeat-1000") {
          await page.evaluate(() => window.__phase7Harness.focusLiveTrack("synthetic-air-0"));
          await page.waitForTimeout(4500);
          await page.evaluate(() => window.__phase7Harness.clearLiveTrackSelection({ animate: false, resetCamera: false }));
          await page.waitForTimeout(500);
        }
        if (name === "profile-activation-10000") {
          await page.evaluate(() => {
            const h = window.__phase7Harness;
            window.__phase7SyntheticLayers.aircraft = false;
            window.__phase7SyntheticLayers.naval = false;
            h.setNavalLayerVisible(false);
            h.clearAllLiveTrackRenderState();
          });
          await page.waitForTimeout(500);
        }
        await cdp.send("HeapProfiler.enable");
        await cdp.send("HeapProfiler.collectGarbage");
        const heapBeforeMb = +((await cdp.send("Performance.getMetrics")).metrics.find(x => x.name === "JSHeapUsedSize").value / 1048576).toFixed(1);
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        const phase = await page.evaluate(async ({ name, aircraftCount }) => {
          const h = window.__phase7Harness, gl = h.viewer.scene.context._gl;
          const originalRequestRenderMode = h.viewer.scene.requestRenderMode;
          if (name === "profile-focus-cold-model-1000" || name === "profile-focus-single-prewarm-1000") {
            h.viewer.scene.requestRenderMode = false;
          }
          const originalModelFromGltf = h.Cesium.Model.fromGltfAsync;
          const context = h.viewer.scene.context;
          const originalDraw = context.draw;
          const computeEngine = h.viewer.scene._computeEngine;
          const originalComputeExecute = computeEngine.execute;
          const parallelExtension = gl.getExtension("KHR_parallel_shader_compile");
          const pendingPrograms = new WeakMap();
          let precompileStarted = 0, precompileReady = 0, precompileSkippedDraws = 0;
          let computeDeferred = 0, computeCompleted = 0;
          const computeJobs = new Map();
          const computeOwners = new Map();
          const precompileShaders = [];
          const parallelScenario = name === "profile-focus-parallel-precompile-1000" ||
            name === "profile-focus-parallel-complete-1000";
          const compileAsync = shader => {
            const vertex = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vertex, shader._vertexShaderText);
            gl.compileShader(vertex);
            const fragment = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fragment, shader._fragmentShaderText);
            gl.compileShader(fragment);
            const program = gl.createProgram();
            gl.attachShader(program, vertex);
            gl.attachShader(program, fragment);
            for (const [attribute, location] of Object.entries(shader._attributeLocations || {})) {
              gl.bindAttribLocation(program, location, attribute);
            }
            gl.linkProgram(program);
            return { program, vertex, fragment };
          };
          const discardAsync = pending => {
            gl.deleteProgram(pending.program);
            gl.deleteShader(pending.vertex);
            gl.deleteShader(pending.fragment);
          };
          if (name === "profile-focus-parallel-complete-1000" && parallelExtension) {
            computeEngine.execute = function (command) {
              const ownerName = `${command.owner?.constructor?.name || "none"}:${command.fragmentShaderSource?.sources?.map(x => x.length).join(",") || command.fragmentShaderSource?.length || ""}`;
              computeOwners.set(ownerName, (computeOwners.get(ownerName) || 0) + 1);
              if (!(command.owner instanceof h.Cesium.DynamicEnvironmentMapManager) ||
                (!command.fragmentShaderSource && !command.shaderProgram)) {
                return originalComputeExecute.call(this, command);
              }
              if (command.shaderProgram?._program) return originalComputeExecute.call(this, command);
              const jobKey = command.shaderProgram || command;
              let job = computeJobs.get(jobKey);
              if (!job) {
                const ownedShader = !command.shaderProgram;
                const shader = command.shaderProgram || h.Cesium.ShaderProgram.fromCache({ context,
                  vertexShaderSource: h.Cesium._shadersViewportQuadVS,
                  fragmentShaderSource: command.fragmentShaderSource,
                  attributeLocations: { position: 0, textureCoordinates: 1 } });
                job = { ...compileAsync(shader), shader, ownedShader };
                computeJobs.set(jobKey, job);
                precompileStarted++;
                precompileShaders.push({ vertex: shader._vertexShaderText?.length,
                  fragment: shader._fragmentShaderText?.length, owner: "DynamicEnvironmentMapManager",
                  ready: false });
              }
              if (!gl.getProgramParameter(job.program, parallelExtension.COMPLETION_STATUS_KHR)) {
                computeDeferred++;
                h.Cesium.DynamicEnvironmentMapManager._activeComputeCommandCount--;
                h.Cesium.DynamicEnvironmentMapManager._nextFrameCommandQueue.push(command);
                setTimeout(() => h.viewer.scene.requestRender(), 16);
                return;
              }
              computeJobs.delete(jobKey);
              computeCompleted++;
              precompileReady++;
              const diagnostic = precompileShaders.find(item => item.owner === "DynamicEnvironmentMapManager" &&
                !item.ready && item.vertex === job.shader._vertexShaderText?.length &&
                item.fragment === job.shader._fragmentShaderText?.length);
              if (diagnostic) diagnostic.ready = true;
              try {
                return originalComputeExecute.call(this, command);
              } finally {
                discardAsync(job);
                if (job.ownedShader) job.shader.destroy();
              }
            };
          }
          if (parallelScenario && parallelExtension) {
            context.draw = function (command, passState, shaderProgram, uniformMap) {
              const shader = shaderProgram || command._shaderProgram;
              let completedPending;
              if (shader && !shader._program &&
                (name !== "profile-focus-parallel-complete-1000" || command.owner)) {
                let pending = pendingPrograms.get(shader);
                if (!pending) {
                  pending = compileAsync(shader);
                  pendingPrograms.set(shader, pending);
                  precompileStarted++;
                  precompileShaders.push({ vertex: shader._vertexShaderText?.length, fragment: shader._fragmentShaderText?.length,
                    owner: command.owner?.constructor?.name || "", pass: command.pass, ready: false });
                }
                if (!gl.getProgramParameter(pending.program, parallelExtension.COMPLETION_STATUS_KHR)) {
                  precompileSkippedDraws++;
                  setTimeout(() => h.viewer.scene.requestRender(), 16);
                  return;
                }
                precompileReady++;
                const diagnostic = precompileShaders.find(item => !item.ready && item.vertex === shader._vertexShaderText?.length && item.fragment === shader._fragmentShaderText?.length);
                if (diagnostic) diagnostic.ready = true;
                pendingPrograms.delete(shader);
                completedPending = pending;
              }
              try {
                return originalDraw.call(this, command, passState, shaderProgram, uniformMap);
              } finally {
                if (completedPending) discardAsync(completedPending);
              }
            };
          }
          if (name === "profile-focus-no-dynamic-ibl-1000" || name === "profile-focus-no-custom-shader-1000") {
            h.Cesium.Model.fromGltfAsync = function (options) {
              return originalModelFromGltf.call(this, {
                ...options,
                ...(name === "profile-focus-no-dynamic-ibl-1000"
                  ? { environmentMapOptions: { ...options.environmentMapOptions, enabled: false } }
                  : { customShader: undefined }),
              });
            };
          }
          const longTasks = [], intervals = [], glCalls = new Map(), slowGlStacks = [];
          const originalFlyToBoundingSphere = h.viewer.camera.flyToBoundingSphere;
          const flightCallbacks = { calls: 0, complete: 0, cancel: 0 };
          h.viewer.camera.flyToBoundingSphere = function (sphere, options = {}) {
            flightCallbacks.calls++;
            return originalFlyToBoundingSphere.call(this, sphere, {
              ...options,
              complete: () => { flightCallbacks.complete++; options.complete?.(); },
              cancel: () => { flightCallbacks.cancel++; options.cancel?.(); },
            });
          };
          const entityOps = { add: { count: 0, totalMs: 0, maxMs: 0 }, remove: { count: 0, totalMs: 0, maxMs: 0 },
            suspendEvents: { count: 0, totalMs: 0, maxMs: 0 }, resumeEvents: { count: 0, totalMs: 0, maxMs: 0 } };
          const collection = h.viewer.entities, originalEntityOps = new Map();
          for (const name of Object.keys(entityOps)) {
            const original = collection[name];
            originalEntityOps.set(name, original);
            collection[name] = function (...args) {
              const start = performance.now();
              try { return original.apply(this, args); }
              finally {
                const elapsed = performance.now() - start;
                entityOps[name].count++; entityOps[name].totalMs += elapsed;
                entityOps[name].maxMs = Math.max(entityOps[name].maxMs, elapsed);
              }
            };
          }
          const observer = new PerformanceObserver(list => list.getEntries().forEach(task => longTasks.push({
            startMs: Math.round(task.startTime), durationMs: Math.round(task.duration),
          })));
          observer.observe({ entryTypes: ["longtask"] });
          const originalProgramParameter = gl.getProgramParameter;
          gl.getProgramParameter = function (program, parameter) {
            const stack = parameter === gl.LINK_STATUS ? new Error().stack : "";
            const start = performance.now();
            const result = originalProgramParameter.call(this, program, parameter);
            const key = parameter === gl.LINK_STATUS ? "LINK_STATUS" : parameter === gl.ACTIVE_UNIFORMS ? "ACTIVE_UNIFORMS" :
              parameter === gl.ACTIVE_ATTRIBUTES ? "ACTIVE_ATTRIBUTES" : String(parameter);
            const current = glCalls.get(key) || { count: 0, totalMs: 0, maxMs: 0 };
            const elapsed = performance.now() - start;
            current.count++; current.totalMs += elapsed; current.maxMs = Math.max(current.maxMs, elapsed);
            glCalls.set(key, current);
            if (key === "LINK_STATUS" && elapsed > 20) {
              const shaderSources = (gl.getAttachedShaders(program) || []).map(shader => gl.getShaderSource(shader) || "");
              slowGlStacks.push({ ms: +elapsed.toFixed(1), shaderLengths: shaderSources.map(source => source.length),
                shaderStarts: shaderSources.map(source => source.slice(0, 260).replace(/\s+/g, " ")),
                stack: stack?.split("\n").slice(1, 7).join(" | ") });
            }
            return result;
          };
          const started = performance.now();
          let lastFrame = 0, monitoring = true;
          const frameSamples = [];
          const frame = now => {
            if (lastFrame) {
              intervals.push(now - lastFrame);
              frameSamples.push({ atMs: now - started, durationMs: now - lastFrame });
            }
            lastFrame = now;
            if (monitoring) {
              h.viewer.scene.requestRender();
              requestAnimationFrame(frame);
            }
          };
          requestAnimationFrame(frame);
          let accepted = true;
          if (name === "profile-activation-10000") {
            window.__phase7SyntheticLayers.aircraft = true;
            window.__phase7SyntheticLayers.naval = true;
            h.setNavalLayerVisible(true);
            h.syncLiveTrackRenderPopulation();
          } else {
            accepted = h.focusLiveTrack("synthetic-air-0");
          }
          const syncMs = performance.now() - started;
          if (name === "profile-activation-10000") {
            const deadline = performance.now() + 12000;
            while (h.getLiveTrackDiagnostics().activeCesiumAircraftEntities < aircraftCount && performance.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          } else if (parallelScenario) {
            const deadline = performance.now() + 10000;
            while ((precompileStarted === 0 || precompileReady < precompileStarted) && performance.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            const focusSettleMs = name === "profile-focus-cold-model-1000" ||
              name === "profile-focus-single-prewarm-1000" ? 6500 : 2500;
            await new Promise(resolve => setTimeout(resolve, focusSettleMs));
          }
          monitoring = false;
          observer.disconnect();
          gl.getProgramParameter = originalProgramParameter;
          context.draw = originalDraw;
          computeEngine.execute = originalComputeExecute;
          h.Cesium.Model.fromGltfAsync = originalModelFromGltf;
          h.viewer.scene.requestRenderMode = originalRequestRenderMode;
          h.viewer.camera.flyToBoundingSphere = originalFlyToBoundingSphere;
          for (const [operation, original] of originalEntityOps) collection[operation] = original;
          const sorted = intervals.slice().sort((a, b) => a - b);
          const summarizeFrames = samples => {
            const values = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
            return { p95Ms: +(values[Math.floor(values.length * .95)] || 0).toFixed(1),
              maxMs: +(values.at(-1) || 0).toFixed(1) };
          };
          return { accepted, syncMs: +syncMs.toFixed(1), totalMs: +(performance.now() - started).toFixed(1),
            aircraft: h.getLiveTrackDiagnostics().activeCesiumAircraftEntities,
            naval: h.getNavalDiagnostics().activeCesiumNavalEntities,
            models: h.viewer.entities.values.filter(entity => entity.model).length,
            focusHeight: Math.round(h.viewer.camera.positionCartographic.height),
            frameP95Ms: +(sorted[Math.floor(sorted.length * .95)] || 0).toFixed(1),
            frameMaxMs: +(sorted.at(-1) || 0).toFixed(1),
            cameraFlightFrames: summarizeFrames(frameSamples.filter(sample => sample.atMs <= 1450)),
            postFlightFrames: summarizeFrames(frameSamples.filter(sample => sample.atMs > 1450)),
            longTasks: longTasks.sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
            glCalls: [...glCalls.entries()].map(([parameter, value]) => ({ parameter, count: value.count,
              totalMs: +value.totalMs.toFixed(1), maxMs: +value.maxMs.toFixed(1) })),
            entityOps: Object.fromEntries(Object.entries(entityOps).map(([operation, value]) => [operation,
              { count: value.count, totalMs: +value.totalMs.toFixed(1), maxMs: +value.maxMs.toFixed(1) }])),
            renderer: (() => {
              const ext = gl.getExtension("WEBGL_debug_renderer_info");
              return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            })(),
            parallelShaderCompile: Boolean(gl.getExtension("KHR_parallel_shader_compile")),
            precompile: { started: precompileStarted, ready: precompileReady, skippedDraws: precompileSkippedDraws,
              computeDeferred, computeCompleted, pendingCompute: computeJobs.size },
            computeOwners: [...computeOwners],
            precompileShaders,
            modelPrimitives: h.viewer.scene.primitives._primitives.filter(primitive => primitive instanceof h.Cesium.Model)
              .map(primitive => ({ ready: primitive.ready, show: primitive.show, url: primitive._resource?.url || "" })),
            flightCallbacks,
            focusedEntity: (() => {
              const focused = h.viewer.entities.getById("track-synthetic-air-0");
              return { model: Boolean(focused?.model), billboard: Boolean(focused?.billboard),
                selected: h.getLiveTrackSelection?.() || null };
            })(),
            slowGlStacks: slowGlStacks.sort((a, b) => b.ms - a.ms).slice(0, 8),
          };
        }, { name, aircraftCount });
        const cpu = summarizeCpuProfile((await cdp.send("Profiler.stop")).profile);
        await cdp.send("HeapProfiler.collectGarbage");
        const heapAfterMb = +((await cdp.send("Performance.getMetrics")).metrics.find(x => x.name === "JSHeapUsedSize").value / 1048576).toFixed(1);
        const appearanceScreenshot = name === "profile-focus-billboard-1"
          ? path.join(os.tmpdir(), "stratops-focus-appearance.png")
          : "";
        if (appearanceScreenshot) await page.screenshot({ path: appearanceScreenshot });
        console.log(JSON.stringify({ scenario: name, load, phase, heapBeforeMb, heapAfterMb, cpu, errors, appearanceScreenshot }));
        await context.close();
        continue;
      }
      const removedLabels = name.endsWith("-nolabel") ? await page.evaluate(() => {
        let count = 0;
        for (const entity of window.__phase7Harness.viewer.entities.values) {
          if (!entity.label) continue;
          entity.label = undefined;
          count++;
        }
        return count;
      }) : 0;
      await page.waitForTimeout(1500);
      const activePids = (await (await browser.newBrowserCDPSession()).send("SystemInfo.getProcessInfo")).processInfo.map(x => x.id);
      const gpuPromise = new Promise(resolve => {
        const ps = `$ids=@(${activePids.join(",")}); $s=Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage','\\GPU Process Memory(*)\\Dedicated Usage' -SampleInterval 1 -MaxSamples 3 -ErrorAction Stop; $a=$s.CounterSamples | Where-Object { $n=$_.InstanceName; @($ids | Where-Object { $n -like ('*pid_'+$_+'_*') }).Count -gt 0 }; $a | Select-Object InstanceName,CounterName,CookedValue | ConvertTo-Json -Compress`;
        execFile("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 12000 }, (error, stdout) => {
          if (error) return resolve({ unavailable: error.message.slice(0, 180) });
          try { resolve(JSON.parse(stdout || "[]")); } catch { resolve({ unavailable: "GPU counter output could not be parsed" }); }
        });
      });
      const camera = await page.evaluate(async () => {
        const h = window.__phase7Harness;
        const scene = h.viewer.scene;
        const intervals = [], renderCosts = [], drawCalls = [];
        let last = 0, began = 0, draws = 0, textureUploads = 0;
        const gl = scene.context._gl;
        const drawElements = gl.drawElements.bind(gl), drawArrays = gl.drawArrays.bind(gl);
        const texImage2D = gl.texImage2D.bind(gl), texSubImage2D = gl.texSubImage2D.bind(gl);
        gl.drawElements = (...args) => { draws++; return drawElements(...args); };
        gl.drawArrays = (...args) => { draws++; return drawArrays(...args); };
        gl.texImage2D = (...args) => { textureUploads++; return texImage2D(...args); };
        gl.texSubImage2D = (...args) => { textureUploads++; return texSubImage2D(...args); };
        const pre = scene.preRender.addEventListener(() => {
          const now = performance.now();
          if (last) intervals.push(now - last);
          last = now; began = now; draws = 0;
        });
        const post = scene.postRender.addEventListener(() => {
          renderCosts.push(performance.now() - began); drawCalls.push(draws);
        });
        const start = performance.now();
        await new Promise(resolve => {
          function frame() {
            const elapsed = performance.now() - start;
            h.viewer.camera.rotateRight(0.004);
            if (elapsed > 900 && elapsed < 1400) h.viewer.camera.zoomIn(18000);
            scene.requestRender();
            if (elapsed < 2500) requestAnimationFrame(frame); else resolve();
          }
          requestAnimationFrame(frame);
        });
        pre(); post();
        gl.drawElements = drawElements; gl.drawArrays = drawArrays;
        gl.texImage2D = texImage2D; gl.texSubImage2D = texSubImage2D;
        const summary = values => {
          const sorted = values.slice().sort((a, b) => a - b);
          return { count: sorted.length, mean: +((sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1)).toFixed(1)),
            p50: +((sorted[Math.floor(sorted.length * .5)] || 0).toFixed(1)), p95: +((sorted[Math.floor(sorted.length * .95)] || 0).toFixed(1)),
            p99: +((sorted[Math.floor(sorted.length * .99)] || 0).toFixed(1)), max: +((sorted.at(-1) || 0).toFixed(1)) };
        };
        return { intervalsMs: summary(intervals), sceneCpuMs: summary(renderCosts), drawCalls: summary(drawCalls), textureUploads,
          tileRequests: performance.getEntriesByType("resource").filter(x => /\/assets\/cesium\/|\/terrain\/|tile|imagery/i.test(x.name)).length,
          entities: h.viewer.entities.values.length, models: h.viewer.entities.values.filter(x => x.model).length,
          labels: h.viewer.entities.values.filter(x => x.label).length,
          aircraft: h.getLiveTrackDiagnostics(), naval: h.getNavalDiagnostics(),
        };
      });
      let transitions = null;
      if (name.startsWith("air-10000") || name === "naval-10000" || name.startsWith("balanced-10000")) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        transitions = await page.evaluate(async ({ navalCount }) => {
          const h = window.__phase7Harness;
          const longTasks = [];
          const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(Math.round(entry.duration))));
          observer.observe({ entryTypes: ["longtask"] });
          const measure = action => { const start = performance.now(); action(); return +(performance.now() - start).toFixed(1); };
          const repeatedNavalOnMs = navalCount ? Array.from({ length: 3 }, () => measure(() => h.setNavalLayerVisible(true))) : [];
          const moveEndDispatchMs = measure(() => h.viewer.camera.moveEnd.raiseEvent());
          const intervals = []; let last = 0;
          await new Promise(resolve => {
            const start = performance.now();
            function frame(now) {
              if (last) intervals.push(now - last);
              last = now;
              if (now - start < 2500) requestAnimationFrame(frame); else resolve();
            }
            requestAnimationFrame(frame);
          });
          observer.disconnect();
          intervals.sort((a, b) => a - b);
          return { repeatedNavalOnMs, moveEndDispatchMs, tailFrameP95Ms: +(intervals[Math.floor(intervals.length * .95)] || 0).toFixed(1),
            tailFrameMaxMs: +(intervals.at(-1) || 0).toFixed(1), longTasks: longTasks.sort((a, b) => b - a).slice(0, 6) };
        }, { navalCount });
        const profile = (await cdp.send("Profiler.stop")).profile;
        const nodes = new Map(profile.nodes.map(node => [node.id, node]));
        const costs = new Map();
        profile.samples?.forEach((id, index) => costs.set(id, (costs.get(id) || 0) + (profile.timeDeltas?.[index] || 0)));
        transitions.cpuTop = [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, micros]) => ({
          function: nodes.get(id)?.callFrame?.functionName || "(anonymous)", selfMs: Math.round(micros / 1000),
        }));
      }
      let warmCamera = null;
      if (name === "models-10000") {
        warmCamera = await page.evaluate(async () => {
          const h = window.__phase7Harness, gl = h.viewer.scene.context._gl;
          const texImage2D = gl.texImage2D.bind(gl), texSubImage2D = gl.texSubImage2D.bind(gl);
          let uploads = 0, last = 0; const intervals = [];
          gl.texImage2D = (...args) => { uploads++; return texImage2D(...args); };
          gl.texSubImage2D = (...args) => { uploads++; return texSubImage2D(...args); };
          const start = performance.now();
          await new Promise(resolve => {
            function frame(now) {
              if (last) intervals.push(now - last);
              last = now;
              h.viewer.camera.rotateRight(0.004);
              h.viewer.scene.requestRender();
              if (now - start < 2000) requestAnimationFrame(frame); else resolve();
            }
            requestAnimationFrame(frame);
          });
          gl.texImage2D = texImage2D; gl.texSubImage2D = texSubImage2D;
          intervals.sort((a, b) => a - b);
          return { uploads, frameP95Ms: +(intervals[Math.floor(intervals.length * .95)] || 0).toFixed(1),
            frameMaxMs: +(intervals.at(-1) || 0).toFixed(1) };
        });
      }
      const metrics = (await cdp.send("Performance.getMetrics")).metrics;
      const rawGpuCounters = await gpuPromise;
      const gpuRows = Array.isArray(rawGpuCounters) ? rawGpuCounters : [];
      const gpuCounters = gpuRows.length ? {
        engine3dPercent: gpuRows.filter(x => /engtype_3d$/i.test(x.InstanceName)).map(x => +Number(x.CookedValue).toFixed(1)),
        dedicatedMb: gpuRows.filter(x => /_phys_\d+$/i.test(x.InstanceName)).map(x => +(Number(x.CookedValue) / 1048576).toFixed(1)),
      } : rawGpuCounters;
      const heapMb = +(Number(metrics.find(x => x.name === "JSHeapUsedSize")?.value || 0) / 1048576).toFixed(1);
      const processInfo = await (await browser.newBrowserCDPSession()).send("SystemInfo.getProcessInfo");
      const pids = processInfo.processInfo.map(x => x.id);
      let processMemory = null;
      try {
        const ps = `$p=Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue; $p | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
        processMemory = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 15000 }));
      } catch (error) { processMemory = { unavailable: error.message }; }
      const processRows = Array.isArray(processMemory) ? processMemory : processMemory ? [processMemory] : [];
      const processSummary = processRows.length && !processRows[0]?.unavailable ? {
        totalWorkingSetMb: +(processRows.reduce((sum, x) => sum + Number(x.WorkingSet64 || 0), 0) / 1048576).toFixed(1),
        largestProcessMb: +(Math.max(...processRows.map(x => Number(x.WorkingSet64 || 0))) / 1048576).toFixed(1),
      } : processMemory;
      let interaction = null;
      if (name.startsWith("interaction-")) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        interaction = await page.evaluate(async ({ modelScenario, repeatedScenario, aircraftCount }) => {
          const h = window.__phase7Harness, records = window.__phase7Records;
          const longTasks = [];
          const observer = new PerformanceObserver(list => list.getEntries().forEach(x => longTasks.push({ startMs: Math.round(x.startTime), durationMs: Math.round(x.duration) })));
          observer.observe({ entryTypes: ["longtask"] });
          const beforeFocus = h.getLiveTrackDiagnostics();
          const airFocus = h.focusLiveTrack("synthetic-air-0");
          await new Promise(resolve => setTimeout(resolve, 800));
          const afterFocus = h.getLiveTrackDiagnostics();
          const airFocusState = { accepted: airFocus, id: h.getLiveTrackDiagnostics().focusedAircraftId,
            cameraHeight: Math.round(h.viewer.camera.positionCartographic.height),
            hasLabel: Boolean(h.viewer.entities.getById("track-synthetic-air-0")?.label),
            entities: h.viewer.entities.values.length,
            labels: h.viewer.entities.values.filter(entity => entity.label).length,
            visibleAircraft: h.viewer.entities.values.filter(entity => entity.id?.startsWith("track-") && entity.show !== false).length,
            created: afterFocus.aircraftCreatedCount - beforeFocus.aircraftCreatedCount,
            destroyed: afterFocus.aircraftDestroyedCount - beforeFocus.aircraftDestroyedCount };
          const movedAt = new Date(Date.now() + 1000).toISOString();
          const before = performance.now();
          for (let i = 0; i < 100; i++) h.upsertLiveTrack({ ...records.air(i), lon: records.air(i).lon + .03, updated_at: movedAt });
          for (let i = 0; i < 30; i++) h.upsertNavalVessel({ ...records.naval(i), lon: records.naval(i).lon + .03, updated_at: movedAt });
          const updateMs = +(performance.now() - before).toFixed(1);
          const moving = { aircraft: h.getLiveTrackDiagnostics().activeInterpolations, naval: h.getNavalDiagnostics().activeNavalAnimations };
          const positionOf = id => h.viewer.entities.getById(id)?.position?.getValue?.(h.Cesium.JulianDate.now());
          const firstAirPosition = positionOf("track-synthetic-air-0");
          const firstNavalPosition = positionOf("naval-synthetic-naval-0");
          let midAirPosition, midNavalPosition;
          const intervals = []; let last = 0;
          await new Promise(resolve => {
            const start = performance.now();
            function frame(now) {
              if (last) intervals.push(now - last);
              last = now;
              if (!midAirPosition && now - start >= 500) {
                midAirPosition = positionOf("track-synthetic-air-0");
                midNavalPosition = positionOf("naval-synthetic-naval-0");
              }
              if (now - start < 2000) requestAnimationFrame(frame); else resolve();
            }
            requestAnimationFrame(frame);
          });
          const motionDistancesMeters = {
            aircraftAt500ms: Math.round(h.Cesium.Cartesian3.distance(firstAirPosition, midAirPosition)),
            vesselAt500ms: Math.round(h.Cesium.Cartesian3.distance(firstNavalPosition, midNavalPosition)),
            aircraftAt2000ms: Math.round(h.Cesium.Cartesian3.distance(firstAirPosition, positionOf("track-synthetic-air-0"))),
            vesselAt2000ms: Math.round(h.Cesium.Cartesian3.distance(firstNavalPosition, positionOf("naval-synthetic-naval-0"))),
          };
          intervals.sort((a, b) => a - b);
          const beforeClear = h.getLiveTrackDiagnostics();
          const clearStart = performance.now();
          h.clearLiveTrackSelection();
          const clearMs = +(performance.now() - clearStart).toFixed(1);
          const afterClear = h.getLiveTrackDiagnostics();
          const navalFocus = h.focusNavalVessel("synthetic-naval-0");
          await new Promise(resolve => setTimeout(resolve, 800));
          const navalFocusState = { accepted: navalFocus, id: h.getNavalDiagnostics().selectedNavalId,
            cameraHeight: Math.round(h.viewer.camera.positionCartographic.height) };
          const tileResources = performance.getEntriesByType("resource").filter(x => /\/assets\/cesium\/|\/terrain\/|tile|imagery/i.test(x.name)).length;
          const cycles = [];
          for (let cycle = 0; cycle < (modelScenario || aircraftCount >= 10000 ? 1 : 3); cycle++) {
            const cycleStart = performance.now();
            window.__phase7SyntheticLayers.aircraft = false;
            window.__phase7SyntheticLayers.naval = false;
            h.setNavalLayerVisible(false);
            h.clearAllLiveTrackRenderState();
            const offMs = performance.now() - cycleStart;
            const off = { entities: h.viewer.entities.values.length, aircraft: h.getLiveTrackDiagnostics().activeCesiumAircraftEntities,
              naval: h.getNavalDiagnostics().activeCesiumNavalEntities, navalRecords: h.getNavalDiagnostics().lightweightVesselRecords };
            window.__phase7SyntheticLayers.aircraft = true;
            window.__phase7SyntheticLayers.naval = true;
            h.setNavalLayerVisible(true);
            h.syncLiveTrackRenderPopulation();
            const on = { entities: h.viewer.entities.values.length, aircraft: h.getLiveTrackDiagnostics().activeCesiumAircraftEntities,
              naval: h.getNavalDiagnostics().activeCesiumNavalEntities };
            cycles.push({ off, on, offMs: +offMs.toFixed(1), onMs: +(performance.now() - cycleStart - offMs).toFixed(1) });
          }
          const focusSwitches = [];
          if (repeatedScenario) {
            for (let cycle = 0; cycle < 3; cycle++) {
              window.__phase7SyntheticLayers.aircraft = false;
              window.__phase7SyntheticLayers.naval = false;
              h.setNavalLayerVisible(false);
              h.clearAllLiveTrackRenderState();
              window.__phase7SyntheticLayers.aircraft = true;
              window.__phase7SyntheticLayers.naval = true;
              h.setNavalLayerVisible(true);
              h.syncLiveTrackRenderPopulation();
              const restoreStarted = performance.now();
              while (h.getLiveTrackDiagnostics().activeCesiumAircraftEntities < aircraftCount &&
                performance.now() - restoreStarted < 4000) {
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              const restorationMs = performance.now() - restoreStarted;
              const airAccepted = h.focusLiveTrack("synthetic-air-0", { duration: 0 });
              await new Promise(resolve => setTimeout(resolve, 80));
              h.clearLiveTrackSelection({ animate: false, resetCamera: false });
              const navalAccepted = h.focusNavalVessel("synthetic-naval-0", { duration: 0 });
              await new Promise(resolve => setTimeout(resolve, 80));
              focusSwitches.push({ airAccepted, navalAccepted,
                restorationMs: +restorationMs.toFixed(1),
                aircraftEntities: h.getLiveTrackDiagnostics().activeCesiumAircraftEntities,
                navalEntities: h.getNavalDiagnostics().activeCesiumNavalEntities,
                selectedNavalId: h.getNavalDiagnostics().selectedNavalId });
            }
          }
          observer.disconnect();
          return { airFocusState, clearMs, clearCreated: afterClear.aircraftCreatedCount - beforeClear.aircraftCreatedCount,
            clearDestroyed: afterClear.aircraftDestroyedCount - beforeClear.aircraftDestroyedCount,
            updateMs, moving, motionDistancesMeters, motionFramesMs: {
            count: intervals.length, p95: +(intervals[Math.floor(intervals.length * .95)] || 0).toFixed(1),
            max: +(intervals.at(-1) || 0).toFixed(1),
          }, navalFocusState, tileResources, cycles, focusSwitches,
            longTasks: longTasks.sort((a, b) => b.durationMs - a.durationMs).slice(0, 8) };
        }, { modelScenario: name.includes("model"), repeatedScenario: name.includes("repeat"), aircraftCount });
        const profile = (await cdp.send("Profiler.stop")).profile;
        const nodes = new Map(profile.nodes.map(x => [x.id, x]));
        const costs = new Map();
        profile.samples?.forEach((id, index) => costs.set(id, (costs.get(id) || 0) + (profile.timeDeltas?.[index] || 0)));
        interaction.cpuTop = [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, micros]) => ({
          function: nodes.get(id)?.callFrame?.functionName || "(anonymous)",
          line: nodes.get(id)?.callFrame?.lineNumber,
          selfMs: Math.round(micros / 1000),
        }));
        await cdp.send("HeapProfiler.enable");
        await cdp.send("HeapProfiler.collectGarbage");
        interaction.heapAfterCyclesMb = +((await cdp.send("Performance.getMetrics")).metrics.find(x => x.name === "JSHeapUsedSize").value / 1048576).toFixed(1);
      }
      let release = null;
      if (name === "release-model-1000") {
        const off = await page.evaluate(() => {
          const h = window.__phase7Harness;
          window.__phase7SyntheticLayers.aircraft = false;
          window.__phase7SyntheticLayers.naval = false;
          h.setNavalLayerVisible(false);
          h.clearAllLiveTrackRenderState();
          return { entities: h.viewer.entities.values.length,
            aircraftRecords: h.getLiveTrackDiagnostics().lightweightTrackRecords,
            navalRecords: h.getNavalDiagnostics().lightweightVesselRecords };
        });
        await page.waitForTimeout(2500);
        await cdp.send("HeapProfiler.enable");
        await cdp.send("HeapProfiler.collectGarbage");
        const gpuPid = processInfo.processInfo.find(x => x.type === "GPU")?.id;
        let dedicatedMb = null;
        try {
          const ps = `$s=Get-Counter -Counter '\\GPU Process Memory(*)\\Dedicated Usage' -SampleInterval 1 -MaxSamples 1; ($s.CounterSamples | Where-Object { $_.InstanceName -like '*pid_${gpuPid}_*' } | Select-Object -First 1).CookedValue / 1MB`;
          dedicatedMb = +Number(execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 10000 }).trim()).toFixed(1);
        } catch { }
        release = { ...off, heapAfterGcMb: +((await cdp.send("Performance.getMetrics")).metrics.find(x => x.name === "JSHeapUsedSize").value / 1048576).toFixed(1), dedicatedGpuAfterOffMb: dedicatedMb };
      }
      console.log(JSON.stringify({ scenario: name, load, removedLabels, camera: {
        intervalsMs: camera.intervalsMs, sceneCpuMs: camera.sceneCpuMs, drawCalls: camera.drawCalls, textureUploads: camera.textureUploads,
        tileRequests: camera.tileRequests, entities: camera.entities, models: camera.models, labels: camera.labels,
      }, transitions, warmCamera, heapMb, processMemory: processSummary, gpuCounters, interaction, release, errors: errors.slice(0, 5) }));
      await context.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(outputPath, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
