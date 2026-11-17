# Cesium delivery remediation and concurrent acceptance

Prepared November 13, 2026, America/Toronto. Source HEAD: `990d9553`. Incident UTC date: November 14. This is a reviewable correction plan, not an applied infrastructure change or a claim that production is fixed. No application, deployment-script, dependency or rendering changes are proposed without further evidence.

## Findings and causal boundary

| Finding | Evidence and conclusion |
| --- | --- |
| CloudFront rejects worker dependencies intermittently | User Chrome capture: HTTP 503, `X-Cache: LimitExceeded from cloudfront`, HTML response, 963-byte body, POP YTO53-P3, November 14 01:15:57–01:16:01 UTC. Identical chunk URLs have both 200 and 503 responses. Polygon and ground-polyline worker imports are affected. This is a confirmed delivery failure. |
| The failed dependency stops Cesium rendering | Cesium 1.143.0 propagates the rejected import through its task processor and primitive failure into `scene.renderError`; CesiumWidget stops its default loop. A later successful GET does not repair that primitive. |
| Exact restriction remains unknown | No distribution configuration, account quotas, plan notices or same-incident AWS diagnostic logs were accessible. The header alone does not identify a per-client, edge, distribution, edge-function or pricing-plan threshold. |
| Missing browser cache contract | Earlier sequential sampling of the polygon entry and 31 dependencies: all 200, JavaScript MIME and bytes matching the local manifest, CDN hits at YTO53-P3, no Cache-Control. Fresh checks of the entry and chunk-ML6MR2RA.js repeat the missing-header finding. CDN hits/Age prove some edge caching; they do not prove browser caching is disabled or absent. Browsers can apply heuristic freshness. |
| Manifest delivery gap | Fresh `/cesium-assets.json` response: 404, branded StratOps HTML, `Error from cloudfront`, AmazonS3 server header, no Cache-Control, and Age. This is not a successful manifest response. It does not distinguish a missing S3 key from routing, permissions/custom-error mapping or a cached error. |
| Browser capture amplifies repeat network activity | Disable cache is checked. Preserve log is also checked, so duplicate rows may span operations/navigations. Duplicate rows alone do not establish retries, duplicate Viewer construction or exact concurrency. Normal cold clients still require reliable delivery. |

Live URLs use this prefix, with no cache-busting query parameters in the inspected requests:

```text
https://app.stratops.space/assets/cesium/releases/1.143.0-a5a84813c72de745-standard/Workers/
  createPolygonGeometry.js
  createGroundPolylineGeometry.js
  chunk-ML6MR2RA.js
  chunk-BDWA46XV.js
  chunk-IEITL4VO.js
```

Evidence: `.generated/gnss-worker-recurrence-20261113/delivery.json` and report; fresh three-request sample `.generated/cloudfront-permanent-20261113/live-sample.json` at November 14 01:27:02 UTC. Fresh sampling was sequential, not a concurrency test. Failing request IDs must be copied from the original browser capture/HAR; screenshot characters were not guessed. Successful sampling request IDs cannot substitute for failing IDs.

## Application and worker audit

`webpack.config.js` defines `CESIUM_BASE_URL` to the release directory and copies the complete standard Cesium distribution there. `scripts/cesium-assets.cjs` hashes final emitted bytes in the manifest. Standard production does not activate the opt-in compact worker loader. No changing timestamps, random query strings or application retry loops were found in the standard worker-resolution path.

`TaskProcessor.createWorker` resolves the worker entry with `buildModuleUrl` and starts module workers. `createGeometry.getModule` dynamically imports geometry implementations relative to its worker directory, caching successful modules within that worker. Static `./chunk-*.js` dependencies stay in the same release directory. Native module maps are per worker; repeated URLs across separate worker contexts can still lead to separate network requests, depending on browser caching/coalescing. HTTP/2 multiplexing does not eliminate HTTP requests.

`Primitive.js` has a shared creation-processor pool sized `max(hardwareConcurrency - 1, 1)`, started lazily by `TaskProcessor.scheduleTask`. A primitive's instances are divided across processors. Combine processing, transfer testing and other Cesium features can start additional workers. The local polygon static graph has 32 unique files; the full manifest has 392 assets, not 392 eager worker requests. Instance count, CPU cores, already-loaded modules and other active layers determine actual startup overlap. No exact browser worker count or request peak is measured here.

GNSS uses asynchronous 200-cell GroundPrimitive batches and optional GroundPolylinePrimitives. Borders and satellite ground tracks also use ground polylines. Their worker activity can overlap. Changing a batch size changes geometry scheduling/primitive work; it is not a dependable network cap and need not reduce unique URLs. Smaller batches can add combine/draw overhead. Do not change batching or cap Cesium internals as a speculative quota workaround.

`index.js:ensureSatelliteViewer` memoizes a promise and exposes one operational Viewer. Its retry path does not construct another Viewer after `window.__warzoneViewer` exists. The separate `initWarzoneIntroGlobe` caller belongs to the recording/intro page; report capture also has its own page flow. These source locations do not prove duplicate Viewers in an operational page. No duplicate operational initialization was established; actual execution still requires browser tracing. No new prefetching, polling, timers, retries or asset requests are added by this plan.

## Manifest role and 404 diagnosis

`cesium-assets.json` is required locally by the release tools. It records the release base, variant, version and final hashes used by integrity checks. Searches found no application runtime fetch of this file. Cesium resolves its base from the compiled constant, not the public manifest. Restoring the public manifest alone cannot fix dependency rejections.

The current deployment script explicitly uploads the root manifest as JSON, after live asset checks and before HTML; it then invalidates that path. A publicly reachable matching manifest is valuable for release provenance. The 404 is inconsistent with the expected deployed artifact contract, but does not prove which uploader/configuration produced the site. The worker prefix alone does not establish the deployed application Git commit.

To determine the cause, inspect these in order without editing:

1. CloudFront distribution E2EFV9935XX3MV → Behaviors. Identify the first matching behavior for `/cesium-assets.json` and separately the worker URL. Record origin, priority, policies and associated functions. Inspect URI rewrites in any associated function/Lambda version.
2. Origins → selected origin: record exact bucket, origin path, S3 website versus REST endpoint and OAC. Translate the public manifest URL to the actual object key, accounting for origin path/rewrites. Do not assume it is the same origin as the workers.
3. S3 → actual bucket → actual key → Properties/Permissions: establish existence, Content-Type, Cache-Control and access through the configured origin identity. Do not make the bucket public. Inspect the corresponding worker objects' metadata too.
4. CloudFront → Error pages: record 403/404 mappings and TTLs. Compare the branded 404 bytes with the configured custom page. An error mapping can hide an origin 403 or 404. Inspect existing request logs if already available.
5. Review saved release artifacts and the actual upload command/tool, including exclusions. The repo's current script does publish the manifest; no repository evidence identifies the historical uploader. If the object/configuration is now correct but the CDN still serves an error, an approved path-specific invalidation may be needed. Do not invalidate before establishing the cause.

## Recommended delivery contract for review

Keep the same distribution, private S3 origin/OAC and rendering technology. Review existing behavior precedence before changing anything. Scope cache changes to public static assets; do not alter API, authentication or signed/private resources.

| Path/class | Origin metadata / viewer contract | CloudFront configuration to review |
| --- | --- | --- |
| `/assets/cesium/releases/*` | `Cache-Control: public, max-age=31536000, immutable`; JS `application/javascript` or `text/javascript`; JSON `application/json`; WASM `application/wasm` | Existing correct S3 origin/OAC, GET/HEAD, HTTPS, compression. No application cookies, query strings or unnecessary headers in the cache key; normalized Accept-Encoding for supported compression. Permit one-year TTL. |
| Content-hashed public app JS/CSS | Same one-year immutable header, correct JS/CSS MIME | Existing correct static origin, shared cache key. Confirm files really have content hashes before treating them as immutable. |
| Entry HTML and `/cesium-assets.json` | `no-cache, no-store, must-revalidate`; `text/html` / `application/json` respectively | Effective minimum TTL 0; use supported caching-disabled behavior where appropriate. Root `/` must resolve the same intended entry. |
| Non-versioned public supporting files | Existing short policy, e.g. `public, max-age=300`, correct MIME | Honor short origin TTL; avoid a positive minimum TTL that exceeds the intended lifetime. These remain rollback risks. Do not apply immutable caching to mutable URLs. |
| Missing/failed assets | Real failure status; no HTML-as-JS or HTTP-200 fallback | Inspect origin error caching. Custom pages cannot resolve CloudFront-generated LimitExceeded. |

AWS currently lists custom cache/origin-request/response-header rules as Business/Premium features; Free has a limited number of behaviors and supports managed rules. Do not assume a custom policy can be created on the current plan. First inspect the actual plan and supported managed policies. A managed CachingOptimized policy, if available for this distribution and appropriate to these public immutable paths, excludes cookies/query strings and supports a one-year maximum TTL; its positive minimum TTL is unsuitable for no-store HTML. CachingDisabled, where supported, is appropriate for mutable entry metadata. Verify the actual managed policy details in the console. Do not upgrade merely to create a policy; ask AWS how to satisfy the required origin-header contract within the existing plan if controls are restricted.

Origin Cache-Control and CloudFront cache policy solve different problems. Correct origin headers give browsers explicit reuse rules. Cache-key/TTL settings improve CDN reuse and origin traffic. They do not eliminate viewer requests on a genuinely cold load and cannot be claimed to lift an unidentified restriction. A response-header override can change what browsers see without repairing origin metadata or the CDN's own TTL decision; trace both.

## Exact AWS Console evidence and proposed correction sequence

Read-only review first:

1. AWS Console → CloudFront → Distributions → E2EFV9935XX3MV. Confirm alias `app.stratops.space`, enabled/deployed status and current pricing plan/usage/notifications under the distribution's plan controls. Save configuration/screenshots privately.
2. Behaviors → winning worker behavior → view details. Record path/order, target origin, protocol/methods, compression, cache-policy ID and TTL/cache-key settings, origin-request policy, response-header policy, function and Lambda associations. Inspect associated policy definitions, not just names. Check response-header removal of Cache-Control.
3. Origins and S3 → inspect exact worker key and manifest key as above. Record object Cache-Control/Content-Type/ETag and compare served bytes to the saved release manifest. Inspect lifecycle expiration rules: old release directories and hashed bundles must remain available for cached entries/existing sessions.
4. Monitoring → Requests/5xxErrorRate around November 14 01:05–01:25 UTC (November 13 20:05–20:25 Toronto). Minute aggregates cannot show sub-second concurrency. Use existing logs if present; capture x-edge-result-type, x-edge-detailed-result-type, time, path and request ID where available. Do not enable paid logs/metrics or change WAF rules for this investigation.
5. AWS Console → Service Quotas → Amazon CloudFront, and associated Lambda service only if actual Lambda@Edge associations exist. Record applied quotas. A quota list alone may not expose internal enforcement. AWS Support needs failing IDs, UTC times, POP and paths to identify it.

Prepared corrections, dependent on that evidence and production approval:

- If origin metadata is wrong, prepare a metadata-only repair of the exact verified release objects, preserving bytes and all other needed metadata, or publish a new immutable release prefix when bytes must change. `s3 sync --cache-control` does not repair metadata on objects it skips. Do not overwrite existing immutable worker content or issue a broad bucket copy/delete.
- If the response policy strips Cache-Control, prepare a narrowly scoped policy correction using controls available on the existing plan. If behavior/cache-key configuration is wrong, prepare a change only for public vendor assets, preserving origin/OAC and unrelated routes. Record before/after values for approval.
- Restore the manifest at its correct mapped key from the exact deployed saved artifacts, or correct its routing if already present. Do not publish a locally rebuilt manifest as proof of a different live build. Keep this mutable file non-cacheable; invalidate only affected paths after an approved repair if stale CDN metadata/errors remain.
- If AWS identifies an enforcement quota, use its supported remedy within existing service/plan constraints. No measured limit is available to select a worker throttle or justify an upgrade. Keep the AWS investigation open even if warm-cache symptoms disappear.

The repo already implements the intended S3 cache metadata, asset integrity gates, explicit `-Execute`, HTML-last ordering and retention without `--delete`. No confirmed source defect justifies rewriting that system. Keep both Cesium and frontend live gates enabled. The current missing immutable headers would fail the Cesium gate; do not bypass it to publish.

An additional release acceptance step should GET the public manifest, require 200/JSON/no-store and compare it to the exact saved deployment artifact after the approved manifest publication/invalidation. This is operator validation, not an added per-user request. The current script's pre-publication asset gates validate using its local manifest, not a fetched public manifest; that distinction remains a limitation.

## Concurrent and browser verification

Do not stress production to discover a threshold. Use the existing isolated staging distribution/API and premium test accounts. Keep production DNS/API blocked in the load runner. No staging deployment or test traffic is authorized by this document itself; the application task authorizes only preparation.

1. Build and verify the full standard release locally. Deploy to approved staging with the existing script and explicit staging bucket/profile/distribution/origin. Complete sequential `cesium-assets.cjs --verify-live` and `frontend-assets.cjs --verify-live`. Verify the public manifest independently. These are prerequisites, not concurrency acceptance.
2. Use `scripts/gnss-load-test.cjs` and its example/flow adapter. Prepare private authenticated storage states, real UI selectors and isolated dependencies as described in `cesium-gnss-reliability.md`. Its default command prints a plan; `--execute` is explicit opt-in and rejects the production host. Use distinct accounts/states. First calibrate one session and compare recorder coverage with worker-target DevTools/HAR; missing worker events must not count as no traffic.
3. Run the existing 16 scenarios: [1, 10, 20, 30] independent clients × [cold, warm] × [simultaneous-load, GNSS-after-load], progressing only after smaller cohorts pass. A fresh browser cache must use normal cache behavior; warm means priming the same context. CDN cache state is separate; do not globally invalidate production or add cache-busting parameters. No request interception or automatic retries to hide failures.
4. Exercise real operational GNSS and borders. Include normal aircraft/naval tracking and satellite focus in the existing optional feature steps/manual review without changing their code or camera behavior. Confirm one Viewer, continued frame progress, correct coverage/picking, existing focus controls and no lifecycle regressions. Existing harness coverage is not automatically complete for other features.
5. Chrome Network: Preserve log; Disable cache unchecked. For first failure save URL/status, exact UTC time, MIME, Cache-Control, Age, X-Cache, X-Amz-Cf-Id/Pop, Initiator, Timing and worker-target requests. Export sanitized HAR and privately review URLs/bodies for credentials. Retain original evidence privately. Capture runtime loaded HTML/bundle names and manifest identity.
6. Compute request overlap from HAR `startedDateTime` and duration using intervals [start, end), separately for worker URLs and all traffic. Count duplicate URLs by worker initiator/context and navigation; distinguish memory/disk-cache reuse, validation and transferred bodies. Do not infer transfer counts from the number of request rows. Existing recorder peakConcurrentRequests includes all requests, not a dedicated measured worker-only peak; activeWorkerRequests is not a historical peak. HAR analysis is necessary for exact worker concurrency, and multiple worker targets must use a comparable clock.
7. Require zero worker HTTP/MIME/network failures, zero LimitExceeded and no rendering stoppage in all cohorts. Review genuine GNSS data and all affected feature visuals, not just HTTP success. Record client CPU/GPU/RAM and server/CDN metrics already available so load-generator exhaustion is not misclassified as CloudFront capacity. Compare cold-start time, p95 worker timing, byte transfers, repeat requests and frame responsiveness to the same-environment baseline. No numerical performance gain or latency SLO is claimed here.

After staging acceptance and AWS clarification, production changes require separate approval and a limited normal-use cold/warm acceptance run. A green sequential deployment gate or one warm session cannot close this incident.

## Performance, rollback and untouched systems

Expected, unmeasured benefit of explicit browser immutable caching: fewer repeated transfers on later sessions; improved CDN cache keys can reduce S3 GETs. Neither changes the first cold module graph or native pool size. No runtime cost is added by this documentation. Full release validation already performs 392 sequential asset GETs per deployment, plus frontend checks. Do not add per-user manifest polling/preloads or cache-busting retries.

Preserve previous complete Cesium release prefixes, hashed JS/CSS and saved entry/manifest artifacts. Review remote lifecycle rules before claiming retention. Roll back application publication using saved prior HTML/manifest and any changed mutable supporting files, then invalidate only affected mutable entry routes. Roll back configuration with its saved prior values only after approval. Do not rebuild an old checkout and assume byte identity; do not delete newer releases or overwrite immutable bytes. Mutable supporting assets can affect old and new sessions simultaneously and require explicit artifact restoration.

Naval/air ingestion, mapping, GLBs, tracking, satellites, camera controls, GNSS observations/geometry/reveal, Viewer lifecycle and CSS are untouched. No EC2 resizing, paid service enablement, plan upgrade or production mutation is included.

## Checks actually run for this preparation

Only this document was added as a source-controlled deliverable; no runtime function or deployment configuration was edited. Ignored evidence/build artifacts are under `.generated/cloudfront-permanent-20261113/`. Pre-existing `apps/worker/src/sources.json` and `dev/assets/css/root.css` changes were left intact. AWS CLI is unavailable, no AWS connector was found, and no authenticated AWS configuration was inspected. Console steps above are therefore review instructions, not findings about actual account settings.

| Check | Result |
| --- | --- |
| `node --test --test-isolation=none scripts/tests/cesium-assets.test.cjs scripts/tests/frontend-assets.test.cjs scripts/tests/gnss-concurrency.test.cjs scripts/tests/gnss-load-test.test.cjs` | 17 passed, zero failed; `integrity-tests.log`. Synthetic concurrency fixtures are not browser/CDN capacity tests. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/deploy-production.test.ps1` | 17 mocked deployment-safety scenarios passed, no AWS/network calls; `deployment-tests.log`. |
| `npm run build -- --config .generated/cloudfront-permanent-20261113/webpack.config.cjs` | Passed, webpack 5.108.4, 108,979 ms; `build.log`. The wrapper redirects output/CopyPlugin destinations only, preserving checked-in production output. Existing large-module Babel notices remain. |
| `node scripts/cesium-assets.cjs --verify .generated/cloudfront-permanent-20261113/build` | Passed, 392 assets; release remains `1.143.0-a5a84813c72de745-standard`. |
| `node scripts/frontend-assets.cjs --verify .generated/cloudfront-permanent-20261113/build` | Passed, 24 application JS/CSS assets. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/cloudfront-permanent-20261113/build` | Passed; no AWS calls. |
| `node --check` for cesium-assets.cjs and gnss-load-test.cjs; `git diff --check` | Passed; Git reports an existing CRLF normalization warning for sources.json. |
| Fresh production sampling | Three sequential GETs only; entry/chunk 200 without Cache-Control, manifest 404. No concurrent production traffic was generated. |
| App/browser and staging concurrent acceptance | Not run. No claim of production reliability, full application regression coverage or resolved LimitExceeded. |

## References

- [AWS 503 troubleshooting](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-503-service-unavailable.html): several possible 503 sources, not identification of this quota.
- [AWS custom error pages](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-custom-error-pages.html): CloudFront does not use custom pages for Limit Exceeded/Capacity Exceeded.
- [AWS cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cache-key-understand-cache-policy.html): positive minimum TTL can override origin no-store/no-cache.
- [AWS S3 request handling](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorS3Origin.html): compatible simultaneous origin requests can collapse; viewer requests remain.
- [AWS managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html): inspect actual policy TTL/key values.
- [AWS flat-rate plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html): plan feature availability and monthly delivery adjustment policy. These docs do not establish this incident's exact threshold or a need to upgrade.
