# Supabase Realtime V1.4 staging validation status and runbook

Status on Laptop B (`C:\DX\warzone-recovery`): **blocked before database execution**. No staging migration, write replay, production change, deployment, or billing change has been run.

## Environment finding

All six configured root/API/worker `.env.local` and `.env.production` files resolve to the **same Supabase project host**. The documented staging web URL is therefore not evidence of an isolated staging database. No `supabase/` local project, PostgreSQL client/server, Docker-compatible runtime, Supabase CLI, or running PostgreSQL/Docker process was found on Laptop B. Do not use the existing `.env.local` for write tests. `apps/worker/src/env.js` loads that file with `override: true`, so importing the live worker directly can overwrite a test URL and connect to the operational project.

The least expensive complete Realtime test environment is an **unlinked local Supabase stack** in a separate folder on Laptop B. It uses local compute and does not consume the hosted project's Realtime quota. Supabase currently requires the CLI plus a Docker-compatible container runtime on Windows; a local stack also includes Postgres and Realtime. Docker Desktop licensing depends on the user's organization; Rancher Desktop or Podman are alternatives. Nothing was installed or started in this pass. [Supabase local development](https://supabase.com/docs/guides/local-development), [Docker Desktop license](https://docs.docker.com/subscription-billing/desktop-license/).

## Files prepared, not executed

- `supabase-realtime-v14-local-stage-setup.sql`: checks the isolated schema, adds only `events` and `tracks` to the local `supabase_realtime` publication if needed, and creates a local-only gate. Never run against production.
- `supabase-realtime-v14-staging-migration.sql`: executable candidate guarded by that local-only gate, a valid single-column `events.dedupe_key` unique index, no unexpected `events` trigger, and event publication membership. Installs only the exact-row AIS `BEFORE UPDATE` guard.
- `supabase-realtime-v14-staging-rollback.sql`: separately guarded rollback of only that trigger/function.
- `supabase-realtime-v14-staging-metrics.sql`: read-only table/index/trigger/publication and WAL snapshots.
- `apps/worker/scripts/realtime-v14-local-replay.mjs`: accepts **only a loopback HTTP Supabase URL**, never imports the worker env loader, and uses synthetic records. It replays 84 vessels at five-second intervals for four cycles; checks response row counts, changed AIS fields, ADS-B and unrelated event controls, track/history heartbeat timestamps, and one local Realtime subscriber. It prints aggregate counts and durations, no credentials or vessel records. Each run uses fresh keys and does not delete rows.

The replay exercises the same PostgREST UPSERT conflict targets, but it does **not** run the production worker module or authenticated StratOps application. Those integration checks require a separately configured local worker/API copy that cannot load the production-linked `.env.local` files.

## Setup after explicit staging approval

1. Install a Docker-compatible runtime permitted by your license and the Supabase CLI on Laptop B; obtain PostgreSQL client tools for the schema-only export/import, or have a DBA provide the reviewed dump. Create `C:\DX\stratops-v14-local-stage` **outside** the application repository. In that folder run `npm init -y`, `npm install --save-dev supabase`, `npx supabase init`, then `npx supabase start`. Do not run `supabase link`, `db push`, or `db reset --linked`. Record the local API and database addresses from `npx supabase status`; both must be loopback. Keep the stack inaccessible from the network.
2. Obtain a **schema-only, no-row-data** export of the four production tables, their indexes/constraints and dependent types from a DBA using read-only `pg_dump --schema-only --no-owner --no-privileges --table=public.events --table=public.tracks --table=public.aircraft_tracks_log --table=public.naval_tracks_log`. Review the dump for unexpected DDL or sensitive function definitions. The production service-role REST key is not a database password. Import the reviewed schema **only into the local Supabase database**, using a PostgreSQL client and the loopback database URL from `supabase status`. Do not store production credentials in the repository.
3. Verify the target host and database in the client session. Run `supabase-realtime-v14-local-stage-setup.sql` against the isolated local database. Run the read-only V1.2 catalog queries and `supabase-realtime-v14-staging-metrics.sql`; compare index names/definitions, validity/readiness, triggers, publication, and replica identity to the production CSV and user-run SQL results. Stop on any mismatch.
4. Using **only** the service-role key printed by the local stack, set `STRATOPS_V14_LOCAL_URL` to its loopback API URL and `STRATOPS_V14_LOCAL_SERVICE_ROLE_KEY` in the current terminal. Run `node apps/worker/scripts/realtime-v14-local-replay.mjs --phase=before` from `C:\DX\warzone-recovery`. Save the aggregate JSON output and a second read-only metrics snapshot. The intended fixture baseline is 84 INSERTs and 252 identical event UPDATEs across the four cycles; these are expectations, not results.
5. With the local database address checked again, run `supabase-realtime-v14-staging-migration.sql` against **local only**. Repeat the read-only metrics query and run the same replay command with `--phase=after`, using its new synthetic IDs. Expected event UPSERT returned-row counts are `[84,0,0,0]` versus `[84,84,84,84]` before. Expected replay UPDATE messages are zero versus 252 before, plus separately counted meaningful-change controls. Track/history heartbeat writes must remain unchanged.
6. Compare database `n_tup_ins/n_tup_upd` deltas and optional `pg_stat_wal` deltas across the equivalent isolated phases; these counters are cumulative and may lag. Compare per-cycle durations, errors, and Realtime messages. Then run the 100/500/1,000-vessel and concurrent-worker cases from the V1.3 plan. Validate the authenticated UI only with an independently configured local API/worker, including both trackers, Focus/CTR, AOI, region switching, alerts, reports, satellite layers, and stale-contact rules. Do not use the operational `.env.local` files for this.
7. Run `supabase-realtime-v14-staging-rollback.sql` against local only and verify an identical AIS event UPDATE again returns one affected row and produces a Realtime UPDATE. Keep the local baseline/after JSON and SQL snapshots as the V1.4 evidence.

The SQL scripts are ordinary PostgreSQL files and can be run with a PostgreSQL client using `-v ON_ERROR_STOP=1 -f <file>` against the **verified loopback** database address. No command in this document has been executed. Do not paste any staging-only script into the production Supabase SQL Editor.

## Results and release gate

Completed this pass: read-only project/tooling detection, production schema CSV review from V1.3, source safety review, and preparation of guarded scripts. **No real PostgreSQL before/after measurements exist yet** because no isolated database is configured and migration execution is not authorized. The earlier production read-only 20-second sample had 336 naval event UPDATE deliveries, 252 of which were exact repeats after each key's first observed update; that is not a post-change saving or billing total.

| Staging metric | Before trigger | After trigger | Current status |
| --- | --- | --- | --- |
| 84-vessel replay row UPDATEs | Fixture expectation: 252 | Fixture expectation: 0 exact repeats | Not run |
| Realtime UPDATE deliveries for replay | Fixture expectation: 252 | Fixture expectation: 0 exact repeats | Not run |
| Meaningful position/time/metadata/status updates | Must deliver all | Must deliver all | Not run |
| Track/history heartbeat and stale-state checks | Baseline required | Must match baseline | Not run |
| Per-cycle duration, database CPU/WAL, errors | Measure locally | Compare locally | Not run |

Production release is **not recommended yet**. After staging passes, prepare a production-specific reviewed migration from the tested trigger body, take a fresh read-only production catalog snapshot, obtain explicit production approval, and apply it in one transaction through the approved DBA process. Keep the five-second poll and worker binaries unchanged. Monitor event UPDATEs, Realtime deliveries, tracking freshness, API errors and worker timing at comparable client/workload levels. A production rollback would drop only `zzzz_stratops_skip_identical_ais_event_update` on `public.events` and `public.stratops_skip_identical_ais_event_update()` in one transaction, followed by delivery/freshness checks. Never run the local-marker staging rollback against production. The under-four-million monthly target still requires the actual Supabase billing-cycle report.

Conditional production rollback SQL, **only after** a successful staging pass and an approved production change whose rollback plan includes these statements:

```sql
BEGIN;
DROP TRIGGER zzzz_stratops_skip_identical_ais_event_update ON public.events;
DROP FUNCTION public.stratops_skip_identical_ais_event_update();
COMMIT;
```

The exact production install script must be generated from the migration actually proven in staging, with a fresh production-only schema guard and no local marker. Issuing it before staging results would misrepresent this proposal as validated.

## V1.6 measured local validation (Laptop B, November 2, 2026)

The V1.4 blocked status above describes the earlier pass. The isolated local Supabase stack is now tested; no hosted Supabase connection, production write, deployment, or billing change was used. Docker Desktop's documented `portBindingBehavior` user setting was set to `local-only-port-binding` in `%APPDATA%\Docker\settings-store.json`; the original small settings file is backed up at `C:\DX\stratops-v14-local-stage\docker-settings-before-v16.json`. Docker Desktop 4.97 / Engine 29.9.2 published the five local ports 54321, 54322, 54323, 54324, and 54327 only on `127.0.0.1` and `::1`. Docker container inspection and Windows listening sockets agreed (10 loopback bindings, zero non-loopback). TCP probes to six non-loopback host addresses across all five ports found zero reachable endpoints. This establishes host-level loopback isolation for this run; it does not assert the state of another network machine.

The unlinked local project `C:\DX\stratops-v14-local-stage` received the V1.5 schema-only fixture, then the existing V1.4 publication/local-gate setup. Local PostgreSQL was 17.11 (production read-only report: 17.6). All 20 reconstructed indexes were present and ready; no non-internal triggers preceded the test; `events` and `tracks` alone were in `supabase_realtime`, with DEFAULT replica identity. The four-table fixture is still a reconstruction, with the V1.5 differences and unknowns documented in `supabase-realtime-v15-reconstruction.md`.

The existing replay script used new synthetic keys for each phase, 84 vessels and four five-second cycles. The first Realtime subscription after each Docker/Realtime start missed its initial 84 INSERT deliveries despite reporting `SUBSCRIBED`; UPDATE deliveries were complete. A second, warm run received all INSERTs. The table writes occurred in both cases. This cold-start delivery behavior is a separate local Realtime readiness limitation, not evidence that the AIS trigger discarded inserts.

| Local measured workload | Trigger absent (warm) | Trigger installed (warm) |
| --- | ---: | ---: |
| Main replay UPSERT rows returned, cycles 1-4 | 84, 84, 84, 84 | 84, 0, 0, 0 |
| Main replay identical AIS event UPDATEs | 252 | 0 |
| Realtime AIS INSERT deliveries | 84 | 84 |
| Realtime AIS UPDATE deliveries, including change/repeat/concurrent controls | 262 | 4 |
| `public.events` table INSERTs per run, including two control records | 86 | 86 |
| `public.events` table UPDATEs per run, including two non-AIS control records | 264 | 6 |

Thus the measured local reduction was **258 event row UPDATEs and 258 Realtime UPDATE deliveries per identical replay**; 252 of those were the four-cycle identical vessel observations. All four meaningful AIS changes (position, source time, metadata, status) returned an updated row and delivered an UPDATE. Exact repeats returned zero rows under the trigger. Two concurrent identical UPSERTs preserved one canonical row. Aircraft and unrelated signal events still updated; naval track/history heartbeat timestamps remained fresh. A separate local SQL check confirmed aircraft-history last-seen updates and a track transition to `stale` remained effective with the trigger installed. No DELETE test or full worker/API/authenticated UI flow was run.

Rollback removed only the local AIS trigger and function. A subsequent warm 84-vessel replay again returned 84 rows in each cycle and delivered 84 INSERTs / 262 UPDATEs. The trigger and function are absent from the local database at the end of the pass. The 25 focused worker tests for Realtime accounting, queue correctness, and naval writes passed. No application source changed, so no production build was run. Request durations varied between warm runs (baseline cycles 23.12/21.72/14.12/24.85 ms; trigger cycles 21.83/13.57/38.53/11.53 ms); this sample does not establish a processing-speed improvement. WAL counters include local background activity and were not used to claim savings.

**Release recommendation:** the exact-row AIS guard passed this isolated schema and delivery replay, including rollback, but production approval still requires a fresh read-only production catalog/trigger check and an approved deployment plan. The reconstructed fixture does not prove full deployed schema, grants, worker integration, authenticated feature behavior, or monthly billable messages. The under-4-million target remains unverified until production billing-cycle telemetry is available.
