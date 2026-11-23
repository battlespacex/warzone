# StratOps API quota protection and rollout

Updated **2026-11-21**. The backend shares persistent request reservations, cached responses and backoff across ingestion workers and API instances. Monthly budgets retain a 20% reserve; the documented anonymous ADSB.lol and OpenSky daily budgets retain 10%. The user confirmed that all existing accounts remain on FREE plans. Account balances and billing anniversaries remain **UNKNOWN** until established by configuration or provider headers.

The user applied the database migration. On 2026-11-21, both RPCs, conflicting reservations and persistence were verified through the configured production service-role connection. API/worker request wrappers also shared the real database successfully with synthetic provider transports. See [deployment readiness results](provider-quota-readiness.md) for evidence and the remaining EC2 gates. This implementation has not been deployed by this task; no upstream provider request, subscription change, commit or push was performed. The unrelated notice UI, marketing and styling changes in the working tree are outside this implementation.

## Why the existing controls needed changes

Some budgets and caches lived only in a worker process, so restarts and additional workers could spend separate allowances against one key. The legacy SkyLink NOTAM dispatcher did not share aircraft enrichment's accounting. API-server aircraft searches were another outgoing ADSB.lol path. A missing SkyLink or VesselAPI quota header also became numeric zero, incorrectly blocking enrichment.

The shared layer reserves cost before dispatch. Pagination, retries and timeouts retain their reservations. It never refunds a failed attempt on an assumption that the provider did not charge it. Existing provider flags, licensing gates, identity caches, aircraft/vessel timestamps, source registries and fallback selection remain in their original modules.

## Allowances and existing configuration

Published figures below come from `STRATOPS_PROVIDER_QUOTA_AND_REDUNDANCY_REVIEW_2026-11-17.md` in the supplied ZIP. These are supplied research figures, not a new account inspection. Numeric configuration was checked again on 2026-11-21 by reading only an allowlist of quota-related settings; no credential values appear here.

| Integration | Unit and supplied free allowance | Existing configured restriction | Shared protection and confidence |
|---|---|---|---|
| NOTAC | 10,000 credits/month; delta 3/page, search 2/page; first day of month UTC | 96 attempts/day, two delta pages/run, six in-process scopes, 30-minute scope cache | 8,000-credit usable monthly ceiling, paced credits, independent shared 96/day budget with a bounded burst; `X-Credits-Limit/Remaining/Cost` reconciliation; persistent regional snapshots and cursor. Starting balance UNKNOWN. |
| SkyLink aircraft and legacy NOTAM | Supplied research: approved free trial 1,000 requests/month; user confirms no paid subscription | Production env file: 1,000/month, one-hour aircraft enrichment floor, minimum remaining 50; seven-day identity/negative cache | Shared 800-call trailing 30-day budget when billing reset is UNKNOWN; retained legacy restrictions; both endpoint families share a matching key or explicitly configured account alias. No claim of a renewed trial or new unused 1,000 calls. |
| VesselAPI | 150 requests/month | Production and local env files: 150/month, five-hour minimum, minimum remaining 10; seven-day static identity cache | Shared 120-call usable trailing budget; imports known old counters. Verified absolute reset plus remaining headers switch pacing to the observed remaining cycle. Static enrichment does not provide a live position. |
| REST Countries | 1,000 requests/month; response caching up to three days | Existing enabled/key gates, bounded code lookup, three-day process cache | 249-entry independent local ISO2/ISO3 reference and name aliases handle routine lookups with **zero provider calls**. Explicitly enabled unresolved fallback still uses the shared conservative budget and three-day response cache. |
| ADSB.lol | Anonymous 500 requests/day/IP; other supplied free tiers require their actual authentication/entitlement | Built-in military client sends no key; existing provider floor three seconds | Anonymous usable budget 450/day across worker and API-server lookup paths, replenished throughout the day. Military ingestion uses approximately one request/192 seconds on this tier. Optional search bursts leave a token for ingestion. Higher-capacity sources retain their own existing schedules. |
| OpenSky | Anonymous 400 credits/day; standard authenticated free 4,000/day; global states cost 4 | Local and production env files: 900,000 ms polling floor; OAuth reuse and one refresh retry | Anonymous usable 360 credits/day, up to 90 global attempts/day; standard authenticated usable 3,600 credits/day. Authenticated polling retains the existing 15-minute floor. A feeder allowance is not assumed. Each authentication retry is separately reserved. |
| Airplanes.live | External account allowance UNKNOWN | Existing code: default 480 attempts/day, 180-second minimum and cache; configured provider options remain authoritative | Daily cap and interval shared across instances and endpoint paths. The 480 figure remains an internal restriction, not a claimed provider entitlement. |
| Copernicus Sentinel Hub | Supplied general-user research lists 10,000 requests/month and 10,000 processing units/month; account-specific entitlement and per-request PU bound UNKNOWN | Local env: 30 previews/day, 120 catalog requests/day. Production env: **3 previews/day**. Code defaults: 120 catalog/day and 20 requests/minute | Atomic request-attempt reservations enforce configured catalog, preview and rate caps. Actual `X-ProcessingUnits-Spent` is recorded. An independently configured PU ceiling requires an explicit request weight; an unknown PU weight does not silently become one request = one PU. Existing preview service continues under its existing caps. |
| CelesTrak | Two-hour element update/fair-use interval; no numeric monthly allowance established | Two-hour refresh, disk cache, dated stale fallback and backoff | Shared two-hour per-resource refresh and response cache. Cache age is carried into the orbital payload's fetch timestamp; an API-instance restart does not make the same elements look newly downloaded. |
| GPSInterference.com | Numeric quota UNKNOWN | Latest snapshot 60 seconds; dated snapshots 24 hours; existing per-date pending/cache and failure cooldown | Shared response cache and in-flight ownership retain these intervals across API instances. Observation dates and published timestamps are preserved. No per-hexagon provider requests were added. |
| Cloudflare Radar | Supplied global API ceiling 1,200 requests/5 minutes/user; no monthly Radar allowance established | Existing authorized-source gates and 15-minute source cache | Shared rolling five-minute request cap, cached responses and persistent Retry-After/backoff. Other applications using the same account must participate in the same accounting or be reflected in account evidence. |
| OTX | Numeric official allowance UNKNOWN; supplied 10,000/hour figure is unconfirmed | Existing source cache, incremental pagination and source health | Shared 15-minute response cache and backoff; no invented 10,000/hour hardcoded entitlement. |
| AISHub | Supplied provider policy: no more than once/minute | Existing 60-second floor and member-access gate | Shared account interval and persistent error holds; existing access checks remain. |
| AISStream and Fintraffic | Exact account connection/subscription caps UNKNOWN | Existing backend WebSocket/MQTT subscriptions and reconnect behavior | One shared ingestion owner per configured source/key, renewed by existing poll cycles. A 90-second ownership expiry closes the socket. This is an internal duplicate-ingestion control, not a claim that the provider permits exactly one connection. |
| DVIDS, GDELT, CISA, FAA and supported legacy intelligence paths | Account quotas generally UNKNOWN | Existing pagination, source health, source scheduling and approval gates | Same request wrapper; DVIDS/GDELT/FAA have short exact-response reuse, CISA retains six-hour reuse. Dedicated status and legacy CISA callers can consume the same response while independently normalizing it. Unique queries and source provenance are retained. |
| NASA FIRMS | Supplied research: 5,000 transactions/10 minutes; active endpoint transaction weights UNKNOWN | Existing legacy scheduling | Shared response reuse and error backoff; no fabricated transaction weight. Configuring a transaction ceiling requires its verified per-endpoint weight. |

The local `.env.production` file describes intended configuration in this checkout. It does not prove the deployed EC2 environment, active provider flags, current account balance or deployed migration version.

## Monthly pacing and unknown history

For a verified cycle, usable headroom is `max(0, allowance × (1 − reserve) − known consumption)`. It is released across the remaining days to the verified reset. Fractional shares accumulate; small balances are not rounded up to one paid request every day. Carryover is bounded by the account ceiling and a daily burst allowance.

SkyLink/VesselAPI response headers containing an absolute future reset timestamp and a remaining count establish an observed cycle. For example, an allowance of 1,000, 800 reported remaining, a 200-call reserve and five days remaining permits 600 usable calls, paced at 120/day before other restrictions. A numeric reset value with undocumented duration units does not establish an anniversary.

When the reset is unknown, SkyLink, VesselAPI and remote REST Countries fallback use a trailing 30-day internal budget. A new ledger initially earns only one day's share of conservative capacity. **UNKNOWN is not converted to a fresh provider balance.** For example, 1,000 calls with a 20% reserve gives an internal maximum of 800 over 30 days, initially 26 whole calls; provider remaining and reset still display UNKNOWN. A known prior 115 calls against VesselAPI's 120-call usable ceiling leaves five internal calls, approximately one every six days.

Existing SkyLink/VesselAPI JSON counters are imported once per host/file/month when their month overlaps the trailing window, including a preceding calendar month. Previously persisted fixed-window reservations are migrated conservatively without resetting usage. Unknown dates on imported reservations are retained for 30 days from import. Separate legacy files on different hosts can overlap; conservative imports may overcount until their dates age out. Account headers and an operator-verified aggregate are preferable to guessing which old counters were duplicates.

New outgoing reservations are shared by all participating instances. The new layer cannot reconstruct requests that another application or a previous deployment made without retaining evidence. A lost ledger or unknown starting balance therefore cannot be a mathematical guarantee about the provider's real remaining credits. The first authorized request can encounter exhaustion; a 402/429 then persists a hold rather than creating a retry storm.

## Modeled forecasts

These are capacity calculations, not measured production consumption. Existing cache hits, provider floors, failed attempts, earlier usage and fallback activity change actual outgoing totals.

| Scenario | Modeled consumption bound |
|---|---|
| Old five-second anonymous ADSB.lol dispatch with no cache/budget hold | Up to 17,280 attempts/day; supplied anonymous 500/day would be consumed in about 42 minutes. Actual previous traffic was not measured. |
| Protected anonymous ADSB.lol account | At most 450 reserved attempts/day across military ingestion and search; bounded optional bursts, with refill across the day. Free-tier capacity cannot sustain a five-second global download. |
| Authenticated OpenSky at the configured 15-minute floor | At most 96 ordinary global attempts/day, or 384 credits/day, before separately counted retries; below the 3,600-credit usable standard free ceiling. |
| Anonymous OpenSky | Up to 90 global attempts/day at four credits each; approximately 16-minute spacing. |
| SkyLink, no recorded prior consumption | Internal maximum 800 calls in a trailing 30-day window, about 26.67/day; initial capacity 26 calls. Remaining provider balance is UNKNOWN. The one-hour identity floor still applies; legacy NOTAM requests share the matching account budget. |
| VesselAPI, no recorded prior consumption | Internal maximum 120 calls/30 days, about four/day; original five-hour identity floor still applies. |
| VesselAPI with known prior 115 calls | Five usable internal calls over the next 30 days, accruing approximately one every six days. |
| NOTAC, 30-day cycle with verified zero prior usage | 8,000 usable credits, about 266.67/day; at most 88 complete delta pages on the first day, additionally subject to the independent 96-attempt daily cap and within-day spreading. Actual opening balance is not assumed zero. |
| Copernicus using local production-file settings | Up to 120 catalog attempts/day and three preview attempts/day, each independently reserved and subject to the minute cap. PUs remain a separate measured/configured unit. |
| Repeated recognized country aliases or ISO lookups | Zero outgoing REST Countries requests, regardless of worker restart or country-code alias. |
| Repeated same CISA request across dedicated and legacy dispatchers | One successful outgoing download per shared six-hour cache window; parser/provenance processing remains separate. |

## Backend configuration and diagnostics

Production selects the Supabase quota store by default. All instances sharing an account must use the same Supabase database and identical account policies. `PROVIDER_QUOTA_STORE=file` is the development fallback; `PROVIDER_QUOTA_DIRECTORY` must be a durable shared directory for cooperating processes on one host. Separate local disks do not coordinate multiple machines. Neither a failed shared store nor a missing migration silently opens an unlimited in-memory fallback.

`PROVIDER_QUOTA_POLICIES_JSON` accepts policies keyed by provider ID, such as `skylink`, `vesselapi`, `notac`, `adsb_lol`, `opensky` and `copernicus`. Server-side fields include:

- `account`: a non-secret operator alias, only when distinct keys are verified to share one entitlement. Identical keys already share accounting automatically. Do not place API keys in this JSON.
- `plan`: the verified/user-confirmed plan label and evidence scope.
- `limits`: independent limits with stable `id`, `unit`, `allowance`, `period`, `reserve`, `paced` and evidence fields. Matching IDs/units replace the corresponding internal limit; other limits are additive. Monthly reserves must be between `0.1` and `0.2`.
- `period`: `month` for documented UTC calendar resets, `anniversary` with an explicit verified `anchor`, `fixed` with a verified duration/anchor, `rolling` with a duration for a trailing rate window, or independent `day`, `hour` and `minute` windows. Do not select a monthly anniversary from a guessed date.
- `costs` and `endpointCosts`: verified unit weights, with endpoint overrides selected by the longest matching path prefix. Every configured unit requires an explicit request weight. For Copernicus, a processing-unit cap requires a verified positive maximum processing weight, for example through `COPERNICUS_MAX_PU_PER_REQUEST`; catalog requests do not consume that processing weight.

For example, a verified common SkyLink account can be assigned `{"skylink":{"account":"verified-shared-skylink-account","plan":"FREE (user-confirmed)"}}`. This aliases the two configured SkyLink paths without changing an allowance or inventing a billing date. Do not alias unrelated provider products solely because their names match.

`PROVIDER_QUOTA_EGRESS_ID` identifies a shared anonymous outbound-IP budget when that is the provider's billing scope. Keep it consistent for instances behind the same egress. `PROVIDER_QUOTA_LEGACY_DIRECTORY` can point the legacy importer at an explicitly retained counter directory; the default is the existing worker `.cache` directory. None of these settings activates a provider.

Run the operator CLI from the repository root after configuring the backend store:

```powershell
node apps/worker/scripts/provider-quota-status.mjs
```

The CLI uses the existing worker environment loader and quota database; it does not contact providers. It can initialize internal ledger records. Its JSON output contains plan scope, reservations by unit/day/month, attempt costs, last status/402/429, cache-hit percentage, holds and modeled forecasts. `remaining` is a provider-reported snapshot or null/UNKNOWN. `internalHeadroom` and `currentlySpendable` describe individual internal budgets before all companion limits and rate/backoff checks. An internal release date is not a provider reset date. Legacy files are imported before the first guarded request, so a diagnostic-only record is not proof of complete historical usage.

## Manual deployment and rollback

1. The user-applied [supabase-provider-quota.sql](supabase-provider-quota.sql) now passes service-role read/CAS checks on the configured database; do not reapply it merely to reset state. The SQL defines RLS and service-role-only RPC access. Runtime anonymous-role denial remains unverified because no distinct anonymous key is configured in the inspected backend environment.
2. Retain old identity counter JSON files, current quota rows, provider headers/log evidence and verified account aliases. Do not delete or zero counters to make a rollout appear healthy. Ensure participating hosts have synchronized UTC clocks.
3. Service-role RPCs, competing reservations, shared API/worker accounting, cache reuse and a separate-process restart have passed against isolated rows in the configured database. Preserve those counters. Verify the deployed EC2 startup environment and code match the inspected configuration; the local connection test does not inspect live PM2 child processes. Complete any outstanding role-denial and operational-flow checks before giving an unconditional production approval.
4. Supply the same quota policy and Supabase service-role configuration to the worker and API instances through the existing server configuration mechanism. Keep credentials backend-only. Preserve provider enablement and licensing flags. Unknown reset/balance values remain unset.
5. Deploy the reviewed backend through the existing manual process. Drain old ingestion workers before starting their replacements; an old unguarded process cannot participate in shared quota accounting. Start one instance, inspect backend-only diagnostics, then add the other intended instances to the same store.
6. Check cache reuse, NOTAC cursor restoration, an expired aircraft search, ordinary air/naval fallbacks and socket ownership. A quota hold should affect its source while other authorized services continue. Cached positions must retain their original observation age; the manual aircraft route rejects positions older than 90 seconds and reports a budget hold as unavailable rather than falsely reporting a newly live position.
7. For rollback, stop/drain the replacement workers, preserve the quota table and file counters, and restore a reviewed backend release and its compatible policy. A release that does not understand trailing reservations requires a reviewed counter migration before it can safely spend again. Retaining the SQL table is safer than deleting usage history; do not drop RPCs while any running worker still needs them.

The local file store writes a flushed temporary file and atomically replaces the state while holding an exclusive directory lock. A crashed process can leave a lock. After confirming all processes using that directory are stopped and the counter file is intact, an operator can remove only the identified stale lock and resume. Never delete the counter file as lock recovery.

## Tests and build evidence

The targeted suite covers reservation contention, optimistic-version conflicts, independent daily/hourly/monthly windows, weighted NOTAC pages, fractional pacing, real/unknown reset handling, fixed-window migration, overlapping legacy history, restarts, duplicate users, regional cursor persistence, quota errors, fallback independence, stale aircraft age, orbital cache timestamps, large compressed catalogs and existing provider normalization/authentication contracts.

The latest targeted run passed **164 tests**, with **zero failures** and **one host-restricted child-process test skipped** (165 total); this was rerun during deployment-readiness verification. Its subprocess spawn is denied with EPERM in this environment. Two independent Node invocations additionally verified persistence against the actual configured Supabase database: the first process exhausted a synthetic ten-credit test budget and the second process was refused another reservation. Twelve competing API/worker reservations accepted exactly five two-credit attempts. A second check exercised the real request wrappers with synthetic transports, accepting five calls and holding seven; six API/worker cache readers caused one synthetic download. These tests used separate readiness records, retained afterward, and made no external provider requests. Runtime anonymous-role denial and deployed EC2 process state remain unverified.

Reproduce the focused quota cases from the repository root:

```powershell
node --import ./apps/shared/test/provider-quota-isolation.js --test --test-isolation=none apps/worker/test/provider-quota.test.js
```

The worker/API package test commands also preload isolated quota directories, so fixtures never consume a developer's retained provider counters. The broader targeted command adds the existing SkyLink, VesselAPI, OpenSky, ADSB.lol, Airplanes.live, naval-provider, AISStream, Fintraffic, naval-intelligence, optional-status, status-pipeline/cache, Copernicus, NOTAC, GNSS and manual-aircraft-lookup test files. Test logs are under `.generated/quota-continue-regression.log`; fixture data and isolated build output remain under `.generated`.

The **2026-11-21 production webpack build passed**, compiling with webpack 5.108.4 in approximately 150 seconds. The command was `npm run build -- --config .generated/quota-build.config.cjs`. The scratch wrapper uses the existing production configuration, redirects output/copy destinations to `.generated/quota-build` and disables parallel minification for this execution environment. No repository build configuration or production assets were modified by that wrapper. The result is recorded in `.generated/quota-continue-build.log`. JavaScript syntax checks and the scoped `git diff --check` also passed. Browser entry, authentication, viewer initialization, operational provider freshness and production behavior require staging/browser verification; unit tests and a build do not certify those flows.

## Exact implementation files and functions

The initial quota implementation was already present in repository commit `9531231b` when the implementation continuation resumed. This task did not create that commit. That continuation changed `provider-quota.js`, its test fixture/preload and this rollout reference. The later deployment-readiness pass changes documentation and isolated verification artifacts only; pre-existing source edits remain in place.

| File | Functions or integration points |
|---|---|
| `apps/shared/provider-quota.js` | `resolveQuotaPolicy`, `quotaWindow`, `bucketFor`, `effectiveLimits`, `reserveQuota`, `reconcileQuota`, `responseResetAt`, `createQuotaFetch`, `getProviderQuotaDiagnostics`; accounting, pacing, caching and holds |
| `apps/shared/provider-quota-store.js` | `createFileQuotaStore`, `createSupabaseQuotaStore`, `getQuotaStore`, `fingerprint`; atomic persistence and account keys |
| `apps/shared/provider-quota-axios.js` | `createQuotaAxios`; existing legacy Axios transport adapter |
| `apps/shared/provider-stream-lease.js` | `createProviderStreamLease`; shared stream ownership and expiry |
| `apps/shared/country-reference.js` | `lookupLocalCountry`; local ISO/name aliases |
| `apps/shared/notice-providers.js` | `createNotacProvider`, `createCommercialNoticeProviders`; guarded pages and persisted regional cursor/snapshot |
| `apps/worker/src/tracking/http.js` | `fetchJson`; shared guard and preserved timeout/error contract |
| `apps/worker/src/tracking/aircraft/providers/airplanes-live.js` | `createAirplanesLiveProvider` request helper; shared configured daily/interval controls |
| `apps/worker/src/tracking/aircraft/providers/opensky.js` | `createOpenSkyProvider` state fetch; stable account identity and bounded OAuth retry |
| `apps/worker/src/tracking/aircraft/providers/skylink.js` | `headerNumber`; absent quota headers remain unknown rather than zero |
| `apps/worker/src/tracking/naval/providers/vesselapi.js` | `headerNumber`; same missing-header correction |
| `apps/worker/src/tracking/naval/providers/aisstream.js` | `createAisStreamProvider`, `ensureConnected`, `shutdown`; shared stream lease |
| `apps/worker/src/tracking/naval/providers/fintraffic.js` | `createFintrafficProvider`, reconnect callback, `waitForConnection`, `shutdown`; shared stream lease |
| `apps/worker/src/copernicus-service.js` | `copernicusFetch`; atomic configured attempt caps and separate processing weights |
| `apps/worker/src/index.js` | Module-local Axios instance; guarded legacy API dispatch, including SkyLink NOTAM |
| `apps/worker/src/naval-intel/ingest.js` | `createNavalIntelRunner`; guarded DVIDS and existing naval-intelligence transport |
| `apps/worker/src/status-fetcher.js` | `fetchText`, `fetchJson`, `fetchAllStatusItems`; shared downloads and local country enrichment |
| `apps/worker/src/official-status-adapters.js` | `lookupStatusCountry`; local reference first, retained enabled fallback |
| `apps/worker/src/conflict-rss-fetcher.js` | `fetchRssXml`; shared recognized-source response reuse |
| `apps/api/src/routes.events.js` | `/aircraft/lookup`; shared ADSB.lol budget, cache-age adjustment and unavailable response on a quota hold |
| `apps/api/src/gnss-gpsinterference.js` | `createGpsInterferenceService` snapshot fetch; shared per-date response reuse |
| `apps/api/src/strategic-satellites.js` | `readTextLimited`, `refreshSatellitePayload`; shared orbital downloads without renewing cached source age |
| `apps/worker/scripts/provider-quota-status.mjs` | Backend-only operator diagnostics |
| `apps/shared/test/provider-quota-isolation.js` | Test `beforeEach`; isolated ledger and legacy directories |
| `apps/worker/test/provider-quota.test.js` | New quota, persistence, contention, cache, cycle and freshness fixtures |
| Existing modified tests | `apps/api/test/manual-aircraft-lookup.test.js`; worker `naval-intelligence`, `optional-status-providers`, `status-pipeline-integration`, `tracking-airplanes-live` fixtures |
| `apps/worker/package.json`, `apps/api/package.json` | Test command preload only; no dependency changes |
| `docs/04-development/supabase-provider-quota.sql` | `stratops_provider_quota`, `stratops_quota_read`, `stratops_quota_cas`; user-applied migration, service-role RPCs verified |

## Remaining quota uncertainty

Actual remaining balances, separate applications using the same key, unknown billing anniversaries and legacy history outside the retained files are not inferred from a FREE plan label. The external numeric allowance remains UNKNOWN for Airplanes.live, several other community/contract-gated tracking adapters, OTX's officially documented account limit, DVIDS and many publication APIs. Existing gates, scheduling and error behavior continue under shared controls where wired; no zero allowance is assigned solely because the external number is unknown.

Copernicus PU/openEO entitlements and weighted FIRMS transactions need verified endpoint/account weights before a hard unit budget can be claimed. No openEO client was added. Existing authorized sources remain available to the existing provider runners when another source is held; no new subscription, fallback entitlement or provider activation is assumed.
