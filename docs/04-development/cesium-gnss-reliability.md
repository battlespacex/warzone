# GNSS / Cesium delivery reliability and 30-user staging acceptance

Date: 2026-11-09. Base: local `main`, `13f98b3a`. This work extends `.generated/cesium-investigation-20261109/report.md`; it does not repeat its production sampling. Existing investigation artifacts were preserved. No AWS setting/object, deployed service, dependency version, branch, commit or PR was changed remotely.

**Status: delivery safeguards and a staging test harness are implemented locally. Production 503 resolution and the 30-user acceptance target remain unverified.** No production load test was run. A Chrome launch smoke test failed with `spawn EPERM` in this execution environment, so no browser acceptance result is claimed.

## 1. Current architecture

Each user runs an independent Cesium Viewer, WebGL context, geometry primitives and worker pool in their browser. Users share CDN assets and backend services, not Viewer state. Native Cesium creation workers are allocated lazily from a module-level pool sized `max(navigator.hardwareConcurrency - 1, 1)`, plus a combine processor and other feature-specific processors. The actual number created and HTTP requests sent must be measured in each browser; geometry count is not worker count.

The previously sampled graph for creation, polygon, ground-polyline, ellipse and combine workers contains **42 unique entry/dependency URLs**. The dispatch table's 55 possible geometry-module imports do not mean 55 eagerly downloaded modules. Individual worker contexts can load overlapping dependencies; HTTP caching and request coalescing determine actual transfers. Cold clients independently need the same static code. CDN cache hits avoid S3 origin requests but are still requests to CloudFront.

`essential.js:refreshGnssInterferenceCells` fetches through `supabase.js:api.getGnssInterferenceCells`, with one in-flight request per browser, controller cancellation, region bounds, selected period and a ten-minute background refresh window. Observation-period/manual refresh operations can force a new request. Severity filtering is local. No new API calls, subscriptions or timers were added to application runtime by this work.

`apps/api/src/routes.events.js:createGnssInterferenceHandler` gets primary snapshots from `gnss-gpsinterference.js`, then filters the result by region. `createGpsInterferenceService` deduplicates pending requests by date **within one Node process**. Latest data has a 60-second cache lifetime, historical dates a 24-hour lifetime, and failures a five-minute cooldown with stale-cache behavior. The cache holds only two dates; mixed historical/latest traffic can evict entries. Multiple EC2 processes/instances do not share this memory cache. No Redis/distributed-cache change was justified by measured production backend evidence.

Rolling 24/48/72-hour data keeps the existing complete-UTC-day semantics. At a typical non-midnight timestamp, the 72-hour window contains two complete provider days; 24h can contain no complete day and legitimately return an unavailable/empty result. These semantics and all genuine observations are unchanged; the load test never fabricates observations to make a period look populated.

`warzone-gnss.js:renderGnssInterferenceLayer/renderGroundBatches` uses signature/style reuse, generation cancellation and batches of 200 polygons with optional ground-polyline outlines. Changes to data, timestamp, filter or style can rebuild geometry; animation does not rebuild it every frame. Radar animates material uniforms. Functional orbital satellites and recording-page decorative sprites/coverage remain separate systems.

## 2. Confirmed versus hypothesized production failure

User-provided evidence: 503 responses with `X-Cache: LimitExceeded from cloudfront`, including worker chunk failures at **2026-11-09 14:24:30–14:24:34 UTC**, POP **YTO53-P3**, distribution **E2EFV9935XX3MV**. User-reported monthly usage is roughly 2% of request allowance and 5% of transfer allowance. Those usage figures were not independently queried.

Previous live sampling: 45 sequential successful responses, including the complete 42-file sampled worker graph, correct JavaScript MIME and production/build byte matches. No sampled response carried `Cache-Control`. These observations do not establish that concurrent delivery works, that the reported failure is gone, or which AWS quota was applied.

Source tracing establishes a failure mechanism: a geometry import rejection can fail a primitive, raise `scene.renderError`, and cause CesiumWidget to disable the default render loop. Later fetching the URL successfully does not repair the failed primitive. No automatic loop restart or repeated retries were introduced.

CloudFront quota/enforcement is the leading explanation for the reported header, but the **specific limit and trigger remain unknown**. Neither a low monthly percentage nor another customer's re:Post case establishes a per-client concurrency threshold. No duplicated operational Viewer startup or runaway geometry construction was confirmed.

## 3. Single-user bottlenecks and risks

- A single cold browser can fan out module loads across its native worker pool, especially on a high-core machine. Versioning preserves the supplied module graph; it does not eliminate that first-load fan-out.
- Missing browser cache headers can cause avoidable repeat validation/downloads. This work supplies immutable cache headers for new, versioned releases when the deployment script is eventually authorized and executed.
- Previously stable worker names could combine a newer entry with older cached dependencies during deployment. New bundle-specific release paths isolate their complete asset trees.
- Client GPU, WebGL limits, heap pressure, geometry readiness and large real datasets remain browser bottlenecks. No density, size, quality, palette or coverage reduction was made.
- The backend's bounded date cache, region-filter CPU cost, API egress and provider latency still need measurement. No EC2 capacity or FPS benchmark was performed.

## 4. What changes with 10, 20 and 30 users

The following is an illustration of distinct `(browser, URL)` needs for the sampled graph, **not measured HTTP request totals or a requests-per-second prediction**:

| Cold independent browsers | Sampled graph URLs across those browsers | Native renderer/GPU ownership |
| ---: | ---: | --- |
| 1 | 42 | One browser |
| 10 | 420 | Ten browsers |
| 20 | 840 | Twenty browsers |
| 30 | 1,260 | Thirty browsers |

Browser memory caches are not shared across users. CloudFront can share cached objects between them and collapse compatible simultaneous origin requests with the same cache key, but neither behavior removes viewer-to-CloudFront requests. Actual behavior depends on cache keys and POPs. [AWS request collapsing](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorS3Origin.html)

Thirty simultaneous GNSS activations can still produce thirty API responses, regional selections, JSON serializations and transfers. In one process their pending upstream date fetches are shared. Across P processes, upstream work can multiply by P. Independent regions and dates, cache evictions, provider refreshes, authentication and other enabled features add load. EC2 CPU/RSS/event-loop delay, provider calls, S3 origin metrics and CDN requests must be correlated with browser traces. This work does not establish their capacity.

## 5. Exact code improvements and justification

| File | Functions / configuration changed | Why |
| --- | --- | --- |
| `webpack.config.js` | Exported config: production `CESIUM_BASE_URL`, Cesium CopyPlugin destination/`toType`, manifest plugin, optional `STRATOPS_API_BASE_URL` definition/validation | Version all Cesium assets together. Explicit directory typing prevents a dotted version name being treated as a filename. Permit a real isolated staging API. Development retains `/assets/cesium`. |
| `scripts/cesium-assets.cjs` (new) | `getCesiumRelease`, `CesiumAssetManifestPlugin.apply`, `readManifest`, `verifyBuild`, `verifyLive`, file/hash helpers and CLI | Stable release identity from vendor/build inputs; manifest hashes final emitted bytes after minification; verify complete files/dependencies locally and sequential live status/MIME/cache/byte checks before publishing HTML. |
| `scripts/deploy-production.ps1` | Parameters; `Invoke-Aws`; `Assert-DeploymentTarget`; upload/verification/publication flow and invalidation paths | Central Execute guard; explicit target/profile/URL and ordered behavior/S3-origin checks; gate HTML on Cesium and application JS/CSS integrity; preserve retained releases and legacy workers. ValidateOnly checks an existing build without building or calling AWS. |
| `scripts/frontend-assets.cjs` | `verifyBuild`, `verifyLive` | Check local HTML JS/CSS references and every emitted application JS/CSS chunk, including named/lazy chunks; sequential live status/MIME/exact-byte checks before metadata or HTML publication. |
| `scripts/build-cesium-compact.cjs` | Output selection and completion callback | Preserve the opt-in experiment in a separate compact namespace; refuse overwriting a standard immutable release; update compact manifest hashes after generation. Explicit `--out-dir` remains available for isolated experiments. |
| `package.json` | `build:cesium-compact`, new `test:cesium-delivery` script | Build an explicitly marked compact variant only on opt-in; provide repeatable checks. Dependency versions/lockfile unchanged. |
| `dev/assets/js/index.js` | `STRATOPS_API_BASE` constant | Accept explicit compiled staging API; retain existing production and local defaults. No boot/Viewer lifecycle function changed. |
| `dev/assets/js/supabase.js` | API base constants evaluated at module load | GNSS/general/intel/report adapters receive the same compiled staging base even before index's config assignment runs. Existing per-service runtime overrides retain precedence. No endpoint, auth, data processing or fetching method changed. |
| `scripts/gnss-load-test.cjs` (new) | Config validation, recorder, scene probe/snapshots, scenario runner, plan/execute CLI, HAR sanitization | Repeatable, opt-in independent-session testing; rejects the production target. |
| `scripts/gnss-staging-flow.cjs`, `scripts/gnss-load-test.example.json` (new) | UI flow adapter / selectors | Entry, authentication state, region, GNSS toggling, severity/period selections and camera actions; configurable steps for other features. No access-control bypass. |
| Three files under `scripts/tests/` (new) | Delivery, concurrency and harness tests | Catch integrity/publication failures, input/variant identity problems, date-fetch storms, accidental production targets and credential-bearing artifacts. |
| This document | Technical report / runbook | Acceptance limits, AWS proposals, test and release/rollback instructions. |

No code changed in `warzone-globe.js`, `warzone-gnss.js`, `warzone-sweeper.js`, `essential.js`, functional satellites, decorative satellites, startup vapor or any CSS. All 110 newly built worker JS files were compared to existing production worker files and were byte-identical; delivery paths changed, geometry algorithms did not.

The normal build still uses the complete supplied Cesium distribution, including fallback geometry, terrain/model workers, WASM and supporting assets. It emits `cesium-assets.json`, with the new base URL and 392 file hashes. Old release directories are retained; only the current manifest's release is uploaded with immutable headers. **Do not edit an already published release in place.**

The compact experiment remains opt-in and is **not activated by normal build/deployment**. Default deployment rejects compact manifests pending separate runtime validation. Its isolated compile success is not proof of complete geometry compatibility or fewer actual browser requests.

## 6. Proposed AWS settings (not applied)

Use the existing distribution and S3 origin. Review the actual behavior order before adding/changing anything:

| Scope | Proposed setting | Expected effect / cost implications |
| --- | --- | --- |
| `/assets/cesium/releases/*` | GET/HEAD, existing S3 origin/OAC and path, HTTPS, compression enabled; cache key excludes application cookies, query strings and unnecessary headers; preserve normalized compression handling | Makes identical public vendor assets shareable. Does not apply to authenticated API responses. Fewer cache-key variants can reduce origin GETs; viewer requests remain billable/countable under the applicable plan. |
| Versioned S3 objects | `Cache-Control: public, max-age=31536000, immutable`; correct JS/JSON/WASM content types | Browser reuse can reduce repeat CDN requests. Initial cold payload size and native worker fan-out are unchanged. Deployment's new release upload sets this header and checks it. |
| Release cache policy | Minimum TTL 0, default TTL e.g. 86400, maximum TTL 31536000; honor object cache headers | Maximum TTL permits the one-year object TTL. Inspect existing policies first; don't blindly replace a shared policy used by API/auth traffic. |
| Entry HTML / `cesium-assets.json` | No-cache/no-store, with a behavior minimum TTL of 0 | New entry references reach clients after release publication. AWS documents that a positive minimum TTL can override no-store/no-cache. [TTL documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html) |
| Error handling | Keep real HTTP status codes for missing/failed assets; do not rewrite worker failures to index.html/HTTP 200 | Prevent HTML-as-JS failure masking. Review origin-error TTLs separately. A custom error page does not handle CloudFront-generated LimitExceeded/CapacityExceeded. [AWS error handling](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-custom-error-pages.html) |
| Retained releases | Retain previous complete vendor releases and hashed app bundles through rollout/rollback and existing-session lifetime | Increases S3 storage per distinct release. Measure actual bytes and retention before adding a lifecycle rule; this task adds no deletion. |

Cache policies and versioning do not fix an unidentified service quota. No plan upgrade, WAF relaxation, quota change, paid logging, Origin Shield or infrastructure expansion is prescribed without evidence. Existing plan allowances, S3 object storage/PUT/GET requests, validation GETs and invalidations remain relevant costs; no dollar estimate is defensible without region and usage. The live gate adds 392 sequential asset GETs per deployment and downloads the release once; this is a release validation cost, not ongoing per-user behavior.

`s3 sync` does not repair metadata on every unchanged object. A new release prefix avoids inheriting legacy object metadata; if an existing release has wrong metadata, the live gate fails instead of silently publishing it. Investigate before any authorized repair. [AWS CLI sync reference](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)

## 7. Actual tests and limits

Local checks performed:

- `npm run test:cesium-delivery`: **14 passed, zero failed**. Includes actual webpack/CopyPlugin output with dotted release directory names, final-byte manifest generation, missing/corrupt assets, traversal rejection, a local HTTP 503/MIME/cache/byte-error gate, deterministic namespace inputs, production-target rejection, HAR redaction and early staging API selection/defaults.
- Existing GNSS API/render and nearby lifecycle set: **43 passed, zero failed**, command below. Includes orbital OFF/ON lifecycle harness coverage; not a production satellite integration test.
- Synthetic service concurrency fixtures: 1, 10, 20 and 30 callers each shared two pending historical upstream fetches for the chosen timestamp; subsequent warm calls caused no extra fetches. Included in the 14 tests. Synthetic fixtures are never installed in the application or used as observations. This is not a throughput, latency or EC2 load benchmark.
- Production webpack build succeeded using the output-only wrapper under `.generated/cesium-reliability-20261109/`; final build log reports **69,312 ms**. Checked-in production output was not overwritten.
- Local manifest verification: **392 assets**, including **110 worker JavaScript files**, all verified with dependencies present. Worker bytes match existing production files.
- `node scripts/build-cesium-compact.cjs --out-dir .generated/cesium-reliability-20261109/compact`: passed, five files totaling 412,728 bytes. Only the isolated experiment was built; its default full build/deployment and geometry runtime compatibility were not validated.
- `deploy-production.ps1 -SkipBuild -ValidateOnly` succeeded against that isolated build with **no AWS requests**. Windows PowerShell parser checks passed.
- **11 JavaScript syntax checks passed**, along with Git diff/whitespace checks and Windows PowerShell parsing.
- A single Chrome launch against a data URL was attempted solely to check runner availability; it failed `spawn EPERM` before navigation. No app browser test, 30-browser run, staging deployment, live AWS validation or production load test occurred.

The earlier investigation's broader radar visual test file had four baseline failures (old width clamp/shader expression/z-index/CSS expectations). This task does not change radar visuals or rewrite those tests. The focused radar lifecycle test passes; the broader visual suite must not be reported as clean.

### Reproducible staging matrix

Run 16 cohorts: **[1,10,20,30] users × [cold,warm browser cache] × [simultaneous-load,gnss-after-load]**. First calibrate all four variants with one user, then progress through 10, 20, 30 only when smaller cohorts and visual checks are satisfactory. Runner stops at the first automated failure/inconclusive result.

Each user has a separate Chromium process/context and authenticated state. Cold means a fresh browser cache; warm means genuine priming in that same context before measured navigation. No Playwright request routing/global fetch interception or cache-disable flag is used. Browser warm cache is distinct from CDN, API-process and provider caches; those are not flushed. In `gnss-after-load`, preparation is sequential and only activation starts together. HAR includes priming/preparation; measured counters start at measured navigation and snapshots show timestamps.

Metrics/artifacts: all request/response rows, worker/API classification, HTTP/MIME/network failures, CloudFront-delivered 503 and specifically LimitExceeded counts/request IDs/POPs, peak outstanding requests per browser and aggregate one-second request buckets, preparation/GNSS times, worker events, render errors, same-Viewer/one-canvas/default-loop/frame progress checks, diagnostics, available JS heap, browser version, screenshots and sanitized HAR. `responseBodyBytes` is the size exposed by Playwright; it is not a verified network-transfer or total-browser-RSS measurement. Page/worker event completeness must be checked against DevTools/HAR in the first one-user calibration; resource rows missing a worker target are not evidence of zero network activity.

All 503 counts must be zero. A response delivered through CloudFront may still originate as an API error; `cloudfrontDelivered503` alone does not attribute its source. Use request category, X-Cache and AWS diagnostics to distinguish them. Cancelled obsolete API requests are logged separately from worker failures. The runner does not count a cancelled obsolete API call as a worker failure.

An automated pass requires live-loop/frame progress, the same Viewer, one visible canvas, genuine nonempty final GNSS coverage, successful UI operations, worker request evidence, and zero relevant failures. Empty/unavailable real 72h data, a locked premium layer, browser crash, hidden tab or timeout is failed/inconclusive. A legitimate empty 24h daily-summary result is recorded honestly and must show the correct unavailable/coverage message in visual review.

**HTTP success is not visual acceptance.** `blackGlobeIncidents`, `functionalSatelliteRegressions` and `radarRegressions` remain `null` pending review; a green automated result is labelled `pending-visual-and-other-feature-review`. Compare screenshots and interactions to an approved baseline. For each cohort review colors, density/size, severity selections, period labels/data, pan/rotate/zoom, GNSS toggle, region switch, radar/SAM animation and cards, AOI draw/resize/scan, aircraft tracking/focus, orbital intelligence with real military satellites, map layers, sign-in/entry transitions, decorative pre-entry video/satellite/vapor presentation, loader/camera stability and continued API health. Add appropriate UI actions to `otherFeatureSteps` or the flow adapter; an empty list does not test those features. Manual acceptance must record each required zero metric with evidence, or leave the release blocked.

Thirty Chrome processes can saturate the load generator's GPU/RAM/CPU before the deployment is saturated. Record runner CPU/GPU/RAM, browser version, viewport, headless mode, process RSS and EC2/CDN metrics. Use adequate hardware or a coordinated distributed runner before interpreting client crashes as a server capacity result. Headless rendering alone does not prove user-visible GPU behavior; repeat visual/interaction checks in real desktop browsers. No distributed runner is claimed implemented here.

## 8. Safest release and rollback

1. Review the source diff and this report. Keep the existing known release/artifacts intact. Build from the reviewed main working tree.
2. Stage the **standard** release first. Configure isolated staging API/auth/data services; do not accidentally load-test the shared production API. Staging CORS and premium test accounts must permit the staging origin. No API/auth bypass is provided.
3. Upload only the manifest-selected Cesium release, with immutable headers, and validate it sequentially. Upload application and supporting assets, then sequentially verify every emitted application JS/CSS chunk and local HTML JS/CSS reference through staging CloudFront before publishing the manifest or HTML. A nonzero upload/validation result stops publication. Legacy Cesium paths are excluded from the general upload; previous releases and old hashed bundles are retained without `--delete`.
4. Publish content-hashed application assets, then metadata/HTML; invalidate root/index/manifest and existing poster routes as needed. Validate the cold/warm matrix and full manual regression checklist. Capture the deployed manifest and all referenced HTML/bundle files as a release record.
5. Production promotion requires a separate explicit authorization after staging acceptance and AWS quota investigation. No such action was performed in this task.
6. Before an authorized upload, save the exact previous complete build and deployed HTML/manifest plus bytes and metadata (or existing S3 version IDs) for mutable keys that will be overwritten. The script does not create these backups or enable bucket versioning. If a pre-publication gate fails, HTML remains untouched, but earlier mutable-asset uploads may already affect existing sessions. Restore those keys from the saved release if necessary.
7. For rollback, first verify that the previous release's retained Cesium and hashed JS/CSS assets are still available. Restore the saved mutable supporting files and their metadata, validate the prior JS/CSS/Cesium assets, then restore the saved manifest and HTML last. Invalidate affected HTML routes, manifest and restored mutable URLs, and verify all affected routes and flows. Keep newer and older immutable assets; never rebuild an old checkout as a substitute for saved release bytes. Rollback is an explicitly authorized operator action, not automated by this script.

Publication spans multiple S3 objects and is not atomic: a failure during the HTML sync can leave mixed old/new pages. An invalidation or post-publication check can also fail after HTML is already live. Serialize releases and keep the prebuilt directory unchanged for the entire deployment. Mutable images, fonts, videos, JSON, PDF workers, partials and root files can affect old sessions during rollout. The new gate checks emitted non-Cesium JS/MJS/CSS, including PDF worker bytes; it does not verify every other supporting asset. CSS `url()` dependencies and external URLs are not recursively verified. Versioning these assets is future work, not part of this review. The application JS/CSS directories currently contain hashed bundles; introducing stable filenames there would also inherit the script's one-year immutable header and requires separate review.

## 9. Exact next actions

### A. Re-run local checks (no AWS traffic)

From repository root, Node 24 is the validated runtime in this session:

```powershell
git status --short --branch
git diff --check
npm run test:cesium-delivery
node --test --test-isolation=none scripts/tests/frontend-assets.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/deploy-production.test.ps1
node --test --test-isolation=none apps/api/test/gnss-gpsinterference.test.js apps/api/test/gnss-route.test.js apps/worker/test/gnss-render-lifecycle.test.js apps/worker/test/radar-sweeper-lifecycle.test.js apps/worker/test/ground-polyline-safety.test.js apps/worker/test/feature-resource-lifecycle.test.js
node scripts/cesium-assets.cjs --verify .generated/cesium-reliability-20261109/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -ValidateOnly -BuildDirectory .generated/cesium-reliability-20261109/build
```

To rebuild the standard release without touching checked-in production output:

```powershell
npm run build -- --config .generated/cesium-reliability-20261109/webpack.config.cjs
```

The wrapper only redirects output and CopyPlugin destinations; it loads the real production config. It is an investigation artifact, not a second application config to deploy. Normal `npm run build` emits to `production` when you intentionally prepare a release there.

### B. Obtain the missing AWS evidence (read-only)

```powershell
$awsProfile = 'YOUR_READ_ONLY_PROFILE'
$distributionId = 'E2EFV9935XX3MV'
aws --profile $awsProfile cloudfront get-distribution-config --id $distributionId --output json
aws --profile $awsProfile service-quotas list-service-quotas --service-code cloudfront --region us-east-1 --output json
aws --profile $awsProfile cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/CloudFront --metric-name Requests --dimensions "Name=DistributionId,Value=$distributionId" 'Name=Region,Value=Global' --start-time 2026-11-09T14:14:00Z --end-time 2026-11-09T14:35:00Z --period 60 --statistics Sum --output json
aws --profile $awsProfile cloudwatch get-metric-statistics --region us-east-1 --namespace AWS/CloudFront --metric-name 5xxErrorRate --dimensions "Name=DistributionId,Value=$distributionId" 'Name=Region,Value=Global' --start-time 2026-11-09T14:14:00Z --end-time 2026-11-09T14:35:00Z --period 60 --statistics Average --output json
```

CloudFront console -> distribution -> Behaviors: inspect the winning behavior for worker paths, origin path, cache policy/TTL/key, edge function/Lambda associations, compression, response-header policy, error mappings and deployment status. Inspect plan usage/notifications, not just allowance percentages. Obtain S3 `head-object` metadata for failed worker keys using the bucket/prefix from the real origin configuration; the previous investigation report supplies the command template. Inspect function throttles only when actual associations exist. Minute request sums do not establish sub-second peaks.

Send the Nov 9 incident request IDs, timestamps and POP to AWS Support. Ask for exact quota name/threshold/scope and whether plan delivery adjustment or edge-function enforcement applied. Until AWS identifies it, there is no technically justified upgrade recommendation.

### C. Prepare staging and the one-user calibration

Do not run these load tests until staging and its API/auth/data dependencies are approved and isolated. The runner rejects the production hostname and launch arguments block DNS resolution for the two known production frontend/API hosts; this is not a substitute for a runner egress policy, especially with proxies, DNS aliases or external providers. Audit all staging dependencies first, including auth, Supabase and live feeds.

Build the staging frontend with a real isolated public HTTPS API base. Replace the placeholder; if `.env.production` already supplies this variable it takes precedence over the shell variable, so check the effective compiled config:

```powershell
$env:STRATOPS_API_BASE_URL = 'https://YOUR_ISOLATED_STAGING_API_HOST'
npm run build -- --config .generated/cesium-reliability-20261109/webpack.config.cjs
Remove-Item Env:STRATOPS_API_BASE_URL
node scripts/cesium-assets.cjs --verify .generated/cesium-reliability-20261109/build
```

This new setting changes general/GNSS/intel/report and index config bases. Some unrelated services have independent fallback URLs; staging egress review must cover those too. No production-default URL was changed.

The following deploy-script command is **dry-run only** and requires your staging bucket/distribution and AWS CLI. Do not substitute production resources:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -BuildDirectory .generated/cesium-reliability-20261109/build -TargetEnvironment staging -Bucket YOUR_STAGING_BUCKET -DistributionId YOUR_STAGING_DISTRIBUTION -PublicBaseUrl https://stratops-staging.battlespacex.com -Profile YOUR_STAGING_PROFILE
```

Dry run queries the selected distribution read-only and prints planned uploads; it does not invoke upload or invalidation commands and does not perform live asset checks. It requires AWS CLI and an explicit profile, target environment, bucket, distribution and public HTTPS origin. ValidateOnly requires none of these remote settings and cannot be combined with Execute; it never builds. Ordinary dry run still builds unless SkipBuild is supplied. Only an explicitly authorized invocation with Execute performs mutations and live pre-publication gates.

The target check rejects the known production distribution/hostname for staging and checks ordered behavior origins against the selected bucket with no origin prefix. Origin groups/custom origins/prefixes are refused pending review. This does not prove infrastructure isolation: another distribution can share that bucket, a profile name does not establish IAM scope, and frontend deployment checks do not inspect API/auth dependencies. Use a staging-only IAM profile restricted to the approved staging bucket/distribution, and independently confirm that the bucket is not shared with production. Configuration changes after the read-only check remain a race. Existing retention lifecycle rules and other operators can also delete retained assets; this script does not change those policies.

Review the proposed uploads. Applying that deployment or changing AWS policies is a separate authorized operator action, not something this task performed. After an authorized staging release, validate it sequentially with:

```powershell
node scripts/cesium-assets.cjs --verify-live .generated/cesium-reliability-20261109/build https://stratops-staging.battlespacex.com
node scripts/frontend-assets.cjs --verify-live .generated/cesium-reliability-20261109/build https://stratops-staging.battlespacex.com
```

Prepare distinct premium staging accounts and save authenticated browser state privately. Example for the first account (interactive sign-in; repeat with the next file/account as needed):

```powershell
New-Item -ItemType Directory -Path .generated/gnss-auth -Force | Out-Null
& .\apps\worker\node_modules\.bin\playwright.cmd codegen --save-storage .generated/gnss-auth/user-01.json https://stratops-staging.battlespacex.com
Copy-Item scripts/gnss-load-test.example.json .generated/gnss-load-config.json
$loadConfig = Get-Content .generated/gnss-load-config.json -Raw | ConvertFrom-Json
$loadConfig.storageStates = @('.generated/gnss-auth/user-01.json')
$loadConfig.counts = @(1)
$loadConfig | ConvertTo-Json -Depth 10 | Set-Content .generated/gnss-load-config.json -Encoding utf8
node scripts/gnss-load-test.cjs --config .generated/gnss-load-config.json
```

The last command prints a plan only: no browser/network traffic. Check the example's actual entry/region/layer selectors against staging, including remembered consent/panel state, using Playwright codegen. Adjust `entrySteps`, `regionSteps`, `layerPanelSteps` and `otherFeatureSteps` in your private config. The adapter never skips access checks or invents auth state. HAR is sanitized at normal completion, but artifacts/state files must still be treated as private; interrupted runs can leave unsanitized HAR. Do not commit auth states, HAR or private config.

When the isolated staging run is authorized, opt in explicitly:

```powershell
node scripts/gnss-load-test.cjs --config .generated/gnss-load-config.json --execute
```

It creates a fresh `run-*` directory instead of overwriting earlier evidence. Inspect the four one-user scenarios and the full manual checklist before expanding. An empty `otherFeatureSteps` list does not satisfy preservation acceptance for other features.

### D. Expand to 10, 20, 30 after calibration

After creating 30 separate authenticated state files, use:

```powershell
$loadConfig = Get-Content .generated/gnss-load-config.json -Raw | ConvertFrom-Json
$loadConfig.storageStates = @(1..30 | ForEach-Object { '.generated/gnss-auth/user-{0:D2}.json' -f $_ })
$loadConfig.counts = @(1, 10, 20, 30)
$loadConfig | ConvertTo-Json -Depth 10 | Set-Content .generated/gnss-load-config.json -Encoding utf8
node scripts/gnss-load-test.cjs --config .generated/gnss-load-config.json
# Only after the staging cohort run is authorized:
node scripts/gnss-load-test.cjs --config .generated/gnss-load-config.json --execute
```

Correlate each cohort's timestamps with staging CloudFront request/error/cache-hit metrics, S3 origin GET/5xx metrics where available, EC2 CPU/RSS/event-loop delay/API latency and provider call counts. Collect external provider usage and browser heap/RSS too. Do not enable paid metrics/logging without evaluating availability and cost. Leave any unavailable metric explicitly unmeasured.

Acceptance is complete only when all 16 cohorts and the visual/functional matrix have evidence for zero worker/CloudFront failures, black globes, GNSS initialization failures and GNSS/satellite/radar regressions. Local build/tests alone cannot provide that evidence.

## 10. Deployment safety review, 2026-11-09

This review preserves the prior local work and changes only deployment tooling, focused tests and this runbook. No runtime JavaScript, CSS, GNSS, radar, satellites, Cesium geometry, dependencies or build configuration was edited. The isolated build wrapper and mock fixtures are under `.generated/deployment-review-20261109/`.

Confirmed gaps and fixes:

- Existing S3 uploads depended on scattered AWS CLI dry-run flags; invalidation was already behind Execute. `Invoke-Aws` now centrally refuses to invoke any mutation without Execute, rejects unreviewed operation types and forbids delete. Invalidation also uses this wrapper. Every actual AWS invocation receives the explicitly selected profile; all S3 destinations use the selected bucket.
- Application JS/CSS checks previously ran only after HTML publication and covered poster/numbered chunks. `frontend-assets.cjs:verifyBuild/verifyLive` now inventories all emitted non-Cesium JS/MJS/CSS, checks local HTML references and sequentially validates live HTTP status, MIME and exact bytes before manifest/HTML publication. Upload or gate failures throw before those publication commands.
- The generic asset upload could overwrite legacy Cesium files. It now excludes the complete Cesium tree. The final HTML sync also explicitly excludes `assets/*` **after** its HTML include: otherwise it would upload vendor HTML again and overwrite the immutable headers already validated. No deletion is introduced; retained Cesium releases and hashed bundles remain available unless another operator/lifecycle rule removes them.
- Target arguments previously allowed unrelated bucket, distribution and URL values. `Assert-DeploymentTarget` now requires explicit remote settings, rejects known production targets in staging and verifies the public hostname plus ordered behavior/direct S3 origins before mutations. This is a consistency check; staging-only IAM permissions and confirmation that its bucket is not shared with production remain required.
- ValidateOnly no longer rebuilds, makes no AWS requests and rejects Execute. Dry run only performs read-only target inspection and prints mutations; the staging example now includes TargetEnvironment and the same explicit target/profile values required for execution.

Checks actually performed:

- Existing `npm run test:cesium-delivery`: **14 passed**.
- New frontend integrity tests: **2 passed**, including named/lazy JS, CSS, PDF workers, missing HTML references, HTTP 503, HTML MIME, corrupt bytes and redirects.
- Real PowerShell orchestration with mocked AWS/Node/HTTP: **17 scenarios passed**, covering ValidateOnly, conflicting switches, dry run, publication ordering, legacy/vendor exclusions, profile/bucket propagation, upload/validation failures and target mismatch refusals. These are local tests, not live AWS acceptance.
- Both new JavaScript syntax checks and both PowerShell parser checks passed. Scoped deployment diff whitespace check passed. Whole-worktree `git diff --check` still reports pre-existing trailing whitespace in `warzone-live-airforce.js` at lines 4572, 4581 and 4582; those edits were preserved.
- Fresh isolated `npm run build -- --config .generated/deployment-review-20261109/webpack.config.cjs`: **passed**, webpack reported **107,936 ms**. Its Cesium manifest verified **392 assets**.
- **Blocker found during this review (resolved in section 11):** generated `pages/report.html` references `/assets/fonts/stratops/style.css`, but the font-copy rule excluded CSS and that file was absent from this build. Both direct frontend verification and the real ValidateOnly command failed as intended before AWS. No exception/bypass was added.

No real AWS commands, uploads, invalidations, deployments, commits or pushes occurred. Live target configuration, IAM isolation, retention policies, rollback execution and browser behavior remain unverified. These safeguards do not establish that CloudFront's `503 LimitExceeded` issue is fixed.

## 11. Report icon-font build follow-up, 2026-11-09

The report reference originates in `dev/pages/report.html:10`, emitted as `pages/report.html` by the existing `pages.map` HtmlWebpackPlugin configuration. The report is a standalone template without injected application CSS. Its icon stylesheet reference is valid: `dev/assets/fonts/stratops/style.css` defines the shared `stratops-icon-font` face and `stratops-ico-*` mappings. Main application CSS imports that same stylesheet through `dev/assets/css/style.css`; root/required styles and existing widgets also use the icon font.

The production font-copy pattern excluded both CSS and JSON, so it copied EOT/TTF/WOFF/SVG files but omitted the referenced stylesheet. The smallest fix is one production CopyPlugin setting in `webpack.config.js`: retain the JSON exclusion and allow CSS to be copied. The StratOps stylesheet is currently the only CSS file under the source font tree. No source stylesheet, template, font, icon mapping, runtime function or deployment safeguard was modified. A focused test in `scripts/tests/frontend-assets.test.cjs` runs the actual font-copy pattern and verifies the report's CSS reference and all four dependent font files against their source bytes.

Validation completed against a fresh isolated build at `.generated/report-font-release-20261109/build`:

- Production build using the real configuration with only output paths redirected: **passed**, webpack reported **115,173 ms**. Existing checked-in production output was not overwritten.
- `node scripts/frontend-assets.cjs --verify .generated/report-font-release-20261109/build`: **26 JS/MJS/CSS assets passed**.
- `node scripts/cesium-assets.cjs --verify .generated/report-font-release-20261109/build`: **392 assets passed**. Every vendor asset's byte hash matches the preceding build. The configuration change correctly produces a new versioned release identity; no old release was overwritten.
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -ValidateOnly -BuildDirectory .generated/report-font-release-20261109/build`: **passed**, with the existing validators unchanged and no AWS requests.
- Both live integrity functions passed against a local HTTP server serving the actual new build. This verifies the gate functions locally, not S3/CloudFront delivery.
- All **four** EOT/TTF/WOFF/SVG dependencies exist at their stylesheet URL paths and match source bytes. All **84** icon content mappings are unchanged after stylesheet minification, and the **three** bundled application CSS files are byte-identical to the preceding build. Evidence and the local verification script are saved in `.generated/report-font-release-20261109/verification.json` and `verify-build.cjs`.
- Existing Cesium delivery suite: **14 passed**. Frontend integrity suite including the new font-copy regression: **3 passed**. Mocked deployment orchestration: **17 scenarios passed**. JavaScript syntax and scoped whitespace checks passed; the pre-existing unrelated whitespace warnings noted in section 10 remain.

Only `webpack.config.js`, `scripts/tests/frontend-assets.test.cjs` and this report were edited in this follow-up, plus isolated generated verification artifacts. No runtime functions changed. Browser appearance, real AWS delivery and production behavior were not exercised; the evidence establishes unchanged style/icon definitions and font bytes. No AWS changes, deployment, commit or push occurred. The CloudFront `503 LimitExceeded` incident remains separate and unresolved by this build fix.
