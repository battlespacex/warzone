# V1.5 four-table local schema reconstruction

Laptop B: `C:\DX\warzone-recovery`. Source: user-exported production SQL Editor CSVs on November 1, 2026. No database password, production write, password reset, or deployment.

## Verified match in isolated PostgreSQL 17

`supabase-realtime-v15-local-fixture.sql` reconstructs the four tables with **87 columns**. A catalog comparison against `Supabase Snippet Untitled query.csv` found zero differences in column name, type, nullability, default expression, table RLS enabled/forced flags. Comparison against `Supabase Snippet Untitled query (1).csv` found zero differences across **20 indexes**, including definition, uniqueness, validity, readiness, and nonpartial status. The seven primary/unique constraints also matched the earlier constraint CSV. The single exported policy, `events` / `public read events` / `anon SELECT USING (true)`, was recreated; `events` RLS itself is **disabled** in production and fixture. RLS is enabled on both history tables and disabled on `tracks`.

Production's earlier read-only catalog check reported DEFAULT replica identity on all four, no non-internal triggers, and only `events` and `tracks` in `supabase_realtime`. The separate V1.4 local setup script supplies that publication membership and its local-only gate. Production PostgreSQL is 17.6; the isolated test engine was PostgreSQL 17.

## Remaining limits

This is a **reconstruction, not a production dump**. The CSVs do not establish deployed grants/ownership, sequence settings or ownership beyond the visible default, collations, storage settings, extension installation, publication options, or schema changes after export. The fixture adds service-role grants for the local PostgREST test; deployed grants were not exported. No production records were copied. The runtime impact of production RLS/permissions and a full authenticated application was not tested. The fixture has no non-internal triggers, matching the earlier user-run report; a fresh production trigger check is required before any release.

The full local Supabase stack started but Docker Desktop published its ports on `0.0.0.0` and `[::]` despite the requested loopback Docker network. It was stopped before schema import or write tests. Do not import the fixture or run the V1.4 replay/migration in that stack until local port isolation and the target endpoint are verified.

## Tests performed

In a throwaway PostgreSQL 17 Alpine container with network mode `none` and no published ports, the revised fixture, existing V1.4 local setup, trigger migration, and rollback executed successfully. An initially absent synthetic AIS event inserted one row; an identical UPSERT before migration returned one row; the same exact UPSERT after migration returned zero; a changed status returned one. The test container was removed. The isolated engine's WAL level was not logical and no Realtime service ran, so **Realtime deliveries, the 84-vessel/four-cycle workload, database resource deltas, and monthly billable savings remain unmeasured**.

No application source changed. The existing V1/V1.1/V1.2 and V1.4 SQL/replay files remain untouched.
