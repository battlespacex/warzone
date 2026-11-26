# Conflict intelligence processing and 72-hour retention

**Deployment instructions superseded:** use [the consolidated database health runbook](stratops-database-health-report.md). The current migrations require dependency guards and keep physical cleanup disabled until backup/review controls are explicitly enabled. The measurements below remain a record of the earlier investigation.

Local implementation, 26 November 2026. No production SQL, database writes, deployment, commit or push was performed during this investigation.

## Confirmed causes

1. **Feed storage omitted resolved coordinates.** `normalizeConflictFeedItemForStorage()` already resolved geography into `raw._event_location`, but left top-level `lat`/`lon` unchanged. Promotion independently resolved geography again. Therefore NULL feed coordinates did not, by themselves, prove promotion had no geocoder. Storage now persists supported local/facility coordinates and their precision/confidence together. A worker replay repairs missing coordinates in dated reports without fetching additional articles.
2. **Attacker nationality incorrectly constrained incident geography.** Country detection treated adjectives such as Russian/Ukrainian, and speakers such as “Iran says”, as geographical vetoes. This rejected foreign localities explicitly named in incident text. The conflict resolver now distinguishes actual geographical country context from actor nationality, checks subsequent occurrences of place names, and recognizes bounded possessive/directional locality grammar. These changes are explicitly scoped to conflict normalization; independent systems retain their existing resolver behavior.
3. **The geographic reference catalog is finite.** Three documented locality references were added; generic Gaza remains regional. Named city references are LOCAL, not confirmed impact positions. Country centroids, unknown places, publisher geography and broad areas remain ineligible for point markers.
4. **Middle East Eye parsing discarded useful evidence.** Its listing parser stored links and a topic summary, discarding each update's body. Article enrichment did not recognize the actual `.date-created` absolute GMT field. Both are corrected. Modification times and unrelated time elements no longer substitute for a missing MEE publication date. Publication evidence is stored separately from occurrence/ingestion metadata.
5. **Feed relevance is intentionally broader than map eligibility.** All stored reports have passed the feed relevance filter. That filter also supports defense/procurement news for Intel Wire; `is_conflict_relevant=true` is not proof of an operational incident or a precise location. Those checks remain separate. Advocacy and roundup headlines are not turned into incidents just because they mention attacks.
6. **Previously identified retention defects remain addressed.** The map default was 48 hours; promotion replayed only the latest provider batch; raw upserts could renew publication dates; undated promotion fell back to ingestion time; corroboration updates referenced a nonexistent `events.updated_at` column; map responses/caches could truncate the dataset. The implementation retains the 72-hour window, global stored-backlog replay, stable original dates, schema-compatible merges, pagination and preservation on empty/failed refreshes.
7. **An empty polling result could leave expired markers visible.** Expiration now runs in the existing visible-tab polling lifecycle, reconciling only expired conflict markers, clusters and event caches. It adds no timer and does not reset the viewer, camera or trackers.

## Measured checks

The same saved 292-report snapshot was normalized before and after the changes, without writing it to Supabase:

| Result | Before | After |
|---|---:|---:|
| Eligible reports | 8 | 19 |
| Unreliable/missing location | 178 | 164 |
| No operational incident evidence | 65 | 68 |
| Intel Wire only | 41 | 41 |

These are **reports passing normalization**, not unique incidents, insert counts or production map counts. Deduplication, source corroboration and the moving time cutoff still apply. The final read-only audit at 18:09 UTC had 289 reports, 18 eligible under the revised normalizer and all 4,745 undated MEE records still present. Stored coordinates were still NULL because no production write/replay was executed. The user's separate 17-event news/OSINT database observation is not an equivalent population.

The bounded publication recovery probe inspected two existing undated MEE URLs. Both original article pages supplied reliable GMT publication dates: one recent and one historical. The generated SQL proposes only the recent restoration, guarded again by the 72-hour cutoff at execution. It has not been executed. The older proposal remains review-only.

## Ownership and retention safety

An event belongs to this retention policy only if it has `metadata.intelligence_pipeline = 'conflict'`, a `conflict-feed:` dedupe key, or the dedicated `report_type = 'conflict'`. A generic `news`/`osint` label is insufficient.

The migration marks legacy news/OSINT/reddit/strike rows only where their exact source URL AND the previous promoter's `metadata.source_id` match an existing conflict-relevant collected report. A shared URL alone is insufficient. The preflight previews this population. Unmatched/unproven news and OSINT rows are excluded and require individual ownership review if additional legacy retention is desired. No unrelated tables or RLS/authentication policies are altered.

Active conflict eligibility is `(original_timestamp > now() - 72 hours) AND (original_timestamp <= now())`. A genuine supplied occurrence timestamp takes precedence. When the source supplies publication time only, that original report time is used and `timeline.timestamp_basis` explicitly records `source_publication`; it is not a verified incident occurrence time. Fetch/update time never renews eligibility. Source material does not establish that every historical incident mentioned in a newly published story is ongoing. Corroboration lookup also excludes independent signals and explicitly unrelated news, so matching report text cannot relabel those records as conflict-owned.

The worker calls `maintain_conflict_intelligence_72h()` after conflict sync, including an empty successful fetch. If `pg_cron` is installed the migration also schedules it every 15 minutes; it does not install extensions. With no pg_cron, the existing worker fallback provides physical cleanup. Missing migration/RPC errors are logged explicitly. API/frontend filtering enforces eligibility independently of cleanup cadence.

Cleanup deletes only expired, owned `events` rows and dated expired `conflict_feed_items` rows. NULL publication dates are never deleted. Database triggers and application merges preserve the earliest original date; retries do not turn an old report into a new event. Ordinary polling also removes locally expired conflict markers when no new data arrives.

## Undated historical records

The 4,745 undated MEE rows remain untouched in production. Existing raw samples retain metadata/media but not the original article HTML or an original occurrence timestamp; those fields cannot reliably reconstruct the missing dates by themselves.

On subsequent ingestion, a reliable recovered date within the active window can repair a recent report. If an existing undated record is found to be historical, the writer keeps `published_at` NULL and records `_historical_publication_recovery` for review. This prevents date recovery from silently routing those rows into automatic deletion.

For a separate archival decision: export the undated subset, including IDs, URLs and raw evidence, through the Supabase dashboard to a controlled JSON/CSV archive; verify the export before considering removal. No archival table, undated deletion job or deletion statement is installed. Historical recovery/archival/deletion requires a separate reviewed decision.

## Manual SQL execution

1. Save a database backup and the current preflight output. Run **`supabase-conflict-72h-preflight.sql`** in the Supabase SQL Editor. Recheck the newly added URL/source-metadata ownership preview, incoming foreign keys, triggers and existing deletion functions/jobs. Stop if another job removes valid reports sooner, if a cascading FK affects an unrelated system, or if duplicate/index/schema assumptions differ.
2. Run the complete **`supabase-conflict-72h-migration.sql`** as one transaction. It marks the previewed legacy ownership, adds narrowly named indexes/uniqueness protection and timestamp triggers, and installs the service-role-only maintenance RPC. It does not invoke cleanup inside the migration. Cleanup starts on the next worker sync or optional scheduled job after installation.
3. Run **`supabase-conflict-72h-verification.sql`**. Check that anonymous/authenticated roles cannot execute maintenance and that the service role can. With pg_cron absent, inspect the next updated worker's `[conflict] retention` log instead of querying nonexistent cron tables.
4. When the updated worker is intentionally activated, verify `stored geographic enrichments`, promotion rejection reasons, inserts/updates/duplicates, retained totals, expired totals and geographic distribution. Run verification SQL again after a cycle. Confirm valid rows keep the same IDs and original timestamps across a second cycle and a provider failure. Do not expect retained unique event count to equal collected report count.
5. Optional read-only diagnostics from the repository root: `node scripts/audit-conflict-intelligence.mjs`. Add `--recover-undated=2` for at most two original-page recovery probes (hard maximum 10). Outputs are local `.generated/conflict-intelligence-audit.json` and, when requested, `.generated/conflict-publication-recovery-proposals.json` / `.sql`. Inspect those proposals before manually executing any recent-date restoration. Historical proposals intentionally produce no UPDATE statements.
6. To roll back database objects, manually run **`supabase-conflict-72h-rollback.sql`**. It unschedules only this job, removes only this migration's objects and removes its specifically tagged legacy ownership backfill. Records already expired by maintenance require backup restoration; rollback cannot recreate deleted data. Code rollback is a separate reviewed action.

The SQL files are complete executable scripts but were not executed or runtime-validated against PostgreSQL here. Live REST SELECTs verified actual column names and the revised general/map query syntax. Administrative trigger/index/RLS/job results supplied by preflight still require the manual review above.

## Modified implementation

| File(s) | Functions/data changed |
|---|---|
| `apps/shared/conflict-retention.js` | Ownership, original UTC timestamps, strict active window and query filter |
| `apps/shared/map-event-policy.js` | Scoped historical relevance/query retention |
| `apps/shared/map-event-pages.js` | Complete page collection with ID deduplication and cursor validation |
| `apps/worker/src/conflict-retention.js` | `readConflictBackfill`, `maintainConflictRetention` |
| `apps/worker/src/conflict-article-publication.js` | Absolute publication/date-created parsing and bounded field extraction |
| `apps/worker/src/intelligence-normalizer.js` | Conflict storage/event normalization, scoped geographic matching/country context, original-date dedupe/fingerprints and timeline/reference metadata |
| `apps/worker/src/operational-location-catalog.js` | Three sourced locality entries, limited to conflict resolution |
| `apps/worker/src/conflict-supabase-writer.js` | `upsertConflictFeedItems`: preserved dates/provenance, insert/update diagnostics and historical recovery protection |
| `apps/worker/src/conflict-event-promoter.js` | Scoped recent eligibility, safe lookups/merges/inserts, no-op duplicate handling and rejection diagnostics |
| `apps/worker/src/conflict-feed-runner.js` | Deduplication dates/geography, source-health counts, stored backlog/geographic repair and maintenance integration |
| `apps/worker/src/conflict-live-fetcher.js` | Live update narrative extraction and testable parser export |
| `apps/worker/src/conflict-media-enricher.js` | MEE article body/publication evidence; no modification-time fallback |
| `apps/worker/src/index.js` | Conflict source dates/geometry options, owned conflict validation/timeline and escalation updates; independent operational paths unchanged |
| `apps/api/src/routes.events.js` | 72-hour map default, stable page ordering/offset metadata, owned conflict query eligibility |
| `apps/api/src/public-event-normalizer.js` | Preserve safe ownership/timeline metadata in lightweight map events |
| `dev/assets/js/supabase.js` | Page consumption/direct-query paging, expiry-aware cache merges, preservation of independent-row bounds and stale-region protection |
| `dev/assets/js/essential.js` | Retain complete active conflict dataset; expire conflict caches/markers within existing polling |
| `apps/worker/test/conflict-retention.test.js`, `conflict-processing.test.js` | New retention, processing, timestamp, geography, ownership, failure and expiry regression tests |
| `apps/api/test/routes-events-map.test.js`, `routes-events-delivery.test.js` | Updated query window, pagination, lightweight metadata and scoped filter assertions |
| `scripts/audit-conflict-intelligence.mjs` | Read-only audit and bounded, manual-only recovery proposals |
| Four `supabase-conflict-72h-*.sql` files and this report | Manual preflight/migration/verification/rollback and execution documentation |

No CSS, GLB models, provider quotas, onboarding/viewer initialization, authentication or independent tracker implementations were edited for this task. Other pre-existing worktree changes were preserved.

## Geographic references and attribution

The city reference additions use [GeoNames: Gaza](https://www.geonames.org/281133/gaza.html), [GeoNames: Khasab](https://www.geonames.org/287614/khasab.html), and [UNGEGN: Krasnodar, sourced from NGA GNS](https://ungegn.un.org/dashboard/cities/details?id=1609). GeoNames data attribution is retained here and in the reference URLs carried with normalized geographic metadata; see [GeoNames terms](https://www.geonames.org/export/). These references locate named cities, not verified incident impacts. No runtime GeoNames API dependency was introduced.

## Verification and limitations

- Targeted retention/processing/normalization-source-quality/frontend-location/map-delivery tests: 58 passed.
- Broader existing normalizer suite: 13 passed, three existing failures. The same failures were reproduced using the original HEAD normalizer: unqualified item coordinates, a generic row coordinate expectation, and an unrelated status default expectation. They were not weakened or fixed as part of this task.
- Read-only Supabase general/map queries succeeded with the new scoped filter; source article publication fields were inspected directly.
- JavaScript syntax checks: all 18 changed implementation/script files passed. Final `npm run build` passed for the app and marketing frontend in `.generated/air-patrol-validation/workspace`, with isolated outputs to preserve existing deployment files. Existing marketing asset-size warnings and contact endpoint configuration notice remain.
- Production SQL/maintenance, actual worker insert/backfill/cleanup results, browser marker appearance and transitions, viewer initialization, authentication and other full operational browser flows were not exercised. No production increase or end-to-end global coverage is claimed.
- Gazetteer/source geography remains incomplete. Broad/ambiguous reports remain unmapped; publication timestamps cannot establish undocumented occurrence times. Existing source response limits and availability are preserved; stored replay cannot reconstruct reports never supplied or previously deleted. No new provider dependency or artificial event data was added.
