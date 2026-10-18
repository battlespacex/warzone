# Local startup investigation and diagnostics

This is a source-only implementation report. No build, test suite, application,
browser, deployment, dependency installation, or process inspection was run.
Read-only node --check parsing passed for the fifteen changed JavaScript/config
files, and git diff --check passed. Performance figures below are asset metadata,
not measured application timings.

## Findings supported by source

- Development previously ran the same CopyWebpackPlugin asset-copy pipeline as
  production: the entire Cesium build, model/image/font trees, videos, and PDF
  assets. Dev Server also served and watched several of these directories.
  One intro video is 59,749,063 bytes. The 64 GLBs together are only 626,800 bytes;
  their file sizes do not support blaming large model downloads for this delay.
- Webpack had no filesystem cache and Babel had no persistent transformation
  cache. Babel already excluded node_modules; third-party Babel processing was
  not an established cause. Its scope is now explicitly frontend/shared source.
- The source and dependency reads are on a network-backed mapped drive.
  Metadata scans, cold module resolution and reads can be slower there. Dropbox
  sync, antivirus, online-only files and SMB behavior have not been measured.
- Static asset watching included binary trees, while generated output and
  Dropbox metadata had no explicit compiler-watch exclusions.
- The default operational boot created Cesium and awaited its first usable
  frame before initializing Tactical. The post-entry hook then created a second
  renderer and paused Cesium. Tactical therefore paid the viewer initialization
  cost of an engine it did not initially use.
- Initial theater warm-up requested GLBs and background assets even without a
  focus request. That call is removed from entry; models load through the
  existing focus and formation code.
- Development aircraft proxy requests had an unbounded shared in-flight promise.
  API reads probed multiple upstreams sequentially without request deadlines or
  cancellation after the browser disconnected. A stalled host could retain work
  or delay fallback despite a completed frontend compilation.
- The old navigation-start mark was created only after static imports and module
  evaluation, so its name concealed earlier resource/evaluation delay.
- The previously reported five Three.js errors share one missing package cause.
  At this inspection three 0.169.0 is installed and matches the existing manifest
  and lockfile. All five referenced package/addon files exist, and the package
  export map supports the addons paths. No further dependency edits or installs
  were necessary in this task. This is not a successful Webpack compilation claim.

These findings do not prove the complete cause of a 30-60 minute browser delay.
The supplied approximately nineteen-second compilation figure is not a browser
startup measurement. Repeated reloads, pending requests, JavaScript evaluation,
WebGL failures and external CPU/I/O contention still need a captured run.

## Development pipeline changes

Webpack's filesystem cache and Babel cache now use a checkout-specific directory
under LOCALAPPDATA/StratOps/webpack-cache, or the OS temporary directory fallback.
STRATOPS_WEBPACK_CACHE_DIR can override it. Configuration, dependency manifests
and the active environment file participate in cache invalidation.

Development no longer instantiates CopyWebpackPlugin or scans/cleans production
output. Static assets come directly from dev/assets and installed dependency
directories; compiled files stay in Dev Middleware memory. Production copying,
minification and output cleanup retain their original paths.

Production-only minimizer/copy plugin packages are required only for production.
Development uses external cheap-module-source-map maps, deterministic module and
chunk identifiers, and a shared Cesium vendor chunk. Static JS/CSS watching does
not independently reload code already watched by the compiler. Generated output,
node_modules, Dropbox metadata, cache directories, logs, temporary files and large
binary extensions are excluded as appropriate. Replacing a GLB/video now requires
a deliberate refresh; ordinary source/HMR watching remains active.

PDF worker .js URL compatibility is retained by an explicit route to the installed
.mjs file. Cesium and Draco static URLs no longer depend on an old production copy.

These choices follow Webpack's cache, watch and build-performance guidance:
https://webpack.js.org/configuration/cache/
https://webpack.js.org/configuration/watch/
https://webpack.js.org/guides/build-performance/

## Browser initialization changes

The normal region-confirmation path starts the selected map manager directly.
With the default Tactical preference it creates MapLibre and waits for an actual
render with operational layers installed. It does not construct a Cesium Viewer
or wait for optional API, imagery, terrain or GLB data before entry completes.
The explicit empty-Cesium diagnostic path and saved Satellite preference remain.

A memoized ensureSatelliteViewer factory creates one persistent Cesium viewer on
Satellite selection. The same viewer is reused on subsequent switches. Tactical
updates, model rendering and rotation pause while Satellite is initializing;
failed switches resume Tactical and stop a partial viewer's render loop.

Aircraft/naval ingestion, snapshots, widget updates and orbital data can operate
before the viewer exists. Viewer-specific listeners and tools attach once when
it arrives. No new feed polling pipeline or subscription was added. Existing
singleton polling and queue guards remain. UI/region bindings and post-entry
actions gained guards to avoid duplication during delayed attachment.

The existing Tactical GLB renderer, exact/fallback model mappings, live movement,
formation controls, 2D/3D view controls and camera focus/unlock remain. Tactical
altitude and rotation use the active map API/render lifecycle. Optional base data
loads when requested, retaining authentication gating. Capture and AOI clicks
load their existing Satellite tools on demand. GLBs are requested only for focus
or enabled formations, never by entry prewarming.

Important limit: Cesium math/types remain statically imported by shared tracker,
region and focus utilities. The Cesium library can still be downloaded/evaluated
as an initial vendor chunk, even though no Viewer, imagery or Cesium workers need
initialize in default Tactical. This change does not claim to remove every byte
of Cesium from first navigation. Profile that shared-library cost before a broader
utility/module split. Existing introduction/dashboard transitions also remain.

## Development proxy behavior

The aircraft shared fetch now has a deadline so its finally block can release a
stuck in-flight promise. GET/HEAD API attempts get deadlines and cancellation on
browser disconnect. The default read deadline is eight seconds per upstream,
configurable with STRATOPS_DEV_READ_TIMEOUT_MS in the shell environment.

Explicit API_UPSTREAM_URL is tried first. The last successful read target is
preferred per route for thirty seconds, then the original priority is retried so
a newly started local API can take over. Unavailable targets can still fall back. Authentication
and billing write requests retain their existing request/retry behavior. Report
downloads are exempt from the metadata-read deadline and retain disconnect
cancellation. No loader timeout was added.

## Exact files and functions changed in this task

| File | Changes |
| --- | --- |
| webpack.config.js | Development cache/Babel/watch settings; static serving; production-only plugin loading/copying; timing hook; API/feed read lifecycles |
| dev/pages/index.html | Development-only early diagnostics injection |
| dev/assets/js/index.js | Navigation/module marks; ensureSatelliteViewer; initializeSatelliteTools; deferred tool launchers; selected-renderer boot; background operational initialization; lazy poster |
| dev/assets/js/essential.js | attachWarzoneAppViewer; viewerless map-data sync/viewport bounds; region callbacks; deferred orbital init; post-entry guard; rotation attachment |
| dev/assets/js/warzone-map-manager.js | Viewerless startup; start/ready; lazy Satellite switch; active map API; lazy base data; switch rollback |
| dev/assets/js/warzone-map-bridge.js | getOperationalMapApi |
| dev/assets/js/warzone-tactical-map.js | Actual first-frame promise; pause/resume; active camera API and rotation |
| dev/assets/js/warzone-tactical-models.js | Pause flag in custom rendering lifecycle |
| dev/assets/js/warzone-live-airforce.js | upsert/apply data guards and optional entity lookup |
| dev/assets/js/warzone-live-naval.js | upsert data guard |
| dev/assets/js/warzone-mil-sats.js | Viewerless data/widget initialization; later viewer attachment without restarting the data service |
| dev/assets/js/warzone-formation-tuner.js | Viewerless Tactical activation guard |
| dev/assets/js/warzone-region-selector.js | Operational viewerless navigation; live viewer lookup; listener guards |
| dev/assets/js/warzone-ui.js | Idempotent UI binding; active map controls; later Cesium altitude attachment; Tactical altitude |
| dev/assets/js/warzone-military-bases.js | Auth-gated Tactical data snapshots without Cesium entities |
| dev/assets/js/warzone-startup-diagnostics.js | New development resource/long-task report |
| docs/local-startup-diagnostics.md | This report and unexecuted diagnostic instructions |
| docs/tactical-globe-implementation.md | Note directing startup readers to this newer report |

Existing uncommitted CSS, model assets, tests, dependencies and production files
were not reverted, regenerated or changed by this task.

## Diagnostic instructions -- for the user to run separately

The following commands/actions were NOT executed by Codex.

### 1. Compilation and recompilation

From the actual checkout used by VS Code, start the development server once:

    npm run dev -- --no-open

Do not start npm run serve on the same port. Record the new terminal line:

    [dev-timing] compile=...ms processUptime=...ms changedFiles=... errors=...

compile is Webpack's compilation duration. processUptime also includes CLI/config
startup and is not a second compile measurement. Require errors=0 before assessing
the browser. Record the first uncached run, a second launch with the same cache,
and one source-edit rebuild. Do not delete unrelated caches to obtain a baseline.
If idle rebuilds occur, preserve their timestamps and changedFiles counts.

Optionally use an explicit upstream rather than repeated local probing:

    $env:API_UPSTREAM_URL = 'http://localhost:8080'

Use the real API location, not the frontend port. Restart Dev Server after changing
its configuration or shell variables.

### 2. Browser loading versus initialization

Open DevTools before navigation. In Network, enable Preserve log and perform one
navigation to http://localhost:4173/pages/index.html. Record:

- HTML time to first byte.
- Main and initial vendor script transfer duration/decoded size.
- JS chunks requested after region confirmation.
- Pending/failed resources and their Initiator.
- Whether the page is repeatedly reloading rather than making slow progress.

After confirming a region, obtain the development report in the Console:

    window.__stratopsStartupDiagnostics()

For a copyable report:

    JSON.stringify(window.__stratopsStartupDiagnostics(), null, 2)

The report separates completed script transfers, the gap to entry-module body,
region-to-first-map time, operational-data time and recorded long tasks. The
module-body gap includes dependency loading/evaluation and deferred-script
scheduling; it is not a pure JavaScript parse benchmark. Missing stage values mean
that stage has not completed. Pending network requests need Network inspection.

Record a Performance trace from navigation through first usable map. Use its
Evaluate Script, long-task and rendering tracks to attribute CPU work. Compare
regionToMapMs rather than total navigation time when the intro is left open.

For default Tactical (select Tactical and reload if Satellite was previously
saved), inspect:

    window.__warzoneViewer
    window.__warzoneMapDiagnostics()

The first should be absent before Satellite selection, and diagnostics should show
Tactical. GLBs/Draco should not be requested until focus or formation activation.
Selecting a Satellite-only tool explicitly switches to that mode.

The long-task observer is bounded to 200 entries and has no polling timer. Stop
observation when finished:

    window.__stopStratopsStartupDiagnostics()

### 3. Check processes without terminating them

In a separate PowerShell terminal:

    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Select-Object ProcessId, ParentProcessId, CommandLine

    Get-NetTCPConnection -State Listen -LocalPort 4173 |
      Select-Object LocalAddress, LocalPort, OwningProcess

Frontend, API and ingestion worker Node processes can all be legitimate. Confirm
which process owns 4173 and which checkout each command uses. Do not kill every
Node process. Check DevTools WebSocket/worker entries for duplicate subscriptions
or repeated page boots; source inspection alone cannot determine live counts.

### 4. Isolate filesystem effects

Compare identical first/warm compilation and browser traces in an approved local
SSD checkout outside Dropbox/SMB, with the same lockfile, Node version and API
target. That requires a user-managed checkout; Codex did not move the repository.
The local cache reduces cache writes but does not relocate source or node_modules.
Inspect Resource Monitor for SMB, Dropbox, antivirus and worker CPU pressure during
the delay. Online-only dependency/source files should be locally available.

### 5. Regression verification

Verify entry/terms/sign-in/region transitions; Tactical globe input and layers;
live aircraft/naval widgets and focused models; all four formations and sliders;
Orbital Intelligence with exact record selection; failed API/tile recovery; first
Satellite activation; Capture/AOI/terrain/contour launchers; camera zoom/follow/
unlock/rotation; and repeated map switching.

After the first Satellite switch, save its reference in the Console and compare
it after further switches:

    window.startupDiagnosticViewer = window.__warzoneViewer
    // Switch Tactical -> Satellite using the UI, then:
    window.__warzoneViewer === window.startupDiagnosticViewer

Tactical should pause that viewer's default render loop without destroying it.
Confirm subscription/polling counts do not grow across switches. A full build and
runtime regression pass remain required before relying on these source changes.

## Expected effects, not measured promises

Warm compilation should reuse cached transforms; development avoids repeated
static-asset copying and production-tree cleanup; irrelevant file activity should
cause fewer reloads; default Tactical no longer pays Cesium viewer/imagery/worker
initialization; API availability no longer gates entry. There is no evidence yet
to promise a particular number of seconds or certify the 30-60 minute issue fully
resolved. Use the separated measurements above to identify any remaining delay.
