# Automatic 72-hour operational reports

This change is source only. It does not apply a migration, publish a report, restart PM2, or alter production data.

## Window and lifecycle

The fixed anchor is `2026-01-01T00:00:00.000Z`. It must be UTC midnight and must remain unchanged after activation. Each window is `[anchor + 72h × n, anchor + 72h × (n+1))`; a window is eligible only once its end has passed. `REPORTING_72H_CATCHUP_START_UTC` is required when enabling the schedule: choose the earliest window with retained source data and keep it stable across restarts. The continuously running `warzone-worker` checks immediately on startup and every 30 minutes. It scans eligible windows oldest first, skips already available/expired reports, attempts at most two claims per check, and continues later. A failed or leased period does not block newer periods. The worker never relies on a page visit or the PM2 `reports` one-shot entry.

The new type is `72hour`, with deterministic `72hour:<start-date>:<scope-key>` report key and `72hour:<start-date>:<scope-key>:v1` snapshot key. Output uses `reports/72hour/<scope>/<start-date>/`. The 72-hour pipeline uses the existing snapshot, intelligence, HTML, PDF-print, S3, and API components. It skips `reporting-capture-service.js`, Cesium, Focus, CTR, and every screenshot path, even when `REPORTING_CAPTURE_ENABLED=true`. PDF printing still uses its separate headless browser renderer.

Core events, conflict items, and current tracks are required; pagination fails instead of silently truncating at the configured bounds (30,000 events/conflict records; 100,000 track rows). Optional alert, satellite-observation and status-feed failures are recorded as unavailable. Status-feed vulnerability advisories are excluded from operational event synthesis. HVA output uses structured identity, operator, position, motion, observation times and available source metadata. The existing `tracks` table and aircraft/naval logs retain current/latest rows, so catch-up cannot reconstruct every past position after the source changes or expires. Set the catch-up boundary only where the underlying event data still exists; a full historical movement report would require a separate archival telemetry store. A zero count from an empty query cannot independently prove the source retained the full historical window.

The `operational_72hour_jobs` row is atomically claimed by Supabase RPC with a time-limited lease. The owner renews during long runs and checks ownership at stage boundaries. The completion RPC locks the job and updates the report row in one transaction, so a stale owner cannot mark another worker's job available. Failed jobs retain attempt count, stage, and error; exponential backoff is bounded to one day and permanent failure occurs at the configured limit. Report and snapshot keys are unique. A crash becomes retryable after lease expiry. S3 uploads occur before DB publication; retries overwrite the same deterministic keys.

72-hour reports are available for 30 days **from publication** by default. API visibility uses `expires_at`, including late catch-up reports; daily and weekly history policy remains separate. S3 files are retained at least 35 days from publication and the worker deletes expired 72-hour artifacts in bounded batches. Snapshot retention stays under the existing `REPORTING_SNAPSHOT_RETENTION_DAYS` policy. Generated local artifacts are removed after successful remote publication; failed runs keep them for retry.

## Configuration

The worker's `apps/worker/.env.example` contains all `REPORTING_72H_*` defaults. Apply the SQL migration before setting `REPORTING_72H_ENABLED=true`. Keep this true on exactly the designated continuously running `warzone-worker`; leave it false on duplicate workers and one-shot processes. `REPORTING_SCHEDULE_ENABLED` must also be true. `REPORTING_72H_SCOPES=global` is the safe default. `scheduled` enables the existing configured global/region/country/AOI scope list; explicit comma-separated scope keys such as `global,region:middle-east` select those configured scopes. The lease renewal interval must be shorter than the lease duration; S3 retention must be at least publication retention. `REPORTING_PDF_EXPIRY_HOURS` is unrelated to this schedule.

## Production rollout order (manual, after review)

1. Back up the reporting schema and verify the base `operational_report_snapshots` and `operational_reports` tables and Phase 1 snapshot migration exist. In the Supabase SQL editor, apply `docs/04-development/supabase-reporting-72hour.sql` as the service administrator. It preserves rows and daily/weekly report types. Review the created job table, uniqueness indexes, RPC permissions and `report_type` constraint. Do not run any backfill.
2. Confirm only one designated server/PM2 worker will have scheduling enabled. Deploy the reviewed commit's worker, API, frontend bundle, and template together through the existing release procedure. Do not start the PM2 one-shot `reports` process. Preserve server secrets in the existing environment manager.
3. On the designated worker, set `REPORTING_72H_ENABLED=true` and set a stable `REPORTING_72H_CATCHUP_START_UTC` at the earliest completed window whose source rows are still retained. Review the anchor, scopes, retention, retry, and lease settings. Keep `REPORTING_CAPTURE_ENABLED=false` if image capture is not wanted; the 72-hour path is independent of it. Confirm existing S3 credentials/role and bucket via the normal secret manager.
4. Restart only the updated API, frontend and `warzone-worker` via the normal approved PM2 procedure; verify startup and catch-up logs. Confirm the worker's `cwd` and deployed commit match the reviewed release. Review PM2 persistence on Windows so the worker returns after reboot. Do not run `npm run reports:once`.
5. After one eligible window publishes, query `/stratops/reports?type=72hour&scope_type=global` and `/stratops/reports/latest?type=72hour&scope_type=global`. Confirm exact UTC start/end, HTML/PDF HTTP 200 with correct content types, the Report modal HTML preview/PDF download, the manifest and JSON keys, and no screenshot captures. Check the job row is `completed` with one attempt and the report row is `available` only after artifacts exist. Verify a second scheduler check creates no duplicate report. For a controlled retry test, use a nonproduction database and injected failure, never production backfill.

Read-only Supabase SQL after release (omit `download_token` and secrets from output):

```sql
select job_key, period_start, period_end, scope_key, status, attempt_count,
       lease_expires_at, next_retry_at, failed_stage, completed_at
from public.operational_72hour_jobs order by period_start desc limit 20;
select report_key, period_start, period_end, status, attempt_count,
       created_at, published_at, expires_at, pdf_storage_key
from public.operational_reports where report_type = '72hour'
order by period_start desc limit 20;
select report_key, count(*) from public.operational_reports
where report_type = '72hour' group by report_key having count(*) > 1;
```

## Read-only Windows server verification (run later on the server, not this workstation)

Run these in PowerShell from the deployed repository. They do not change production state or print secret values:

```powershell
git rev-parse HEAD
git status --short
pm2 list
pm2 describe warzone-worker
pm2 describe reports
Get-Content .\ecosystem.config.cjs
pm2 jlist | ConvertFrom-Json | ForEach-Object { [pscustomobject]@{ name=$_.name; pid=$_.pid; status=$_.pm2_env.status; cwd=$_.pm2_env.pm_cwd; script=$_.pm2_env.pm_exec_path; schedule=$_.pm2_env.env.REPORTING_SCHEDULE_ENABLED; hour72=$_.pm2_env.env.REPORTING_72H_ENABLED; capture=$_.pm2_env.env.REPORTING_CAPTURE_ENABLED; anchor=$_.pm2_env.env.REPORTING_72H_ANCHOR_UTC; catchup=$_.pm2_env.env.REPORTING_72H_CATCHUP_START_UTC } } | Format-Table -AutoSize
pm2 logs warzone-worker --lines 150 --nostream | Select-String -Pattern '\[reports:72hour\]|\[reports\]|Worker started'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd)(\.exe)?$' -and $_.CommandLine -match 'warzone-worker|apps[\\/]worker' } | Select-Object ProcessId,ParentProcessId,Name
Get-Service | Where-Object { $_.Name -match 'pm2' } | Select-Object Name,Status,StartType
Get-ScheduledTask | Where-Object { $_.TaskName -match 'pm2' } | Select-Object TaskName,State
```

Check whether the effective worker flags and commit match the expected release. The previous production error `Report has imagery targets but REPORTING_CAPTURE_ENABLED is false` indicates an old code or environment mismatch in the **daily** pipeline; enabling screenshot capture is not the 72-hour remedy. These commands intentionally avoid `pm2 env`, which would print credentials. PM2 service/task absence is a persistence warning to investigate through the existing server setup; do not create a new service during verification.

## Migration rollback

Set `REPORTING_72H_ENABLED=false` on the designated worker first, then roll back application code by the normal release process if needed. Leave the new job/report/snapshot rows intact for audit. The SQL RPCs can have execute revoked after the old worker is active; do not drop reporting tables or delete historical failed reports. The old daily/weekly report-type constraint can only be reinstated if no `72hour` report rows exist, so preserving rows takes precedence.
