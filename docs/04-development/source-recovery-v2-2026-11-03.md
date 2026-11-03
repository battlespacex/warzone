# StratOps V2 source recovery: local evidence and release gate

Working copy: `C:\DX\warzone-recovery` (Laptop B). No production write, deployment, credential print, or paid provider request was made.

## Inventory and status method

`docs/StratOps-Data-Sources-V2-2026-11-03.xlsx` preserves all 287 rows from the November 2 workbook and adds six review entries. One original row is a `_comment` object in `sources.json`, with no name, parser, URL or enable flag; it is **not an ingestible source**. Thus the original workbook contains 286 source references and one audit artifact. An entry may be an internal table or integration reference, not a distinct company or endpoint. The current totals for 293 rows are: **0 WORKING, 0 DEGRADED, 0 NOT WORKING, 28 DISABLED, 10 NOT INTEGRATED, 255 NOT VERIFIED**. The 28 disabled entries are explicitly off in checked-in registries. Four additional disabled entries are candidate stubs and are classified NOT INTEGRATED. Deployment overrides were not inspected. No source was promoted to WORKING from code presence, historical local tests, or an HTTP 200.

The workbook has separate Executive Summary, Existing Sources, New Candidates, Verified Working, Failed Sources, Disabled Sources, Repair Actions, Repository Code Audit, and Production Readonly Snapshot sheets. The code audit checks each original row against the checked-in registry or referenced module. The snapshot contains all 193 rows from the four user-supplied SQL exports, with persistence timestamps explicitly distinguished from request success. Blank working and failed sheets mean that neither status has been established by current end-to-end production evidence. Dates carried from the earlier workbook are labeled historical; current freshness and cost remain unverified where no telemetry exists.

## Complete repository reconciliation

The original 287 rows comprise 119 conflict feeds, 14 status feeds, 94 legacy JSON entries (93 feeds plus the comment artifact), 39 specialized integrations, 18 internal-table references, and three local catalogs. All **226 real registry entries** matched their current definition. Registry flags show 194 enabled and 32 disabled; four of the disabled entries are nonfunctional candidate stubs, leaving 28 implemented disabled sources. All 60 specialized/internal/local code references were found after correcting two stale AOI paths to `dev/assets/js/warzone-aoi-lens.js`. File presence establishes implementation evidence only, not runtime success. The registry flags are checked-in defaults, not a production configuration dump.

The earlier workbook recorded three credential-dependent entries without local keys: FAA NOTAM, SkyLink NOTAM and the disabled Cloudflare Radar candidate. This is historical local inventory evidence, **not** a current production credential check. Five entries have historical local errors: ADSB.one, Airplanes.live, SkyLink aircraft enrichment, VesselAPI and Pikud HaOref alerts. Their current production failure status is unknown. The workbook's Repository Code Audit sheet records implementation and code enablement for every original entry without asserting health.

## Confirmed code defect corrected

`apps/worker/src/source-health.js` previously returned `healthy` for any enabled source with no stored fetch result. It now returns `unknown` with `not_yet_checked`. `shouldAttemptSource` still allows the first fetch. The shared health enum and focused test were updated. This corrects an internal false-positive state; it does **not** prove that a provider's response reaches a StratOps feature. `recordSourceSuccess` measures a successful nonempty fetch, not freshness, quality, database persistence, API delivery, or Cesium/UI rendering. A future administrative view must use the full chain of evidence before labeling a source WORKING.

## Evidence boundary

The production worker path `C:\websites\warzone-worker\warzone\apps\worker` is not present on Laptop B, no local worker logs were found, and the API and worker are separate processes. The worker's source-health map is in memory and is not a persisted, authenticated admin data service. The existing API admin key protects an event-insert route but does not expose per-source ingestion metrics. Consequently, current production source success, last error, fresh record counts, API delivery, and monthly cost cannot be established from this checkout. An honest administrative health dashboard needs a reviewed telemetry path and access control. Adding a static dashboard now would misrepresent operational status.

Historical local source probes from `docs/04-development/source-audit-local-2026-09-10.md` are retained only as dated evidence. They do not establish November production health.

## November 3 production read-only snapshot

The user supplied four production SQL Editor CSV exports, collected without database writes. At approximately 15:07 UTC, `source_registry` contained **93 rows: 86 enabled and seven disabled**. This matches the counts in the checked-in legacy JSON registry, but **16 names in production differ from 16 names in local code** (for example `Reuters` versus `Reuters World News`). This is configuration or registry drift, not proof of a broken provider; `source_registry` is upserted by source name and old names may persist. Confirm the deployed worker revision before changing or deleting any rows.

`conflict_feed_items` contained **18,438 rows across 91 source names**. Seventy-nine source names had a row with `fetched_at` inside the preceding 24 hours; 12 did not. All 91 names match a current conflict-source name. Of the 28 checked-in conflict sources with no stored row, 21 are disabled and seven are enabled: BBC Asia, The New York Times U.S., Krebs on Security, The Jerusalem Post, U.S. Navy Top Stories, U.S. Air Force News, and FAA Cleared for Takeoff. No stored row may mean no accepted content, a filter, a deployment mismatch or a fetch failure; this query cannot distinguish them.

`status_feed_items` contained **67 rows across seven source names**, with **no row fetched in the preceding 24 hours**. Of seven checked-in status sources without a stored row, four are disabled candidates and three are enabled: FAA NAS Status, CISA Known Exploited Vulnerabilities, and Defense News Global. The latest stored status-feed timestamp was October 30. This deserves targeted worker/deployment review, but absence of a new row is not proof that polling stopped or an endpoint failed. `max(fetched_at)` is the last **persisted record timestamp**, not the last successful request. The earlier local FAA/CISA adapter tests do not establish that those adapters are deployed.

`tracks` contained **45,582 aircraft** and **1,786 naval** rows; each type had a latest `updated_at` near 15:05 UTC on November 3. This verifies recent database updates, not tracker UI delivery, geographic coverage, source quality or data accuracy. The PM2 screenshot showed `warzone-worker` online alongside separate API and frontend processes, but its CPU and memory columns were instantaneous and do not establish sustained health. The earlier PM2 log script failed because no worker name was entered and it assumed fixed log filenames; the Windows guide now uses PM2's read-only non-streaming log command for the observed process name.

The source statuses in the workbook remain unchanged: these aggregates lack per-source request/error and downstream API/UI evidence. Use `source-recovery-v2-windows-readonly.md` to collect only filtered worker health output. No production repair or source activation is justified yet.

## New candidates and access review

- [DeepState UA public Telegram channel](https://t.me/DeepStateUA): identified as a candidate; a public index showed recent posts, but no integration or reuse permission was verified.
- [OSINTdefender public Telegram channel](https://t.me/s/OSINTdefender): the handle already appears in the enabled `Telegram OSINT High Signal` channel list in `apps/worker/src/sources.json`; its present access, licensing and delivery are unverified. It must not be added as a duplicate feed.
- OSINT Radar Tracker: name supplied in the request; the exact handle, operator and provenance remain unverified. No guessed channel was added.
- [EASA Conflict Zone Bulletins](https://www.easa.europa.eu/en/domains/air-operations/czibs): official public advisories. No checked-in adapter or automated reuse review; candidate only.
- [UKMTO maritime advisories](https://www.ukmto.org/ukmto-products/advisories): official maritime-security reports, not AIS vessel positions. No checked-in adapter or automated reuse review; candidate only.
- [NOAA Aviation Weather Center Data API](https://aviationweather.gov/data/api/): documented METAR/TAF and other aviation products. Provider limits require scoped requests; no checked-in adapter or source-to-feature test. Candidate only.

[Telegram API terms](https://core.telegram.org/api/terms) and [content licensing terms](https://telegram.org/tos/content-licensing) require review before channel ingestion. No Telegram adapter or source was enabled. Public OSINT claims must remain attributed and must not become aircraft or vessel telemetry.

## Release gate and remaining work

1. Obtain a redacted production PM2 worker-log export and read-only per-source last-ingestion and latest-record timestamps. Do not export keys or connection strings.
2. Reconcile each enabled provider's successful request with accepted worker records, persisted rows, API responses and the intended tracker or intelligence feature. Only then assign WORKING, DEGRADED or NOT WORKING.
3. Review production enable flags by variable name only, provider contracts, quotas, API errors, schedule overlap and cost. Fix confirmed adapter faults one at a time with focused fixtures.
4. Design authenticated, persisted (or securely proxied) source telemetry before building the administrative dashboard. Retest controls must be rate-limited and must not trigger paid calls unexpectedly.
5. Add new providers only after recent activity, provenance, geographic gap, usage terms and end-to-end adapter checks pass. Do not enable the three Telegram candidates from the workbook alone.

The V2 workbook and source-health correction are **not a production release recommendation**. No production health or cost reduction is claimed.
