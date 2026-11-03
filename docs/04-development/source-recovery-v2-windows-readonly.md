# V2 production evidence: Windows EC2 read-only collection

Run these steps **on the AWS Windows EC2 server**, in a normal Windows PowerShell window opened through Remote Desktop. Do not run them in Supabase or on Laptop B. These commands do not stop/restart PM2, edit files or reveal environment-variable values. Share only the filtered output described below. No production access is required for the local code audit.

## 1. Identify the worker without changing it

```powershell
pm2 status
```

Take a screenshot showing the **process names, status, CPU and memory**. Identify the row that corresponds to the worker at `C:\websites\warzone-worker\warzone\apps\worker`. Do not run `pm2 restart`, `pm2 reload`, `pm2 stop`, `pm2 jlist`, `pm2 describe`, or paste raw `pm2 logs` output. Multiple Node services may be listed; do not treat the API service as the worker.

## 2. Extract only health enums from the worker's recent PM2 logs

Your November 3 PM2 screenshot shows that the worker is named **`warzone-worker`**. The earlier `Read-Host` prompt received a blank name and rejected it. The earlier file-path lookup also assumed a fixed log filename; PM2 may suffix filenames with a process ID or use custom paths. Use PM2's read-only `logs` command below to find the right files. Its output is filtered in PowerShell before display, so do not run `pm2 logs` by itself or paste raw logs. This command reads recent logs and exits; it does not start a live stream or change a service. PM2 documents `--nostream` and `--lines` for this use.

```powershell
pm2 logs warzone-worker --lines 5000 --nostream --raw 2>&1 | ForEach-Object {
    $line = [string]$_
    if ($line -match '\[(aircraft|naval):([A-Za-z0-9_-]+)\]\s+(HEALTHY|DEGRADED|BACKOFF|UNAVAILABLE)\b') {
        [pscustomobject]@{ Kind = 'provider'; Domain = $Matches[1]; Id = $Matches[2]; State = $Matches[3] }
    } elseif ($line -match '\[conflict\] source health:\s*(\{[^\r\n]*\})') {
        try {
            $c = $Matches[1] | ConvertFrom-Json
            [pscustomobject]@{ Kind = 'conflict_counts'; Healthy = [int]$c.healthy; Stale = [int]$c.stale; Failing = [int]$c.failing; RateLimited = [int]$c.rate_limited; Disabled = [int]$c.disabled }
        } catch { }
    } elseif ($line -match '\[sources\] Synced (\d+) configured sources into source_registry') {
        [pscustomobject]@{ Kind = 'registry_sync'; Result = 'success'; Count = [int]$Matches[1] }
    } elseif ($line -match 'Source registry sync error:') {
        [pscustomobject]@{ Kind = 'registry_sync'; Result = 'error'; Count = $null }
    }
} | Select-Object -Last 100
```

Only the filtered table is suitable to share. A provider `HEALTHY` transition or aggregate `healthy` count still does not prove a fresh record reached StratOps. If the command produces no rows, tell me only that; do not paste raw logs. The command is based on [PM2's documented log options](https://pm2.keymetrics.io/docs/usage/log-management/).

The production registry export contains 16 source names absent from the checked-in Laptop B registry and lacks 16 newer local names. To check the worker file actually deployed on EC2, run this separate **read-only** block in PowerShell. It prints only a count and two name-presence flags, not URLs or keys:

```powershell
$sourceFile = 'C:\websites\warzone-worker\warzone\apps\worker\src\sources.json'
if (Test-Path -LiteralPath $sourceFile) {
    $names = @((Get-Content -LiteralPath $sourceFile -Raw | ConvertFrom-Json).feeds | Where-Object { $_.name } | ForEach-Object { $_.name })
    [pscustomobject]@{ FeedCount = $names.Count; HasReutersWorldNews = ('Reuters World News' -in $names); HasReuters = ('Reuters' -in $names) }
} else { 'Worker sources.json not found at the stated path' }
```

Share only that small result. Do not paste `sources.json` itself.

## 3. Read-only database evidence

Open the **production Warzone Supabase dashboard → SQL Editor** in a browser. Run each `SELECT` separately. Export each result to CSV. These queries read only metadata and per-source counts/timestamps; they do not return records, credentials or connection strings. If a table is absent or a column differs, report the error text without changing the query or schema.

```sql
SELECT source_name, source_type, enabled
FROM public.source_registry
ORDER BY source_name;
```

```sql
SELECT source_name, count(*) AS stored_rows,
       max(fetched_at) AS last_fetched_at,
       max(published_at) AS latest_publication_at
FROM public.conflict_feed_items
GROUP BY source_name
ORDER BY source_name;
```

```sql
SELECT source_name, count(*) AS stored_rows,
       max(fetched_at) AS last_fetched_at,
       max(published_at) AS latest_publication_at
FROM public.status_feed_items
GROUP BY source_name
ORDER BY source_name;
```

```sql
SELECT track_type, count(*) AS stored_rows, max(updated_at) AS latest_update_at
FROM public.tracks
GROUP BY track_type
ORDER BY track_type;
```

The SQL Editor can show an estimated execution plan before a query if the tables are very large; do not run `EXPLAIN ANALYZE` on production. The four results do **not** identify every one of the 286 source references: `source_registry` syncs the legacy JSON feeds, while specialized providers and some frontend/internal integrations use separate paths.

## What to share and what remains unknown

The four SQL CSV exports and `pm2 status` screenshot were received on November 3. Send only the **filtered** PowerShell table and small deployed-file check from step 2. Never send `.env` files, API keys, database passwords, service-role keys, connection strings, raw PM2 logs, or full table rows. These artifacts allow a safe first production reconciliation of enabled flags, provider transitions and persisted ingestion timestamps. `max(fetched_at)` above is the timestamp of the most recently **stored row**, not necessarily the last successful provider request. Per-source request counts, latest errors, downstream API/UI delivery and Supabase/AWS billing still require additional approved telemetry; the current worker does not persist that complete chain. No source may be promoted to WORKING solely from these outputs.
