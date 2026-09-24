import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("basemap provider is configuration-only on one fixed-quality Cesium viewer", async () => {
  const [globe, google, ui, header, index, webpack] = await Promise.all([
    read("../../../dev/assets/js/warzone-globe.js"),
    read("../../../dev/assets/js/warzone-google-basemap.js"),
    read("../../../dev/assets/js/warzone-ui.js"),
    read("../../../dev/partials/header.html"),
    read("../../../dev/assets/js/index.js"),
    read("../../../webpack.config.js"),
  ]);
  assert.equal((globe.match(/new Cesium\.Viewer\(/g) || []).length, 1);
  assert.equal((globe.match(/viewer\.resolutionScale\s*=/g) || []).length, 1);
  assert.equal((globe.match(/viewer\.scene\.msaaSamples\s*=/g) || []).length, 1);
  assert.match(globe, /viewer\.resolutionScale = 1;/);
  assert.match(globe, /viewer\.scene\.msaaSamples = 1;/);
  assert.match(globe, /getActiveBasemapProvider\(\)/);
  assert.match(globe, /setActiveBasemapProvider\(viewer, "esri"\)/);
  assert.match(globe, /setActiveBasemapProvider\(viewer, "google"\)/);
  assert.match(globe, /setActiveBasemapProvider\(viewer, "tactical"\)/);
  assert.doesNotMatch(globe, /MAP_STYLE_STORAGE_KEY/);
  assert.doesNotMatch(ui, /setMapStyle/);
  assert.doesNotMatch(header, /wz-map-style-(?:tactical|satellite)/);
  assert.match(index, /enableGoogle: STRATOPS_ENABLE_GOOGLE_MAP === true/);
  assert.match(index, /enableTactical: STRATOPS_ENABLE_TACTICAL_MAP === true/);
  assert.match(index, /localTacticalMapBaseUrl = "\/assets\/map\/tactical\/v1"/);
  assert.match(webpack, /STRATOPS_BASEMAP_PROVIDER \|\| process\.env\.STRATOPS_BASEMAP_PROVIDER \|\| "esri"/);
  assert.match(webpack, /STRATOPS_ENABLE_GOOGLE_MAP/);
  assert.match(webpack, /STRATOPS_ENABLE_TACTICAL_MAP/);
  assert.match(google, /Google2DImageryProvider\.fromUrl/);
  assert.match(google, /missing_google_api_key/);
  assert.match(webpack, /publicPath: localTacticalMapBaseUrl/);
  assert.match(globe, /\[BASEMAP\] requested=\$\{requestedProvider\}/);
  assert.match(globe, /fallback=esri/);
});

test("tactical style exposes centralized tokens and a MapLibre Style Spec preview", async () => {
  const [tokensText, styleText, provider, generator, upload, docs] = await Promise.all([
    read("../../../scripts/selfhost-map/tactical-style.json"),
    read("../../../scripts/selfhost-map/maplibre/tactical-v1.style.json"),
    read("../../../dev/assets/js/warzone-selfhosted-basemap.js"),
    read("../../../scripts/selfhost-map/pilot.py"),
    read("../../../scripts/selfhost-map/upload.ps1"),
    read("../../../docs/tactical-map.md"),
  ]);
  const tokens = JSON.parse(tokensText).tokens;
  const required = ["LAND_FILL", "WATER_FILL", "OCEAN_FILL", "COUNTRY_BORDER", "COUNTRY_BORDER_WIDTH",
    "STATE_BORDER", "STATE_BORDER_WIDTH", "PRIMARY_ROAD", "PRIMARY_ROAD_WIDTH", "SECONDARY_ROAD",
    "SECONDARY_ROAD_WIDTH", "CITY_LABEL", "CITY_LABEL_HALO", "COUNTRY_LABEL", "COUNTRY_LABEL_HALO",
    "AIRPORT_COLOR", "COASTLINE", "BACKGROUND"];
  for (const name of required) assert.ok(Object.hasOwn(tokens, name), name);
  const style = JSON.parse(styleText);
  assert.equal(style.version, 8);
  assert.equal(style.sources.openmaptiles.type, "vector");
  assert.match(provider, /"xyz-jpeg"/);
  assert.match(provider, /tileWidth: tileSize/);
  assert.match(provider, /manifest\.close/);
  assert.match(provider, /manifest\.detail/);
  assert.match(provider, /window\.location\.origin/);
  assert.match(provider, /asset_content_type_/);
  assert.match(upload, /map\\tactical\\v1/);
  assert.match(upload, /image\/webp/);
  assert.match(upload, /max-age=31536000, immutable/);
  assert.match(docs, /Cesium remains the only viewer/);
  assert.match(docs, /OpenStreetMap contributors/);
  assert.match(generator, /TACTICAL_TILE_SIZE = 512/);
  assert.match(generator, /TACTICAL_DETAIL_ZOOM = 13/);
  assert.match(generator, /TACTICAL_METATILE_SIZE = 4/);
  assert.match(generator, /TACTICAL_WEBP_QUALITY = 90/);
});
