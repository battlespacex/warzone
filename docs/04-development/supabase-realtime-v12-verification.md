# Supabase Realtime V1.2: conditional write gate (Laptop B, 2026-11-01)

No production database, worker, API, billing, or frontend behavior changed in V1.2. V1/V1.1 uncommitted work remains intact. The proposed migration is deliberately commented out in [supabase-realtime-v12-proposed-migration.sql](./supabase-realtime-v12-proposed-migration.sql); its executable part consists only of read-only catalog queries.

## Verified write paths and freshness contracts

- `runAdsbWorker` writes one `tracks` upsert and one `aircraft_tracks_log` upsert per qualified aircraft in each successful poll. It writes an `events` row only for a newly seen aircraft in its 45-minute process-local cache. Its track `occurred_at` is source observation time; `updated_at` is ingestion time. Aircraft history `last_seen_at` copies the ingestion time.
- `runAisWorker` writes one `events`, one `tracks`, and one `naval_tracks_log` upsert per qualified vessel per successful poll. Naval event `occurred_at` is source observation time when available. Naval track `updated_at` and history `last_seen_at` are ingestion times. Alias reconciliation can additionally mark an old track ended.
- Both pollers default to five seconds, skip overlapping cycles within their process, and supersede the general-cycle fallback when enabled. Laptop B configuration enables both at five seconds; deployed process settings and instance count are not verified.
- The `/events/aircraft` API selects `tracks` by a recent `updated_at` cutoff. Aircraft history and 72-hour pruning use `aircraft_tracks_log.last_seen_at`. The frontend uses track last-seen values for active/stale state, and naval signals use their source `occurred_at` to decide freshness. Suppressing a track/history heartbeat merely because position is unchanged would alter these contracts. A new source timestamp with the same coordinates is meaningful and must be retained.
- Identical naval event rows have no distinct heartbeat column in the deployed REST schema. Their repeated UPDATEs can be suppressed only after confirming database triggers and conflict constraints. Any changed position, source timestamp, metadata, classification, status, or other column must still update.

## Read-only deployed schema findings

Supabase REST OpenAPI returned HTTP 200 and showed all four tables. `events` has `id`, `dedupe_key`, `source_key`, `occurred_at`, `metadata`, `report_type`, and no `updated_at`. `tracks` has `track_key`, `occurred_at`, and `updated_at`. Both history tables have `last_seen_at`. OpenAPI marks each table's `id` as primary key. Source code uses `events.dedupe_key` for AIS conflicts, `events.source_key` for ADS-B, `tracks.track_key`, `aircraft_tracks_log.track_key`, and `naval_tracks_log.mmsi`; OpenAPI does **not** verify that these conflict columns have deployed unique indexes. No migration defining these four deployed tables exists in this repository.

A live read-only Realtime subscription confirmed `events` and `tracks` publish changes. A subsequent user-run, read-only production SQL check reported that only those two tables are in `supabase_realtime`, the two history tables are excluded, all four tables have DEFAULT replica identity, and no non-internal triggers exist on them. History writes still consume database resources but do not directly generate Postgres Changes messages under that reported publication. The user's full constraint/index CSV exports confirm `events.dedupe_key` has a unique constraint and two single-column unique btree indexes, `events.source_key` has a single-column unique btree index, `tracks.track_key` and `naval_tracks_log.mmsi` each have a unique constraint/index, and `aircraft_tracks_log.track_key` has a single-column unique btree index. The duplicate `events.dedupe_key` indexes are a separate index-maintenance concern; this proposal leaves them untouched. The configured REST credentials cannot inspect the SQL catalog directly; staging must repeat the supplied read-only queries before applying anything.

## Identical-workload evidence

| Workload | Current persistence calls | Proposed effect, if schema gate passes |
| --- | --- | --- |
| Two identical observations of one existing naval vessel | 2 event UPSERT calls, 2 track UPSERT calls, 2 history UPSERT calls | 1 or 2 event row UPDATEs skipped depending on initial stored row; both track and history heartbeats retained |
| New vessel, then exact repeat | 1 event INSERT + 1 event UPDATE, 2 track/history UPSERTs | 1 event INSERT; repeated event UPDATE skipped; track/history unchanged |
| New source time or changed position/identity metadata | Event, track and history payloads change as applicable | All meaningful event UPDATEs retained |
| Two identical observations of one aircraft | 1 event UPSERT call, 2 track UPSERT calls, 2 history UPSERT calls | No additional aircraft suppression proposed |

The first row is a model of the proposed trigger, **not a post-migration measurement**. Existing fixture tests verify the current persistence calls and that repeated naval event payloads are exactly equal. Other focused tests verify changed source time, position, identity metadata, aircraft new-identity events, and history coordinates.

In a separate read-only 20-second production Realtime observation, one temporary `events` UPDATE subscription received **336 naval signal messages across 84 vessel keys**. For each key after its first observed message, **252 later UPDATE payloads were exactly identical** to the preceding payload for that key: source time, position, metadata, and all other returned columns matched. This is a measured lower bound on redundant row UPDATE notifications in that short sample, assuming no hidden trigger effects. It is not an implemented reduction, a monthly rate, or a Supabase billing report. The temporary channel was removed and disconnected.

## Proposed change and release gate

The draft adds a narrowly scoped `BEFORE UPDATE` trigger on `public.events` that returns NULL only for an AIS `signal` row when the entire new row is identical to the old row. The five-second polling interval stays unchanged. Track and history heartbeat writes remain unchanged. New events, changed positions, new source timestamps, metadata/status changes, and DELETE cleanup remain on the current path.

The complete unique-index and constraint definitions now support the AIS `dedupe_key` conflict target. Repeat the catalog checks in staging before preparing an executable migration. The user-reported absence of existing non-internal triggers removes the known trigger-order conflict, subject to the staging schema matching production. Test the draft on that staging database with cases listed in the SQL file. Specifically verify absence of duplicate rows under concurrent pollers, no lost freshness, the naval 90-second missing-contact grace and 45-minute source-stale purge, aircraft history, AOI, region filtering, CTR, alerts, and reporting. Compare row INSERT/UPDATE counts and Realtime deliveries for identical fixtures before and after. The current worker's “Upserted N” event log counts attempted rows, so it would need corrected wording when skipped-row reporting is available.

If approved after staging, release the database trigger before any optional worker log change. Monitor event UPDATE counts, Realtime deliveries, fresh/active naval records, API errors, and tracker behavior against the prior equivalent interval. Rollback is to drop only the new trigger and function, as shown in the draft; no data rewrite or polling-interval change is required. Do not deploy the draft file directly.

The 4-million-message target remains unverified. This proposal can reduce identical AIS `events` UPDATE notifications; `tracks` heartbeat notifications, other writers, broadcasts, subscribers, and production connection counts remain. A later heartbeat/publication redesign would require separate API, cleanup, reporting, and schema review.
