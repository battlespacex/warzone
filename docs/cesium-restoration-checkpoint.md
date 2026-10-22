# Cesium-only restoration: phased checkpoint

## Phase 4 status - 2026-10-19

Feature resource lifecycle implementation and focused automated verification are
complete; see [the Phase 4 report](phase4-resource-lifecycle.md) for exact changes,
activity probes, passing checks/build and remaining authenticated-browser checks.
Phase 5 has not started. Earlier phase sections below are historical checkpoints.

## Phase 3 completion - 2026-10-19

Workspace: `C:\DX\warzone-recovery`. The user confirmed the original Cesium
globe renders correctly in Chrome on Laptop B after region selection. That
manual result is accepted; headless visual rendering is no longer a blocker.
Phase 3 is complete. Stop here; later performance/layer-priority phases have
not been implemented.

### Worker failure classification

The original 13 failures are not confirmed Phase 2 regressions:

- Nine source-based cases reproduce against committed `HEAD` using read-only
  `git show` inputs: Dev Panel mounting, entry scene tuner, event-marker tuning,
  PDF viewer styling, 404 home link, entry handoff, aircraft hard lock, poster
  layout, and realtime aircraft rescue/history ingestion.
- Two coordinate/normalizer cases and the VesselAPI persisted-interval case
  reproduce in unchanged worker/shared source and unchanged tests. The failures
  are respectively `false !== true`, `null !== 49.99`, and missing
  `diagnostics.interval_blocked`.
- The PDF conversion case cannot launch its configured Playwright Chromium
  headless shell because that executable is not installed. This is a local test
  environment failure; renderer removal did not change the PDF service.

No application changes were made to silence these failures. Targeted regression
testing additionally found one stale assertion requiring the removed `is2DMode`
branch; it now checks the equivalent retained 3D tile-loading condition.

### Exact source/test changes in this phase

| File under `dev/assets/js/` | Functions/behavior changed |
| --- | --- |
| `warzone-globe.js` | `initWarzoneGlobe` explicitly selects `SCENE3D`; remove scene-mode normalization/getter/setter, morph loader/timers/events and rotation's obsolete 2D guard; `setMapMode` retains map/heatmap event styling only. |
| `warzone-region-selector.js` | `applyRegionCameraLock`, `releaseRegionCameraLock`, `refreshRegionButtonHint`, `flyToRegion`, `initRegionNav`: retain native 3D navigation; remove 2D priming and mode-refocus timers/listeners. |
| `warzone-hotspots.js` | `getHotspotPerspectiveTilt`, `projectWorldPosition`, `projectHotspotWorldAnchor`, `createWarzoneHotspotLayer`: retain 3D projection/culling and remove obsolete 2D branches/mode listener. |
| `warzone-boot.js` | Boot bindings: remove unused mode buttons and mode-change resize listener. |
| `essential.js` | `initializeWarzoneAppOnce`: remove mode-change recluster listener; camera/region/data reclustering remains. |
| `warzone-military-bases.js` | `bindBaseRuntime`, `unbindBaseRuntime`: remove morph listeners/state; camera/panel lifecycle remains. |
| `warzone-formation-tuner.js` | `applyViewMode`: remove obsolete scene setter; existing 3D/terrain/contour presets remain. |
| `report-capture.js` | `applyAssetFocus`, `applyCamera`: remove scene setter/morph waits; retain legacy report presets' overhead camera framing within the 3D viewer. |

Tests changed: `apps/worker/test/stratops-ui-improvements.test.js` extends the
Cesium-only lifecycle guard across the migrated consumers;
`apps/worker/test/cesium-imagery-focus-performance.test.js` updates the stale
2D-specific assertion. This checkpoint is the only documentation changed in
this phase. The production build also regenerated hashed output under
`production/`. Existing unrelated CSS edits were preserved.

### Verification

- Syntax checks: all eight changed application JavaScript files passed.
- Targeted hotspot, geometry, imagery, capture, tracker-focus and UI regression
  checks: 70 passed, zero failed. The three known baseline UI cases were
  excluded explicitly by name; the full worker suite is not claimed green.
- `npm run build`: passed; Webpack compiled successfully in 85,697 ms.
- Browser control smoke check: one viewer, `scene3DOnly: true`, scene mode 3,
  camera input/zoom/rotate/tilt enabled, wheel zoom changed camera height,
  and the same viewer remained active with no JavaScript errors.
- Premium aircraft/naval toggles and Orbital Intelligence remained gated in the
  unsigned browser context. Live premium feeds, Focus actions and model
  appearance require an authenticated browser check; no access gates were
  altered to test them. Their source paths and targeted regression checks remain.
- Development application source has no renderer-switch imports, scene morphs,
  2D branches or mode-change listeners. Old renderer preferences have no reader.
  Canvas 2D drawing and legacy report camera-preset names remain intentional.

---

Phase 1 historical checkpoint. Phase 2 was subsequently approved on 2026-10-18,
including the dedicated 2D mode and controls. The Phase 1 authorization boundary
and next-phase checklist below describe the state before that approval.

Updated: 2026-10-18, America/Toronto. Workspace: `C:\DX\warzone-recovery`.
Inspected HEAD: `1f6bea6f`. This is not a commit or branch change.

## Execution boundary

The user requires independent phases and authorization before each next major
phase. Phase 1 source inventory is complete. Browser/GPU baseline measurements
are outstanding. Phase 2 is NOT started or authorized by this checkpoint.
No renderer, dependency, layer, camera, styling, or backend code was changed.
The only new file in this phase is this checkpoint.

Pre-existing change to preserve: `webpack.config.js` CSS fallback `entry` ->
`[id]`. Preserve the existing JS unnamed-chunk filename fix as well. Initial
`git status --short` contained only that modified configuration file. Do not
reset, restore stashes, change branches, commit, push, or overwrite local work.

## Confirmed implementation and removal boundaries

- `package.json` declares `maplibre-gl` 5.24.0; update the root lockfile together
  with the manifest during removal. Audit transitive dependency ownership before
  pruning; do not delete similarly named packages by text matching.
- Renderer-only candidates: `dev/assets/js/warzone-tactical-map.js`,
  `warzone-tactical-models.js`, `warzone-tactical-style.js`, and
  `dev/assets/css/warzone-tactical-map.css`. The renderer creates the MapLibre
  globe, loads the custom Three.js model layer, and owns its rendering resources.
  Verify final incoming references before deleting these tracked files.
- `warzone-map-manager.js` owns engine selection, lazy renderer imports, controls,
  renderer teardown and `stratops.map-engine` storage. Missing preference defaults
  to Tactical. It also handles selection and camera transfer: migrate retained
  behavior, not just imports.
- `warzone-map-bridge.js` is NOT an isolated renderer file. Direct consumers:
  `essential.js`, `index.js`, `warzone-animation-scheduler.js`,
  `warzone-asset-focus-controller.js`, `warzone-formation-tuner.js`,
  `warzone-globe.js`, `warzone-live-airforce.js`, `warzone-live-naval.js`,
  `warzone-mil-sats.js`, `warzone-military-bases.js`,
  `warzone-region-selector.js`, `warzone-ui.js`, plus renderer/manager modules.
  Shared data, selection, overlay mounting and camera behavior must retain their
  Cesium paths before removing the bridge. Do not leave permanent no-op stubs.
- Three.js and Draco wiring are present in `warzone-tactical-models.js` and
  Webpack's decoder serving/copy rules. No dependency removal is authorized in
  Phase 1. Complete the retained-feature import audit before deciding ownership;
  never delete the original GLB library or Cesium WebGL resources.
- There are TWO separate mode systems to remove: engine switching above, and
  Cesium's own 2D/3D scene morphing. `dev/partials/header.html` contains
  `wz-toggle-2d`/`wz-toggle-3d`. `warzone-ui.js:initGlobeRotation`,
  `warzone-globe.js:setSceneMode`, `warzone-live-airforce.js`, boot, region,
  hotspot and naval focus code contain 2D/mode consumers. The feature flag is
  `header.sceneModeToggle`. Retain unrelated scene-event behavior until audited.
- `index.js:ensureSatelliteViewer` already memoizes native Viewer creation and
  dynamically imports `warzone-globe.js`. Region-confirmed startup currently
  enters the manager path. Restore the existing native path without starting a
  second viewer, re-running onboarding, or restarting operational satellite data.
- Native Viewer already uses request-render mode and `shouldAnimate: false`.
  Do not present enabling those existing settings as a new optimization.

## Layer and resource findings

- `warzone-layers.js` is the central authority: `setLayer`, `toggleLayer`,
  `getEffectiveLayerState`, `isTrackerIsolationActive`, and
  `isLayerAllowedByTrackerIsolation`. Aircraft and Naval are already compatible
  with simultaneous enablement.
- Existing tracker isolation masks unrelated effective states without clearing
  their stored true values. It retains map-labels, raised regions and borders as
  base layers and permits aircraft airspace. It therefore does not implement the
  requested state-level OFF behavior or unrestricted intentional later overrides.
  Phase 6 must change actual state/notifications, not hide more DOM.
- Aircraft ingestion/sync/realtime already stop when disabled or backgrounded in
  `essential.js:syncAircraftLivePipelines`. Preserve these paths and audit
  outstanding requests, animation tasks and reactivation idempotency separately.
- `warzone-live-naval.js:setNavalLayerVisible(false)` removes render entities and
  unbinds runtime while retaining data records. Naval signals also come from the
  shared event pipeline in `essential.js`; do not stop that feed indiscriminately.
- `warzone-mil-sats.js:setWarzoneMilSatsEnabled(false)` calls `cleanupLayer`,
  which stops both timers, destroys handlers, clears focus/entities and separates
  startup demo cleanup. Operational Orbital Intelligence is retained functionality.
- Military bases already destroy the datasource/unbind runtime when no longer
  needed. Hotspots expose listener teardown. Validate actual toggle call paths
  before claiming leaks or adding a second lifecycle system.
- Shared animation scheduling already coalesces render requests and suspends on
  hidden documents. `essential.js` also owns shared event polling, intel-wire,
  widget and visibility-recovery work. Feature ownership is not the same as one
  timer per named layer; backend collection is outside the shutdown scope.

## Five profiling candidates, NOT measured bottleneck rankings

1. `warzone-live-airforce.js:wakeLiveTrackInterpolationRender` traverses all
   rendered aircraft on each active interpolation frame and requests rendering.
2. `refreshLiveTrackViewDependentVisuals` snapshots the entity population and
   updates it in 24-entity RAF batches; camera churn may cancel/restart work.
3. Entity/model/label/trail population and rebuilding costs: inspect
   `syncLiveTrackRenderPopulation`, view-dependent entity refresh, and Naval
   re-enable population separately from the complete authoritative registries.
4. Focus/camera work: aircraft preRender callbacks at approximately 3956/5120,
   aircraft lookAt around 5085, naval lookAt around 2494 and preRender around
   3084, plus the shared asset-focus controller. Multiple hooks are candidates,
   not proof that two controllers currently compete.
5. Optional layer and shared pipeline work while disabled: trace effective state
   through API/realtime, widget timers, overlays and scheduler tasks. Existing
   cleanup means a blanket claim that all OFF layers keep running is unsupported.

## Baseline and verification status

No browser-control/profiling tool or GPU telemetry tool is exposed in this
session. No browser FPS, p95/p99, 1% lows, input latency, CPU/GPU or memory baseline
was collected. No five largest measured bottlenecks can honestly be reported.
No application, test, development build or production build was run in Phase 1:
only documentation changed, and the preceding CSS task already compiled the
same application configuration successfully. That earlier warm-cache compile
is NOT a Cesium rendering benchmark or a new before/after measurement.

Before major rendering changes, capture a manual baseline on the same machine,
1080p viewport, browser version, region, terrain and imagery configuration. Record
CPU/GPU models, power mode and refresh rate. Capture an idle globe and each of
Aircraft, Naval, both trackers, focus/orbit/zoom, repeated OFF/ON and an extended
session. Capture 1k/5k/10k only with available, clearly labeled representative
data; never falsify live authoritative contacts or reduce dataset coverage.

Use Chrome Performance traces for frame-time distributions, interaction tasks,
GC and execution samples; Network for API/subscription activity; Memory snapshots
for retained resources. Export traces and compare equal-length warmed samples.
DevTools FPS overlays alone do not establish 1% lows or percentile frame times.
Collect existing console diagnostics where available:
`window.__stratopsStartupDiagnostics?.()`,
`window.__getWarzoneAircraftDiagnostics?.()`,
`window.__getWarzoneAircraftPipelineDiagnostics?.()`,
`window.__getWarzoneMilSatsDiagnostics?.()`, and
`window.__getStratOpsPerformanceDiagnostics?.()`.
Measure layer shutdown/restore separately, explaining shared work that remains.
GPU draw calls/utilization require a suitable graphics capture/OS tool and cannot
be inferred from entity count. No performance target is claimed achieved.

## Authorized-next-phase checklist

1. Phase 2, AFTER user approval: remove the MapLibre engine and its exclusive
   resources/dependencies, migrating shared Cesium consumers atomically. Wire
   startup to the existing native Viewer path as necessary to keep the checkpoint
   runnable; do not leave a deliberately broken app until Phase 4. Preserve the
   Formation Dev Tuner, exact GLBs, overlays, authentication and orbital data.
2. Phase 3: remove separate 2D controls/morph paths and obsolete saved settings.
3. Phase 4: verify permanent native default, single Viewer, onboarding, imagery,
   terrain, original navigation and operational satellites.
4. Phase 5: audit remaining feature OFF/ON resource ownership and fix proven gaps.
5. Phase 6: implement state-level tracker priority with both trackers allowed and
   predictable explicit optional-layer re-enablement.
6. Phases 7/8: profile-driven population/interpolation and Focus improvements;
   benchmark before major primitive/instancing/culling redesigns.
7. Phase 9: remove only verified obsolete leftovers; preserve historical docs.
8. Phase 10: targeted tests, development/production builds, browser functional
   matrix and matched performance comparisons. Report unverified metrics plainly.

Stop after each major phase and request authorization for the next. Application
code and dependency removal begin only after the next authorization.
