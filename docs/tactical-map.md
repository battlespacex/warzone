# StratOps tactical map pilot

## Runtime architecture

Cesium remains the only viewer and WebGL canvas. Tactical replaces only the tracked basemap imagery layers on the existing globe. Camera state, scene mode, entities, primitives, tracker focus, subscriptions, and terrain provider are not recreated.

Map style and provider are separate:

- `STRATOPS_BASEMAP_PROVIDER=tactical` selects Tactical at application startup.
- `STRATOPS_ENABLE_TACTICAL_MAP=true` explicitly enables the experimental provider. When false, Tactical code and tiles remain dormant and Esri is used.
- `STRATOPS_TACTICAL_MAP_BASE_URL` points to the tactical manifest directory, for example `https://maps.example.com/map/tactical/v1`.
- `STRATOPS_TERRAIN_PROVIDER` remains independent. Tactical and Satellite both work with the ellipsoid, self-hosted terrain, or the existing optional focused terrain path.

If Tactical is disabled or cannot load its manifest/sample tile, StratOps selects Esri without reloading the page or creating a second viewer.

## Pilot data and rendering

The generated pilot uses Natural Earth public-domain land and generalized features through low zoom. A bounded OpenStreetMap extract supplies strategic roads, cities, airports, water, coastlines, and administrative context from z6 upward in the UAE. Coverage is global z0-z4, Middle East & Gulf z5-z8 (20-65 E, 10-45 N), native UAE urban-corridor detail z9-z12 (53.8-56.4 E, 23.8-26.1 N), and bounded z13 detail for Dubai and Abu Dhabi. Operational overlays are not baked into tiles.

The offline renderer is Pillow. It was selected for the pilot because it extends the existing dependency-light static XYZ generator and does not require a second runtime map engine. Production data can later move to OpenStreetMap plus OpenMapTiles without changing the Cesium runtime contract.

Runtime tiles are opaque 512 x 512 WebP quality-90 XYZ files. Each 4 x 4 tile metatile is rendered with a 96 px buffer and one deterministic label-collision pass before splitting. This keeps roads and coastlines continuous and prevents duplicate or clipped labels at internal tile edges. The Dubai benchmark measured 58,408 bytes for 512 WebP versus 114,726 bytes for 512 JPEG quality 94; 256 px candidates had roughly six to eight times the reconstruction error when enlarged to the same display size. WebP decoded more slowly locally, but its transfer/quality balance was materially better for cartographic linework.

## Style control

All important colors, widths, and opacities live in [`scripts/selfhost-map/tactical-style.json`](../scripts/selfhost-map/tactical-style.json):

- `LAND_FILL`, `LAND_FILL_OPACITY`
- `WATER_FILL`, `WATER_FILL_OPACITY`
- `OCEAN_FILL`, `OCEAN_FILL_OPACITY`
- `COUNTRY_BORDER`, `COUNTRY_BORDER_WIDTH`, `COUNTRY_BORDER_OPACITY`
- `STATE_BORDER`, `STATE_BORDER_WIDTH`, `STATE_BORDER_OPACITY`
- `PRIMARY_ROAD`, `PRIMARY_ROAD_WIDTH`, `PRIMARY_ROAD_OPACITY`
- `SECONDARY_ROAD`, `SECONDARY_ROAD_WIDTH`, `SECONDARY_ROAD_OPACITY`
- `CITY_LABEL`, `CITY_LABEL_HALO`, `CITY_LABEL_OPACITY`, `CITY_LABEL_HALO_WIDTH`, `CITY_LABEL_SIZE`
- `COUNTRY_LABEL`, `COUNTRY_LABEL_HALO`, `COUNTRY_LABEL_OPACITY`, `COUNTRY_LABEL_HALO_WIDTH`, `COUNTRY_LABEL_SIZE`
- `AIRPORT_COLOR`, `AIRPORT_OPACITY`, `AIRPORT_RADIUS`
- `COASTLINE`, `COASTLINE_WIDTH`, `COASTLINE_OPACITY`
- `BACKGROUND`

Edit the tokens, export the MapLibre preview style, rebuild the pilot, and refresh:

```powershell
python scripts/selfhost-map/pilot.py export-style
python scripts/selfhost-map/pilot.py build-tactical
python scripts/selfhost-map/pilot.py validate-tactical
```

The generated MapLibre Style Spec file is [`scripts/selfhost-map/maplibre/tactical-v1.style.json`](../scripts/selfhost-map/maplibre/tactical-v1.style.json). It opens in Maputnik when its `openmaptiles` source URL points to a local OpenMapTiles TileJSON endpoint. Maputnik is a design preview tool only; MapLibre GL JS is not shipped in StratOps. The checked-in token file remains the source of truth for the pilot raster renderer. Future Tactical Dark/Light/Night variants can use separate token and version directories.

## Generate and serve locally

```powershell
python -m pip install Pillow==11.3.0
python scripts/selfhost-map/pilot.py download-tactical
python scripts/selfhost-map/pilot.py export-style
python scripts/selfhost-map/pilot.py build-tactical
python scripts/selfhost-map/pilot.py benchmark-formats
python scripts/selfhost-map/pilot.py validate-tactical
```

`npm run dev` automatically serves the generated pilot at `/assets/map/tactical/v1`; no separate tile server or environment override is required. Production still requires an explicit public URL. To override either setting when desired:

```dotenv
STRATOPS_BASEMAP_PROVIDER=tactical
STRATOPS_ENABLE_TACTICAL_MAP=true
STRATOPS_TACTICAL_MAP_BASE_URL=http://127.0.0.1:4181/map/tactical/v1
```

## S3 and CloudFront layout

The upload helper uses these versioned paths:

```text
/map/tactical/v1/manifest.json
/map/tactical/v1/global/{z}/{x}/{y}.webp
/map/tactical/v1/pilot/{z}/{x}/{y}.webp
/map/tactical/v1/close/{z}/{x}/{y}.webp
/map/tactical/v1/detail/{z}/{x}/{y}.webp
```

Run `scripts/selfhost-map/upload.ps1 -Bucket BUCKET` for an AWS CLI dry run. Add `-Execute` only when deployment is approved. Tiles use `Cache-Control: public, max-age=31536000, immutable`; the manifest uses five minutes. Configure CloudFront/S3 CORS from `scripts/selfhost-map/s3-cors.json` and expose `Timing-Allow-Origin` for browser performance measurements. Do not proxy tiles through EC2, Node, the API, or the worker.

## Attribution and licensing

The raster pilot displays both Natural Earth public-domain and `(c) OpenStreetMap contributors (ODbL)` credit through Cesium. Retain both credits and link the OSM credit to its copyright/ODbL page when publishing.

## Global generation recommendation

Keep this pilot limited to global z0-z4, Middle East & Gulf z5-z8, the UAE urban corridor z9-z12, and Dubai/Abu Dhabi at z13. Generate broader high zoom coverage only after visual acceptance and measured S3 object count, transfer, browser memory, warm-cache reuse, and style-switch performance.
