# Naval source activation and verification

## Actual state

See `naval-source-results.md` for the complete 63-row table and `naval-source-results.json` for machine-readable results. All WORKING results mean real provider HTTP plus parsing/normalization plus insertion into isolated local SQLite using the worker persistence interface. **No deployed Supabase verification or migration execution is claimed.**

The approved PostgreSQL staging target is **local Supabase/Docker only**. No hosted non-production project is approved. Never use the production Warzone Supabase connection for verification. The operator ran `.generated/naval-postgres-verification/verify.mjs --execute` from their working PowerShell; the resulting local artifact `.generated/naval-postgres-verification/result.json` reports **PASS** (started 2026-11-17 00:52:28 UTC). An isolated `postgres:17-bookworm` container stored **63 source rows, 45 evidence rows and 45 genuine activity rows**. The actual migration and its repeat application, exact typed JSONB/timestamp roundtrip, duplicate upserts, source/external-ID uniqueness, foreign-key rejection, indexes, enabled RLS, role grants, anonymous/authenticated direct-read denial and API-equivalent SQL queries passed. All rows and their digest remained identical after a container restart. The container and persistent volume were retained, no ports were published and production connections were zero. This validates PostgreSQL storage and database role protections; it does **not** test Supabase PostgREST/JWT integration or authenticated browser access. Agent-side Docker execution remains permission restricted, so this result is from the operator's local execution and inspected output artifacts. Relevant regression tests passed 38/38 in `.generated/naval-postgres-verification/regression.log`. No PostgreSQL-specific application or migration fix was required by these checks.

- Six continuously discovered naval-report sources verified: DVIDS, official U.S. Navy RSS, UK MOD Atom, France Marine nationale, Armada Argentina and EUNAVFOR ATALANTA.
- One Indian PIB historical publication verified. It is explicitly a single archival publication, not a continuous discovery feed.
- Two Copernicus catalog endpoints verified. STAC stored ten catalog items and OData one product metadata item, each in one `naval_source` payload row. These are **zero vessel detections and zero naval activity records**.
- India's public RSS adapter fetched successfully, but its current snapshot has zero eligible naval items. It is READY, not WORKING. Its missing RSS dates are resolved from the original article only; the canonical host/language/region parameters were verified from actual server responses. Missing original dates are rejected.
- Three permission-gated RSS adapters are implemented but disabled: CMF, USNI and Naval News. Unit fixtures do not establish a working live source. Existing AISHub/AISstream/MarineTraffic/Spire adapters are reused; no optional AIS provider was activated.
- Navy RSS directory, USNI listing and Naval News listing resolve to canonical feeds without duplicate polling. They are not additional independent feeds.
- Source-specific New Zealand, Spanish Navy and Bangladesh Navy publication adapters are also READY, disabled pending source-specific reuse permission. Their parsers were checked against fetched HTTP 200 articles/indexes, including original publication dates; no licensed records were inserted. Bangladesh's public index yielded ten dated items, five qualifying naval reports; session-token POST downloads are never replayed. Spain's Navy-specific rights notice takes precedence over broader ministry reuse terms. A licence attached to a separate NZDF annual report is not assumed to cover website articles.
- **Eight entries remain INCOMPLETE**. The full 56-adapter implementation is not finished. Unknown reuse permissions are not asserted legal prohibitions and unfinished adapters are not called complete. Exact restrictions and unfinished work are separate in the results table.

The fresh combined verification at 2026-11-16 23:56–23:57 UTC inserted 45 genuine activity/publication records. Evidence is under ignored `.generated/naval-registry-20261116/final-verification.json` and `final-verification.sqlite`. All 63 registry pages and available legal links were inspected individually; this is not equivalent to verifying 63 ingestion feeds. Existing working changes and supplied inventories were preserved.

## Backend settings

- Existing `DVIDS_API_KEY`: backend only; never a frontend/build setting.
- `NAVAL_INTEL_ENABLED=false` disables the job. Existing approved public adapters otherwise run automatically; no additional browser polling loop.
- Optional `NAVAL_INTEL_SOURCE_IDS`: comma-separated registry IDs to restrict ingestion. An alias selects its canonical feed exactly once. It does not override licensing/authentication gates.
- `NAVAL_INTEL_CATALOG_ENABLED=true`: explicitly opt into catalog metadata. Optional and off by default. Does not enable ship detection or alter satellites.
- France, Argentina and ATALANTA use a six-hour process cooldown. The single PIB archival publication is rechecked weekly. Data is upserted idempotently. Publication 404/410 marks previously stored records withdrawn. Index errors remain errors, not fabricated empty successes.
- `NAVAL_INTEL_RIGHTS_FILE`: optional private UTF-8 JSON array, at most 63 entries / 100 KB. Leave unset until real permission is obtained. A grant needs `source_id`, `commercial_display: true`, `automated_ingestion: true`, `approved_by`, an actual HTTPS `permission_reference`, ISO `reviewed_at`, and optional ISO `expires_at`. Future review dates and expired grants fail closed. Only `COAL-001`, `PUB-002`, `PUB-005`, `NZL-001`, `ESP-001`, and `BGD-001` are supported by this file; listing other IDs does not enable them. The operator remains responsible for the actual scope of publisher rights. No grant or permission is provided by this repository.
- Aliases `PUB-001` / `PUB-004` require the canonical `PUB-002` / `PUB-005` grant respectively. Do not grant rights based solely on the existence of a public RSS feed.

Copyright/contract references remain private: API diagnostics expose an explicit public field allowlist, not operator permission-document URLs or catalog payloads. No source access restriction, TLS verification, authentication or license was bypassed.

## UI / lifecycle

The existing Naval toggle still controls the independent OSINT layer alongside live AIS. There are no changes to GLB identity, scale, camera follow/unfocus, Air Tracker, GNSS, NOTAM or orbital systems. Source metadata refreshes on enable/region settlement; expiry is local. Fresh data does not push automatically to a continuously open, unchanged view; no new per-user polling loop was introduced.

Only published geometry is mapped. Named regions remain list records rather than fabricated vessel positions. New map filtering runs on camera settlement, with at most 40 visible records and four parts per record. Native Cesium clustering groups only owned public point records and labels them as reports, never moving vessels. OFF removes the owned camera/cluster callbacks, data source, pick handler, panel, timer and pending request. No per-frame DOM/CSS work was added. Date-only publications remain explicitly labelled; their displayed clock is not assumed UTC. Names/hulls/classes are extracted only when explicitly present; no weak-name AIS merges are performed.

Actual browser FPS, GPU memory, visual clustering and cookie/CORS integration remain unverified: the available Chrome launch previously failed with `spawn EPERM`. Harness counts and passing tests are not browser performance measurements.

## Operator release steps (not executed)

1. Review the source diff and results. Apply the existing additive `naval-intelligence-migration.sql` only to the approved **local Supabase/Docker** target first, once its engine is available. Verify service-role access and anonymous/authenticated RLS denial. Do not load production environment files or use the production Warzone database. Keep prior artifacts and database backups.
2. Ship all reviewed worker `src/naval-intel/*.js` and `sources.json`, shared policy and API changes to the staging backend. No new dependency or AWS setting is required. Keep private rights/import files and credentials outside source control. No paid source needs enabling.
3. The repository process names are `warzone-api` and `warzone-worker`; after the authorized backend update/configuration use `pm2 restart warzone-api --update-env` and `pm2 restart warzone-worker --update-env`. Run one ingestion process to avoid duplicate upstream polling across instances.
4. Validate private-table writes, 403/429 isolation, expiry/withdrawal and actual premium API access. Verify all visible source links/timestamps and that imagery catalogs never appear as vessel observations. Validate toggling, GLBs, focus/unfocus, native clustering and other layers in a real browser; measure performance before promotion.
5. Local reviewed frontend output is `.generated/naval-osint-20261116/build`. The no-network gate is `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/naval-osint-20261116/build`.
6. Use the existing deployment script first as a dry run with explicit staging target, bucket, distribution, profile and public URL. Omit `-Execute` until the proposed staging writes are separately authorized. Production promotion is a separate operator action after staging validation; no resource IDs should be guessed. Preserve HTML-last publication, immutable releases and retained bundles.
7. Rollback uses saved prior backend/frontend artifacts, with `NAVAL_INTEL_ENABLED=false` to stop new ingestion if needed. Retain the additive tables and evidence. Database deletion or table removal is not needed for application rollback.

## Changed files and functions

| File | Scope |
| --- | --- |
| `apps/worker/src/naval-intel/publications.js` (new) | Source policies; `articleMetadata`, `publicationLinks`, `bangladeshPublications`, `multilingualActivity`, `hasPublicationRights`, `readPublication`. Bounded public article/index ingestion and source-specific permission gates. |
| `apps/worker/src/naval-intel/catalogs.js` (new) | `readNavalCatalog`; optional Copernicus metadata, never vessel observations. |
| `apps/worker/src/naval-intel/licensed-feeds.js` (new) | `hasSourceRights`, `hasFeedRights`, `readLicensedFeed`; private permission validation and three disabled-by-default RSS adapters. |
| `apps/worker/src/naval-intel/public-feeds.js` | Navy RSS policy and canonical source aliases. |
| `apps/worker/src/naval-intel/ingest.js` | `parseDvids`, `createNavalIntelRunner` / `run`; explicit hull identity, source selection, public/licensed/catalog ingestion, per-provider isolation and withdrawals. |
| `apps/shared/naval-intelligence.js` | `sourceAccess`, `normalizeNavalActivity`; reviewed policy gates, original publication precision, bounded intact GUIDs, official-report classification. |
| `apps/api/src/routes.naval-intel.js` | `publicNavalSource`; public source diagnostics field allowlist. |
| `dev/assets/js/warzone-naval-intel.js` | Owned OSINT map-source clustering and settled-viewport filtering, current picked metadata, publication precision and cleanup; no GLB/camera-control changes. |
| `apps/worker/test/naval-publications.test.js` (new) | Publication/date/source/permission/withdrawal/catalog regression fixtures. |
| `apps/worker/test/naval-licensed-feeds.test.js` (new) | Disabled-before-network and pinned-source licensed RSS tests. |
| `apps/worker/test/naval-intelligence.test.js` | Original GUID identity, canonical polling, private-fixture authorization and persistence tests. |
| `apps/worker/test/naval-intel-lifecycle.test.js` | Map ownership, viewport settlement, clustering and cleanup tests. |
| `apps/api/test/naval-intel.test.js` | Permission-reference/catalog diagnostic redaction regression. |
| `docs/04-development/naval-source-results.json` (new) | Machine-readable outcomes for all 63 entries. |
| `docs/04-development/naval-source-results.md` (new) | Complete per-source evidence and outstanding work table. |
| `docs/04-development/naval-source-activation.md` (new) | Activation, limitations, changed files and operator rollout instructions. |

Continuation regression: **123 passed, zero failed** in `regression-combined-final.log`. Eight changed application modules passed `node --check`; `git diff --check` passed. Mocked deployment checks passed **19 scenarios**, with no AWS/network calls. These selected passing suites do not erase the previously reproduced two baseline failures in the broader realtime-performance test file. Browser acceptance and hosted Supabase insertion remain unverified.

Final isolated production frontend build passed in **61,777 ms** (`build-combined-final.log`). The subsequent `-ValidateOnly` gate verified **27 JS/CSS assets, 392 Cesium assets and 64 GLB assets**, with no AWS calls (`integrity-combined-final.log`). Checked-in `production/` output was not overwritten. The output wrapper is the pre-existing `.generated/naval-osint-20261116/webpack.config.cjs` and only redirects build/copy output. No production deployment or process restart occurred.
