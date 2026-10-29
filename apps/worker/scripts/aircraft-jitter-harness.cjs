// Browser-private diagnostic entry: reuse production movement, models and Focus.
// Neither this HTML nor its bundle is registered with the development server.
const fs = require("node:fs"), path = require("node:path"), webpack = require("webpack");
const { chromium } = require("../node_modules/playwright");
const root = path.resolve(__dirname, "../../..");
const output = path.join(root, ".generated", "aircraft-jitter-harness");
const tag = process.argv[2] || "capture";
async function main() {
  if (!process.argv.includes("--reuse")) await new Promise((resolve, reject) => webpack({
    mode: "development", devtool: false,
    entry: path.join(__dirname, "phase7-cesium-harness-entry.js"),
    output: { path: output, filename: "harness.js", publicPath: "/assets/cesium/" },
    resolve: { modules: [path.join(root, "node_modules"), "node_modules"] },
    plugins: [new webpack.DefinePlugin({ CESIUM_BASE_URL: JSON.stringify("http://localhost:4173/assets/cesium/") }),
      new webpack.NormalModuleReplacementPlugin(/warzone-layers\.js$/, resource => {
        resource.request = path.join(__dirname, "phase7-cesium-harness-layers.js");
      })], performance: { hints: false },
  }, (error, stats) => error || stats?.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const browser = await chromium.launch({ executablePath: process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(60000); const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("http://localhost:4173/__private_aircraft_jitter", route => route.fulfill({
      contentType: "text/html", body: '<html><head></head><body><div id="globe"></div><style>html,body,#globe{margin:0;height:100%;width:100%;overflow:hidden}</style></body></html>',
    }));
    await page.goto("http://localhost:4173/__private_aircraft_jitter");
    await page.addStyleTag({ path: path.join(root, "dev/assets/css/root.css") });
    await page.addStyleTag({ url: "http://localhost:4173/assets/cesium/Widgets/widgets.css" });
    await page.addScriptTag({ path: path.join(output, "harness.js") });
    const results = await page.evaluate(async ({ processExtended, switchesOnly }) => {
      const h = window.__phase7Harness, C = h.Cesium, v = h.viewer;
      window.__phase7SyntheticLayers = { aircraft: true, naval: true };
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const track = { title: "Synthetic KC-135 Stratotanker", model_name: "Boeing KC-135 Stratotanker",
        category: "military", subcategory: "tanker", type_code: "K35R", lat: 26, lon: 50, altitude_ft: 25000,
        heading_deg: 90, ground_track_deg: 90, speed_kts: 420, country: "United States", operator: "United States Air Force",
        status: "active", model_code: "Tanker-KC135", asset_key: "Tanker-KC135", render_mode: "glb" };
      const records = [];
      for (const mode of (processExtended ? ["combined-turning"] : ["stationary-camera", "focus", "duplicate-heartbeats"])) {
        const key = `jitter-kc135-${mode}`;
        h.clearLiveTrackSelection(); h.clearAllLiveTracks();
        const started = performance.now(), epoch = Date.now();
        const record = { ...track, track_key: key, icao24: `ae12${records.length.toString(16).padStart(2, "0")}`,
          timestamp: epoch, updated_at: new Date(epoch).toISOString() };
        h.upsertLiveTrack(record);
        const entity = v.entities.getById(`track-${key}`);
        if (!entity) throw new Error(`Missing fixture entity in ${mode}: ${JSON.stringify(h.getLiveTrackDiagnostics())}; entities=${v.entities.values.map(e => e.id).join(",")}`);
        if (mode !== "stationary-camera") h.focusLiveTrack(key);
        else v.camera.lookAt(C.Cartesian3.fromDegrees(50, 26, 7620), new C.HeadingPitchRange(0, C.Math.toRadians(-58), 2400));
        await wait(2800);
        const samples = [], writes = [];
        let lastWriteLon = null;
        const recordWrite = () => {
          const position = entity.position.getValue(v.clock.currentTime), geo = C.Cartographic.fromCartesian(position);
          const lon = C.Math.toDegrees(geo.longitude);
          writes.push({ time: performance.now(), lon, deltaLon: lastWriteLon == null ? 0 : lon - lastWriteLon,
            phase: entity.__liveTrackMotionState?.phase, source: entity.__lastSourceTimestamp });
          lastWriteLon = lon;
        };
        const removeWrite = entity.position.definitionChanged.addEventListener(recordWrite);
        const removeFrame = v.scene.postRender.addEventListener(() => {
          const position = entity.position.getValue(v.clock.currentTime), geo = C.Cartographic.fromCartesian(position);
          const screen = C.SceneTransforms.worldToWindowCoordinates(v.scene, position);
          const motion = entity.__liveTrackMotionState;
          samples.push({ time: performance.now(), sourceTimestamp: entity.__lastSourceTimestamp,
            receiptTime: motion?.prediction?.receivedAt, animationTime: motion?.elapsedMs,
            rawLon: motion?.track?.lon, predictedLon: motion?.prediction?.lon, lon: C.Math.toDegrees(geo.longitude),
            lat: C.Math.toDegrees(geo.latitude), altitude: geo.height, phase: motion?.phase,
            heading: entity.__currentHeadingDeg, orientation: entity.orientation?.getValue(v.clock.currentTime),
            x: screen?.x, y: screen?.y, camera: C.Cartesian3.clone(v.camera.positionWC),
            cameraHeading: v.camera.heading, cameraPitch: v.camera.pitch,
            cameraTarget: { x: v.camera.transform[12], y: v.camera.transform[13], z: v.camera.transform[14] } });
        });
        let timer, updateCount = 0;
        if (mode === "duplicate-heartbeats") timer = setInterval(() => h.upsertLiveTrack({ ...record, timestamp: Date.now(), updated_at: new Date().toISOString() }), 1000);
        if (mode === "combined-turning") {
          h.setNavalLayerVisible(true);
          const others = [
            { ...record, track_key: "jitter-f18", icao24: "aeff01", title: "Synthetic F/A-18", type_code: "F18S", subcategory: "fighter", model_code: "Fighter-F18", asset_key: "Fighter-F18", lon: 51, speed_kts: 600, altitude_ft: 32000 },
            { ...record, track_key: "jitter-low-kc135", icao24: "aeff02", lon: 52, speed_kts: 250, altitude_ft: 8000 },
          ];
          others.forEach(r => h.upsertLiveTrack(r));
          const vessel = { id: "jitter-vessel", dedupe_key: "jitter-vessel", source_name: "ais", category: "naval", title: "Synthetic Frigate",
            lat: 26, lon: 50.5, metadata: { mmsi: "999000001", vessel_name: "Synthetic Frigate", vessel_type: "frigate", speed_knots: 20, heading: 90 }, updated_at: new Date().toISOString() };
          h.upsertNavalVessel(vessel);
          let lon = C.Math.toDegrees(C.Cartographic.fromCartesian(entity.position.getValue(v.clock.currentTime)).longitude);
          let lat = 26, previous = performance.now();
          timer = setInterval(() => {
            const now = performance.now(), seconds = (now - previous) / 1000;
            previous = now; updateCount++;
            const heading = 90 + 20 * Math.sin(updateCount / 20), radians = heading * Math.PI / 180;
            lon += 420 * .514444 * seconds * Math.sin(radians) / (111320 * Math.cos(lat * Math.PI / 180));
            lat += 420 * .514444 * seconds * Math.cos(radians) / 111320;
            const fresh = { ...record, lon, lat, heading_deg: heading, ground_track_deg: heading, timestamp: Date.now(), updated_at: new Date().toISOString() };
            h.upsertLiveTrack(fresh);
            if (updateCount % 4 === 0) {
              h.upsertLiveTrack(fresh);
              h.upsertLiveTrack({ ...record, timestamp: record.timestamp - 5000 });
            }
            others.forEach(r => h.upsertLiveTrack({ ...r, lon: r.lon + (now - started) / 1000 * r.speed_kts * .514444 / 100000, timestamp: Date.now() }));
            h.upsertNavalVessel({ ...vessel, lon: vessel.lon + (now - started) / 10000000, updated_at: new Date().toISOString() });
          }, 250);
        }
        await wait(mode === "combined-turning" ? (switchesOnly ? 5000 : 35000) : 6500);
        removeFrame(); removeWrite();
        const switches = [];
        if (switchesOnly) {
          for (const selected of ["jitter-f18", "jitter-vessel", key]) {
            if (h.getNavalDiagnostics().selectedNavalId) document.querySelector('[aria-label="Unlock naval asset"]')?.click();
            else h.clearLiveTrackSelection({ animate: false, resetCamera: false });
            await wait(250);
            const naval = selected === "jitter-vessel";
            const accepted = naval ? h.focusNavalVessel(selected) : h.focusLiveTrack(selected);
            await wait(2600);
            const selectedEntity = naval ? v.entities.values.find(e => e.__navalTrackKey === selected || String(e.id).includes(selected)) : v.entities.getById(`track-${selected}`);
            const before = selectedEntity?.position?.getValue(v.clock.currentTime);
            const beforeClone = before && C.Cartesian3.clone(before);
            await wait(700);
            const after = selectedEntity?.position?.getValue(v.clock.currentTime);
            switches.push({ selected, accepted, movementMeters: beforeClone && after ? C.Cartesian3.distance(beforeClone, after) : null,
              aircraftSelection: window.__warzoneLiveTrackSelection, naval: h.getNavalDiagnostics(),
              activeAircraftModels: v.entities.values.filter(e => e.__trackKey && e.model).map(e => e.__trackKey) });
          }
          h.clearLiveTrackSelection({ animate: false, resetCamera: false });
          const before = C.Cartesian3.clone(v.camera.positionWC);
          await wait(700);
          switches.push({ selected: "unlock", cameraMovementMeters: C.Cartesian3.distance(before, v.camera.positionWC), aircraftSelection: window.__warzoneLiveTrackSelection });
        }
        clearInterval(timer);
        let worldReversals = 0, screenReversals = 0, previousScreenDirection = 0, maxBackwardMeters = 0;
        for (let i = 1; i < samples.length; i++) {
          const delta = (samples[i].lon - samples[i - 1].lon) * 111320 * Math.cos(26 * Math.PI / 180);
          if (delta < -0.001) { worldReversals++; maxBackwardMeters = Math.max(maxBackwardMeters, -delta); }
          const dx = samples[i].y - samples[i - 1].y;
          const direction = Math.abs(dx) > 0.01 ? Math.sign(dx) : 0;
          if (direction && previousScreenDirection && direction !== previousScreenDirection) screenReversals++;
          if (direction) previousScreenDirection = direction;
        }
        const positions = samples.map(s => s.y).filter(Number.isFinite);
        records.push({ mode, duration: performance.now() - started, samples, writes,
          summary: { frameCount: samples.length, worldReversals, screenReversals, maxBackwardMeters, updateCount, switches,
            frameP95Ms: samples.map((s, i) => i ? s.time - samples[i - 1].time : 0).sort((a,b) => a-b)[Math.floor(samples.length * .95)],
            frameMaxMs: Math.max(...samples.map((s, i) => i ? s.time - samples[i - 1].time : 0)),
            naval: h.getNavalDiagnostics(),
            screenSpanY: Math.max(...positions) - Math.min(...positions),
            models: v.entities.values.filter(e => e.__trackKey === key && e.model).length,
            entityCount: v.entities.values.filter(e => e.__trackKey === key).length,
            modelUri: String(entity.model?.uri?.getValue?.(v.clock.currentTime)?.url || entity.model?.uri?.getValue?.(v.clock.currentTime) || "") } });
      }
      return records;
    }, { processExtended: process.argv.includes("--extended"), switchesOnly: process.argv.includes("--switches-only") });
    await page.screenshot({ path: path.join(root, ".generated", `aircraft-jitter-${tag}.png`) });
    fs.writeFileSync(path.join(root, ".generated", `aircraft-jitter-${tag}.json`), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ tag, scenarios: results.map(r => ({ mode: r.mode, ...r.summary })), errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
