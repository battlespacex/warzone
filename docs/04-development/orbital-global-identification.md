# Operational orbital performance and global military identification

Local implementation, 2026-11-15. Baseline `c47a1be3`. Evidence is under `.generated/global-identification-20261115/`. The initial working tree was clean. No GNSS file/interface/test, decorative satellite implementation, root.css, GLB byte, model-selection mapping, camera-follow algorithm, API route/contract, database schema, environment file or AWS setting was changed. No commit, push, deployment or database write occurred. External probes were read-only.

## Root causes and corrections

- Operational satellite orientation previously read CSS three times for every property evaluation. Only the operational renderer now shares those angle reads for 250 ms, with explicit invalidation through the existing scale-refresh hook. Decorative getters/rendering remain unchanged.
- A small population of up to 64 satellites was still built synchronously; each asset creates multiple propagated samples. Populations above eight now yield in batches of at most eight/about six ms. Pointer dragging/wheel activity defers background construction and widget work until input settles. This is cooperative scheduling, not preemptive execution or a guarantee that model decoding cannot stall a device.
- Fresh API objects discarded satellite propagation/sample caches even when orbital elements were unchanged. Satrec validity now includes the actual OMM signature; unchanged OMM retains samples/orientation, while changed elements rebuild the affected asset. Deleted records are pruned. Record lookup uses an ID index.
- Routine focus telemetry recreated 18 detail rows, restarted the arrival animation, forced layout and scrolled again. Rows now update in place; animation/scroll occurs on selection. Unfocus resets the arrival identity. Unchanged filter options and region lists retain their DOM. Region propagation groups have a bounded five-second cache; current-region/record changes invalidate it.
- Aircraft country prefixes conflated several states, and military qualification accepted role/type overrides as ownership evidence. Shared exact-ID/evidence resolution now distinguishes `verified_military`, `strongly_supported_military`, `possible_military` and `unknown`. Type/allocation alone never qualifies a contact. A reported operator or provider classification is supported evidence, not independently verified ownership. Commercial names containing military words are not automatically accepted.
- Four/five-character addresses were padded, and readsb non-ICAO `~` IDs became plausible transponder IDs. Complete six-hex validation now preserves leading zeros and rejects truncated, non-ICAO, malformed and reserved addresses. Deduplication retains conflict evidence. Source model descriptions take precedence over generic type labels; A330 no longer automatically gets the MRTT name. Missing RFAL/H64 role aliases are recognized without changing GLB mappings.
- Registry enrichment previously followed an unpinned moving CSV and silently overwrote duplicate IDs. The default is now a bundled, hashed, pinned server-only source. Malformed rows are counted, identical duplicates are counted, and conflicting IDs are quarantined. Exact-ID registration disagreement stays ambiguous. Existing explicit source-URL overrides retain their legacy refresh behavior and must be reviewed separately.
- Naval matching already had important verified-identity conflict protections. These remain. Its configured registry now uses indexed exact MMSI/IMO lookup, checksum/format/date validation and duplicate reporting. Conflicting matches remain present for rejection. Names, aliases, prefixes, MID and AIS type never grant verified military identity or a specialized GLB. Candidate prefixes from the workbook expand only candidate recognition. Invalid identifier-only contacts no longer reach persistence; valid IMO-only contacts still reconcile to later MMSI observations.

## Exact files/functions

| File | Changes |
| --- | --- |
| `dev/assets/js/warzone-mil-sats.js` | Operational orientation cache; `getSatelliteRecord`, `getSatrec`, `propagateRecord`, `createSampledPosition`, `getSatelliteRegionGroups`, `renderSatelliteRegionList`, `showFocusCard`/`hideFocusCard`, `setSelectOptions`, `updateControlsOptions`, `updateDefaultEntities`, `fetchOrbitalData`, `startTimers`, `cleanupLayer`, enable/diagnostics/scale-refresh paths. New `orbitalMetrics`, `orbitalInputBusy`, `orbitalRenderTick`, `bindOrbitalPerformance`, `getOperationalSatelliteAngles`. Input/render/observer cleanup is owned by layer enablement; no competing animation loop. |
| `apps/shared/aircraft-identifiers.js` | New strict `normalizeIcao24`. |
| `apps/shared/aircraft-identity.js` (new) | `getAircraftAllocation`, `resolveAircraftIdentity`; official state ranges, evidence/confidence/conflicts and provenance. |
| `apps/shared/military-taxonomy.js` (new) | Workbook SHA-256, 45 country/service definitions, 175 family labels, 43 prefix candidates and 48 naval type labels. These are reference hints, not invented individual identities. |
| `apps/shared/maritime-allocations.js` (new) | `maritimeAllocation`; 292 MID entries inspected from the [ITU table](https://www.itu.int/gladapp/Allocation/MIDs). Administration allocation is separate from ownership. |
| `apps/shared/naval-identity.js` | `validMmsi`, `validImo`, `createNavalIdentityRegistry`, `navalCandidateEvidence`, strict identifier parsing and indexed resolution; existing class/model selection unchanged. |
| `apps/worker/src/tracking/aircraft/providers/plane-alert-db.js` | Audited parser, pinned/checksummed initialization, exact-ID enrichment, conflict/provenance diagnostics. |
| `apps/worker/src/tracking/aircraft/providers/readsb.js`, `skylink.js` | Shared complete-address normalization. |
| `apps/worker/src/tracking/merge.js` | Strict identity grouping; preserve aircraft conflict/provenance across providers; naval identifier parsing. Position corroboration and source-time logic retained. |
| `apps/worker/src/tracking/naval/normalize.js` | Do not manufacture numeric IDs by deleting arbitrary non-digit characters. |
| `apps/worker/src/adsb-worker.js` | `getCountryFromIcao`, `toLegacyAircraft`, qualification and metadata builders use shared evidence; role aliases, source naming precedence, stage rejection/provider diagnostics. |
| `apps/worker/src/ais-worker.js` | Indexed configured identity registry, invalid-ID qualification, conservative candidate expansion, provider/registry validation diagnostics. Existing unchanged-write/history suppression retained. |
| `apps/worker/src/tracking/provider-health.js` | New credential-free `providerPipelineSnapshot` includes all configured adapters, disabled reasons, scope, last attempts/success/status and available stage/quota counts. Existing per-provider concurrency, request deadlines and backoff retained. |
| `scripts/import-military-aircraft.mjs` (new) | Reproducible import with exact commit and expected Git blob; refuses overwriting an output directory. |
| `apps/worker/scripts/tracking-provider-diagnostics.mjs` (new) | Configuration-only default; optional single probe of existing public air adapters. No persistence, paid enrichment or naval subscriptions. |
| `apps/worker/data/aircraft/` (new) | Original CSV, manifest, upstream `LICENSE`, `NOTICE.md`, scoped `.gitattributes` to preserve exact CSV bytes across checkouts. |
| Tests | New `global-military-identification.test.js`; extended `orbital-performance.test.js`; targeted updates in `tracking-plane-alert-db.test.js`, `tracking-skylink-provider.test.js`, `naval-identity-integrity.test.js`, `naval-worker.test.js`, `feature-resource-lifecycle.test.js`. Fixtures now use valid complete IDs/checksums; no application observations are fabricated. |
| This report | Exact results, limits and release procedure. |

The shared satellite-model module and Air/Naval frontend renderer files did not require new edits. Their existing GLB paths, model priority/visibility, root.css sizing and camera controls remain the source of runtime behavior. Existing renderer/filter/retention/focus/toggle tests were included; this is not a live visual acceptance claim.

## Registry and coverage evidence

The [Plane Alert military source](https://github.com/sdr-enthusiasts/plane-alert-db) is pinned to `f7b46dbdeb29ea01c43eca2db21940d60fa7f36e`. GitHub's contents response for that commit confirmed blob `c9a44640aeee5e9bc3856e49af0170148a588224`. The local original bytes match that Git blob.

- SHA-256: `3e619fe9549a01ea58f3d884b1e1c86acbb67d284212fc9879a07c5b52a9c099`.
- Imported: `2026-11-15T11:24:51.794Z`.
- 9,856 input records; **9,854 valid individual ICAO24 IDs; zero duplicates; two rejected invalid identifiers** (CSV lines 197 and 198).
- Upstream ODbL/contents notices are retained. Enriched evidence carries attribution, source/version and import/check date. Import time is not a claim of current independent ownership verification. Review redistribution obligations before production publication of derived data.
- The workbook contains 45 countries but **zero individual aircraft or naval-ID rows**. It cannot supply a verified world naval registry. No fictional MMSI/IMO/hull list was installed. Existing legitimate configured naval records remain the authority, subject to explicit validation diagnostics.
- Official address allocations use [ICAO Table 9-1 as reproduced by ICAO](https://www.icao.int/sites/default/files/ESAF/APIRG/APIRG-26/EN/WPs-ENG/APIRG26-WP03F12-App-Guidelines-for-ICAO-24-Bits-Adresses-Assignment.pdf). The included ranges cover 44 workbook jurisdictions. Unmapped addresses, including the workbook's Taiwan allocation case, retain reported country or remain unknown; they are never guessed into another state. Exact registry/operator evidence can still identify them independently of country allocation. This is not a complete world address-allocation database.
- All 45 workbook service sets pass supported-operator qualification checks. The 18 required aircraft families pass the real worker role pipeline, including missing/ambiguous ownership tests. Registry-only records never create positions or tracks.

At `2026-11-15T11:33:09Z`, a single read-only public-adapter probe returned:

| Provider | Actual result |
| --- | --- |
| ADSB.lol | HTTP 200; 85 fetched/normalized observations; 37 valid positions. This is one snapshot, not a global coverage guarantee or proof of frontend display. |
| Airplanes.live | HTTP 403; BACKOFF. |
| ADSB One | HTTP 403; BACKOFF. |
| OpenSky / SkyLink | Enabled in local config; not probed. Authentication/quota and live delivery remain unverified. |
| ADSB.fi / ADS-B Exchange | Disabled in effective local config. |
| Plane Alert | Enabled; bundled 9,854 records verified locally; static identity only. No live position coverage. |
| AISStream / Fintraffic / VesselAPI | Enabled in local config; live subscriptions/enrichment not probed. |
| AISHub / Kystverket / BarentsWatch / MarinePlan / MarineTraffic / OpenAIS / Spire / VesselFinder | Disabled in local config. |

These are local effective flags, not inspected production environment variables. Provider files alone do not establish operation. No paid call/subscription was silently enabled. A failed provider does not discard successful peers; a cycle still waits for the slowest configured adapter's own bounded deadline. Immediate streaming persistence of partial provider responses was not introduced.

Worker diagnostics expose fetched/normalized/valid counts where adapters provide them, canonical and persisted totals, qualification reasons and identity conflicts. Existing API freshness/region selection and browser pipeline/render diagnostics must be correlated using source timestamps and stable IDs. Production API-to-visible-GLB counts and geographically representative live observations remain unmeasured. Public receiver gaps and military emissions restrictions cannot be fixed by identification rules.

## Measurements and tests

Same Node fixture, baseline vs current source; 45 satellites and 13,500 orientation evaluations:

| Metric | Before | After |
| --- | ---: | ---: |
| Orientation CSS getter calls | 40,500 | 3 |
| Orientation CPU time | 60.76 ms | 53.15 ms |
| Cold activation CPU time across submitted work | 34.66 ms | 29.66 ms |
| Warm repeated ON: SGP4/sample/orientation allocations | 0 / 0 / 0 | 0 / 0 / 0 |

These are single-run CPU fixtures with instrumented CSS getters, not Chrome style/layout, wall-clock completion latency, FPS, RSS or GPU memory measurements. The updated cold work yields between construction callbacks. The dense 300-satellite fixture completes in approximately 38 callbacks with no warm propagations; elapsed callback figures vary with host load. Drag tests defer construction and then restore all records. Ten-cycle lifecycle tests reject stale callbacks and return owned listeners/tasks/entities to zero. New API objects with unchanged OMM reuse properties; one changed OMM rebuilds one satellite. Focus details retain all 18 rows without repeat arrival/scroll.

Final results:

- Focused identity/provider/orbital/GLB/lifecycle group: **184 passed**.
- API suite: **81 passed**. Script suite: **56 passed**. PowerShell deployment suite: **19 mocked scenarios passed**, no AWS writes.
- Full worker suite: **660 tests; 608 passed; 52 failed**. All 52 names match the previously recorded failing names. Existing harness globals, outdated CSS/UI assertions and Chrome `spawn EPERM` failures remain; the whole suite is not green. Logs are retained, not suppressed.
- Production build, output-only wrapper: **passed, 105,985 ms**. Verified **392 Cesium assets, 24 JS/CSS assets, 64 GLBs**. Local deployment `-ValidateOnly` passed without AWS requests. All 64 GLBs also passed decoder/geometry checks and exact-byte local HTTP delivery against the final build. The raw identity CSV is absent from frontend output.
- JavaScript syntax and Git whitespace checks passed. No GNSS/CSS/model-byte/API/build-config diff in this task.

Browser launch remains blocked by `spawn EPERM`; live application camera smoothness, Air/Naval/Orbital GLB placement/movement/focus, memory plateau and GPU cleanup are **unverified**. The runtime counters now expose frame intervals, page long tasks, propagation/sample/entity updates, widget/list rebuilds, render requests and input deferrals. Frame intervals include requestRenderMode idle periods; long tasks cover the page, not exclusively satellites. Do not convert these into idle FPS or claim that the reported freezes or 1 GB memory behavior are conclusively resolved.

## Reproduction and deployment steps (not executed)

Local checks and read-only config report:

```powershell
node apps/worker/scripts/tracking-provider-diagnostics.mjs
# Optional single public-air probe; no writes or paid providers:
node apps/worker/scripts/tracking-provider-diagnostics.mjs --probe-public-air
node scripts/cesium-assets.cjs --verify .generated/global-identification-20261115/build
node scripts/frontend-assets.cjs --verify .generated/global-identification-20261115/build
node scripts/model-assets.cjs --verify .generated/global-identification-20261115/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/global-identification-20261115/build
```

Reproduce the registry in a **new** directory, preserving original bytes:

```powershell
node scripts/import-military-aircraft.mjs --input apps/worker/data/aircraft/plane-alert-mil.csv --out-dir .generated/registry-review-f7b46db --version f7b46dbdeb29ea01c43eca2db21940d60fa7f36e --expected-blob c9a44640aeee5e9bc3856e49af0170148a588224
```

1. Review the complete working diff and manifest, including naval-registry validation rejects and explicit `PLANE_ALERT_DB_SOURCE_URL` overrides. Local inspection found no registry override; production has not been inspected. Preserve existing environment files. Resolve the provider 403s with supported provider/account configuration and licensing; do not disable qualification or hammer endpoints.
2. Ship `apps/shared/`, affected `apps/worker/src/` files and the complete `apps/worker/data/aircraft/` directory together through the existing worker release process. Omitting data/manifest is a release error. No schema migration, dependency install, API route change or API restart is required by this patch. Restart the existing ingestion worker after an authorized worker release; verify its actual PM2 name/path first (`pm2 status`). The documented process name is `warzone-worker`, but remote state was not queried. The conditional operator command is `pm2 restart warzone-worker`; do not use `--update-env` or restart unrelated services.
3. Build/release the frontend through the existing standard, versioned Cesium deployment system. Use the approved isolated staging API configuration and output-only wrapper for staging. The current local artifact uses existing build defaults; do not treat it as an isolated staging API build. Keep API/worker environment files unchanged.
4. Review a staging dry-run with explicit targets:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -TargetEnvironment staging -BuildDirectory YOUR_REVIEWED_STAGING_BUILD -Profile YOUR_STAGING_PROFILE -Bucket YOUR_STAGING_BUCKET -DistributionId YOUR_STAGING_DISTRIBUTION -PublicBaseUrl https://YOUR_STAGING_FRONTEND
```

5. Only a separately authorized operator adds `-Execute`. The existing gates verify complete Cesium, application and model assets before HTML publication. Preserve old hashed bundles/releases and exact rollback HTML/manifest. No production deploy, invalidation or repair was performed here.
6. In authenticated desktop staging, compare baseline/current during continuous drag/zoom, incoming orbital updates and model loading; test exact-ID focus/unfocus, details, collapse, region changes, all three trackers together and ten OFF/ON cycles. Record counters, Chrome Task Manager/heap/GPU memory, screenshot/video and failures. Confirm one Viewer and unchanged camera/loader/login behavior. Keep separate GNSS development intact.
7. Promote only after browser acceptance, provider/attribution review and resolution of blocking test failures. The earlier CloudFront 503 issue is separate and is not fixed or verified by this work. No production infrastructure change is included.
