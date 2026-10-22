# Tactical / Satellite map engines

Historical implementation note: Phase 2 removed the alternative MapLibre
renderer and restored Cesium as the sole operational globe. The details below
describe the former implementation, not the current application.

## Implementation and verification status

This is a source implementation, not a measured performance result. Builds,
automated tests, application launches, browser checks and deployment were not
performed, as requested. JavaScript syntax-only checks and patch/diff review
are separate from runtime verification. The existing dirty worktree, generated
production assets and previous formation/model changes are not replaced.

Observed architectural issue: data updates, Cesium entity updates, focus tasks
and shared animation tasks were coupled to the globe. Hiding its canvas alone
would not stop that work. This change adds rendering boundaries; it does not
claim that the cause of all prior lag has been measured.

## Architecture and entry

- The existing post-entry hook loads a singleton mode manager. Entry, onboarding,
  authentication and the startup globe sequence remain on their existing path.
- MapLibre GL JS **5.24.0** is a pinned dependency. It is imported lazily only
  when Tactical is requested. Install the updated lockfile before building.
  The resolved dependency tree includes packages requiring Node 22 or newer.
- First operational use defaults to Tactical. The preference is stored in
  `stratops.map-engine`; an existing Satellite preference takes precedence.
- The new map container is a sibling of the globe, never a replacement of the
  viewer or its parent.
- The renderer-neutral bridge registers adapters over existing cached data.
  It owns no HTTP polling, WebSocket, Supabase or authentication subscription.
- Tactical movement goes through the existing debounced viewport-fetch
  scheduler, using bounds from the visible MapLibre map.
- Mode changes are serialized. During Tactical operation the existing Cesium
  viewer remains allocated but its default render loop/clock animation are
  stopped. The shared animation scheduler and aircraft interpolation stop.
  Existing finite missile/alert effects defer their next frame until Satellite.
- Returning to Satellite removes the MapLibre instance, its WebGL resources,
  update timer, observer and per-instance listeners before resuming Cesium.
  Existing data adapters reconcile cached positions without refetching feeds.
- A failed MapLibre import leaves Cesium running. A failed initialization
  removes MapLibre and restores Satellite; it does not persist a failed choice.

Cesium retains its existing GPU allocations while inactive because the
persistent viewer must not be destroyed. Actual peak GPU/heap usage and repeated
switching stability still require measurement.

## Implemented Tactical adapters

| Data | Tactical representation / interaction |
| --- | --- |
| Aircraft | Cached live positions, aircraft/helicopter symbols, headings, metadata, selection, follow/pause/unlock, existing type/country/region filters |
| Aircraft history | Registry-backed ended/recent contacts and the selected contact's recorded path, split at the antimeridian; no fabricated history |
| Naval | Existing vessel registry, vessel/submarine symbols, headings, metadata, existing category/country/region filtering and selection/follow |
| Orbital | Exact filtered `state.visibleRecords` and stable record IDs; existing GP propagation produces current ground positions. Explicitly labelled propagated, not direct observations |
| Operational events | Existing operational/region/lens/layer-filtered events as GPU markers, metadata, existing event-details popup with Tactical projection |
| Military bases | Canonical dataset through the existing module's authentication and visibility gate |
| GNSS | Existing cached cells as markers, and actual supplied polygon boundaries when available; missing boundaries are not invented |
| Formations | Existing simulation registries; all four presets remain controlled by the dedicated tuner. Cleared aircraft are excluded. Simulated formations remain discoverable outside the currently selected monitoring region |

The same effective `isLayerEnabled` rules apply, including tracker isolation
and access restrictions. Raw layer preferences are not rewritten by switching.
Country-border and map-label visibility honor those existing controls, so a
user with labels/borders disabled will continue to see them disabled.

## Explicit Satellite-only features and limitations

Use **SATELLITE** or the selected-contact **3D / SATELLITE** button for GLB model
inspection, 3D aircraft/naval formations, orbit paths/altitudes, focused terrain,
contours, airspace/coverage volumes, range/sweeper graphics, AOI, regional plates
and satellite imagery overlays. Enabling the corresponding unsupported layer
transitions to Satellite; layers already enabled when entering Tactical retain
their preference but are not drawn there. The mode control explains this.

The formation tuner's 3D/TER/CTR actions first transition to Satellite. Its speed,
distance, activation and clear behavior remains in the existing simulation;
there is no second formation renderer or simulation.

Satellite selection restoration calls the original native focus functions.
Their 3D camera calculations are not replaced. A Tactical follow pause applies
to Tactical navigation; requesting native 3D focus re-enters the existing
Satellite focus behavior. Generic event/base selection has metadata in Tactical,
but is not synthesized into a Cesium aircraft/satellite focus.

Tactical paths use existing aircraft `path_history` only. Animated historical
replay and real 3D orbital paths remain Satellite features. Satellite ground
positions are projected from the existing GP records at the visual update
cadence; the underlying propagation formulas, data refresh and filters are
unchanged. Web Mercator cannot display the poles beyond approximately 85 degrees.

## Styling, providers and licenses

The custom style uses OpenFreeMap's public OpenMapTiles-compatible vector tiles
and glyphs, plus public Mapzen/Terrarium elevation tiles for restrained
hillshading. No OSIRIS assets, private endpoints or branding are used.

- [OpenFreeMap quick start and attribution](https://openfreemap.org/quick_start/)
- [OpenStreetMap attribution/licensing](https://www.openstreetmap.org/copyright)
- [Elevation tile attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
- [MapLibre incremental source updates](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/)

Attribution remains visible in the map. Production requires access to
`tiles.openfreemap.org`, `s3.amazonaws.com/elevation-tiles-prod`, and blob
workers used by the bundled MapLibre distribution. Review deployment CSP,
provider terms/availability and font coverage before release. The tile source
configuration is isolated in `warzone-tactical-style.js` for a future licensed
or self-hosted provider. No extra API key is embedded.

All requested `--tactical-*` colors are in `root.css`: land, ocean, background,
country/state borders, coastline, terrain shadow/highlight/opacity, country/
city/water labels, roads, rivers, grid, aircraft, naval, satellite and selected.
Additional tokens: terrain-intensity, event-color, border-width, label-size,
symbol-size, layer-opacity, grid-opacity and state-opacity.

The active renderer reads the computed CSS theme on its one-second visual
update schedule and applies changed paint/layout values without rebuilding
the style. Atlas images are recolored only when the theme changes. Root
class/style changes also schedule synchronization. Stylesheet edits therefore
propagate without a full application reload. Grid opacity defaults to zero.
Terrain opacity/intensity multiply the hillshade exaggeration, not 3D terrain.

## Performance strategy and diagnostics

- GPU GeoJSON/symbol/circle/line/fill layers; no per-contact DOM markers or GLBs.
- Stable feature IDs and batched `updateData` diffs, rather than per-frame full
  source replacement. Unchanged sources are not submitted again.
- Buffered viewport culling, low-zoom dots, collision-managed labels,
  category-specific shared atlas symbols and a separate selected-contact layer.
- No clustering of live assets: selected/formation identities are never
  aggregated away. Very dense views may still need measured LOD tuning.
- One renderer-owned one-second projection/update timer, paused in hidden tabs
  and removed on exit. No independent intelligence polling.
- Manual drag pauses follow without clearing selection; wheel zoom retains the
  user's zoom. Follow updates change center only.
- Development/localhost only: `window.__warzoneMapDiagnostics()` returns engine
  ownership, initialization/switch timing, batch timing/rate, visible/cached
  features, enabled style layers and available JS heap size. Frame intervals
  exclude idle gaps and are not a benchmark. GPU memory is not claimed.

Still verify with representative loads: initial tile failure/recovery, all
four formations, aircraft/naval/satellite selection both directions, history
filters, layer isolation, auth/logout, region changes, event popups, rapid
switches, hidden-tab recovery, wheel/drag behavior, CSP/workers, style/token
updates, network subscription counts, long-run memory and real navigation FPS.
Also verify entry/onboarding, loader lifecycle and existing Satellite features
for regressions. No 60 FPS or speed improvement is asserted.

## Exact source changes

Created:

- `dev/assets/js/warzone-map-bridge.js`: renderer/source/filter registration,
  shared selection, routing, deferred Cesium frames and Tactical projection.
- `dev/assets/js/warzone-map-manager.js`: `initWarzoneMapManager`,
  `satelliteCamera`, `restoreSatelliteCamera`; internal `switchMode`,
  `restoreCesium`, `select`, `region`, `showSelection`.
- `dev/assets/js/warzone-tactical-map.js`: `createTacticalMap`,
  `addOperationalLayers`, `installIcons`, `pathGeometry`, `gridData`;
  internal projection refresh, scheduling, selection and disposal.
- `dev/assets/js/warzone-tactical-style.js`: `readTacticalTheme`,
  `tacticalStyle`, `syncTacticalTheme`.
- `dev/assets/css/warzone-tactical-map.css`: scoped container, controls,
  metadata panel and inactive Cesium overlays.
- `docs/tactical-map-engine.md`: this implementation/verification report.

Modified:

- `package.json`, `package-lock.json`: pinned MapLibre dependency and its tree.
- `dev/assets/css/root.css`: Tactical tokens only.
- `dev/assets/js/essential.js`: `schedulePostEntryActions` adapters/manager,
  `syncInitialEventsToGlobe` and `syncGnssInterferenceLayer` render gates;
  operational viewport listener; existing popup projection/tracking closure.
- `dev/assets/js/warzone-animation-scheduler.js`: `requestSceneRender`,
  `scheduleAnimationFrame`, `runAnimationFrame`, `requestSharedSceneRender`
  active-renderer gates.
- `dev/assets/js/warzone-asset-focus-controller.js`: `tick`,
  `requestFrame`, `canEnterFocus`, `resume` Tactical guards only.
- `dev/assets/js/warzone-live-airforce.js`: selection routing in
  `focusLiveTrack`, `clearLiveTrackSelection`, `toggleLiveTrackSelection`,
  `getLiveTrackSelection`, `isLiveTrackHardLockEnabled`; render gates in
  `applyLiveTrackUpdate`, `syncLiveTrackRenderPopulation`,
  `wakeLiveTrackInterpolationRender`, `requestWarzoneRenderBatched`,
  `refreshAllLiveTrackVisualModes`, `scheduleRefreshAllLiveTrackVisualModes`;
  registry adapter registration.
- `dev/assets/js/warzone-live-naval.js`: `upsertNavalVessel`,
  `setNavalLayerVisible`, `focusNavalVessel`, `clearNavalSelection`;
  registry adapter registration.
- `dev/assets/js/warzone-mil-sats.js`: `selectSatellite` routing,
  `updateDefaultEntities`/`updateSelectedSatellitePosition` render gates,
  filtered-record adapter registration.
- `dev/assets/js/warzone-military-bases.js`:
  `getWarzoneMilitaryBaseMapRecords` gated read-only adapter API.
- `dev/assets/js/warzone-region-selector.js`: `flyToRegion` routing.
- `dev/assets/js/warzone-ui.js`: `syncAutoFocusSceneMode` skips native
  auto-morph bookkeeping for Tactical selections.
- `dev/assets/js/warzone-formation-tuner.js`: `applyViewMode` explicit
  Satellite transition.
- `dev/assets/js/warzone-globe.js`: event-reconcile/render gates, finite
  missile/alert frame deferral; public viewport/scene-mode/contour/terrain
  adapter boundaries. No viewer constructor or focus math replacement.
