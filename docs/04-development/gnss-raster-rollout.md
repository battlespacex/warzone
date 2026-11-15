# Operational GNSS raster implementation and staging release

Local implementation, 2026-11-14. Source base: `e57fd541`. No deployment, AWS operation, production environment change, dependency update, commit or push was performed. The initial worktree was clean; checked-in `production/` output remains unchanged. Investigation/build evidence is under `.generated/gnss-raster-implementation-20261114/`.

**Status: implemented locally and tested as described below; production promotion requires staging/browser acceptance.** The CloudFront `503 / X-Cache: LimitExceeded` restriction is still unresolved. Raster delivery removes operational GNSS geometry submissions; other Cesium features still require workers.

## Changes and causes

The previous operational renderer built asynchronous fill/outline primitives in 200-cell batches. Thousands of instances could initialize Cesium geometry processors and their module dependencies. A rejected geometry import can fail a primitive and stop the shared Cesium render loop. The supplied production headers establish CloudFront LimitExceeded responses; they do not establish its exact enforcement threshold. OFF previously retained geometry and full cell records. Global basemap `imageryLayers.removeAll()` also violated imagery ownership. Layer-policy isolation disabled GNSS/orbital/tracker combinations.

The operational satellite position properties used the viewer's simulation time, while this application intentionally creates its shared viewer with `shouldAnimate: false`. Once the frozen time falls outside a refreshed sample window, a property can return undefined. A separate model distance condition also hid assets beyond 26,000 km, including eligible high-orbit satellites. These are confirmed source defects; successful production GLB rendering has not been observed in this task.

| File | Exact functions / responsibility |
| --- | --- |
| `apps/shared/gnss-geometry.js` (new) | `gnssBoundary`, `unwrapGnssPolygon`, `gnssContains`: existing fallback hex formula, real polygon boundaries, antimeridian handling and lookup containment. |
| `apps/api/src/gnss-raster.js` (new) | `createGnssRasterStore`, `gnssRasterRoutes`, `encodeGnssPng`, `validateGnssStyle`: revisioned PNG generation, spatial index, lookup, bounded caches/queues, atomic snapshot persistence, real failure statuses. Uses Node built-ins only. |
| `apps/api/src/gnss-gpsinterference.js` | `selectGpsInterferenceRegion`: internal `includeAll` for raster snapshots; safe unknown-severity counts. Legacy JSON retains its existing display cap. |
| `apps/api/src/routes.events.js` | `createGnssInterferenceHandler`, `eventsRouter`: `format=raster` descriptors, genuine regional fallback observations, shared concurrent descriptor preparation, tile/lookup routes. |
| `dev/assets/js/supabase.js` | `api.getGnssInterferenceCells`: request raster descriptors and resolve tile/lookup URLs under the existing GNSS API base (including local `/api`). Report an incompatible old API instead of silently returning to heavy geometry. |
| `dev/assets/js/essential.js` | `syncGnssInterferenceLayer`, `refreshGnssInterferenceCells`: pass raster metadata/normalization, release OFF records/requests, allow one necessary refresh of an expired raster revision. |
| `dev/assets/js/warzone-gnss-raster.js` (new) | `createGnssRasterLayer`: owns one imagery layer, request diagnostics, cancellable/debounced lookup, bounded hover cache, authoritative click lookup, disposal and local imagery errors. |
| `dev/assets/js/warzone-gnss.js` | `renderGnssInterferenceLayer`, `clearGnssInterferenceLayer`, `bindPicking`, `bindGnssControls`, `getGnssDiagnostics`: raster operational branch with existing legend/period controls/detail panel; owned cleanup; ignore old `retainGeometry` requests. Legacy renderer remains for compatibility/direct callers, but the application adapter requires raster for nonempty operational data. |
| `dev/assets/js/warzone-globe.js` | New `removeOwnedBasemapLayers`, `basemapInsertionIndex`, `addBasemapImageryProvider`; update `addArcGisLayers`, Google/self-hosted initialization, `createMapStyleLayerSet`, `addSelfHostedDetailLayers`, `setEntryMapImageryVisible`. Remove only owned imagery, keep overlays above basemaps, reject stale completions. No viewer, camera, terrain or onboarding reinitialization. |
| `dev/assets/js/warzone-layers.js` | Isolation allowlists, `restoreOrbitalIsolation`, `reconcileTrackerPriority`, `setLayer`, `setSectionLayers`: preserve independent GNSS/orbital/air/naval selections; preserve access checks and existing unrelated layer policies. |
| `dev/assets/js/warzone-mil-sats.js` | `createSampledPosition` reads UTC through a callback position property; `makePointEntity` removes the insufficient model-distance cutoff. `updateDefaultEntities`, `startTimers`, `stopTimers` own one 12 Hz shared render task only when real operational model entities exist, with OFF/hidden cleanup. No model mapping, focus camera or decorative entry satellite changes. |
| `webpack.config.js` | Development GNSS route/mount uses the same raster store and routes. Production Cesium packaging and deployment protections remain active. The config input changes the vendor release namespace, while all 392 final vendor file hashes remain identical. |
| `scripts/gnss-load-test.cjs`, `scripts/gnss-staging-flow.cjs` | Recognize raster readiness, tile/lookup MIME/network failures and genuine descriptor counts. Continue collecting every other Cesium worker failure. Production targets remain rejected. |

No CSS, GLB, aircraft/naval implementation, radar, ingestion, database, authentication or production environment file changed. No new package/lockfile change.

## Data and delivery contract

`GET /events/gnss-interference?format=raster&date=72h&minLat=...&maxLat=...&minLon=...&maxLon=...`

This uses the existing provider and complete-UTC-day 24/48/72-hour rules. Genuine empty/unavailable windows stay empty/unavailable. The primary raster path retains all regional cells in the existing provider snapshot, including counts above 12,000; the upstream parser's existing 30,000-record guard remains. Existing database fallback qualification/limit remains, and demo rows are excluded. No observations are fabricated, averaged onto another grid or timestamped to create apparent freshness.

A nonempty response carries `cells: []`, original provenance/coverage metadata, regional counts and:

```json
{
  "raster": {
    "revision": "<32 hexadecimal characters>",
    "maximumLevel": 14,
    "tilePath": "/events/gnss-interference/raster/<revision>/{z}/{x}/{y}.png",
    "lookupPath": "/events/gnss-interference/raster/<revision>/lookup"
  }
}
```

The PNG service uses GeographicTilingScheme coordinates: two level-zero tiles across longitude, one across latitude, including the poles. Output is 256×256 RGBA, rasterized at 512×512 with buffered candidate selection and alpha-aware downsampling. Colors/alpha, fallback hex size and outline width come from the existing CSS values, passed as a validated `style` query; severity uses a canonical `filter` query. These queries are deterministic, without random cache busting. Tile errors return real errors, not fake transparent observations.

Click lookup uses `?lon=...&lat=...&filter=...&style=...` against the same revision/polygons and reverse draw order. It returns the existing cell fields into the unchanged GNSS detail-panel markup. Hover is debounced 180 ms and can reuse up to 64 known polygons for its cursor. Clicks validate authoritative ordering, including overlaps. Obsolete lookups are aborted; late results cannot rebuild a disabled layer or populate another revision.

Descriptors and lookup responses use `Cache-Control: no-store`. Tiles use `private, max-age=300`. Preserve the API's current CORS/access boundary. Any API proxy/CDN must forward `format`, date/bounds, style, filter and lookup coordinates correctly; use caching disabled/minimum TTL 0 for these API paths. Do not apply the static Cesium Managed-CachingOptimized policy to API responses. No AWS policy was changed.

Cache limits are serialized snapshot bytes (32 MiB, at most 16 memory snapshots), PNG bytes (32 MiB), 256 pending unique tile jobs, 32 queued snapshot loads and separate 32 MiB budgets for pending snapshot pins and publication. These byte counts are **not JavaScript heap/RSS measurements**. Geometry/index object overhead is additional. Generation is serialized with periodic event-loop yields; identical requests share pending work. The descriptor preparation cache holds at most 32 short-lived entries with weak cell references.

Snapshots persist atomically under `apps/api/.cache/gnss-raster-v1/`, with a 30-minute lifetime and a 256 MiB disk-cache pruning target. Pruning occurs during publication, at most once a minute; interrupted temporary files expire through the same owned-cache pruning. Same-host API processes using this directory can recover a revision after memory eviction or restart. Retain this directory during releases. **Multiple API hosts need shared snapshot storage or appropriate routing; this implementation does not create distributed infrastructure.** Disk quota/permissions and proxy behavior require staging verification.

An expired/unavailable revision returns 410. The frontend refreshes a given expired revision once; repeated failure is reported rather than retried indefinitely. Other tile errors remove only the GNSS imagery layer and report its failure. In-flight imagery downloads/server cache jobs can finish after OFF, but disposed generations cannot reattach resources. The backend cache is shared and bounded; one user's OFF does not purge data needed by other users.

## Tests and measured results

New tests: `apps/api/test/gnss-raster.test.js`, `apps/worker/test/gnss-raster-lifecycle.test.js`, `apps/worker/test/layer-ownership-coexistence.test.js`.

Updated tests: `apps/worker/test/feature-resource-lifecycle.test.js`, `gnss-render-lifecycle.test.js`, `layer-admission-bulk.test.js`, `orbital-performance.test.js`, `tracker-layer-confirmation.test.js`; `scripts/tests/gnss-load-test.test.cjs`. Changes reflect intentional cleanup/coexistence behavior and inject the existing shared scheduler into source-extraction harnesses. Tracker sizing tests were not modified.

Passing local invocations are recorded separately:

| Check | Result |
| --- | --- |
| All 15 API test files, Node `--test-isolation=none` | 81 passed, 0 failed. Includes real local Express tile/lookup HTTP responses. |
| Selected GNSS, ownership, layer, orbital, startup, resource lifecycle, ground-polyline, radar lifecycle and imagery/focus group | 84 passed, 0 failed. |
| Tracker confirmation suite in a separate process | 7 passed, 0 failed. |
| Cesium/frontend delivery, GNSS concurrency and staging-harness tests | 17 passed, 0 failed. |
| PowerShell deployment safety suite | 17 mocked scenarios passed; no AWS/network operations. |
| Production webpack build, isolated output | Passed, webpack 5.108.4, 95,013 ms; `build-release.log`. |
| Final build integrity and deployment `-ValidateOnly` | 392 Cesium assets, 24 application JS/CSS assets; no AWS calls. |
| Vendor comparison | New release `1.143.0-4106863949fcb3b1-standard`; 110 worker JS files; all 392 vendor file hashes match current checked-in production artifacts. |
| Syntax and whitespace | Relevant JavaScript syntax checks and `git diff --check` passed. |

Wider tracker regression attempt: **32 passed, 4 failed**. Three `aircraft-model-responsive-sizing.test.js` assertions also fail independently with their source/test/CSS inputs byte-identical to HEAD (far/focus sizing expectations). They were left unchanged. The fourth failure is Chrome launch `spawn EPERM` in `mobile-focused-model-sizing.test.js`. An independent Chrome smoke launch also failed `spawn EPERM`. No app browser session, production test, real-data staging cohort, FPS/GPU-memory benchmark or visual acceptance is claimed.

`benchmark.mjs` and `benchmark.json` under the evidence directory measure a **synthetic Node-only 12,000-cell fixture**, never installed in the application: 30 descriptor callers share one publication (~101.4 ms total; snapshot preparation ~94.9 ms); 30 identical cold tile callers share one 26,018-byte PNG (~77.7 ms); 30 warm tile calls ~0.23 ms. Serialized snapshot bytes: 5,217,478. Forced-GC retained heap delta: +17,738,712 bytes; process RSS rose from 81,051,648 to 194,617,344 bytes in that run. These numbers describe backend allocation/cache costs, not browser memory savings or production throughput. Pending jobs/pinned bytes returned to zero. Fifty imagery OFF/ON cycles destroyed owned layers/listeners, and the raster branch with 12,000 descriptor cells constructed zero GNSS ground primitives in the lifecycle harness. This does not measure a real WebGL driver's memory.

## Staging deployment procedure (not performed)

1. Review the diff and save the previous frontend HTML/manifest/bundles and API release. Keep existing Cesium releases, hashed bundles and API cache files. Do not overwrite published immutable URLs or run S3 sync with `--delete`.
2. **Deploy the API first** through the existing approved isolated staging API process. Ship `apps/api/src/routes.events.js`, `gnss-gpsinterference.js`, new `gnss-raster.js` and `apps/shared/gnss-geometry.js`, preserving these relative paths and `apps/api/.cache/`. Keep the current environment/auth configuration. Existing `npm --prefix apps/api start` is the API entry point; the actual staging supervisor/service name is not documented sufficiently to provide a safe restart command. Use its existing release mechanism, not a guessed production service restart. No dependency installation is needed for these changes.
3. Verify the API account can create/read/atomically replace files in the owned cache directory and that all staging processes see the same directory. Inspect API proxy query forwarding, PNG MIME, CORS and minimum TTL. Do not point staging at shared production API/auth/data services for a load run.
4. Perform a small sequential real-data contract check on the **approved staging API**:

```powershell
$stagingApi = 'https://YOUR_ISOLATED_STAGING_API_HOST'
$query = 'date=72h&minLat=15&maxLat=75&minLon=-170&maxLon=-40'
$descriptor = Invoke-RestMethod "$stagingApi/events/gnss-interference?format=raster&$query"
$descriptor | Select-Object sourceMode, sourceHealth, totalCells, observationPeriod, raster
# An unavailable/empty real window is inconclusive, not permission to fabricate coverage.
$tilePath = $descriptor.raster.tilePath.Replace('{z}', '3').Replace('{x}', '3').Replace('{y}', '2')
$tile = Invoke-WebRequest -UseBasicParsing "$stagingApi$tilePath"
$tile.Headers['Content-Type'] # image/png
$tile.Headers['Cache-Control'] # private, max-age=300
# Existing JSON endpoint allows a real cell's details to be compared with lookup.
$legacy = Invoke-RestMethod "$stagingApi/events/gnss-interference?limit=12&$query"
$cell = $legacy.cells[0]
$lookup = Invoke-RestMethod "$stagingApi$($descriptor.raster.lookupPath)?lon=$($cell.lon)&lat=$($cell.lat)"
$lookup.cell | Select-Object id, cellId, severity, affectedPercent, sampleCount, observationPeriod
```

5. Build staging with the existing compiled API override, into isolated output. The current `.env.production` does not set `STRATOPS_API_BASE_URL`; recheck that fact if configuration changes. Never edit production environment files for staging. Review all independent feed/auth URLs and egress before load testing; this compiled override does not redirect every external service.

```powershell
$env:STRATOPS_API_BASE_URL = $stagingApi
npm run build -- --config .generated/gnss-raster-implementation-20261114/webpack.config.cjs
Remove-Item Env:STRATOPS_API_BASE_URL
node scripts/cesium-assets.cjs --verify .generated/gnss-raster-implementation-20261114/build
node scripts/frontend-assets.cjs --verify .generated/gnss-raster-implementation-20261114/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/gnss-raster-implementation-20261114/build
```

The build produced during this implementation uses the current production-default API base; **rebuild for staging before staging publication**. Inspect the effective compiled API base. The wrapper only redirects output/CopyPlugin destinations and is an ignored investigation artifact; recreate it from the evidence directory if working elsewhere.

6. Review the staging upload plan. This command does not write AWS without `-Execute`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -TargetEnvironment staging -BuildDirectory .generated/gnss-raster-implementation-20261114/build -Bucket YOUR_STAGING_BUCKET -DistributionId YOUR_STAGING_DISTRIBUTION -Profile YOUR_STAGING_PROFILE -PublicBaseUrl https://stratops-staging.battlespacex.com
```

Only after separate staging deployment authorization, repeat that reviewed command with `-Execute`. Its existing sequence uploads/validates all versioned Cesium assets, uploads/validates application assets, then publishes manifest/HTML. The script retains remote older release directories and hashed bundles and requires explicit matching target/profile/origin configuration. No deployment safeguards were weakened or bypassed.

7. Calibrate one real premium staging account in a real desktop browser. Verify North America and Middle East, all severity selections, 24/48/72 hours, click details/hover, zoom/rotation and GNSS OFF/ON while orbital intelligence, air and naval are independently enabled. Compare cell polygons, palette/alpha, outlines, close-up resampling, poles/dateline and region boundaries with the approved baseline. Verify default moving satellite GLBs, focus/orbits/ground tracks, unfocus and repeated teardown. Check radar, normal startup/auth/entry, same viewer, one canvas, camera continuity, loader and API health. The renderer code/test fixtures do not establish this acceptance.
8. Use the existing private `gnss-load-test` configuration and 16-cohort matrix after staging/egress approval. Start with `counts: [1]`, then 10/20/30 after each accepted calibration. Plan-only command: `node scripts/gnss-load-test.cjs --config .generated/gnss-load-config.json`. The explicitly authorized run adds `--execute`. No such run occurred here. Require zero raster/worker/CloudFront failures, continued frames and manual visual/other-feature review. Measure browser GPU/RSS/heap, API event-loop/CPU/RSS and runner saturation; Node cache tests are insufficient.
9. Production promotion is a separate release decision after these checks and the CloudFront restriction investigation. Rebuild using the unchanged production environment. Run the same local gates, then review the existing deploy script with explicit `-TargetEnvironment production`, the selected production bucket/distribution/profile/origin and matching build. No production command was executed or automatically authorized by this implementation.

## Rollback and remaining limits

Restore the **saved previous frontend HTML/manifest and any mutable assets changed by that release**, using retained exact hashed bundles/vendor trees. Invalidate only affected entry paths through the existing approved deployment mechanism. Do not rebuild an old source tree and assume identical artifacts; do not overwrite immutable URLs or delete old releases. Keeping this backwards-compatible API deployed supports both old JSON clients and new raster clients. If API rollback is necessary, first restore a compatible older frontend, then restore the saved API code through its existing supervisor; preserve the cache until newer sessions have drained. No restore was attempted.

Raster removes GNSS primitive creation jobs and full client geometry retention; it adds imagery requests/textures and backend CPU/disk/RAM costs. It does not reproduce the old exact 3–5-cell progressive reveal. Raster outline width/resampling and geodesic-vs-texture appearance need screenshot approval, especially at close zoom and poles. Existing panel UI is reused, but browser picking latency and visual equivalence are not accepted yet. A global WebGL context failure remains shared by all layers.

Other Cesium features (borders, satellite ground tracks/footprints, terrain/models) still load their own workers. Standard final-byte manifest/dependency/MIME/immutable-cache/live gates remain necessary, but sequential gates cannot prove concurrent CloudFront delivery. The new release contains unchanged vendor bytes. The missing live `cesium-assets.json` is a deployment/audit issue; the manifest is a build/release gate artifact rather than a renderer runtime dependency. Its upload remains HTML-last guarded by the existing deployment script.

For any further LimitExceeded response, retain exact failed URL, UTC timestamp, status, content type, `x-cache`, `x-amz-cf-id`, POP, cache-control/age, initiator and waterfall/HAR concurrency with cache state. Send same-incident IDs to AWS Support for the exact enforcement scope/threshold. No geometry reduction, unsupported worker-pool edit, EC2 resizing, paid service or plan upgrade was introduced to hide that unresolved delivery failure.
