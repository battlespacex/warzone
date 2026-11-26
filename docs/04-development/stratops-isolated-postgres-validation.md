# Isolated PostgreSQL retirement validation

Validation completed against the user-provided `stratops-pg17-retirement` endpoint, `127.0.0.1:55432/stratops_test`, PostgreSQL **17.12**. Production's previously inspected version was 17.6; this validates the same major version, not an identical Supabase deployment.

Docker control commands remained sandbox-denied. PostgreSQL TCP access succeeded, using a temporary dependency-free Node test client with SCRAM authentication. No installation, image download, Docker permission change or production connection was necessary. No production MCP calls were made during validation.

## Baseline and limitations

The isolated public schema was empty initially. It was reconstructed from the existing local audit metadata: 22 tables, 388 columns, 47 constraints, 93 indexes and seven existing public function definitions/permissions. Test roles reproduce the application grants and RLS flags; 11 representative policies reproduce the recorded policy logic. The policy names are synthetic. Existing AIS trigger behavior was included. No production record payloads or credentials were loaded.

An `auth.role()` fixture uses the test connection's claim setting. This does not reproduce Supabase Auth, API routing, Realtime or S3. Actual S3 deletion was not attempted; receipt tests use fictional storage keys. Optional pg_cron scheduling, Supabase-specific extension behavior and production-scale lock contention remain outside this local validation. No browser or live deployment behavior is claimed.

## Executed results

| Test group | Result |
|---|---|
| Seven forward migration groups, each preceded by the separately committed maintenance pause | Passed |
| Repeated installation of all seven groups, starting with synthetic controls enabled before each retry | Passed; controls disabled after every installation |
| Six post-install verification files | Executed successfully |
| Five original preflight files and the new authoritative post-retirement preflight | Executed successfully locally; no production audit repeated |
| Failed following migration after a committed pause | Passed; rollback did not restore enabled controls |
| Full retirement/security/alert/source/performance/conflict/foundation rollback | Passed |
| Effective role/table permissions after rollback | All 66 combinations restored to the fixture baseline |
| Reinstallation after rollback | Passed |
| Final maintenance state | Every control disabled |
| Synthetic behavioral scenarios | **24 passed** |
| Targeted Node regression suite | **45 passed**, zero failures/skips |
| Application and marketing production build | Passed using existing isolated outputs; existing asset-size warnings remain |

The 24 scenarios include recent and exactly 72-hour events; family retirement; shared/unshared raw evidence; NULL source history; aged missing-event links; direct report and snapshot pins; explicit release and re-pinning after update; generating-report holds; receipt mismatch and success; unknown historical NULL keys; receipt invalidation on a new image; standalone observation retirement while retaining its parent; high-fanout holds; bounded batches; explicit and injected-failure rollback; actual client write denials; service source deduplication and counter increments; owned cleared-alert deletion; independent/active alert preservation; stale alert archival and lifecycle rollback; concurrent report publication in both lock orders; source insertion against a retiring parent; and competing cleanup batches sharing evidence.

## Corrections completed

- A new preview invalidates any old receipt before its references change. The receipt RPC refreshes the retirement timestamp only on a matching expired observation/key.
- `stratops_prune_retired_observations(100)` provides an independent, separately controlled observation lifecycle. It requires a seven-day expired row, cleared object references, a receipt, no observation/parent report pin and no generating report. It preserves the parent. The existing worker maintenance RPC invokes this bounded function when installed; it remains disabled until `satellite_retirement` is separately approved.
- Shared preview pin checks now protect report references to observation IDs as well as parent IDs/storage keys.
- The source preflight is explicitly identified as a pre-install baseline. `supabase-db-retirement-preflight.sql` mirrors the installed expanded missing-event source policy, approved report releases, observation lifecycle and cleared-alert rules. It is the authoritative preview before any destructive approval.
- Retirement rollback removes the new receipt trigger/function and standalone observation function before restoring the remaining groups.

## Local dependency benchmark

Twenty absent UUID lookups against 26.5 million synthetic report characters, measured using PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`:

| Implementation | Execution time |
|---|---:|
| Original per-candidate serialized report scan | 1,049.077 ms |
| Indexed UUID dependency helper | 0.446 ms |

This is one synthetic local comparison, not a production latency or throughput claim. Arbitrary URL/key substring checks intentionally retain conservative scans; orphan UUID checks use the index. Migration cache population and future report updates still pay the one-time parsing cost.

## Evidence and repeat commands

Ignored local artifacts under `.generated/database-health/`: `local-pg.cjs`, `validate.cjs`, `scenarios.cjs`, `rollback.cjs`, `benchmark.cjs`, `final-checks.cjs`; result files `isolated-results.json`, `scenario-results.json`, `rollback-results.json`, `benchmark-results.json`, `final-checks.json`.

These harnesses are restricted to the provided localhost test database. **The bootstrap resets that isolated database's public and maintenance schemas and must never be adapted to production.** Synthetic setup errors (a missing sequence, FK creation order and separators in exported function definitions) were corrected in the harness before the successful runs; they were not production migration failures.

```powershell
node .generated/database-health/validate.cjs --bootstrap
node .generated/database-health/scenarios.cjs
node .generated/database-health/rollback.cjs
node .generated/database-health/benchmark.cjs
node .generated/database-health/final-checks.cjs
```

The production execution sequence is maintained at the top of `stratops-production-readiness-checklist.md`. Successful local validation does not authorize production SQL, cleanup activation, deployment, commit or push. A fresh backup/export and production application/role smoke checks remain operator rollout gates.
