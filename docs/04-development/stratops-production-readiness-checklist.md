# StratOps production database rollout checklist

## Final simplified sequence after isolated validation

**Current result:** PostgreSQL 17.12 isolated installation/reinstallation, rollback, permissions and 24 synthetic retention/concurrency scenarios passed. See [validation evidence and limitations](stratops-isolated-postgres-validation.md). This supersedes the earlier local-Docker/runtime blockers recorded below. Production remains unchanged; no production SQL or MCP queries were executed in this validation turn.

All files below are in `docs/04-development/`. Run **`supabase-db-maintenance-pause.sql` separately and commit it before each migration**, including retries. Stop if pause fails. Keep controls disabled throughout installation and application validation.

| Step | Execute in this order | Gate before proceeding |
|---|---|---|
| 1 | Verified restorable external backup; retain reviewed ownership/dependency exports | Never use prior aggregate counts as deletion instructions. |
| 2 | `supabase-db-health-foundation.sql` | Private controls exist and all are OFF. |
| 3 | `supabase-db-security-migration.sql`, then `supabase-db-security-verification.sql` | Validate production guest/authenticated reads, Auth, Realtime and service access. Security is independent of historical cleanup. |
| 4 | `supabase-db-sources-migration.sql` | Atomic linking installed; no cleanup invocation. |
| 5 | `supabase-db-performance-migration.sql` | Atomic counters installed; existing quota admission unchanged. |
| 6 | `supabase-conflict-72h-migration.sql` | Strict ownership/timestamps and existing worker fallback retained. |
| 7 | `supabase-db-alerts-migration.sql` | Correction/archive routines installed but not invoked. |
| 8 | `supabase-db-retirement-migration.sql` **last** | Report indexes/triggers, receipts and coordinated retirement installed; all controls OFF. |
| 9 | `supabase-conflict-72h-verification.sql`, `supabase-db-sources-verification.sql`, `supabase-db-alerts-verification.sql`, `supabase-db-security-verification.sql`, `supabase-db-performance-verification.sql`, `supabase-db-retirement-verification.sql` | All expected grants, controls and dependencies pass. No forced planner settings or unreviewed index DDL. |
| 10 | `supabase-db-retirement-preflight.sql` | Fresh authoritative source/observation/alert previews; source baseline counts from before retirement are insufficient. |
| 11 | Updated worker deployment, separately authorized | Receipt RPC used after successful object deletion; verify no missing-RPC fallbacks and normal report/tracker flows. No deployment occurred here. |
| 12 | Separately approve one physical cleanup control and a reviewed small trial batch | Reconcile exported IDs, observe workload, pause on mismatch. No automatic mass cleanup. |

The new `satellite_retirement` control governs standalone observation retirement; `stratops_prune_retired_observations(100)` is called from the existing conflict maintenance RPC and can also be invoked deliberately after approval. It requires a receipt, cleared references, seven-day expiry and no report pins. Historical NULL keys are still insufficient proof. New image references invalidate old receipts. Existing event-family retirement continues to handle its eligible children atomically under its own approved parent scope.

The previous staged sections and original audit below are retained as historical context. Their statements that isolated PostgreSQL was unavailable are now superseded. Their production backup, report-release, historical receipt-proof and independent cleanup-approval requirements remain in force. The 90-day cleared escalation policy remains separately gated. Production is 17.6 versus local 17.12; real Supabase Auth/Realtime/S3 and production-scale contention still require controlled rollout checks.

26 November 2026. This is the consolidated execution checklist; it supersedes the execution sequence in `stratops-database-health-report.md`. All filenames below are relative to `docs/04-development/`.

## Production verification completed

Live Supabase MCP queries succeeded with `transaction_read_only=on` on PostgreSQL **17.6**, approximately 18:56–19:02 UTC (13:56–14:02 Toronto). The five group preflights ran statement by statement because this connector returns only the final result set of a multi-statement request. All 45 statements in the final five scripts succeeded; the additional 16-statement catalog/dependency preflight also succeeded. These are successive snapshots of a working database, not one frozen cross-query snapshot. No migrations, record changes, permission changes, destructive RPCs or cleanup activation were performed.

| Check | Verified production result | Decision |
|---|---|---|
| Schema | 22 public tables, 388 columns; 47 validated constraints, seven public functions, five enabled triggers (four internal FK triggers), 11 policies; no public views or views depending on public tables found | Catalog matches the supplied full schema. Recheck immediately before rollout. |
| Roles and ACLs | Neither anon nor authenticated inherits another role; neither bypasses RLS. Service role bypasses RLS and has all-table access. All three lack public-schema CREATE. No explicit column ACLs found. Effective table permissions still grant authenticated mutation on 20 tables and anon TRUNCATE on 20 | Security remains unresolved in production. Do not confuse privileges with RLS row authorization; TRUNCATE is outside RLS protection. |
| RLS | Disabled on `events`, `tracks`, `active_alerts`, `raw_items`, `worker_state` | Existing policies on events/alerts are ineffective until RLS is enabled. Use the reviewed transactional security group and preserve intended reads. |
| Public functions | Four reporting job SECURITY DEFINER functions are service-only and explicitly check `auth.role()`. Two quota routines are service-only. The client-executable AIS routine returns trigger and is not a directly callable row writer | Preserve all seven. Their public search paths are not writable by the inspected client roles. No unrelated RPC rewrite is justified. |
| New indexes | All three requested indexes have the exact expected keys/predicates, `indisvalid=true`, `indisready=true` | Each representative EXPLAIN selects its corresponding index. No recreation, forced planner setting or index removal. EXPLAIN is not a measured before/after latency result. |
| All indexes | 93 public indexes; duplicate events dedupe indexes confirmed by advisor. Existing unique constraint is bound to `events_dedupe_key_key` | Do not drop either as part of this rollout. Usage counts alone do not authorize dropping other indexes. |
| Source orphans | 1,506,505 non-NULL, both-parent-missing links; 1,146 held by report UUID references; **1,505,359 candidates after report exclusions**; no direct report references to source-link IDs; no NULL reference rows or duplicate `(event_id,raw_item_id,support_type)` groups found in the sampled live preflight | Candidate count is a preview, not approval to delete historical source attribution. Export and review historical semantics first. New source preflight also checks direct link-row references. |
| Conflict ownership | Five recent and 11 expired explicitly owned events; 15 strict URL-plus-source-ID legacy matches can be tagged, including already dedupe-owned records | These are not 15 additional incidents. Generic news/OSINT remains outside conflict ownership. Four expired owned rows pass current dependency guards; the others are held. |
| Reports and observations | 74 reports, 74 snapshots, 55 observations; no generating reports or queued job records at final check. Four expired owned-event observations; 45 expired independent/unverified observations in the dependency query, all without storage keys | Snapshot scope differs from earlier exports. No inference of deletion or new ownership. Preserve observations even after preview cleanup. |
| Foreign keys | `event_satellite_observations.event_id` has validated **ON DELETE CASCADE** to events; no event-source parent FKs | Any unchecked parent deletion could cascade observations. Existing explicit satellite/source/report guards must remain. |
| Alerts | 145,348 stale orphan escalation alerts qualify for the separate 30-day archival preview | No classification as conflict-owned, fabricated expiry, archival or deletion occurred. |
| Existing cleanup | No application cleanup routines or new maintenance controls installed. pg_cron absent; pg_stat_statements present. Realtime publishes events and tracks | Worker fallback is required. Database inspection cannot establish deployed worker revision, external schedules or application deletion calls. A non-application Storage protection trigger matched the broad routine search and was excluded from application cleanup findings. |

The first read-only security preflight's `information_schema` grant views returned zero rows even though effective privileges were broad: the audit role is not a member of those grantee roles. The revised preflight/verification uses catalog ACLs and effective privilege functions so empty grant views cannot be mistaken for secure access.

PostgreSQL 17 adds the `MAINTAIN` table privilege. Production grants it to both client roles on 20 tables. The local security migration now revokes it on its existing operational targets, checks for inherited MAINTAIN and column mutation rights, and preserves the existing ACL snapshot/rollback. No production permission was changed. `stratops_subscriptions` remains outside the migration's targets.

## Dependency holds that do not expire automatically

- An event with a surviving source link is held by `stratops_event_has_dependents`; source cleanup requires both parents missing. The raw-item prune also holds raw rows referenced by any source. That chain cannot free itself merely through age. The live preview found two raw rows older than seven days held by sources, including one with missing-event source history. One old independent event had source, satellite and report holds; a subsequent snapshot had a second report-held independent event. This is intentional preservation, not a reason to disable guards.
- Any satellite observation holds its parent even after the observation is expired and its S3 key is cleared. Four expired owned events have observations. There is no automatic observation-row retirement in these migrations. Clearing an image does not release the FK or authorize parent deletion.
- The conservative report guard includes available, expired and failed reports and all snapshots. Five expired owned events have report references; this overlaps some observation holds. A failed or expired report can therefore hold evidence indefinitely. Report retention and evidence-release decisions require separate review; no automatic report/source/observation deletion is introduced.
- Event cursor cycling prevents held events from starving later candidates, but does not release a hold. The rolling 72-hour map visibility window remains separate from physical retention.

Do not solve these holds with CASCADE, forced unlinking or report deletion. Keep the held records until their intended retention semantics and an archive/release policy are approved. The guarded orphan preview remains useful for genuinely parentless, unreferenced links.

## Current rollout sequence: separate approval stages

This section supersedes the older numbered table below. The prior audit is complete and is not repeated. New SQL is prepared locally; **installation, runtime, concurrency and rollback tests are still gated on isolated PostgreSQL 17**. No production SQL was executed in this continuation.

1. **Pause:** run `supabase-db-maintenance-pause.sql` as a complete, separate committed script before EVERY migration installation or retry. Stop if it fails. A pause inside a failing migration transaction alone would roll back and could restore enabled controls. Each migration also disables controls internally. No automatic re-enable occurs.
2. **Security-only rollout:** run `supabase-db-health-foundation.sql`, then `supabase-db-security-migration.sql`, then `supabase-db-security-verification.sql`. Validate guest/authenticated reads, auth, Realtime and service access. No source cleanup, alert archival, worker deployment or destructive activation is needed to apply the security corrections. Stop on any role/RLS error or unexpected enabled control. Security rollback remains `supabase-db-security-rollback.sql`.
3. **Maintenance installation, still OFF:** pause separately before each file, then run `supabase-db-sources-migration.sql`, `supabase-db-performance-migration.sql`, `supabase-conflict-72h-migration.sql`, `supabase-db-alerts-migration.sql`, and finally **`supabase-db-retirement-migration.sql`**. The last file overrides the original conservative event/source prune functions; it MUST be last. Run `supabase-db-retirement-verification.sql` plus the existing five verification files. All controls must be false. Report document counts must match. Do not rerun foundation/source after retirement unless also reinstalling retirement last.
4. **Worker deployment, separate authorization:** only after SQL validation, deploy the updated worker containing `recordPreviewRetirement` in `apps/worker/src/copernicus-runner.js`. No deployment occurred here. Successful S3 deletion now atomically records a receipt and clears references via the service-only RPC. Missing RPC, false return or network failure retains the key for retry; do not count an absent receipt as successful database retirement. Existing S3 deletion criteria and provider quotas are unchanged.
5. **Destructive cleanup, separate authorization:** export fresh affected rows and verify external restoration first. Enable only one approved control using its actual backup reference/review timestamp; manually call one bounded batch and reconcile all deleted event/link/raw/observation IDs against the export. `conflict` uses the original 72-hour cutoff; `working_history` retains its existing seven-day scope. `source_orphans` now also permits reviewed source history older than seven days whose event is missing; the prior 1,505,359 count does NOT describe this expanded population. Never reuse it as a deletion target. NULL-reference history is still held. Measure real SQL batch duration before scheduling. Stop on unexpected parent loss, report access regression, timeout, deadlock or mismatched preview.
6. **Cleared escalation deletion, separate control:** proposed retention is 90 days after both `cleared_at` and last update. `stratops_prune_cleared_escalations(100)` requires `cleared_escalations` approval, a proven conflict marker or reviewed stale-escalation archival marker, no parent event and no report references. It does not delete active alerts or independent categories. Alert backup rows remain for audit; restoring a physically deleted alert requires the external export. This policy is prepared, not activated.

### Retention and explicit report release rules

After the isolated tests and a separate destructive approval ONLY, activate one reviewed control with the following template, replacing both placeholders. Never include this in an installation script:

```sql
UPDATE stratops_maintenance.controls
SET enabled=true,backup_reference='<VERIFIED EXTERNAL BACKUP>',reviewed_at=now()
WHERE name='<ONE APPROVED CONTROL>';
```

Then call only its corresponding batch: `SELECT public.maintain_conflict_intelligence_72h();` for `conflict`, `SELECT public.stratops_prune_working_history();` for `working_history`, `SELECT public.stratops_prune_source_orphans(100);` for `source_orphans`, or `SELECT public.stratops_prune_cleared_escalations(100);` for `cleared_escalations`. Historical escalation archival remains the separate `historical_escalations` control and `stratops_archive_stale_escalations(100)` call. Pause again after a trial batch and reconcile exported IDs before continuing. A successful function return is not sufficient evidence of correct retention.

- Coordinated event batches lock the event and child rows, then remove eligible links and observations before the parent in the SAME transaction. Maximum 100 events, 1,000 links per event and 100 observations per event; larger families are held for review. Shared raw evidence survives until no source link references it, it is older than seven days and it has no report pin. Concurrent source inserts acquire parent key-share locks, including direct writers, preventing insertion against a retired parent. Lock timeout aborts the transaction rather than leaving partial families.
- Any report-protected event, source link, raw item or observation keeps the family held. Report UUIDs are parsed once during installation and updated synchronously by report triggers. UUID checks use `report_pins(ref)`, including UUID text tokens for orphan checks. Arbitrary URL/storage-key substring checks retain the conservative document scan; these do not run per orphan candidate. No periodic cache-refresh gap is introduced.
- Report publication and cleanup share advisory transaction lock `(190087,72)`. Cleanup returns without work when report generation is active. A report INSERT/UPDATE/DELETE takes the lock before modifying rows and maintains pins atomically. Updates revoke prior releases. These concurrency properties require real PostgreSQL testing before rollout.
- Available or still-dependent reports remain pinned. Expired/failed status alone does not release evidence. A reviewed release requires a verified independently restorable, self-contained report archive (including any preview assets and displayed evidence) and confirmation the live report no longer needs the underlying objects. Only an administrator may insert a `report_releases(kind,id,backup_reference,reviewed_at)` row, in a transaction holding `pg_advisory_xact_lock(190087,72)`, after checking report status/identity and absence of generating jobs. Kinds are `operational_reports` or `operational_report_snapshots`; IDs are their actual primary keys. Review expired/failed reports monthly; preserve the pin if archive verification fails. No report or report snapshot is deleted automatically.
- Satellite observation retirement requires expired status, expiry at least seven days old, no storage/image reference, no report pin, and a `preview_retirements` receipt. New receipts are written only after a successful storage deletion. Historical NULL keys are ambiguous: preserve them until an operator verifies prior storage retirement against logs/inventory and explicitly records a reviewed receipt for that observation. Never bulk seed receipts from NULL keys. No live orbital satellite catalog is touched.

### Local PostgreSQL 17 availability and exact Windows preparation

Current checks: Docker Desktop is installed at `C:\Users\wirfa\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe` and its UI/backend processes are already running. Engine access fails with permission denied on `dockerDesktopLinuxEngine`; `wsl --status` also returns access denied. `postgres` and `psql` are absent from PATH. This is an access blocker, not evidence that Desktop needs installation. This session cannot change Windows account/daemon permissions. No software, image or service was installed or started.

In a normal PowerShell window under the Windows account that owns Docker Desktop, run:

```powershell
docker context ls
wsl --status
docker version
docker image inspect postgres:17
```

Open the existing Docker Desktop from Start if installed, select its Linux/WSL 2 engine and wait until `docker version` shows a server. Do not change Docker permissions or WSL Windows features blindly. If Desktop or WSL needs installation/update, obtain approval first and follow [Docker's Windows installation instructions](https://docs.docker.com/desktop/setup/install/windows-install/) and [WSL backend instructions](https://docs.docker.com/desktop/features/wsl/). No paid service is required by this plan; no license entitlement is asserted.

Only after Docker is usable AND use/download of the PostgreSQL image is approved, create the disposable local instance (localhost binding, local test credentials only):

```powershell
docker run --name stratops-pg17-retirement -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=stratops_test -p 127.0.0.1:55432:5432 -d postgres:17
docker exec stratops-pg17-retirement pg_isready -U postgres -d stratops_test
docker cp docs/04-development stratops-pg17-retirement:/sql
```

Do NOT connect this container to production or load production credentials. First load a sanitized schema with all 22 table definitions, constraints, existing functions, roles `anon/authenticated/service_role`, and an `auth.role()` test fixture. A blank PostgreSQL database cannot run the migrations correctly. Then use `docker exec -i stratops-pg17-retirement psql -v ON_ERROR_STOP=1 -U postgres -d stratops_test -f /sql/<exact-script-filename>` for each script in stages 1–3. All such commands are future operator steps, not executed evidence.

### Required isolated validation matrix (not yet executed)

Run forward installation, verification and repeated installation with controls first enabled ONLY in the disposable database; the separately committed pause must leave controls off even when a following migration deliberately fails. Verify client denials and service access, including PG17 MAINTAIN, then run reverse rollback and reinstall.

Seed synthetic cases: recent 71-hour event; exact 72-hour cutoff; expired event with multiple links; two events sharing raw evidence; missing-event historical link; NULL references; report-pinned event/raw/link/observation; generating report; expired observation without receipt; matching receipt; nonmatching key receipt; 90-day cleared owned escalation; active and independent alerts. Export before/after IDs. Roll back a deliberately failed child deletion and verify the entire family is unchanged. Test batch limits and high-fanout holds.

Use two psql sessions: hold a report INSERT/UPDATE transaction while invoking cleanup; repeat in reverse order. Neither transaction may allow a stale report pin. Repeat with source INSERT against a locked parent and with two events sharing a raw row. The source writer must either retain a valid parent or fail atomically. Test lock timeout/retry and reinstallation while a batch runs. Measure report UUID checks and a 1,000-link cleanup against representative report documents; compare with the old helper scans without claiming a production speedup.

For retirement rollback: pause, run `supabase-db-health-foundation.sql` and `supabase-db-sources-migration.sql` to restore their old safe functions, then `supabase-db-retirement-rollback.sql`. Keep private receipts/documents/pins/releases. Remaining group rollback order is unchanged. Re-running the old conservative helpers safely restores holds; deleted rows require external restoration.

Continuation validation: 45 targeted Node tests passed, including receipt success/failure/network cases and SQL guard assertions; worker syntax passed. These are NOT full PostgreSQL migration/concurrency tests. No production audit was repeated and no production query or write was executed during this continuation.

The application and marketing `npm run build` also passed using the existing isolated-output workspace, with the existing size warnings. The prepared SQL remains unexecuted and must not be described as runtime validated.

Functions changed by this continuation: `cleanupExpiredSatelliteObservations` and new `recordPreviewRetirement` in the worker; prepared SQL overrides `stratops_report_references`, `prune_event_batch` and `stratops_prune_source_orphans`; adds report-lock/index and source-parent trigger functions, `stratops_record_preview_retirement` and `stratops_prune_cleared_escalations`. Installation scripts only add disabled-control guards. Existing frontend, map expiry logic and unrelated stylesheet edits were not changed by this work.

## Historical numbered sequence (superseded by the staged sequence above)

**Current readiness: production diagnostics complete; migration application and destructive activation remain gated.** Nothing in this checklist authorizes automatic execution.

| Order | Exact file/action | Expected result | Stop condition |
|---|---|---|---|
| 1 | `supabase-db-production-preflight.sql` | 22 tables/388 columns; reviewed constraints, triggers, routines and dependency counts; read-only session | Schema drift, unexpected cascade/trigger/RPC, unreviewed dependent object or inaccessible evidence. |
| 2 | `supabase-conflict-72h-preflight.sql` | Proven ownership, original timestamps, unique upsert target, protected observations/reports and retention previews | Duplicate URLs/owned dedupe keys, unsupported ownership, malformed original timestamp data or schema mismatch. |
| 3 | `supabase-db-sources-preflight.sql` | Fresh non-NULL parentless count, report exclusions, duplicates and initial parent-lookup plan | Treating 1,505,359 as a fixed delete target; missing export; unreviewed source-history semantics; report generation in progress. |
| 4 | `supabase-db-alerts-preflight.sql` | Proven-parent correction preview separated from unproven stale orphan archival | Mixed alert categories, uncertain parent ownership or unreviewed archival population. |
| 5 | `supabase-db-security-preflight.sql` | Effective ACLs, MAINTAIN, recursive memberships, policies, callable routines and Realtime inventory | Inherited client rights, unexpected restrictive reads, unexplained RPC access or service-role access mismatch. |
| 6 | `supabase-db-performance-preflight.sql` | Three indexes valid/ready, expected definitions and selected plans; optional missing source-URL index printed as text only | Invalid/not-ready indexes, different predicates, poor plans or conflicting existing index definitions. Never execute returned DDL automatically. |
| 7 | `supabase-db-readonly-regression.sql` | Eight synthetic SQL cases pass; exactly one candidate eligible | Any failed case. This tests predicates, not migration installation or concurrency. |
| 8 | Existing isolated PostgreSQL **17** validation and external backup/restore rehearsal | Apply the forward sequence below against a representative sanitized schema/roles; rerun; run all verification files; rehearse reverse rollback. Test concurrent source linking/parent pruning/report creation, empty backup references, controls disabled and explicit holds. Review real RPC candidate plans and batch durations | **Not completed here:** no local postgres/psql and Docker daemon inaccessible. Do not substitute a production transaction or production TEMP schema. Do not add infrastructure/dependencies to bypass this gate. Backup restore, role/RLS behavior and SQL concurrency remain unverified. |
| 9 | Separately review optional DDL emitted by performance preflight | Source URL lookup index only if still absent and a reviewed plan supports it | No measured/plan evidence, equivalent index exists, insufficient operational window. If approved, `CREATE INDEX CONCURRENTLY` must run alone outside migration transactions. No existing index drops. |
| 10 | `supabase-db-health-foundation.sql` | Private schema and service-only dependency guards; all four cleanup controls false on first install | Any control enabled unexpectedly, public access to private schema/functions, missing dependency table or lock timeout. This creates no cleanup approval. |
| 11 | `supabase-db-sources-migration.sql` | Atomic source-link RPC; orphan RPC rejects missing/empty backup references and holds generating reports/direct link-row references | Failed isolated parent-lock/race tests; controls not false; unreviewed historical reference behavior. No orphan cleanup call yet. |
| 12 | `supabase-db-performance-migration.sql` | Service-only atomic usage increment installed; existing quota admission unchanged | Counter race/permission tests fail or quota behavior differs. No paid dependency or index creation here. |
| 13 | `supabase-conflict-72h-migration.sql` | Strict legacy ownership tagging, timestamp preservation triggers and protected worker maintenance; no pg_cron installation | Tagging affects unproven events; original dates are changed incorrectly; satellite/report/source protections absent. Cleanup remains disabled. |
| 14 | `supabase-db-alerts-migration.sql` | Correction/archival functions installed; no automatic historical correction | Missing private backups, unexpected ownership scope or controls enabled. A later deliberate `stratops_correct_conflict_alerts(500)` call changes records and requires a reviewed/exported preview. |
| 15 | `supabase-db-security-migration.sql` | One transaction snapshots ACL/RLS and applies reviewed role restrictions, including PG17 MAINTAIN, while preserving intended guest/authenticated reads | Any guard exception, inherited mutation/column/MAINTAIN rights or application read/auth regression. Roll back the transaction; do not change memberships to force success. |
| 16 | `supabase-conflict-72h-verification.sql`, then `supabase-db-sources-verification.sql`, `supabase-db-alerts-verification.sql`, `supabase-db-security-verification.sql`, `supabase-db-performance-verification.sql` | All service-only ACLs/controls/ownership/expiry/index checks pass. Role smoke reads and existing guest/authenticated/Reatime flows work | RPC fallback/missing function, unexpected public write/internal read, regression in report previews or trackers. These files depend on installation and were **not** executed as post-migration evidence against unchanged production. |
| 17 | Separate reviewed worker activation and observation | Installed SQL dependencies used; no missing-RPC compatibility fallback; rolling-window/replay and original-time expiry correct | Unknown deployed version, old blind pruning still active, duplicate work, unexpected event/observation loss or quota changes. Deployment is outside this task and has not occurred. |
| 18 | Separately approved cleanup controls and one bounded batch at a time | Verified external backup reference/review timestamp and correct control only; counts reconciled against the fresh preview | **Do not enable yet.** Isolated SQL/runtime plans, restore rehearsal and historical semantics are outstanding. Parent-only EXPLAIN does not validate the report-scanning RPC. Reports contain about 26.5 million serialized characters; repeated per-candidate helper scans need realistic batch measurement. Preserve all holds. |
| 19 | Repeat performance verification and advisors after a comparable workload | Compare plans, row counters/WAL/latency without resetting statistics. Retention correctness independently verified | Do not claim production speedup from mocks, index existence, EXPLAIN costs or one cumulative counter snapshot. No VACUUM FULL, REINDEX or paid compute changes prescribed. |

In step 18, `conflict`/`working_history`, `source_orphans` and `historical_escalations` are separate approvals. If eventually authorized, use the existing control-table statements and bounded RPCs from the implementation report, replacing its backup placeholder with a real verified identifier. Do not paste activation SQL during installation. Source deletion requires the reviewed export; historical alert archival is a separately reviewed status change. Undated historical Middle East Eye reports remain protected.

## Advisor findings and disposition

Security advisor: five RLS-disabled errors, two policy-with-RLS-disabled errors and eight RLS-enabled/no-policy informational findings. The last group can be intentional service-only access; do not add public policies simply to clear a notice. [RLS remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [ineffective policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled).

Performance advisor: five auth/RLS-initplan warnings, one duplicate-index group, 20 unused-index informational findings and one Auth connection-allocation informational finding. Service-role policies may be bypassed by the worker; no measured hot path justifies changing them here. Do not remove indexes or change Auth/compute settings automatically. [RLS initplan guidance](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [duplicate-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index), [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Rollback and stopping cleanup

After any future authorized activation, first disable all private maintenance controls. This is a future write action, not something performed by this audit. Then use this order:

1. `supabase-db-security-rollback.sql` (restores the captured, potentially unsafe ACL baseline including MAINTAIN; use deliberately).
2. `supabase-db-alerts-rollback.sql` (only matching applied update stamps restore automatically).
3. `supabase-db-sources-rollback.sql`.
4. `supabase-db-performance-rollback.sql`.
5. `supabase-conflict-72h-rollback.sql`.
6. `supabase-db-health-foundation-rollback.sql`, after its callers are removed.

No rollback reconstructs deleted rows or S3 objects. Those need independently verified backups/exports. Preserve private ACL/lifecycle snapshots for audit. Do not reinstate the old worker's unguarded deletion paths as a rollback shortcut.

## Local changes and validation in this verification pass

- `supabase-db-security-{preflight,migration,verification}.sql`: effective privilege visibility, recursive roles, version-guarded MAINTAIN revocation and effective column mutation checks. Existing security scope/rollback snapshot design retained.
- `supabase-db-sources-{preflight,migration}.sql`: exact protected-population preview; direct source-link report-reference checks; active report-generation and empty-backup guards. NULL and singly missing references remain excluded.
- New `supabase-db-production-preflight.sql` and `supabase-db-readonly-regression.sql`: reproducible read-only inventory/hold queries and synthetic SQL cases.
- `apps/worker/test/database-health.test.js`: two focused prepared-SQL guard regression tests. No operational backend or frontend JavaScript changed.
- Targeted Node tests: **41 passed, zero failed/skipped**; eight read-only PostgreSQL fixture cases passed. Test-file syntax and `git diff --check` passed.
- Full `npm run build` passed for application and marketing using the existing isolated-output workspace `.generated/air-patrol-validation/workspace`; existing marketing size warnings remain. UI flows after future RLS changes are unverified because no migration was applied.
- Ignored audit evidence: `.generated/database-health/production-readonly-evidence.json` contains aggregate/catalog/plan/advisor results, without the sampled raw alert/source payloads. It is not a backup and should not be published.

No production migration, DML, permission change, destructive function, SQL extension installation, S3 operation, infrastructure change, dependency installation, commit, push or deployment occurred. Full migration installation/rerun/rollback and concurrent behavior still require the isolated-runtime gate above.
