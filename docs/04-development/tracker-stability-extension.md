# Tracker stability extension — local implementation, 2026-11-14

Continues the uncommitted GNSS raster implementation described in `gnss-raster-rollout.md`. That implementation remains in place. No production deployment, AWS mutation, environment-file edit, dependency update, GLB edit, CSS edit, commit, reset or push occurred. Evidence: `.generated/tracker-stability-extension-20261114/`; earlier GNSS evidence remains in its original directory.

**Local corrections are implemented. Production readiness remains blocked by browser acceptance and the unresolved CloudFront delivery restriction.** Tests below establish source/asset behavior, not successful live aircraft/naval/satellite rendering, FPS or browser memory stabilization.

## Confirmed defects and exact corrections

| File | Functions and change |
| --- | --- |
| `dev/assets/js/warzone-layers.js` | New `enforceBasemapBorders` centralizes the constraint. `setLayer`, `buildSingleToggleState`, `saveState` and `notifyChange` use it. `applyTrackerPriority`, `applyOrbitalIsolation` and predicted toggle states no longer force terrain ON. `restoreDefaultLayers` preserves map choices on operational exits; `setAllLayers` does not resurrect operational defaults on explicit All OFF. Orbital mode permits the basemap control. |
| `dev/assets/js/warzone-globe.js` | `suspendCtrImagery` respects basemap OFF; `restoreCtrImagery` preserves the current basemap choice and refuses obsolete/destroyed imagery snapshots; `enableFocusedTerrain` changes physical terrain without overriding imagery preferences. These were separate paths capable of disagreeing with layer-panel state. No focus-camera positioning change. |
| `dev/assets/js/warzone-live-airforce.js` | `isLiveAircraftModelCodeAvailable` no longer treats one failed CDN request as permanent proof that an assigned GLB is unavailable. `unbindLiveTrackRuntime` clears failed-load/resource bookkeeping. `syncLiveTrackRenderPopulation` and the upsert path release **unselected** render resources excluded by region/category selection, retaining authoritative records for restoration. Dense ON/focus reconciliation yields bounded chunks and resumes collection events **each chunk**, avoiding a final burst of all deferred Cesium model creation. The selected asset's existing focus exception remains. |
| `dev/assets/js/warzone-live-naval.js` | OFF clears owned resource/failure bookkeeping. `refreshNavalViewDependentVisuals` updates label visibility without restyling every model; distance callbacks continue sizing models during camera movement. `refreshFocusedNavalModelScale` schedules bounded CSS/media reconfiguration. `scheduleNavalRenderReconcile` limits construction chunks; `queueNavalRenderReconcile` merges incoming work instead of repeatedly cancelling and starving a dense restoration. `animateVesselTo` preserves freshness on an unchanged settled target. |
| `dev/assets/js/warzone-mil-sats.js` | `getCssNumber` honors defaults for empty CSS strings. `createSampledPosition` records the actual final sample time. `updateDefaultEntities` reuses valid sample/orientation properties for unchanged records, resamples before expiration/when records change, and yields populations above 64 records in at most eight records/about six ms of submission work per callback. `cleanupLayer` cancels the pending batch/generation; stale callbacks cannot erase a newer frame handle. Diagnostics expose pending model construction. The earlier UTC-clock correction, focus path, genuine orbital data, model assignments and separate decorative renderer remain. |
| `scripts/model-assets.cjs` (new) | Local source/build GLB container/hash verification and sequential live HTTP/status/MIME/hash verification. All 64 shipped model files are covered, including air, sea and space. Accepts binary GLB MIME or `application/octet-stream`; rejects HTML fallbacks, redirects, 503s and corrupted bytes. |
| `scripts/deploy-production.ps1` | Two GLB gate calls, each with failure handling: local verification before AWS, live verification after asset upload but before manifest/HTML publication. No new AWS mutation type, permission, target selection or deletion. Live checks run only under `-Execute`; `-ValidateOnly` remains local/read-only. |
| `scripts/tracker-stability-test.cjs` (new) | Opt-in real-application profiling via the existing authenticated staging flow: ten switching cycles; ready Model primitives vs assigned ModelGraphics; OFF resource counts; same viewer/canvas/render loop; render errors; Chrome heap and DOM/listener counters; render-frame intervals and long tasks; Basemap/Borders checks. No fake authentication, observations, fetch interception or forced render loop. Production targets are rejected. |

Source model assignments, aircraft subtype/vessel classification, telemetry ingestion, GLB contents, root.css values, scaling interpolation, GNSS data/geometry boundaries/classifications/period semantics, radar design and camera controls were not replaced. Rendering resource removal does not remove a real tracking record: eligible assets can be restored from the retained registry. The existing history bounds remain.

The exact base-layer behavior is now:

| Requested state/action | Result |
| --- | --- |
| Basemap ON, Borders OFF | Allowed |
| Basemap OFF, Borders ON | Allowed |
| Both ON | Allowed |
| Disable Basemap while Borders OFF | Basemap OFF, Borders ON, one coherent notification |
| Disable Borders while Basemap OFF | Basemap ON, Borders OFF, one coherent notification |
| Operational ON/OFF, focus terrain, CTR restore | Preserve the chosen basemap preference |
| Explicit All OFF | Operational layers OFF; retain the mandatory base-layer invariant |

## GLB and sizing verification

The three earlier sizing assertion failures hard-coded old illustrative values (5/10 and a fixed pixel floor), while current root.css defines different values by tier/category. `aircraft-model-responsive-sizing.test.js` now reads the actual CSS cascade, independently checks near/far endpoints against those values, checks nearby focus equality, drawing-buffer pixel conversion and property reuse. **The sizing implementation and root.css were not changed to satisfy these assertions.**

`naval-glb-assets.test.js` now checks all 64 shipped GLBs, rather than only the 11 naval files. It validates binary/JSON bounds, geometry/material/index integrity, decodes Meshopt, and decodes the two Draco-compressed aircraft with Cesium's shipped Draco WASM. All 64 also return exact bytes and acceptable binary MIME over a local Express server. This establishes local assets/decoder compatibility. It does not establish GPU rendering, live CDN delivery or correct production data availability.

Model-loading recovery is bounded: OFF removes owned entities/animations/listeners and clears load failure/resource records; ON constructs the assigned models again. No permanent failed-URI blacklist, new billboard substitute, invented ship classification, new model-omission budget or automatic retry storm was added. Existing genuine-data/premium gates remain.

## Tests and limitations

New/extended regression coverage includes:

- `apps/worker/test/tracker-model-recovery.test.js` (new): failed aircraft URI availability, OFF bookkeeping cleanup, render-resource removal with data retention, 300-aircraft restoration with real Cesium EntityCollection events, ten ON/OFF cycles, late callback rejection.
- `apps/worker/test/layer-ownership-coexistence.test.js`: exact base-layer combinations, compensating notification, ten operational switching cycles with Basemap OFF, bulk OFF, CTR/physical-terrain independence and obsolete imagery protection.
- `apps/worker/test/naval-glb-runtime.test.js`: ten dense restoration cycles, zero models/animations after OFF, resource-cache reset, no settled-camera model-style parsing, live-input batch starvation protection.
- `apps/worker/test/orbital-performance.test.js`: ten normal OFF/ON cycles, 300-satellite bounded construction, sample reuse, UTC motion, expired-sample rebuild and late callback rejection across a new generation.
- `scripts/tests/model-assets.test.cjs`, `scripts/tests/tracker-stability-test.test.cjs` (new): local/live model gates, HTTP/MIME/corruption failures, profiling target/cohort restrictions.
- Existing lifecycle/confirmation tests were updated only for intended coexistence/base-layer behavior and scheduler/resource-harness inputs. Root.css tests now reflect current CSS values.

The full API suite passes 81 tests. All seven script test files pass 56 tests, including mocked Cesium metadata repair tests. The PowerShell deployment suite passes 19 mocked safety scenarios (including both local and live GLB gate failures), with no AWS/network writes. The final focused tracker/layer/GNSS group passes 71 tests. The broad worker run is **not green: 646 tests, 594 passed, 52 failed**. All 52 failing test names reproduce in the isolated Git HEAD archive; the comparison has additional archive/setup differences, so it is not an identical baseline-suite success claim. Existing failures include stale UI/radar/report expectations, missing source-extraction globals, disabled build defines and browser launch failures. They were not hidden, skipped or fixed through unrelated UI/data changes. `worker-tests-final.log`, `model-tests-final.log` and `worker-failure-comparison.json` preserve the results.

Actual Node measurements: the 300-satellite fixture is submitted over 38 construction callbacks; the final focused run's maximum Node callback cost was 2.713 ms (`model-tests-final.log`; machine load varies). A warm update performs zero SGP4 propagations and creates no new sample/orientation properties. The 300-aircraft fixture publishes at most eight entities per collection-event batch, restores all 300, and returns to zero render entities after ten OFF cycles. These are CPU/lifecycle fixtures, not browser frame-time/GPU measurements. No production load test occurred.

No actual browser memory plateau, startup RSS, peak GPU allocation or dense real-data FPS was measured. Chrome child-process launch fails `spawn EPERM`; the browser access host is unavailable; desktop Chrome access was rejected as unapproved. A count of zero JS entities does not prove that the GPU driver released all allocations. Browser/Cesium caches can retain memory legitimately. An absolute memory target cannot be justified without the missing measurements.

## Real browser profiling procedure

Use the private, approved isolated staging configuration from `gnss-raster-rollout.md`, with genuine data and a premium staging account. No new credentials or auth bypass are provided. Set `cycles: 10` and `settleMs` long enough for genuine API/model loading (default 5000; maximum 60000). Optional `forceGc: true` explicitly forces Chrome GC at samples; compare this separately from natural retention. Calibrate selectors/account/region using one user. Browser launch or missing genuine data is failed/inconclusive, never substituted with invented tracks.

```powershell
# Plan only; no browser or network requests:
node scripts/tracker-stability-test.cjs --config .generated/YOUR_PRIVATE_STAGING_CONFIG.json
# Only for the approved isolated local/staging environment:
node scripts/tracker-stability-test.cjs --config .generated/YOUR_PRIVATE_STAGING_CONFIG.json --execute
```

The sequence captures startup OFF, Naval+Air, GNSS after both OFF, Orbital after GNSS OFF, combined Air+Naval+GNSS+Orbital, then all operational OFF. It repeats ten times with Basemap OFF/Borders ON, then tests border-to-basemap fallback and Both ON. Failed worker/raster/GLB HTTP responses, missing ready models, a changed viewer, stopped loop, or both base layers OFF prevent successful completion. Artifacts remain labelled pending manual memory-plateau/visual review even when automated checks complete. Ready Model primitives are not proof of unobstructed on-screen visibility.

Compare settled OFF samples using `JSHeapUsedSize`, total heap, Documents/Nodes/JSEventListeners, model counts, application request/timer/animation diagnostics, and long tasks. Record the Chrome Task Manager renderer/GPU process memory separately: CDP heap counters are not tab RSS or GPU memory. Browser/model caches may warm over the first cycles; inspect the later-cycle trend rather than requiring immediate return to startup bytes. Set memory/FPS acceptance targets only after repeatable measurements on the actual supported devices. Render-frame intervals include intentional idle gaps under requestRenderMode and must not be reported as idle FPS. Compare screenshots and focus/unfocus, zoom/reset, telemetry, region changes and GNSS cell picking/periods to the accepted visual baseline.

## CloudFront and worker delivery remain external release gates

No Cesium worker module, geometry algorithm, worker-pool size, model byte or production metadata repair was changed in this extension. The new model publication gates close a genuine deployment blind spot: the older JS/CSS/Cesium gates did not validate GLB bytes and responses. Existing complete native worker/dependency verification remains in place, including MIME, immutable-cache headers and final-byte hashes. Replacing GNSS rendering does not eliminate workers used by borders, satellite ground tracks, terrain or compressed models.

Read-only `get-distribution` and one `head-object` were attempted with the explicitly named `stratops-repair` profile and production resources. Both failed at the environment proxy `http://127.0.0.1:9`, before receiving AWS metadata. No inference about the current object headers, completed repair count, distribution policy or exact restriction follows from that transport failure. The supplied production `503 / LimitExceeded` evidence remains confirmed; its exact quota/threshold is not established. AWS documents multiple 503 sources and directs production edge-capacity cases to Support: [AWS 503 guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-503-service-unavailable.html).

Read-only operator checks:

1. CloudFront console → distribution `E2EFV9935XX3MV` → Behaviors. Match the failing versioned worker URL against behavior order; inspect origin/path, Managed-CachingOptimized policy, compression, function/Lambda associations and any response-header policy. Verify a response policy is not removing/overriding Cache-Control. Do not change it during inspection.
2. S3 console → `warzone.battlespacex.com` → the exact deployed release worker/chunk → Properties/Metadata. Check JS MIME and `public, max-age=31536000, immutable`, then compare served headers. Inspect the existing repair journal before deciding that any interrupted metadata repair should resume; this task did not restart or alter it. Keep byte/metadata backups intact.
3. Review plan notifications, usage and available request/error metrics for the supplied November 14 incident (approximately 01:15:57–01:16:01 UTC, YTO53-P3). Monthly allowance percentages do not identify a burst quota. Use the original HAR/request IDs already captured; do not infer a threshold from filename repetition or run another production stress test.
4. Ask AWS Support to identify the exact enforcement name, threshold and scope from those same-incident request IDs. A confirmed AWS delivery restriction requires its supported remedy; local metadata/cache changes alone cannot prove it resolved. No service upgrade, EC2 resize, WAF weakening, paid feature or infrastructure change is authorized by this report.

## Build, release and rollback

The extension build uses `.generated/tracker-stability-extension-20261114/webpack.config.cjs`, an output-only wrapper around the real production configuration. It leaves checked-in `production/` output intact. The final build passed in 34,121 ms (`build-final.log`). Final local gates verified 392 Cesium assets, 24 application JS/CSS assets and 64 GLBs; deployment `-ValidateOnly` passed with no build or AWS requests. The two decoder/local HTTP tests also passed against the final build. Nine runtime/helper syntax checks and `git diff --check` passed. Source/runtime validation uses:

```powershell
npm run build -- --config .generated/tracker-stability-extension-20261114/webpack.config.cjs
node scripts/cesium-assets.cjs --verify .generated/tracker-stability-extension-20261114/build
node scripts/frontend-assets.cjs --verify .generated/tracker-stability-extension-20261114/build
node scripts/model-assets.cjs --verify .generated/tracker-stability-extension-20261114/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/tracker-stability-extension-20261114/build
```

Use the prior report's **API-first, isolated-staging-first** release procedure, substituting this extension build directory and rebuilding with the approved isolated staging API base before staging publication. Shipping this extension also requires the current Air/Naval/Satellite/layer/globe source changes and new `model-assets.cjs` helper alongside `deploy-production.ps1`. The normal deployment remains dry-run unless `-Execute` is separately authorized. The live model gate adds 64 sequential model GETs/downloads per deployment; it adds no application runtime request. This validation cost is separate from per-user rendering.

Do not promote until genuine-data desktop/browser acceptance, full layer switching, memory-plateau review and CloudFront delivery acceptance have evidence. Previous release/rollback instructions remain: save exact HTML/manifest/mutable assets (including models if deliberately changed), retain old hashed bundles and Cesium releases, preserve the API raster cache, restore saved artifacts rather than rebuilding old source, and keep the API compatible with both old JSON clients and new raster clients. No rollback, deployment, invalidation or S3 copy was performed here.
