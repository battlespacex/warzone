# StratOps combined integration and release assessment

Checked 2026-11-15 in `C:\DX\warzone-recovery`. **Both implementations are present and integrated in this working tree. Ready for isolated staging validation; production promotion remains blocked by the acceptance items below.** No application correction or architectural change was needed during this check. Only this consolidated report and ignored local validation/release artifacts were created. Existing source changes were preserved. No deployment, push, reset, AWS mutation, database write or environment-file change occurred.

## Git baselines and overlap

| Implementation | Baseline | Present state | Changed files |
| --- | --- | --- | ---: |
| GNSS raster, owned cleanup, independent layers, Basemap/Borders, GLB restoration/delivery gates | `e57fd541b364600c93427de61dcfae43886917f2` | Committed together in current HEAD `c47a1be3ef02a5fd818d1574915e7562a3aa40cd` | 37 |
| Orbital performance, shared Air/Naval identification, diagnostics and aircraft registry | `c47a1be3ef02a5fd818d1574915e7562a3aa40cd` | Current uncommitted working changes, including new files | 29 |

`e57fd541` is an ancestor of `c47a1be3`. There are no unmerged index entries. The two lists overlap in exactly three files:

- `dev/assets/js/warzone-mil-sats.js`: the newer performance work extends the earlier UTC position fix, distance visibility, bounded construction, shared rendering and cleanup. The earlier fixes remain; the focus-camera algorithm, GLB mapping and decorative implementation were not replaced.
- `apps/worker/test/orbital-performance.test.js`: existing UTC/model/cancellation/lifecycle tests remain, with additional cache/input/detail-row checks and async-batch harness support.
- `apps/worker/test/feature-resource-lifecycle.test.js`: two scheduler/performance bindings were added to the orbital source-extraction harness. GNSS cleanup and request-generation tests remain.

The other 34 first-set files are unchanged from `c47a1be3`, including every GNSS runtime/API/test/build integration file, layer policy, imagery ownership code, Air/Naval renderers, sizing corrections and deployment gates. SHA-256 snapshots of all files in both original lists showed **zero implementation-file changes during this audit**. No conflicting or overwritten implementation was found. The exact lists are below and in `git-integration.json` under the evidence directory.

## Combined behavior checked

The focused 109-test integration group covers raster-layer disposal and stale request completion, real raster descriptor/palette/filter/period/lookup behavior through the API suite, repeated independent GNSS/Air/Naval/Orbital toggling, Basemap/Borders compensation, overlay ownership, tracker restoration, source/identity conflicts, CSS sizing, orbital UTC/sample reuse, input deferral and resource cleanup. These are source/Node/local HTTP checks; they do not replace authenticated desktop acceptance.

Preservation evidence:

- Operational GNSS still uses the raster adapter; OFF disposes its owned imagery/lookup resources and ignores legacy geometry retention. Basemap replacement does not call global `imageryLayers.removeAll()`.
- GNSS, Air, Naval and Orbital remain independently selectable. Both base layers OFF is prevented, while operational toggles preserve the selected basemap state.
- All original GLB files and root.css sizing bytes are untouched. All 64 models pass build byte/hash checks plus geometry/decoder and local HTTP delivery tests.
- Aircraft/Naval renderer files, focus-controller/camera controls, startup/onboarding/auth code, decorative satellites and the shared Viewer initialization were not edited by this check. The existing local tests cover nearby lifecycle behavior; no new browser claim is made.
- Identification keeps the full six-character ICAO24, source provenance and conflicts. Registry records do not create live positions. Naval MID/prefix/type evidence stays separate from verified identity and specialized GLB selection.

## Worker/API deployment contents

The existing `scripts/deploy-production.ps1` publishes **frontend S3 assets only**. It does not deploy worker/API source or the aircraft registry. A frontend-only deployment is therefore insufficient for this combined release.

A local review archive was prepared at `.generated/final-integration-20261115/server-release.tar`. It contains the current API source, worker source, shared modules, the complete aircraft-data directory and API/worker package/lock files, preserving their repository-relative layout. It excludes environment files, runtime caches and node_modules. The archive is a private local release artifact, not a deployment action or a replacement for the existing server release process.

All **133 extracted files** were compared byte-for-byte/hash against the working tree. The archive includes:

```text
apps/api/src/gnss-raster.js
apps/api/src/gnss-gpsinterference.js
apps/api/src/routes.events.js
apps/shared/gnss-geometry.js
apps/shared/aircraft-identity.js
apps/shared/naval-identity.js
apps/worker/src/tracking/aircraft/providers/plane-alert-db.js
apps/worker/data/aircraft/.gitattributes
apps/worker/data/aircraft/LICENSE
apps/worker/data/aircraft/NOTICE.md
apps/worker/data/aircraft/plane-alert-mil.csv
apps/worker/data/aircraft/plane-alert-mil.csv.manifest.json
```

Loading the actual provider module from the extracted worker archive, with a fetch implementation that throws on any network request, successfully initialized **9,854 records**. The pinned manifest and CSV agree:

- Upstream commit: `f7b46dbdeb29ea01c43eca2db21940d60fa7f36e`.
- CSV SHA-256: `3e619fe9549a01ea58f3d884b1e1c86acbb67d284212fc9879a07c5b52a9c099`.
- Git blob: `c9a44640aeee5e9bc3856e49af0170148a588224`.
- 9,856 input rows; 9,854 valid IDs; zero duplicates; two rejected malformed IDs.
- `.gitattributes` disables line-ending conversion for the original CSV.
- Archive SHA-256: `8409425eb4032e22fb6eaf5a007d5d79b17359f645629f52642766ac0f29986f`.

The raw registry is absent from the built frontend. New identification files/data are still untracked in Git; an eventual Git-based server deployment must explicitly include them in its reviewed release. They must not be omitted merely because tracked-file diffs look complete. No remote worker directory or deployed registry was inspected.

## Fresh validation results

All evidence in this section was generated for the combined tree during this integration check. Counts are separate invocations and overlap; do not add them together.

| Check | Result |
| --- | --- |
| Focused combined integration group | **109 passed, 0 failed** |
| All API tests | **81 passed, 0 failed** |
| All script tests | **56 passed, 0 failed** |
| PowerShell deployment safety | **19 mocked scenarios passed**, no AWS operations |
| Full current worker suite | **660 tests: 608 passed, 52 failed** |
| Fresh isolated `c47a1be3` worker baseline | **646 tests: 594 passed, 52 failed** |
| Failure comparison | Same 52 failing names, zero baseline-only or current-only failures; all 14 additional tests pass |
| Production webpack build | **Passed in 93,314 ms**, real config with output-only wrapper |
| Cesium integrity | **392 assets passed**, release `1.143.0-4106863949fcb3b1-standard` |
| Frontend integrity | **24 JS/CSS assets passed** |
| Model integrity | **64 GLBs passed** |
| Final-build model decoder/local HTTP tests | **2 passed**, all 64 model URLs/bytes checked |
| Deployment `-SkipBuild -ValidateOnly` | **Passed**, no build or AWS requests |
| Changed/new JavaScript syntax checks | **23 passed** |
| Git whitespace and preservation checks | Passed; no implementation bytes changed by this audit |

The fresh baseline was read using `git archive c47a1be3` into an ignored directory, with references to the existing dependency/static-asset directories and a local environment preload. No checkout, restore or reset was performed. An initial incomplete archive lacked template/data support files; it was completed before the baseline results above. This is stronger evidence than comparing only with the older saved logs. It still does not prove the full application has no regression outside executable coverage.

## Remaining failures

The suite is not green. All 52 failures reproduce at the same test names on the committed first-set baseline. They break down as **7 browser availability failures, 19 missing harness-reference failures and 26 assertion failures**. Some assertions encode older CSS/UI expectations; others require separate investigation. They were not changed, skipped or reclassified as passing to obtain this result.

| Failing test file under `apps/worker/test/` | Count | Immediate failure kind |
| --- | ---: | --- |
| `aircraft-focus-category-altitude.test.js` | 1 | CSS/category assertion |
| `aircraft-jitter.test.js` | 1 | Missing `__liveTrackAoiFreeze` harness reference |
| `aircraft-trajectory-turns.test.js` | 1 | Trajectory/banking assertion |
| `audio-disabled.test.js` | 1 | Missing webpack build define |
| `ctr-grid-motion.test.js` | 1 | Chrome launch `spawn EPERM` |
| `ctr-radar-rendering.test.js` | 1 | Chrome launch `spawn EPERM` |
| `ctr-radar-scaling.test.js` | 1 | Extent/spacing assertion |
| `ctr-surface-anchoring.test.js` | 2 | Missing draw-matrix harness reference |
| `dev-visual-inspection.test.js` | 2 | Feature-flag/source assertions |
| `event-marker-visual-quality.test.js` | 1 | CSS expectation |
| `focused-asset-geometry.test.js` | 1 | CSS expectation |
| `hotspot-anchoring.test.js` | 1 | Missing webpack build define |
| `incoming-event-batching.test.js` | 2 | Event batching assertions |
| `intel-wire-refresh.test.js` | 1 | Chrome launch `spawn EPERM` |
| `intelligence-normalizer.test.js` | 3 | Normalization assertions |
| `mobile-focused-model-sizing.test.js` | 1 | Chrome launch `spawn EPERM` |
| `mobile-warning-feature-flag.test.js` | 1 | Feature-flag assertion |
| `mobile-widget-collapse.test.js` | 1 | Chrome launch `spawn EPERM` |
| `operational-presentation.test.js` | 1 | Missing webpack build define |
| `radar-sweeper.test.js` | 4 | Existing visual/shader/CSS assertions |
| `report-html-viewer.test.js` | 3 | API/UI/CSS assertions |
| `reporting-pdf.test.js` | 1 | Browser executable unavailable |
| `runtime-animation-scheduler.test.js` | 1 | Render coalescing assertion |
| `stratops-map-style-switch.test.js` | 1 | Basemap configuration assertion |
| `stratops-realtime-performance.test.js` | 2 | Snapshot/camera assertions |
| `stratops-realtime-queue-correctness.test.js` | 2 | Missing aircraft harness reference |
| `tracker-ctr-cleanup.test.js` | 5 | Missing entity-position harness reference |
| `tracker-domain-integration.test.js` | 1 | Older focused-sizing CSS assertion |
| `tracker-priority-mode.test.js` | 1 | Missing webpack build define |
| `tracker-runtime-lifecycle.test.js` | 6 | Admission/identity/aircraft harness references and an assertion |
| `tracker-widget-stability.test.js` | 1 | Chrome launch `spawn EPERM` |

Exact test names, locations and error messages: [remaining-failures.json](../../.generated/final-integration-20261115/remaining-failures.json). Baseline correspondence: [baseline-failure-comparison.json](../../.generated/final-integration-20261115/baseline-failure-comparison.json). No newly failing automated test was found; this is not a waiver of the existing failures.

## Release readiness and outstanding acceptance

**Ready locally:** both source sets together; verified server release contents and registry; a successful combined production build; complete frontend/Cesium/model integrity gates; passing focused integration, API, script and mocked deployment checks. Existing immutable release retention, HTML-last publication, explicit `-Execute` and selected-target safeguards remain intact.

**Not yet verified or resolved for production:**

1. Authenticated desktop visual/interaction acceptance: GNSS raster appearance and cell picking/periods, real moving Air/Naval/Orbital GLBs, focus/unfocus/collapse, regional entry, pan/zoom, all layers together, one Viewer, stable camera/loader/auth transitions. The browser tests could not launch; no successful app session is claimed.
2. Browser memory plateau/GPU release and dense real-data camera smoothness over repeated switching. Node counters/lifecycle checks and earlier CPU fixtures are not Chrome RSS, GPU memory or FPS evidence.
3. The 52 pre-existing failing tests above. Harness and obsolete expectations need their own scoped fixes; assertion failures with uncertain intent need investigation. No unrelated changes were made in this integration task.
4. CloudFront `503 / LimitExceeded` and actual concurrent production worker delivery. Complete local assets and successful sequential gates cannot identify or remove an AWS enforcement limit. No production stress test or AWS inspection/mutation was run here.
5. Provider/coverage acceptance. The earlier read-only probe found ADSB.lol responsive and Airplanes.live/ADSB One returning 403. That is historical task evidence, not a fresh probe or a guarantee of production coverage. Naval/live account/provider verification and ODbL redistribution review remain required. The workbook has no individual naval IDs; prefixes/MIDs do not fill that evidence gap.
6. API raster cache persistence/routing and proxy/auth behavior in the actual server topology. Preserve `apps/api/.cache/gnss-raster-v1/`; multiple API hosts need shared revision visibility or appropriate routing. Do not apply static-asset cache rules to these API endpoints.

No production GO is issued from this local check. The combined version is suitable for an approved isolated staging acceptance run; production promotion still requires the missing evidence and resolution/disposition of blocking failures.

## Exact release sequence, after separate authorization

1. Freeze/review this combined tree and include all new files. Preserve exact previous server/frontend artifacts for rollback. The current audit has not committed or published them. Keep environment files and runtime caches on the servers.
2. Through the existing server release process, ship the reviewed API, worker, shared modules and registry together. The prepared archive proves their local inclusion; it is not a remote deployment confirmation. Keep source-relative paths. No schema migration, dependency version change or new infrastructure is required.
3. Apply the **API first**, before publishing frontend HTML that requests raster descriptors. Verify the actual PM2 working directories/service names against `ecosystem.config.cjs` and live supervisor state; local documented names are `warzone-api` and `warzone-worker`. Only after an authorized source release restart those actual services. This combined release needs the API restart for first-set GNSS changes and the worker restart for second-set identification; the second set alone did not require an API restart. Do not restart unrelated services or change environment variables.
4. Rebuild the isolated staging frontend with its approved isolated API/auth dependencies. The validated build here uses existing production defaults; do not use it to load-test shared production services. Run local gates, then review the existing deployment script's dry-run with explicit staging target/profile/bucket/distribution/origin. Add `-Execute` only when separately authorized.
5. Validate all staging release assets before HTML publication, then complete real-data desktop/visual/memory/provider acceptance. Retain old hashed bundles and full Cesium releases. Production publication and AWS settings remain separate authorized operator actions.
6. Roll back with saved exact server source/registry and previous frontend HTML/manifest/mutable assets while retaining API cache and immutable releases. Do not rebuild an old source checkout and assume identical artifacts, overwrite published immutable worker paths, or delete retained assets.

The local rebuild/check commands are:

```powershell
npm run build -- --config .generated/final-integration-20261115/webpack.config.cjs
node scripts/cesium-assets.cjs --verify .generated/final-integration-20261115/build
node scripts/frontend-assets.cjs --verify .generated/final-integration-20261115/build
node scripts/model-assets.cjs --verify .generated/final-integration-20261115/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/final-integration-20261115/build
```

The wrapper redirects output/CopyPlugin destinations only; checked-in `production/` output was not replaced. Logs, source hashes, Git comparison, release file manifest and extracted-registry verification are under `.generated/final-integration-20261115/`.

## Exact implementation file lists

First set: `e57fd541` to `c47a1be3` (37 files).

```text
apps/api/src/gnss-gpsinterference.js
apps/api/src/gnss-raster.js
apps/api/src/routes.events.js
apps/api/test/gnss-raster.test.js
apps/shared/gnss-geometry.js
apps/worker/test/aircraft-model-responsive-sizing.test.js
apps/worker/test/feature-resource-lifecycle.test.js
apps/worker/test/gnss-raster-lifecycle.test.js
apps/worker/test/gnss-render-lifecycle.test.js
apps/worker/test/layer-admission-bulk.test.js
apps/worker/test/layer-ownership-coexistence.test.js
apps/worker/test/naval-glb-assets.test.js
apps/worker/test/naval-glb-runtime.test.js
apps/worker/test/orbital-performance.test.js
apps/worker/test/tracker-layer-confirmation.test.js
apps/worker/test/tracker-model-recovery.test.js
dev/assets/js/essential.js
dev/assets/js/supabase.js
dev/assets/js/warzone-globe.js
dev/assets/js/warzone-gnss-raster.js
dev/assets/js/warzone-gnss.js
dev/assets/js/warzone-layers.js
dev/assets/js/warzone-live-airforce.js
dev/assets/js/warzone-live-naval.js
dev/assets/js/warzone-mil-sats.js
docs/04-development/gnss-raster-rollout.md
docs/04-development/tracker-stability-extension.md
scripts/deploy-production.ps1
scripts/gnss-load-test.cjs
scripts/gnss-staging-flow.cjs
scripts/model-assets.cjs
scripts/tests/deploy-production.test.ps1
scripts/tests/gnss-load-test.test.cjs
scripts/tests/model-assets.test.cjs
scripts/tests/tracker-stability-test.test.cjs
scripts/tracker-stability-test.cjs
webpack.config.js
```

Second set: uncommitted changes over `c47a1be3` (29 files at audit start; includes new/untracked files).

```text
apps/shared/aircraft-identifiers.js
apps/shared/naval-identity.js
apps/worker/src/adsb-worker.js
apps/worker/src/ais-worker.js
apps/worker/src/tracking/aircraft/providers/plane-alert-db.js
apps/worker/src/tracking/aircraft/providers/readsb.js
apps/worker/src/tracking/aircraft/providers/skylink.js
apps/worker/src/tracking/merge.js
apps/worker/src/tracking/naval/normalize.js
apps/worker/src/tracking/provider-health.js
apps/worker/test/feature-resource-lifecycle.test.js
apps/worker/test/naval-identity-integrity.test.js
apps/worker/test/naval-worker.test.js
apps/worker/test/orbital-performance.test.js
apps/worker/test/tracking-plane-alert-db.test.js
apps/worker/test/tracking-skylink-provider.test.js
dev/assets/js/warzone-mil-sats.js
apps/shared/aircraft-identity.js
apps/shared/maritime-allocations.js
apps/shared/military-taxonomy.js
apps/worker/data/aircraft/.gitattributes
apps/worker/data/aircraft/LICENSE
apps/worker/data/aircraft/NOTICE.md
apps/worker/data/aircraft/plane-alert-mil.csv
apps/worker/data/aircraft/plane-alert-mil.csv.manifest.json
apps/worker/scripts/tracking-provider-diagnostics.mjs
apps/worker/test/global-military-identification.test.js
docs/04-development/orbital-global-identification.md
scripts/import-military-aircraft.mjs
```

This audit adds only `docs/04-development/stratops-final-integration.md` outside the ignored evidence directory.
