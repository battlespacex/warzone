# StratOps static basemap and terrain pilot

`STRATOPS_BASEMAP_PROVIDER=esri|google|tactical` is the only basemap selection mechanism. Esri is the default. There is no browser control or persisted browser preference.

Google and Tactical are opt-in:

```dotenv
STRATOPS_ENABLE_GOOGLE_MAP=false
STRATOPS_ENABLE_TACTICAL_MAP=false
```

Google requires both `STRATOPS_ENABLE_GOOGLE_MAP=true` and `STRATOPS_GOOGLE_MAPS_API_KEY`. Tactical requires both `STRATOPS_ENABLE_TACTICAL_MAP=true` and `STRATOPS_TACTICAL_MAP_BASE_URL` in production. A disabled provider, missing required configuration, or initialization failure falls back to Esri. Terrain configuration remains independent.

The default remains Esri. `STRATOPS_TERRAIN_PROVIDER=selfhosted` independently uses static Cesium heightmap terrain. The browser makes direct requests to the configured provider. The local Tactical pilot server is only a development stand-in for a static asset host; it must not be used for production.

## Data and format decision

The pilot uses **pre-generated JPEG XYZ** imagery from Natural Earth's public-domain shaded-relief raster and land polygons. Cesium's built-in `UrlTemplateImageryProvider` handles it directly. Levels 0–2 cover the entire globe at low resolution; levels 3–7 cover Middle East & Gulf (20–65°E, 10–45°N). Country borders, markers, and labels remain separate StratOps layers. The style is dark land relief and subdued ocean with no roads, POIs, buildings, or baked operational borders.

PMTiles would reduce S3 object count but needs a Cesium imagery bridge and byte-range reads. It is not used for this pilot: 386 imagery objects are small, and direct XYZ adds no client decoding or archive parsing. Re-evaluate PMTiles only if global object counts, CDN costs, and a measured bridge justify it. Byte-range support is not required for the selected format.

Terrain comes from the [Mapzen Terrain Tiles public AWS dataset](https://registry.opendata.aws/terrain-tiles/), whose Middle East data is largely SRTM with lower-resolution sources at small zooms. The offline script downloads Terrarium PNG elevation tiles and converts them to Cesium's native `heightmap-1.0` terrain: 65×65 unsigned 16-bit samples plus child and water masks. This is a supported `CesiumTerrainProvider.fromUrl` format. Quantized mesh was not chosen because no suitable generator is installed here and the small native heightmap files avoid adding a build dependency. Negative heights are flattened to sea level for the pilot's naval/coastal display. The source may be 30 m SRTM in land areas, but generated zoom 7 terrain samples are roughly 4–5 km apart in the pilot; this is a regional visualization, not survey terrain. Levels 0–2 are global low detail; levels 3–7 are pilot-only. Cesium availability metadata prevents higher-level requests outside the pilot.

Natural Earth requires no attribution under its [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/), but the map displays its credit. The terrain credit links to [Mapzen's source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md); verify the exact contributing datasets before any global release. OSM and Protomaps data are not used.

## Build the pilot locally

From the repository root, install Pillow for the offline tool and run:

```powershell
python -m pip install Pillow==11.3.0
python scripts/selfhost-map/pilot.py download
python scripts/selfhost-map/pilot.py build-map
python scripts/selfhost-map/pilot.py build-terrain
python scripts/selfhost-map/pilot.py validate
node scripts/selfhost-map/serve-pilot.mjs
```

All downloaded inputs and generated tiles stay under `.generated/selfhosted`, which is ignored by Git. The outputs are `.generated/selfhosted/output/map/v1/` and `.generated/selfhosted/output/terrain/v1/`. The generator is offline relative to visitors; it never runs in an application or API request. The local server listens on port 4181 and serves only these finished files with narrow localhost CORS and cache headers.

For a local build, set the following in the root `.env.local` (`npm run dev`) or `.env.production` (`npm run build`), then restart/rebuild:

```dotenv
STRATOPS_BASEMAP_PROVIDER=tactical
STRATOPS_ENABLE_TACTICAL_MAP=true
STRATOPS_MAP_BASE_URL=http://127.0.0.1:4181/map/v1
STRATOPS_TERRAIN_PROVIDER=selfhosted
STRATOPS_TERRAIN_BASE_URL=http://127.0.0.1:4181/terrain/v1
```

For no terrain, set `STRATOPS_TERRAIN_PROVIDER=none`; this also prevents the legacy focused ArcGIS terrain path. For complete rollback, set `STRATOPS_BASEMAP_PROVIDER=esri` and `STRATOPS_TERRAIN_PROVIDER=legacy` (the defaults), then restart/rebuild. Google and Tactical failures fall back to Esri; self-hosted terrain failure leaves the ellipsoid. Neither fallback recreates Cesium.

Production builds accept self-hosted tile URLs only when they are public `https://` URLs. A production build requested with a missing, HTTP, localhost, `.local`, link-local, or private-network map URL compiles the Esri provider instead and removes the rejected URL from the bundle. The corresponding invalid self-hosted terrain configuration compiles as `terrain=none`. Local HTTP tile URLs remain available in development builds.

## S3 and CloudFront preparation

Create a static S3 bucket behind CloudFront with origin access control. The app should use HTTPS CloudFront URLs ending in `/map/v1` and `/terrain/v1`. The map and terrain paths are versioned; publish a new `v2` for updates and switch only the two configured URLs. Do not overwrite immutable tiles in place. The app server, worker, and API must not proxy tile requests.

`scripts/selfhost-map/upload.ps1 -Bucket BUCKET` performs an AWS CLI **dry run**. Adding `-Execute` uploads the prepared v1 tiles; this repository work does not run it. It applies `public, max-age=31536000, immutable` to versioned tiles and a five-minute cache to `manifest.json` and `layer.json`. Version switches require no CloudFront invalidation. Review `scripts/selfhost-map/s3-cors.json` for the actual local and production origins before applying it. CloudFront must forward/cache the `Origin` header consistently with the S3 CORS policy or apply an equivalent response-headers policy. For browser performance byte measurements, also return `Timing-Allow-Origin` for permitted origins. Range requests are unnecessary for XYZ JPEG or individual terrain binaries.

The configuration contains **no browser map key**. Existing unrelated application credentials are untouched. AWS storage, CDN transfer, and S3 requests are still infrastructure costs; the new data path has no paid map API or per-map-provider request fee.

## Performance and rollout gate

The pilot uses maximum imagery level 7, maximum terrain level 7, Cesium terrain screen-space error no lower than 8, and at most 16 loading descendants while self-hosted terrain is active. It does not add a render loop or wait for tile refinement before operational startup. The viewer uses the existing camera and entity architecture. `STRATOPS_TERRAIN_PROVIDER=none` is the maximum-responsiveness diagnostic mode.

Run the same Middle East view and aircraft in Esri and self-hosted modes. Measure first visible pixels, requests/bytes, long tasks, memory, region switching, warm cache, and a two-minute moving-aircraft focus. Then test naval focus, overlays, terrain occlusion, rapid region switches, and Esri rollback. The pilot is **not** a global replacement: only levels 0–2 are global, so other regions remain coarse. Generate higher global levels only after the pilot passes these tests.

The Phase 2 recommendation is imagery through zoom 8 and terrain through zoom 7. Imagery zoom 8 avoids an abrupt loss of context at base, port, aircraft, and naval focus distances, while terrain zoom 7 is sufficient for broad regional relief and avoids spending objects on terrain detail that operational assets do not require. At measured pilot averages this is about 432 MiB for 87,381 imagery tiles and 176 MiB for 21,845 terrain tiles, plus two manifests: 109,228 S3 objects total. This remains a straightforward XYZ dataset; PMTiles is not justified at that object count. These are planning estimates only. Do not generate the global dataset until the Phase 2 aircraft smoothness blocker is resolved and the rollout gate is approved.
