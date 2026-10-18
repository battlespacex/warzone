# StratOps Tactical operational compatibility correction

Source inspection and implementation: 2026-10-17. No build, tests, application launch, deployment, browser measurement, or visual acceptance test was performed. Syntax-only parsing does not validate WebGL or application behavior. The five screenshots referenced in the request were not present in its text attachment.

Static checks completed: `node --check` passed for all 12 modified JavaScript/configuration files. Targeted `git diff --check` passed. Build result: not run, as requested. These checks do not prove runtime compatibility or performance.

## Source-confirmed causes

- Tactical CSS explicitly hid the original aircraft/naval focus overlays. The manager constructed an independent selection panel; Three.js created different model-space corner brackets; MapLibre added a replacement selection ring.
- The Tactical aircraft adapter duplicated model resolution, bypassing the canonical availability/fallback decisions. Its renderer re-centered authored GLBs and imposed separate pixel-size limits rather than honoring model descriptors.
- Tactical selected state did not enter the original shared focus controller. Other operational components could observe no active focus while a Tactical asset was selected.
- The Tactical trail was a single surface-projected line with its own width, color and opacity. Aircraft already have authoritative history, original route geometry/fade helpers, subtype widths, colors and altitude resolution.
- Fixed `cesium-vendor` naming across `chunks: all` combined initial Cesium utilities with lazy viewer dependencies. This undermines the intended lazy viewer boundary; actual emitted byte savings require a build/network measurement.
- A rejected `satelliteViewerPromise` remained cached, so subsequent Satellite switches reused the same failure. Catch-all HTML routing could also turn missing asset requests into HTML rather than genuine asset 404s.
- A one-second Tactical loop rebuilt snapshot/signature collections even when no data changed. Orbital propagation repeated on each unrelated refresh. Active formation GLBs were requested before viewport culling.
- Aircraft snapshots included ended registry records, allowing cleared formation aircraft to remain on the map. Naval removal did not invalidate the Tactical renderer. Naval updates requested a render on the dormant native scene.
- Tactical's orbital camera compensated for the globe camera's sea-level target with zoom restrictions. That is not equivalent to the existing Cesium orbital focus experience.

The reported 30-60 minute stall and the original failing chunk's HTTP response are not explained conclusively by source inspection. Filesystem/network latency, stale browser runtime, compilation throughput, transfer stalls, JS evaluation, and GPU/driver behavior still need separate measurements. Existing local-cache, source-map, watch-boundary and static-serving optimizations were retained.

## Operational architecture and behavior

The existing aircraft registry, naval registry and Orbital Intelligence records remain the data sources. No new feed, subscription, orbital calculation, authoritative tracking history or formation simulator was introduced. Renderer-specific adapters project those records and use the existing focus controller. Engine switches do not restart onboarding, authentication or data subscriptions.

Aircraft and naval focus reuse their original overlay constructors and cyan X arms. Only the overlay node is reparented between map hosts; viewer containers and their parents are not replaced. A small projection adapter presents the original label text/style settings at that same anchor. This is not a new metadata panel. Terrain/contour buttons transfer selection to Satellite and invoke their existing handlers; plain 3D and Unlock remain operational in Tactical.

Aircraft GLBs now use `getLiveTrackModelDescriptor`, canonical fallback resolution, heading calibration, altitude resolution and attitude helpers. Derived Tactical poses are weakly cached per telemetry record so heading-spike filtering is not advanced by unrelated refreshes. Naval GLBs continue using `getNavalModelDescriptor`; vessel altitude remains zero. No model files or registry mappings were changed. The current original aircraft resolver contains specific role/default fallbacks (including F-16 as the global default); these are preserved, not presented as exact identity matches.

The original aircraft route geometry, fade segments, widths and color settings are passed into the shared-context Three renderer. Each longitude/latitude/altitude point uses MapLibre's installed globe-compatible `getMatrixForModel`; no Mercator-only conversion or disconnected overlay canvas is used. The trail head follows the rendered/interpolated asset. Unchanged trail signatures reuse geometry. Changed histories currently rebuild trail segment buffers; profiling is needed before further incremental-buffer work. The live naval module has no matching aircraft-style trail implementation to reuse; no fabricated naval history was added. Existing native routes remain available in Satellite.

The Three layer retains the official shared-canvas, `renderingMode: 3d`, projection-matrix and depth-buffer arrangement. It preserves authored model origins/materials and descriptor scale/minimum-pixel/maximum-scale settings. Lightweight batched markers remain until a GLB is ready, then are hidden for that model. Focus overlays use the actual custom-layer screen projection, including heading/altitude movement and globe occlusion. Visual parity still requires browser acceptance.

Focused satellites intentionally use the existing Cesium renderer. The pinned MapLibre globe camera does not provide equivalent orbital target/follow behavior. Clicking an exact satellite transfers that ID into native focus, with its original GLB registry, orbital positioning, paths and controls. Returning to Tactical shows an overview with the ID retained, not fake orbital following; Focus can reopen native orbital tracking. This limitation was identified before implementation. Geographic satellite symbols in the overview are not claimed to represent a focused 3D satellite.

Tactical startup still creates no Cesium viewer. Tactical is disposed before first Satellite creation. After Cesium has been created, returning to Tactical preserves that same native viewer with its clock/render loop paused. A dormant Cesium context remains allocated alongside Tactical's context: destroying it would violate viewer continuity. Only one geographical renderer should run; this requires runtime verification. Heading, pitch and approximate camera range now transfer instead of always forcing a top-down view. Different sphere/ellipsoid/FOV conventions prevent exact pixel-identical camera transforms.

## Exact files and functions changed in this correction

| File | Functions/sections |
| --- | --- |
| `webpack.config.js` | Development Cesium splitChunks group; development asset history-fallback rewrite |
| `dev/assets/js/index.js` | `ensureSatelliteViewer`: named lazy chunk; allow retry after pre-viewer failure, never recreate an existing singleton |
| `dev/assets/js/warzone-map-bridge.js` | `getMapOverlayContainer`, `mountMapAssetOverlay`, `presentMapAssetOverlay` |
| `dev/assets/js/warzone-map-manager.js` | `initWarzoneMapManager`, `select`, `showSelection`, `restoreCesium`, `switchMode`, camera transfer helpers and diagnostics |
| `dev/assets/js/warzone-asset-focus-controller.js` | `resetWarzoneCameraReference` Tactical guard; `resume` shared lifecycle restoration without native RAF work |
| `dev/assets/js/warzone-live-airforce.js` | Existing overlay mount/control callbacks, mode button synchronization, `getFocusedRoutePositions`, `getRouteScreenFadeDistanceMeters`, aircraft adapter model/pose/trail/label/presentation/snapshot/selection/resume |
| `dev/assets/js/warzone-live-naval.js` | Existing overlay mount/control callbacks, mode synchronization, `requestNavalRenderBatched`, `clearNavalVessel`, naval adapter camera/label/presentation/selection/resume |
| `dev/assets/js/warzone-mil-sats.js` | Satellite adapter snapshot memoization and removal of unused Tactical GLB descriptor; native propagation/focus/model algorithms unchanged |
| `dev/assets/js/warzone-tactical-map.js` | `addOperationalLayers`, `createTacticalMap`, `refresh`, invalidation/scheduling, selection, overlay projection, culling, model/trail handoff and disposal |
| `dev/assets/js/warzone-tactical-models.js` | Loader acquire/release, canonical pose handling, model attachment/scaling, shared-context trail rendering, screen anchors, diagnostics and cleanup |
| `dev/assets/js/warzone-tactical-style.js` | Remove paint assignment to deleted replacement selection-ring layer |
| `dev/assets/js/warzone-startup-diagnostics.js` | Bounded failure collection, source-notification timing, resource/measures and existing operational diagnostics aggregation, teardown |
| `dev/assets/css/warzone-tactical-map.css` | Stop hiding original focus UI; remove replacement selection-panel styles |
| `docs/tactical-operational-compatibility.md` | This investigation and verification handoff |

Existing unrelated dirty work, production output, dependency manifests, `root.css`, `essential.js`, native `warzone-globe.js`, original models, formation presets and legacy tuner feature flags were not edited in this correction. Existing dark cartographic variables remain exposed through `root.css`. The four formation presets remain in their original module, whose simulation timer is conditional on an active formation.

## Performance changes and diagnostics

Incoming original registry events invalidate Tactical batches; listeners are removed with the renderer. Unchanged periodic scans are skipped unless the enabled orbital layer needs time-based positions. Propagation snapshots reuse the existing algorithm and satrec cache, at most once per second per visible-record set. Models load only for focused contacts and visible, explicitly active formations. Idle template caching remains bounded; abandoned requests abort, failed entries can be retried after release, mixers/skeletons/trail buffers are cleaned up, and Draco workers are released after the last Tactical layer and in-flight load finish. GPU resources are released with the MapLibre-owned context; Three never loses that shared context independently.

Development-only inspection entry point:

```js
window.__stratopsStartupDiagnostics()
```

The result includes HTML navigation, JS/API resource transfer durations, StratOps startup/import measures, first aircraft/naval registry notification times, existing pipeline/subscription/timer diagnostics, orbital diagnostics, bounded long tasks, failed script/chunk URLs, last switch error/latency, renderer/context counts and Tactical frame samples. Model diagnostics separate download from decode/parse time and report Three geometry/texture/draw counters. These counters are not GPU byte measurements or a complete browser-wide context/worker census. Resource-to-module timing includes scheduling/dependency evaluation; exact JS evaluation requires a Performance trace. First registry notification is not proof of a completed tracker initialization. Orbital readiness is exposed through its existing loading/record diagnostics, not a new fabricated initialization duration.

## Manual verification instructions (not executed)

1. Restart the existing development server manually after config changes. Open DevTools with Preserve log and Disable cache, then reload once. Do not evaluate fresh source using an old already-loaded Webpack runtime. Record `[dev-timing]` separately from the Network HTML/scripts waterfall.
2. Capture a Performance trace from navigation through first map interaction. Record `window.__stratopsStartupDiagnostics()` before and after enabling Air, Naval and Orbital. Compare API response/normalization/UI stages and subscription counts. Repeat with a warm browser/cache and note Wi-Fi/mapped-drive conditions.
3. Focus a known exact aircraft, helicopter, unknown aircraft and vessel. Confirm matching GLB requests, model identity, authored origin/waterline, heading/roll, scale and materials. Compare cyan X indicators, label placement, controls and trails with Satellite. Pan/rotate/zoom, then Unlock. Check occlusion, antimeridian history and depth at aircraft altitude. Verify no selected-icon remains over a successfully rendered GLB.
4. Activate each formation independently and together. Verify every member/model, location, movement, speed/spacing, focus and Clear; inactive presets must not run simulation updates. Check that culling does not drop members after camera movement settles. Do not enable the legacy tuner.
5. Focus exact satellite IDs from multiple region accordions. Confirm native handoff, original orbital model/path/camera and selection identity. Switch to Tactical overview and re-focus the same satellite. No second propagation library or representative satellite should appear.
6. Switch modes repeatedly with selections and enabled layers. Confirm one persistent Cesium viewer, one active render loop, stable camera context, no loader/onboarding replay, no duplicate subscriptions/listeners, and bounded model/heap growth. Expect two allocated engine contexts after returning to Tactical once Cesium exists, but only one active renderer.
7. For a chunk failure, record the exact Request URL, status, response MIME/body and timing. Asset failures must be actual 404s rather than fallback HTML. Inspect `map.lastSwitchError` and `failures`. Restore connectivity and retry Satellite; no full-app reload or timeout increase is part of the recovery path. A failure after native viewer creation intentionally does not recreate it automatically.
8. Measure active-navigation frame duration/FPS and main-thread long tasks with multiple layers and thousands of contacts. Idle gaps are excluded from the small Tactical rendered-frame sample, so it is not a 60-FPS benchmark. Inspect actual GPU/worker activity in browser tooling. No throughput or performance target has been verified.

Reference: MapLibre's official [globe Three.js example](https://maplibre.org/maplibre-gl-js/docs/examples/globe-3d-model/) and the installed 5.24 globe/mercator transform sources were inspected. The supplied OSIRIS page was read as a reference; no visual-parity claim or copied assets are involved.
