# Tactical globe implementation and startup investigation

Startup sequencing below records the earlier implementation. Current Tactical-first
boot and development settings are documented in [local-startup-diagnostics.md](local-startup-diagnostics.md).

Source-only change record, 2026-10-16. No build, test, dependency installation,
application launch, browser session, process inspection, or deployment was run.

## Startup evidence

Webpack injects its deferred main bundle into dev/pages/index.html. The entry is
dev/assets/js/index.js, which imports warzone-boot.js and essential.js. The
DOMContentLoaded handler initializes the startup background, authentication and
region selector, then exposes a memoized __warzoneStartDeferredApp callback.
Region confirmation imports warzone-globe.js and creates the Cesium viewer.
waitForFirstUsableMap checks canvas size, a rendered frame, and camera input
before the entry fade and dashboard reveal. Operational API initialization runs
after that boundary. schedulePostEntryActions installs the singleton map manager.

The previous waitForFirstUsableMap awaited __warzoneImageryReadyPromise before
checking a frame. For the default Esri provider, setEntryMapImageryVisible ->
addArcGisLayers awaits ArcGisMapServerImageryProvider.fromUrl against remote
World_Imagery metadata (and optionally the labels provider). This path has no
application request deadline. A pending metadata promise prevents entry from
settling even if WebGL can already render. A rejected provider also previously
failed entry. Imagery now completes independently; actual canvas/frame/input
readiness remains required. No new loader-hiding logic or timeout was added.

The post-entry hook also waited for all operational data, including optional
status/GNSS completion. The hook now waits for the visual entry transition only.
initializeWarzoneAppOnce still initializes its subscriptions and caches once;
status/GNSS layer completion continues in the background.

MapLibre was initialized only in the post-entry hook, so its tile load or workers
cannot explain a loader that never reaches the entry/region UI. The old Tactical
initializer waited for all resources via the map load event and a 20-second
timeout. It now waits for local style.load and handles style errors explicitly;
remote tile/DEM/glyph availability does not gate operational layers.

These are source-proven blocking conditions, not a reproduction of the user's
specific browser failure. If loading stops before entry/region UI, the bundle
response, compilation diagnostics and first browser exception still need review.
No claim is made that the observed browser failure is fully verified as fixed.

## Module warning and process roles

apps/shared/reporting-intelligence.js and reporting-snapshot.js import
dev/assets/js/warzone-event-cluster-model.js. The shared packages declare ESM,
but the imported frontend file previously inherited the typeless root package.
Node detects its export syntax and reparses it, producing
MODULE_TYPELESS_PACKAGE_JSON. dev/assets/js/package.json now declares type=module
only for frontend JavaScript. The root server and webpack config remain CommonJS.
The frontend JavaScript directory was searched for CommonJS exports/requires.

The scripts describe distinct frontend webpack, API node --watch, and ingestion
worker processes. The static server and webpack both default to port 4173 and
are alternatives, not servers that should both own that port. This source
inspection does not establish which processes currently run, which owns 4173,
or whether an old server serves stale output. No processes were started/stopped.
The memoized operational boot, application initializer, and singleton map manager
are retained; no additional viewer initialization or polling pipeline was added.

## Rendering and focus

The installed maplibre-gl is 5.24.0. Tactical sets native globe projection after
style.load. Existing root.css cartographic tokens, vector styling and hillshade
remain in use. Tactical remains the default preference; explicit Satellite
preferences are honored.

The custom 3D layer follows MapLibre's official globe integration:
https://maplibre.org/maplibre-gl-js/docs/examples/globe-3d-model/

It uses transform.getMatrixForModel(lonLat, altitude), the current render
arguments' defaultProjectionData.mainMatrix, renderingMode=3d, and MapLibre's
canvas/context/depth buffer. The Three camera is a projection-matrix carrier,
not an independently controlled camera. No overlay canvas or extra RAF loop is
created. The installed globe and Mercator transform implementations were read.

The Three module is imported only when a focused asset or enabled formation
needs a GLB. The existing tracker adapters provide descriptors; their Cesium
focus functions are unchanged. Coordinates and aircraft altitude come from
tracker data, vessels use sea level and their authored vertical origin, and
satellites use the existing propagation's altitudeKm. Heading/pitch/roll convert
the existing Cesium HPR convention to MapLibre's local east/up/south basis.

The GLB headers were inspected without rendering. Most require
EXT_meshopt_compression and KHR_mesh_quantization; B-1 and Global Hawk require
KHR_draco_mesh_compression. The loader configures Meshopt and Draco. The decoder
copy rule serves Three's matching Draco files from /assets/three/draco/.
Three 0.169.0 is pinned with registry integrity in the lockfile. It is NOT
installed in this workspace yet; dependency installation is required before
the next compilation. The existing production output was not regenerated.

Aircraft explicit registry keys and exact identity rules take precedence.
Fallbacks use the configured F-16 default or Heli-412 default, with explicit
fallback labeling in the focus panel. There is no neutral generic aircraft GLB
in this library. Failed exact requests try the default once; a failed fallback
reports an error. Fallback orientation uses that model's calibration.
Naval classes reuse the existing registry, including its Boat-to-Frigate
mapping; failed model loads use the existing Frigate default. Satellite
visualization reuses its existing registry, whose country/default mappings
are representative visuals rather than guaranteed exact spacecraft geometry.
All selection and follow IDs remain the exact record IDs.

Focused models receive depth-tested corner indicators and bounded projected
screen sizes. Shared geometry/materials and cloned skeletons are retained;
embedded GLB animation clips run from MapLibre render callbacks. Position and
orientation updates interpolate between existing snapshots. Follow changes
center/elevation without repeatedly overriding user zoom. Drag pauses follow;
unlock releases the focused instance (enabled formation members remain).

Formation records marked formation-dev-tuner are the only nonselected assets
eligible for detailed GLBs. All four presets reuse their existing models and
movement/sliders. Existing ticks notify Tactical, without a second simulator.
Focus framing includes the group's extent around the designated primary.
2D/3D view buttons control top-down/tilted globe views; contour/terrain-specific
tools still explicitly use Satellite. The legacy tuner remains disabled.

## Resource and compatibility limits

Unfocused contacts remain existing batched GeoJSON markers. There is no new
feed request or data polling loop. Only models interpolate/animate through the
map lifecycle; offscreen model centers are culled and Three frustum culling
remains enabled. Assets share in-flight requests, cached templates and GPU
resources. At most twelve idle templates are retained across map switches;
eviction disposes geometry/materials/textures. Instance rigs and indicators
are released on removal; map teardown disposes the renderer without losing
MapLibre's shared context. Failed individual models report errors without
throwing out of the map render callback.

Native 5.24 spherical camera matrices ignore center elevation. Orbital focus
therefore uses an altitude-derived global zoom, a surface-centered overhead
view, and a maximum zoom outside the satellite radius. It is not unrestricted
Cesium-style orbital camera navigation. Orbit paths and coverage volumes remain
in Satellite. Aircraft close-ups use MapLibre's native globe-to-Mercator
transition and unclamped center elevation. Global zoom remains spherical.
There are no separate reduced-polygon GLB variants in this implementation:
detail control is marker-versus-model selection, screen-size bounds and culling.

Waterline alignment retains authored GLB origins; no bathymetry, coastline
snapping, or fabricated vessel-position correction is applied. Bad upstream
coordinates can still put a vessel on land. Visual hull waterlines and model
calibration require browser inspection.

## Exact change inventory

| File | Changed function or area |
| --- | --- |
| dev/assets/js/index.js | waitForFirstUsableMap; post-entry promise barrier |
| dev/assets/js/essential.js | initializeWarzoneAppOnce optional completion |
| dev/assets/js/package.json | frontend-only ESM scope |
| dev/assets/js/warzone-tactical-map.js | createTacticalMap; refresh; lazy syncModels; select; view/elevation/orbital camera helpers; disposal |
| dev/assets/js/warzone-tactical-models.js | new model cache, decoder configuration, GLB lifecycle and custom layer |
| dev/assets/js/warzone-map-bridge.js | getTacticalView; routeTacticalView |
| dev/assets/js/warzone-map-manager.js | select; showSelection; region; switchMode; setView adapter |
| dev/assets/js/warzone-globe.js | Tactical branches of setSceneMode/getSceneMode only |
| dev/assets/js/warzone-live-airforce.js | aircraft map-source model descriptor |
| dev/assets/js/warzone-live-naval.js | naval map-source model descriptor |
| dev/assets/js/warzone-mil-sats.js | satellite map-source model descriptor |
| dev/assets/js/warzone-formation-tuner.js | renderFormation notification; applyViewMode routing |
| package.json | pinned Three dependency |
| package-lock.json | matching Three dependency and registry integrity |
| webpack.config.js | Three Draco decoder copy rule |
| docs/tactical-globe-implementation.md | this report |

Pre-existing edits and generated-output changes were not reverted or regenerated.
No CSS, model binaries, production files, test files, or authentication functions
were edited by this task.

## Verification still required

Source/diff review and git diff --check only; no runtime or performance claims.
After installing the declared dependency, verify compilation, initial loading
with stalled/failed imagery and API requests, one viewer/satellite initialization,
authentication/onboarding, source/worker requests, all four formations, exact
model appearance/orientation, fallback labels, naval waterlines, GLB decoding,
zoom/follow/unlock, globe transitions, antimeridian/polar behavior, orbital
focus limits, context loss/restoration, layer isolation, and repeated
Tactical/Satellite switching. Measure performance before claiming improvements.
