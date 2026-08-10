import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as Cesium from "cesium";

const {
  RADAR_RING_RATIOS,
  RADAR_SWEEP_MATERIAL_TYPE,
  buildRadarSweepStops,
} = await import("../../../dev/assets/js/warzone-sweeper.js");

test("radar uses exactly three concentric outline-ring ratios", () => {
  assert.deepEqual([...RADAR_RING_RATIOS], [0.34, 0.67, 1]);
});

test("faded sweep shader material registers with Cesium", () => {
  for (const name of ["HTMLCanvasElement", "HTMLImageElement", "ImageBitmap", "OffscreenCanvas"]) {
    if (typeof globalThis[name] === "undefined") globalThis[name] = class {};
  }
  const material = Cesium.Material.fromType(RADAR_SWEEP_MATERIAL_TYPE);
  assert.equal(material.type, RADAR_SWEEP_MATERIAL_TYPE);
  assert.equal(material.uniforms.minAlpha, 0.02);
  assert.equal(material.uniforms.midAlpha, 0.14);
  assert.equal(material.uniforms.maxAlpha, 0.42);
});

test("sweep stops keep most of the disc transparent and fade toward the leading edge", () => {
  const stops = buildRadarSweepStops(64, {
    minAlpha: 0.02,
    midAlpha: 0.14,
    maxAlpha: 0.42,
    leadingEdgeDeg: 1.4,
  });
  const trailStart = 1 - (64 / 360);
  assert.equal(stops[0].alpha, 0.42);
  assert.equal(stops[1].alpha, 0);
  assert.equal(stops[2].offset, trailStart);
  assert.equal(stops[2].alpha, 0);
  assert.ok(stops[3].alpha < stops[4].alpha);
  assert.ok(stops[4].alpha < stops[5].alpha);
  assert.ok(stops[5].alpha < stops[6].alpha);
  assert.equal(stops[6].alpha, 0.42);
});

test("sweep width is constrained to the requested 45 to 80 degree visual range", () => {
  const narrow = buildRadarSweepStops(10);
  const wide = buildRadarSweepStops(160);
  assert.equal(narrow[2].offset, 1 - (45 / 360));
  assert.equal(wide[2].offset, 1 - (80 / 360));
});

test("active sweeper uses a tunable translucent shader fill rather than a polygon sector", async () => {
  const source = await readFile(new URL("../../../dev/assets/js/warzone-sweeper.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /coverageFill/);
  assert.doesNotMatch(source, /buildSectorHierarchy/);
  assert.doesNotMatch(source, /sweep-edge|getRadarEdgeCoordinate/);
  assert.equal(RADAR_SWEEP_MATERIAL_TYPE, "StratOpsRadarSweep");
  assert.match(source, /function createRadarSweepPrimitive/);
  assert.match(source, /new Cesium\.GroundPrimitive/);
  assert.match(source, /viewer\.scene\.groundPrimitives\.add\(primitive\)/);
  assert.match(source, /sweepMaterial\.uniforms\.heading = Cesium\.Math\.toRadians/);
  assert.match(source, /float sweepAlpha = max\(fadedAlpha \* inSweep, edgeAlpha\) \* radialMask/);
  assert.match(source, /float fillAlpha = fillOpacity \* discMask/);
  assert.match(source, /\)\) \* innerRingOpacity/);
  assert.match(source, /material\.alpha = max\(fillLayerAlpha, max\(sweepLayerAlpha, ringLayerAlpha\)\)/);
  assert.match(source, /classificationType:\s*Cesium\.ClassificationType\.TERRAIN/);
  assert.doesNotMatch(source, /id:\s*`\$\{overlayId\}-sweep`[\s\S]{0,500}\bheight\s*:/);
  assert.match(source, /requestRenderFrameSkip:\s*1/);
  assert.match(source, /fwidth\(trail\)/);
  assert.match(source, /float ringPixel = max\(fwidth\(radius\)/);
  assert.match(source, /fwidth\(trail\) \* 2\.5/);
  assert.match(source, /fwidth\(radius\) \* 2\.5/);
  assert.match(source, /ringFeather = ringPixel \* 1\.5/);
  assert.match(source, /ringInner:\s*RADAR_RING_RATIOS\[0\]/);
  assert.match(source, /ringMiddle:\s*RADAR_RING_RATIOS\[1\]/);
  assert.match(source, /ringOuter:\s*RADAR_RING_RATIOS\[2\]/);
  assert.doesNotMatch(source, /buildRadarRingPositions|polyline:\s*\{/);
});

test("radar labels remain below the hotspot activity stack", async () => {
  const components = await readFile(new URL("../../../dev/assets/css/warzone-components.css", import.meta.url), "utf8");
  const map = await readFile(new URL("../../../dev/assets/css/warzone-map.css", import.meta.url), "utf8");
  const radarLayer = components.match(/\.wz-radar-label-layer\s*\{([^}]*)\}/)?.[1] || "";
  const hotspotLayer = map.match(/\.warzone-hotspot-layer\s*\{([^}]*)\}/)?.[1] || "";
  const radarZ = Number(radarLayer.match(/z-index:\s*(\d+)/)?.[1]);
  const hotspotZ = Number(hotspotLayer.match(/z-index:\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(radarZ));
  assert.ok(Number.isFinite(hotspotZ));
  assert.ok(hotspotZ > radarZ);
});

test("radar visual controls are centralized in root CSS", async () => {
  const css = await readFile(new URL("../../../dev/assets/css/root.css", import.meta.url), "utf8");
  for (const token of [
    "--radar-color",
    "--radar-ring-color",
    "--radar-fill-color",
    "--radar-fill-opacity",
    "--radar-inner-ring-opacity",
    "--radar-ring-opacity",
    "--radar-ring-width",
    "--radar-sweep-opacity-min",
    "--radar-sweep-opacity-mid",
    "--radar-sweep-opacity-max",
    "--radar-sweep-width",
    "--radar-sweep-speed",
    "--radar-center-size",
    "--radar-center-glow",
  ]) {
    assert.match(css, new RegExp(`${token}\\s*:`));
  }
  assert.match(css, /--radar-inner-ring-opacity:\s*0;/);
  assert.match(css, /--radar-fill-opacity:\s*0;/);
  assert.match(css, /--radar-sweep-width:\s*72;/);
});

test("radar toggle remains isolated from hotspot state", async () => {
  const source = await readFile(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
  assert.match(source, /const hotspotsEnabled = isLayerEnabled\("hotspots"\)/);
  assert.match(source, /const sweepersEnabled = isLayerEnabled\("sweepers"\)/);
  assert.match(source, /const nextSweepersKey = sweepersEnabled \? sweeperSignature : "__off__"/);
});
