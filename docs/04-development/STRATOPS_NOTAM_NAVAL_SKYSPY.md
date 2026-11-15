# NOTAM, maritime warnings and SkySpy integration

## Routing, window and provider correction (2026-11-15)

The current backend registers `/notices` in `apps/api/src/index.js` (the implementation filename is `routes.notices.js`, not `routes/notices.js`). Local Express preview and webpack development now mount that same current router at `/api/notices` through `server/local-notices.cjs`, before generic upstream proxying. Vite dev/preview use the same bridge, plus an `/api` proxy for other API families. Production Express preview keeps the configured `API_UPSTREAM_URL` proxy and preserves HTTP statuses. Deploy the updated API together with frontend changes. Restart an already-running local dev/preview process to load server configuration; this session did not restart the user's process. A read-only request to the pre-existing port 4173 still returned HTML 404, while newly started isolated actual preview/production-server HTTP tests returned valid notice JSON and preserved 403/404 responses.

The Published Notice window now reuses `bindFloatingPanel`, factored from the existing floating-panel implementation in `essential.js`. Header pointer capture, RAF-coalesced movement, viewport bounds, release/cancel/blur cleanup and disposal are shared. It starts on the right rather than over the left Map Layers panel, retains its position during this page session, and clamps on resize. New header selectors extend existing cursor rules without changing CSS declarations. Loading, unconfigured, empty, access-denied and unavailable states contain no fabricated notice fields. Detail fields render only for a selected valid record. Actual drag/viewport/input-suppression tests use the real binder in a DOM harness; real browser appearance/touch behavior remains unverified.

Aviation Edge's documented `https://aviation-edge.com/v2/public/notams?key=...&location=...` request and response fields are implemented using the official endpoint example at https://aviation-edge.com/airport-and-fir-notam-data-through-api/ and response examples at https://aviation-edge.com/notam-api/. The supplied YAML download was inaccessible; no undocumented query parameters were invented. The adapter requires one explicit location, server-side key, enablement and usage approval. Original notice text is preserved; ICAO parsing supplies only published geometry/validity. Source military relevance is set only from explicit military wording.

Autorouter uses its documented `/v1.0/notam`, Bearer OAuth access token, JSON `itemas`, `offset` and `limit=100` (https://www.autorouter.aero/wiki/api/notams/, https://www.autorouter.aero/wiki/api/authentication/). It fetches at most three sequential pages per five-minute cache refresh and reports `partial` when total coverage exceeds that bound. Published Garmin coordinates convert by `90 / 2^30`; Q-line circles remain approximate. `modified` is stored as update metadata, not invented issue time. Valid authorization/usage agreement and scoped locations are required. There is no automatic credential exchange or bypass; an expired token produces source denial/backoff.

ICAO lists realtime and stored NOTAM products (https://www.icao.int/api-data-samples), but a verified callable endpoint/account contract was unavailable. DTN's public documentation exposed no usable OpenAPI download in this environment (https://devportal.dtn.com/catalog/Aviation/dtn-notams-api/documentation). Both have explicit disabled contract-gate diagnostics and make no requests; no endpoint or response mapping was guessed. AAI, NAVAREA IX, SkySpy and approved imports remain independently supported. No enabled/approved credentials for these live providers were found in the inspected root/API environment files. No actual authorized upstream response was retrieved, so none is described as live.

Cross-provider canonicalization uses original identifier/year and geographic authority scope, preserves distinct known issuing offices, and never deduplicates on polygon overlap. NOTAM provider-specific revision labels do not create duplicate polygons. Preferred records use explicit verification, source update timestamps, geometry completeness and a documented tie-break (autorouter before Aviation Edge); source publications and original text remain in up to eight source references per canonical record. Cancellation/replacement records supersede matching prior identities. Cached imports/provider rows survive individual outages with their prior freshness; entirely unavailable configured sources return errors, and unconfigured sources return a clearly labelled empty collection.

New correction files: `server/local-notices.cjs`, `apps/api/test/notices-integration.test.js`, `apps/worker/test/notices-dragging.test.js`. Additional modified files: `server.js`, `webpack.config.js`, `vite.config.js`, `apps/api/src/routes.notices.js`, `apps/shared/notice-providers.js`, `apps/shared/geospatial-notices.js`, `dev/assets/js/warzone-notices.js`, `dev/assets/js/essential.js`, `dev/assets/css/warzone-components.css`, `apps/worker/test/geospatial-notice-lifecycle.test.js`, the placeholder environment example and this document. Prior camera-stutter working changes remain untouched.

Correction verification: 112/112 API tests; 42/42 focused notice/HTTP/widget tests; complete worker suite 625/677 with the same 52 recorded baseline failures and no new failure names. Integrity/harness tests passed 17/17, and mocked deployment checks passed 19/19. Production build passed in 100,076 ms; its isolated candidate is `.generated/notices-correction-20261115/build`. Post-build gates verified 392 Cesium assets, 24 application JS/CSS assets and 64 GLB assets. `-ValidateOnly` passed without AWS calls. All 3,710 CSS declarations matched the original values after line-ending normalization; only selectors changed. Evidence lives in `.generated/notices-correction-20261115/`.

Actual HTTP tests started isolated instances of the real `server.js` app and verified local preview and production-proxy paths with fixtures, including empty collections, configured-source validation failures, and 403/404 preservation. The UI tests execute the actual shared drag binder and owner, not a separate drag implementation. Chrome launch failed `spawn EPERM`; real visual/camera interaction remains unverified. Vite and `vite-jsconfig-paths` are not installed in this checkout; Vite configuration evaluation/proxy rewriting passed with dependency stubs, but a real Vite process was not run. Normal webpack development and Express preview retain their existing commands. The user's pre-existing preview process was not restarted, and the isolated candidate was not copied over its current frontend output.

Commercial response schemas do not provide public per-record publication URLs in the verified examples. Their source links therefore identify the provider reference, not a newly invented issuing-authority document URL. Autorouter query validity can be scoped with `AUTOROUTER_START_VALIDITY` / `AUTOROUTER_END_VALIDITY` (Unix seconds); no global or automatic camera-driven source polling is introduced. Live activation still requires authorized credentials/account permissions, approved usage and explicit location scope. Existing process/environment restart procedures apply when credentials change. No production environment, AWS resource, dependency/lock file, HTML template, root sizing token, tracker model or camera function was changed by this correction.

Local implementation, 2026-11-15. No deployment, AWS change, production environment edit, commit or push was performed. The feeds default to disabled. This is a working implementation for controlled acceptance, **not a claim of production or visual acceptance**.

## Exact changed files

| File | Change |
| --- | --- |
| `apps/shared/geospatial-notices.js` | Canonical validation, parsers, geometry/time filters and correlation |
| `apps/shared/notice-providers.js` | Disabled official adapters and strict SkySpy notice contract |
| `apps/shared/skyspy-client.js` | Bounded REST client, caching, approval/host checks and backoff |
| `apps/shared/skyspy-stream.js` | Separate native/Socket.IO transports, heartbeat, reconnect and disposal |
| `apps/api/src/routes.notices.js` | Shared notice service, source health, query/overlap routes and ETag |
| `apps/api/src/index.js` | Mount notice router and dispose service on server close |
| `apps/worker/src/tracking/aircraft/providers/skyspy.js` | Optional aircraft source in existing normalization/identity pipeline |
| `apps/worker/src/tracking/aircraft/registry.js` | Register default-disabled SkySpy after existing providers |
| `dev/assets/js/warzone-notices.js` | Owned overlays, pick/details/list/filter UI and cleanup |
| `dev/assets/js/warzone-layers.js` | Four off-by-default layers, isolation/restoration preservation and unsubscribe |
| `dev/assets/js/warzone-region-selector.js` | Additive unsubscribe return from existing region subscription API |
| `dev/assets/js/essential.js` | Initialize notice owner once; skip unrelated event work for notice-only changes |
| `dev/assets/css/warzone-components.css` | Extend existing GNSS panel selector; declarations unchanged |
| `scripts/import-geospatial-notices.mjs` | Approved offline HTML/PDF/text import and exclusive output creation |
| `scripts/examples/stratops-notices.env.example` | Disabled placeholder-only configuration |
| `apps/api/test/geospatial-notices.test.js` | Parser, source, query, security, import and transport regressions |
| `apps/worker/test/geospatial-notice-lifecycle.test.js` | Real Cesium entity lifecycle, coexistence, focus and aircraft integration |
| `apps/worker/test/tracking-provider-health.test.js` | Include new default-disabled provider in expected registry order |
| `apps/worker/test/stratops-ui-improvements.test.js` | Include four explicit notice defaults in startup contract |
| `docs/04-development/STRATOPS_NOTAM_NAVAL_SKYSPY.md` | Configuration, boundaries, checks and release/rollback runbook |

## Implementation and ownership

`apps/shared/geospatial-notices.js` normalizes the canonical notice fields, validates geometry, derives temporal states, parses ICAO NOTAMs and reviewed maritime warning text, and computes geographic/time overlaps. Original publication text is retained and displayed through `textContent`; generated summaries remain a separate field. Identity uses issuing authority + notice identifier/year + version. Independent issuers remain separate. Replacement/cancellation references supersede their corresponding prior notices.

Supported geometry is a verified point, point plus published radius (nautical miles internally), or a single-ring polygon of at most 1,000 vertices. Rings close automatically; invalid coordinates, degenerate rings and detected self-intersections reject the record. Dateline coordinates are unwrapped for validation/correlation and split into longitude intervals for regional queries. Circle containment uses great-circle distance. Polygon containment uses geographic ray casting with longitude unwrapping; it is not certified flight-planning geometry, and polar/very large areas require review. Holes and multipolygons reject rather than silently losing geometry; separate distinct notice records can represent separately published areas.

Compact ICAO coordinates, separated DMS, degrees/decimal minutes and decimal degrees with hemispheres are supported. NOTAM Q/A/B/C/D/E/F/G fields include Q code, FIR, approximate Q-line influence circle, E-line polygons, FL/surface/AMSL/AGL text, EST/PERM and NOTAMN/R/C. DAILY UTC schedules, including overnight periods, are evaluated. Unrecognized recurring schedules and missing/ambiguous times remain `unknown`; they are never invented. Maritime publication prose, handwritten documents and arbitrary date formats are not silently interpreted. Administrators must supply reviewed UTC validity, issuer, source URL, military relevance and activity classification in the import context. A warning published “until cancelled” is not itself a cancellation record.

`apps/api/src/routes.notices.js` adds:

- `GET /notices`: `minLat,maxLat,minLon,maxLon`, `layers` (comma-separated layer IDs), `status`, `military=all`, `type`, `offset`, `limit` (1–200). Default: military-related active/upcoming/unknown notices. Includes health, counts and missing-location coverage; 30-second private HTTP caching and ETag/304.
- `GET /notices/overlap?lon=...&lat=...&observed_at=...`: validated observed coordinates/time, at most 50 candidate comparisons. Results explicitly distinguish published notice, geographic overlap and temporal overlap; they do not establish participation or intent.

One refresh is shared per API process, with a 60-second cache. Approved import files are capped at 5 MB / 5,000 records. Previously validated source records survive source outages with their previous fetch time; normal validity still expires them. Storage is bounded process memory, not a new database or durable historical archive. Multiple API processes have independent caches/connections. The service exposes disposal and closes its stream when its HTTP server closes.

`dev/assets/js/warzone-notices.js` owns one CustomDataSource, one pick handler, one polling timer, one active request, one optional RAF queue and one card. Four independent, default-off toggles are integrated into Operational Areas. Their state survives leaving tracker/orbital mode. Notice-only toggles bypass unrelated event resynchronization. A record matching multiple enabled layers renders once. Pagination bounds the visible page at 200 records; eight new entities are submitted per animation frame. Unchanged entities are reused. Removing all notice toggles aborts requests and destroys only owned resources. Region changes cancel stale work. No additional Cesium Viewer or independent render loop is created.

Polygons and published circles use translucent orange StripeMaterialProperty fills rotated diagonally, with orange outlines; verified points use point markers. Runtime configuration `window.__stratopsConfig.notices` accepts `opacity` (0.01–0.5) and `stripes` (2–64), read once on initialization. No existing CSS property values or root sizing tokens were changed: the new panel extends the existing GNSS selector and reuses Military Base widget classes. Visual equivalence, hatch quality, outline/platform limits, terrain occlusion and responsive positioning still require real browser acceptance. These entities can initialize standard Cesium geometry workers; this feature does not resolve the separate CloudFront delivery restriction.

The notice card provides original text, source link, authority, validity, schedule, altitude, precision, provenance, coordinates, close/collapse/list/copy controls and explicit area focus. Area focus refuses to move the camera while the shared asset-focus controller or native tracking owns it. On-demand overlap checks use existing tracker snapshot getters, not provider requests or per-frame scans. Temporal overlap requires a source observation timestamp; browser receipt time is not substituted.

## Sources and transport contracts

AAI and Pakistan Navy/NAVAREA IX adapters are **disabled/import-only**. The AAI summaries are a JavaScript application; an approved machine-readable API and reuse contract were not established. Pakistan Navy publishes warning/weekly products, but technical page access does not establish collection or redistribution rights. There is no scraper or remote-document fetcher. Official URLs:

- https://aim-india.aai.aero.in/notam-summaries
- https://hydrography.paknavy.gov.pk/navarea-ix-warnings/
- https://hydrography.paknavy.gov.pk/weekly-notice-to-mariners/

`scripts/import-geospatial-notices.mjs` processes a local administrator-approved TXT/HTML/machine-readable PDF using the existing PDF.js dependency. HTML scripts/styles are removed without execution. PDFs are bounded to 10 MB, 100 pages and 500,000 extracted characters; no OCR or runtime archive parsing. One reviewed notice is imported per invocation; split multi-notice documents into reviewed entries. Output uses exclusive creation and will not overwrite an existing file.

```powershell
node scripts/import-geospatial-notices.mjs PRIVATE_DOCUMENT.pdf PRIVATE_REVIEWED_CONTEXT.json NEW_PRIVATE_NOTICES.json
```

Context must contain `usageApproved: true`, `format: "notam"` or `"maritime"`, `provider`, `issuer`, `sourceUrl`, reviewed UTC validity/classification and any required publication metadata. For generic Notices-to-Mariners document entries omit the parsing format and supply `sourceId`/`noticeType` explicitly. Review output before adding it to the private import array. Do not commit copyrighted publications, private imports or credentials.

SkySpy documentation describes a self-hosted service, not an authorized hosted subscription endpoint:

- REST: https://skyspy.readme.io/docs/rest-api
- Native transport: https://skyspy.readme.io/docs/websocket-api
- Socket.IO: https://skyspy.readme.io/docs/socketio-message-protocol

The REST adapter uses `/api/v1/notams/`, `/notams/tfrs/`, `/aviation/airspace/`; it also validates documented nearby/airport/stats request paths. No upstream mutation or refresh POST is sent. Notice REST docs omit full row schemas. Canonical records with authoritative `issuer`, `sourceUrl`, `sourceId` and `rawText`, or reviewed raw ICAO text, normalize; unknown row contracts reject and increment diagnostics. **A field mapping for the actual deployed service must be verified before enabling its notices.** No issuer, publication URL or exact boundary is inferred from a numeric provider ID.

REST has server-only X-API-Key, fixed path/query allowlists, configured HTTPS host allowlist, private literal-host rejection, redirect rejection, 15-second timeout, 5 MB streamed response bound, 16-response cache, pending request sharing and 60-second TTL. 401/403 isolate requests for a day; other failures back off exponentially and respect Retry-After (up to seven days). There is no immediate retry storm. DNS aliases to private networks are not a complete SSRF boundary; only administrator-controlled approved public hosts belong in the allowlist, with deployment egress restrictions as appropriate. Browser clients never select upstream URLs.

Native realtime uses existing `ws`, `/ws/all/`, Bearer subprotocol authentication, JSON subscribe/ping actions and typed events. Socket.IO uses `/socket.io`, namespace `/`, event subscriptions and its own client API; it is never emulated using raw native frames. Reconnect is bounded exponential backoff with jitter, heartbeats, generation guards and stop/disposal. Auth-denial close codes stop reconnecting. The API notice relay uses native transport only: no NOTAM Socket.IO topic was verified. Aircraft streaming uses the configured explicit transport; REST remains available when streaming is unsupported.

The optional Socket.IO adapter is unit-tested with an injected client. Its official `socket.io-client` runtime library is **not installed or locked in this checkout**. Installation was attempted and blocked by the environment's npm cache/proxy. Do not activate Socket.IO mode as a release feature until that dependency is installed through the normal reviewed dependency process and the deployed protocol is verified. Native transport requires no new dependency.

The optional worker SkySpy provider uses documented `/aircraft/?military=true`, normalizes REST/readsb-style stream units, strict ICAO24, real source timestamps and provenance, and enters the existing provider/registry/identity-fusion path. Endpoint military claims are metadata only, not independent military verification. Other providers remain configured. The existing bundled registry still provides identity evidence. Missing/stale/future timestamps and unsupported partial deltas cannot fabricate fresh positions; REST reconciles them. Streams are bounded to 2,000 aircraft. Feed coverage depends on the configured receiver/service and is not assumed global.

Existing Orbital Intelligence already retrieves CelesTrak military GP JSON in `apps/api/src/strategic-satellites.js`; it was left untouched. No Zendir integration, tracker/GLB change, camera rewrite or synthetic asset was introduced.

## Configuration and local verification

Placeholder-only configuration: `scripts/examples/stratops-notices.env.example`. No live feed has been enabled or successfully retrieved. Set only backend configuration through the existing private environment process; frontend builds must never receive SkySpy credentials. `NOTICES_ENABLED` and import approval control approved document notices independently of SkySpy. The SkySpy enablement, per-domain switches, usage approval and hostname allowlist are all required for that source. Realtime is separately opt-in.

Evidence is under `.generated/notices-20261115/`. Targeted tests exercise parsing, malformed geometry, dateline handling, unknown timing, cancellation, source isolation, credentials, cache/dedup/backoff, native/Socket.IO separation/reconnect, API limits/ETags, offline extraction, military registry enrichment, focus/layer independence and cleanup. The lifecycle harness completed 25 cycles with zero remaining owned data sources, handlers, timers, frames or panels after each disable; layer/region subscriptions are removed on disposal. This measures object lifecycle counts, **not browser GPU/RSS, FPS or a memory-usage reduction**. Native browser acceptance remains unavailable in this environment; existing Chrome tests fail at launch with `spawn EPERM`.

Executed results: targeted 34/34 passed; complete API suite 106/106 passed; complete worker suite 623/675 passed with 52 failures matching the recorded pre-existing 52 failure names; integrity/harness group 17/17 passed; deployment orchestration 19/19 mocked safety scenarios passed. New full-worker assertion failures encountered during integration were corrected through explicit startup defaults and updated expected provider/default lists. `failure-comparison.json` records no additional failure names against `.generated/airplanes-live-20261115/all-worker.log`. This is a comparison with recorded baseline evidence, not a new checkout/replay of that old version. The complete failure list remains in the comparison artifact. Offline import tests exercised both HTML and an actual machine-readable PDF; native HTTP handshake-denial coverage confirms that a 403 does not reconnect.

Commands:

```powershell
node --test --test-isolation=none apps/api/test/*.test.js
node --test --test-isolation=none apps/worker/test/*.test.js
node --test --test-isolation=none scripts/tests/cesium-assets.test.cjs scripts/tests/frontend-assets.test.cjs scripts/tests/gnss-concurrency.test.cjs scripts/tests/gnss-load-test.test.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/deploy-production.test.ps1
npm run build -- --config .generated/notices-20261115/webpack.config.cjs
node scripts/cesium-assets.cjs --verify .generated/notices-20261115/build
node scripts/frontend-assets.cjs --verify .generated/notices-20261115/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/notices-20261115/build
```

The wrapper only redirects production output/CopyPlugin destinations. Checked-in production output is preserved. Test counts and build outcome are recorded in the completion report and logs. Existing full-worker failures must not be called clean merely because the notice-specific tests pass.

Final source build passed: webpack 5.108.4, 85,249 ms (`build-final-source.log`). Post-build verification passed for all 392 Cesium assets and 24 application JavaScript/CSS assets. Deployment `-ValidateOnly` also verified 64 GLB model assets and passed without build or AWS requests. The standard Cesium release identity in this current checkout is `1.143.0-4106863949fcb3b1-standard`; this does not establish the identity of live production. Thirteen JavaScript syntax checks and `git diff --check` passed. No production asset files, package/lock files, environment files, tracker rendering modules, GNSS renderer or satellite modules changed in this task.

## Controlled deployment and rollback (not executed)

1. Complete source-use review and verify the actual deployed SkySpy schema/auth/capabilities on an authorized staging host. Keep unavailable sources disabled. Run one permitted REST request, then only the matching documented native or Socket.IO handshake. Stop on denial. No credentials are needed to test approved local imports with SkySpy disabled.
2. Run the checks above, review the complete working diff and existing worker baseline failures. Package the reviewed API source, worker source, all shared modules, API/worker package/lock files and **complete `apps/worker/data/aircraft/` registry plus manifest** together using the existing server release process. Exclude environment files and private publications. No database migration is required.
3. Stage the backend release and private source configuration first through the existing operator-managed server process. Inspect `pm2 status` and actual process paths. Repository ecosystem names are `warzone-api` and `warzone-worker`; conditional restart commands are `pm2 restart warzone-api` and `pm2 restart warzone-worker`. Do not restart unrelated services or use `--update-env` blindly. This session did not inspect remote PM2 state or run either command.
4. Build frontend for the isolated staging API using the existing `STRATOPS_API_BASE_URL` mechanism. Save previous entry HTML/manifest/bundles, then use the existing deployment script and gates. First plan, without `-Execute`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -BuildDirectory .generated/notices-20261115/build -TargetEnvironment staging -Profile YOUR_STAGING_PROFILE -Bucket YOUR_STAGING_BUCKET -DistributionId YOUR_STAGING_DISTRIBUTION -PublicBaseUrl https://YOUR_STAGING_HOST
```

Only an authorized operator adds `-Execute` after reviewing the actual targets and artifact. Preserve immutable Cesium releases and old hashed bundles; do not delete or overwrite old release trees. The existing script owns HTML-last publication and entry invalidations. This feature adds no AWS policy or cache setting changes. Production promotion is a separate authorized operation after acceptance.

5. In real Chrome test Air+Naval+GNSS+Orbital together, all notice toggles, last-tracker/orbital exit, region changes, missing-location list, past/current notices, card/source/copy controls and area focus while asset focus is active. Compare Military Base/GNSS card appearance on mobile and desktop. Measure cold/warm requests, console errors, frame responsiveness, GPU/RSS and memory after repeated toggles. Verify satellite/GLB movement and entry/auth remain intact. A successful HTTP response alone is insufficient.
6. Roll back the backend using saved prior server artifacts and disable only the new source flags; restart only affected services via the existing procedure. Roll back frontend using the saved previous HTML/manifest and retained exact bundles, with the existing entry invalidation process. Never clear browser storage, change login behavior, restore over unrelated working changes, or delete retained Cesium releases to roll back.

Outstanding acceptance: upstream credentials/reuse permission/deployed payload contracts, optional Socket.IO runtime dependency, real browser visual/performance acceptance and resolution or explicit acceptance of existing worker-suite failures. The separate CloudFront `503 LimitExceeded` restriction remains unresolved.
