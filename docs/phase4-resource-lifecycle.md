# Phase 4: feature resource lifecycle

2026-10-19. Workspace: `C:\DX\warzone-recovery`. Implementation and focused
automated verification completed. Phase 5 has not started.

## Root causes and corrections

Several existing OFF paths removed visuals but retained feature-owned input or
scene callbacks. Some outstanding requests could complete after OFF, update
controls, normalize records, or interfere with the next ON request. Hidden
Cesium data sources also remained attached to DataSourceDisplay, whose update
loop still visits attached visualizers. These are distinct ownership gaps, not
a reason to stop shared collection services or recreate the Cesium viewer.

### Exact application files and functions changed

All paths in this table are under `dev/assets/js/`.

| File | Functions and behavior |
| --- | --- |
| `warzone-animation-scheduler.js` | `unregisterAnimationTask`: cancel the outstanding animation frame when the final task is removed. |
| `warzone-live-airforce.js` | `syncLiveTrackRenderPopulation`, `bindFocusInteractionTracking`, `bindLiveTrackOverlay`, `bindLiveTrackPicking`; new runtime event/scene binding and unbinding helpers: OFF removes picking, inputs, camera callbacks, focus tasks and queued frames/timeouts; existing guarded population paths restore ON. `getLiveTrackDiagnostics` exposes runtime ownership. |
| `warzone-air-ingestion.js` | `fetchAirplanesLiveRecords`, `refreshPublicAirTracks`, `schedulePublicAirPoll`, `startPublicAirIngestion`, `stopPublicAirIngestion`: reject obsolete completions, abort requests and prevent old poll generations from restarting after rapid OFF/ON. |
| `warzone-mil-sats.js` | `fetchOrbitalData`, new `stopOrbitalFetch`, `cleanupLayer`, `handleVisibilityChange`, `setWarzoneMilSatsEnabled`, `initWarzoneMilSats`, diagnostics: abort pending work, remove satellite focus tasks, guard late controls/data updates and restore cached records immediately on ON. |
| `warzone-aoi-lens.js` | Initialization, activation, close/setEnabled, canvas/visibility binding, panel observer, summary/base scan and data-source visibility paths: detach owned listeners/observer OFF, cancel restoration timeout and invalidate unfinished scans. ON binds once. |
| `warzone-realtime.js` | `subscribeToSirenBroadcast`, new `syncSirenBroadcastSubscription`: one siren channel, removed OFF; rapid ON waits for actual unsubscribe completion, not an arbitrary delay. Shared events channel remains. |
| `warzone-siren-alert.js` | Layer-change hook and `showSirenAlert`: OFF clears alert timers and pauses audio; disabled operational alerts cannot restart it. Explicit development preview remains separate. |
| `essential.js` | GNSS visibility/refresh, new `stopGnssInterferenceRefresh`, diagnostics; aircraft history refresh, progressive normalization, new `stopAircraftHistoryRefresh`, `stopAircraftLiveSync`: abort requests and queued normalization frames, guard ownership, retain caches for re-enable. |
| `supabase.js` | `getGnssInterferenceCells`, `getAircraftTracks`: forward optional AbortSignal through HTTP and aircraft SQL requests; existing callers without options retain behavior. |
| `warzone-globe.js` | Label visibility/zoom-controller binding, labels/raised-region/border loading and setters; new controller teardown and shared country-geometry read: detach optional sources OFF, stop label calculations, discard obsolete geometry completions and reuse cached records/metadata ON. |
| `warzone-gnss.js` | `ensureDataSource`, `renderGnssInterferenceLayer`, `clearGnssInterferenceLayer`: only attach the optional source while active; detach after clearing OFF. |
| `warzone-data-source-lifecycle.js` (new) | `setDataSourceActive`: retain parsed data while detaching visualizers; serialize asynchronous collection attachment and honor the latest ON/OFF state without duplicate sources. |

New tests: `apps/worker/test/feature-resource-lifecycle.test.js`.
This report and the checkpoint link are the Phase 4 documentation changes.
The build regenerated hashed output under `production/`; unrelated pre-existing
source/CSS changes and earlier renderer-removal work were not reverted.

## Ownership audit: retained working lifecycle paths

- Naval already removes vessel render entities/animation tasks, focus and runtime
  handlers OFF and restores cached records ON; no Phase 4 edit was needed.
- Military tracks already clear cleanup timers, track timeouts and entities.
- Bases already destroy their data source/unbind runtime when neither the layer
  nor an active shared CTR highlight needs them.
- Sweepers/ranges already remove their animation tasks and visual population.
  Hotspots already cancel renders and detach runtime listeners/observers.
- Event-category filters reconcile marker populations and stop invisible pulses.
  Shared event collection/status feeds remain necessary for enabled consumers.
- Airspace/cyber widgets skip ranking when disabled. Satellite observations use
  shared event records rather than a separate feature polling process.
- Cesium's single viewer, camera, required terrain/imagery and shared internal
  worker pool remain intact. No feature-owned `new Worker` construction was found
  in application JavaScript. No backend collection service was changed.
- Lightweight layer-state hooks, cached records and explicit development tools
  remain intentionally available; OFF does not mean deleting shared services.

## Deterministic before/after activity probes

These are counts from source-function regression probes, not browser CPU/FPS,
GPU, memory or live network benchmarks. The data-source race test additionally
uses the installed real Cesium DataSourceCollection.

| Disabled resource | Before | After |
| --- | ---: | ---: |
| Aircraft picking handlers / input listeners / scene callbacks / focus tasks | 1 / 17 / 3 / 2 | 0 / 0 / 0 / 0 |
| AOI drawing input listeners | 6 | 0 |
| Orbital late completion control updates | 1 | 0 |
| Siren subscriptions after repeated subscription calls while OFF | 40 | 0 |
| Shared events subscription in the same probe | 1 | 1 |
| Alert audio timers | 1 | 0 |
| GNSS normalization after OFF | 1 | 0 |
| Attached labels/raised-region/border sources | 4 | 0 |
| Label calculations over 100 simulated rendered frames while OFF | 100 | 0 |
| Pending final shared animation frame after last task removed | 1 | 0 |

Additional probes verify aborted request signals, no obsolete polling-chain
restart, aircraft history batch cancellation, and fresh ON request ownership.
Twenty-cycle checks cover listener/task/data-source restoration without growth.
Parsed caches remain available instead of being re-fetched unnecessarily.

## Verification

- All 12 changed/new application JavaScript files and the new test passed syntax
  checks. Targeted `git diff --check` passed (line-ending notices only).
- Focused lifecycle tests: 17 passed. Latest combined lifecycle and tracker-focus
  responsiveness run: 22 passed, zero failed.
- Broader targeted scheduler, hotspot, geometry, imagery, capture, UI, realtime,
  radar and zoom regression run: 111 passed before the final history cancellation
  addition; that final addition is covered by the subsequent 22-check run.
  Four previously documented baseline cases were explicitly excluded from the
  broad run; the entire worker suite is not claimed green.
- `npm run build` passed after all application edits: Webpack compiled
  successfully in 29,061 ms. An earlier verification build also passed.
- Phase 4 has not been authenticated-browser validated. The user's earlier Chrome
  confirmation establishes original globe rendering, not these new OFF/ON paths.
  Live aircraft/naval/Orbital Intelligence toggles, Focus/model appearance,
  onboarding continuity, authentication, camera/loader stability and real CPU/GPU
  or network activity still need a matched browser smoke/profile run. Automated
  probes are not a substitute for that evidence.

## Remaining manual check

In authenticated Chrome on the intended laptop, use the same region and data:
toggle each affected layer OFF/ON repeatedly, including while requests are in
flight. Check Network for feature-owned requests/subscriptions stopping OFF;
use the existing aircraft, orbital and performance diagnostics to check counts.
Exercise aircraft/naval Focus and exact supported models, Orbital Intelligence,
GNSS, AOI, labels, borders and raised regions. Confirm the same viewer/camera is
retained and no loader or onboarding restart occurs. Record equal-duration
Performance traces OFF versus ON; shared intelligence activity should remain.

Stop after Phase 4. No Phase 5 work is authorized by this report.
