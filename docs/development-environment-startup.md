# Automatic local/network development startup

## Scope and evidence

This change is source-only. No build, test, server, browser, worker, dependency
installation, or deployment was run. The reported 10-15 minute intervals are user
observations, not measured or reproduced benchmarks. No seconds-to-ready result
is claimed. Existing map, model, tracker, formation and production initialization
paths are not rewritten by this change.

Source-confirmed contributors and critical paths:

- Node loads Webpack CLI/config/plugins and many small dependency files from the
  checkout's `node_modules`. On Laptop B these remain SMB/Wi-Fi reads, before the
  compiler can use Webpack's persistent cache. Polling is not an explanation for
  all of this phase: Watchpack installs its watchers after the first compilation.
- The static `dev/assets` Chokidar root formerly included the entire model asset
  directory tree. Ignoring individual `.glb` files did not prune the directory
  traversal. Inherited terminal settings forced polling even on local disks.
- Development ran Babel preset-env over application code and generated separate
  cheap-module source maps. The launcher opens modern Chrome; development now
  uses native supported syntax and a lighter source-map profile. Production Babel
  transformation and browser compatibility settings are unchanged.
- `index.js` statically imports `essential.js`, whose Cesium imports enter the
  initial dependency graph even though native Viewer construction is deferred.
  Development previously did not analyze used exports. Enable export analysis
  to let declared side-effect-free unused dependency exports be skipped. This is
  not equivalent to eliminating Cesium from compilation or the entry graph.
- `pages/index.html` loaded external Google Fonts CSS as a blocking stylesheet.
  Deferred application scripts wait for blocking stylesheets. A slow CSS response
  could therefore delay initialization, even after local JS has downloaded. Only
  development now loads this CSS non-blockingly; the same fonts still apply.
  See [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event).
- The current region-confirmation path awaits map setup, then schedules optional
  operational data. Tactical Map does not await live trackers, orbital feeds or
  initial GLB library downloads. Cesium Viewer creation is already lazy/singleton.
  No source evidence establishes duplicate Node servers, a hanging API promise,
  or a specific WebGL/worker failure as the cause of the reported minutes.
- CopyWebpackPlugin and production minifiers were already excluded from
  development; they are not reintroduced. Dynamic imports still participate in
  compilation. No experimental lazy compilation, feature removal or loader
  concealment is used.

## Automatic configuration

Run the usual `npm run dev` when runtime verification is authorized. No new
dependency, installation, administrator permission or permanent environment
change is required by this patch. Existing project dependencies must be installed.

`scripts/dev.cjs` configures the environment before requiring Webpack CLI, and
invokes the installed CLI in the same Node process. Extra `npm run dev -- ...`
arguments and normal CLI shutdown/error handling remain available. It does not
start the API/data worker or another persistent Node process.

`scripts/dev-environment.cjs` recognizes Windows UNC paths immediately. For a
non-system Windows drive letter it queries the OS mapping table with `net use
<drive>` (no shell, recursive scan or server ping; one-second timeout). A mapping
selects the network profile; an unmapped drive selects local. An unavailable or
timed-out query selects conservative polling. Linux recognizes NFS/SMB/FUSE;
other POSIX filesystems default to local. Exotic network mounts on other OSes
can explicitly select the network profile if needed.

| Location | Watchpack | Unbundled asset Chokidar | Source maps |
| --- | --- | --- | --- |
| Laptop A, local checkout | Native events | Native events | eval-cheap-module-source-map |
| Laptop B, mapped Z: / UNC | 2000 ms polling | 2000 ms polling | eval, module sourceURL only |

Two seconds is a conservative polling default, not a measured optimum. It avoids
the previous one-second global forcing. Source polling still incurs network I/O
and adds up to approximately one interval before recompilation begins.

Old WATCHPACK/CHOKIDAR polling variables are removed only inside the launcher
process, so they cannot override these explicit profiles. Your terminal and OS
environment are unchanged. Optional overrides are `STRATOPS_DEV_FILESYSTEM`
(`local`/`network`) and `STRATOPS_DEV_POLL_MS` (1000-30000). Neither is required
on the two Windows laptop configurations described above.

Webpack filesystem cache and optional Node 22.8+ bytecode cache use a per-checkout
directory under local user cache storage (Windows LOCALAPPDATA, then local profile
cache/temp fallback). Cache candidates are checked for a local filesystem,
writability, checkout containment and Dropbox/OneDrive locations, including
resolved existing ancestors. An explicit STRATOPS_WEBPACK_CACHE_DIR must also
meet these rules; an invalid override fails with an actionable error. Node's
optional cache status is logged; a pre-existing NODE_COMPILE_CACHE setting may
already have enabled Node caching before the launcher and takes precedence in
Node itself. Webpack's cache selection is independent. Node bytecode caching may
make the first load slower; it targets subsequent unchanged dependency loads.

Development output uses a local cache subdirectory and remains in memory
(`writeToDisk: false`). Production output/copying/minification are unchanged.
Compiled JS, CSS, HTML/partials and SEO dependencies remain compiler-owned.
Chokidar watches only `dev/public` and `dev/assets/images`; it prunes the
`images/models` subtree. Static URLs for fonts, audio, videos, GLB, Cesium,
Draco, PDF and generated tiles remain available, without recursive watching.
Changes to unbundled audio/font/video/binary assets require a manual browser
refresh; source JS/CSS/HTML retains hot/live reload. Outside-project paths,
node_modules, production/dist/build, generated output and Dropbox metadata are
excluded. No drive-root watcher is added.

## Verification instructions (not executed)

1. On each laptop, start `npm run dev` without setting polling variables. Confirm
   `[dev-env]` reports local/native on A and network/polling on B, and a local
   cache path. Record a cold run and a subsequent warm run, without deleting
   caches or touching production files.
2. Save the `[dev-timing]` lines: launcher-start, environment-ready, config-enter,
   config-requires, compiler-created, server-listening, watch-run and compile.
   The environment-ready/config-enter gap isolates CLI loading, not compilation.
   `compile` is Webpack's stats interval; `watch-run-to-done` is a hook interval.
   These spans overlap and must not be added. Module graph/sealing spans and the
   five slowest build/resolution spans show where to investigate next; concurrent
   spans are elapsed waiting time, not exclusive CPU time. Initial asset bytes
   cover all entrypoints uncompressed, not this page's actual network transfer.
3. In Chrome DevTools record Network and Performance while reloading
   `http://localhost:4173/pages/index.html` and following normal onboarding.
   Inspect document TTFB (may include waiting for compilation), pending requests,
   JS/CSS transfers, script parse/evaluate tasks, main-thread long tasks, map
   style/tile requests, WebGL errors and worker activity. Keep cold and warm
   browser-cache runs separate from cold/warm compiler-cache runs.
4. In the browser console collect `window.__stratopsStartupDiagnostics()`.
   `scripts` measures transfer/resource durations; `staticDependencyExecutionMs`
   brackets initial static-dependency execution, not full JS parsing/evaluation.
   Full evaluation requires the Performance trace. Tactical module-loading and
   manager-to-map spans separate imports from renderer readiness. `regionToMapMs`
   excludes earlier onboarding think-time; navigation-to-map includes it and is
   not a browser TTI metric. Tracker stage timing is relative to its own toggle
   or enable event, distinct from first registry notifications. Null means the
   measured stage has not occurred. Pending requests require Network, not the
   completed-resource list. Cross-origin resource details may be restricted.
5. Verify JS/CSS/partial edits rebuild once, idle watchers do not continuously
   recompile, GLB/metadata changes do not rebuild, and only one dev server runs.
   Verify entry/onboarding, map switching, one persistent Cesium Viewer, camera
   state, Air/Naval tracking, Orbital Intelligence, exact GLBs and Formation Dev
   Tuner. No regression or performance pass has been claimed here.

If the CLI/dependency-read phase still dominates, Wi-Fi SMB latency remains a
hard limit: configuration cannot make remote node_modules local. A local SSD
checkout/dependency installation on Laptop B, running Webpack on Laptop A, or a
wired connection are follow-up deployment/workspace choices, not actions taken
by this patch. The separate live worker was not changed or stopped.
