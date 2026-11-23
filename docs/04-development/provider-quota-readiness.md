# StratOps quota deployment readiness

Assessment date: **2026-11-21**. **The configured Supabase database passes the quota checks. The EC2 rollout is not yet unconditionally cleared**, because the live server's code, supervisor environment and operational flows have not been inspected. The repository supervisor configuration has no explicit production environment block, so the live `NODE_ENV` setting must be confirmed rather than assumed.

## Checks completed

| Check | Observed result |
|---|---|
| Configured worker service-role connection | `stratops_quota_read` succeeded against an isolated hashed readiness key. |
| Compare-and-swap function | `stratops_quota_cas` accepted the matching version; a second write using the old version returned false and did not overwrite the marker. |
| API/worker database configuration | The inspected production-file resolution yields the same Supabase database, same service-role credential, Supabase store and matching policies/account fingerprints. Credentials were compared in memory and not printed. |
| Competing reservations | Twelve contenders through the API/worker connections accepted five two-credit reservations, held seven and persisted exactly ten spent credits. |
| Independent process/restart | A second Node invocation read the same database record and refused another reservation; spent credits remained ten. |
| Shared outgoing-request guards | Real quota wrappers backed by Supabase, with fake provider transports, dispatched exactly five requests and held seven. No actual provider was contacted. |
| Shared response cache | Six API/worker readers sharing Supabase produced one fake upstream download. |
| Production configuration selection | Resolved worker/API `NODE_ENV` values were both `production`; both selected the Supabase store. These are configuration checks from this checkout, not observations of EC2 processes. |
| Operator status command | `provider-quota-status.mjs` ran with `NODE_ENV=production`, exited zero, reported 13 provider/endpoint entries and produced no stderr output. |
| Local regressions | 164 passed, zero failed, one EPERM-restricted subprocess test skipped, 165 total. Real database persistence was separately verified with independent processes. |
| Build | The implementation's isolated production build passed earlier on 2026-11-21. No application source changed during this readiness pass, so it was not rebuilt again. |
| Anonymous-role permission test | Not completed: no distinct configured anonymous/publishable key was available. SQL grants were inspected; service-role success does not itself prove denial for every other role. |

The user applied the migration. This pass did not deploy, reapply SQL, reset real quota counters, contact upstream intelligence/tracking providers, modify provider flags, commit or push. It created and retained isolated readiness rows and ran the requested diagnostic, which can initialize missing internal ledger records. Test records do not share real provider account identifiers.

The safe result files are `.generated/quota-readiness/report.json`, `extra-report.json`, `provider-status.ndjson` and `regressions.log`. Raw credential/environment dumps are not part of these artifacts.

Complete the one read-only role query in step 3 below; no additional credentials are needed.

## FREE plan policy results and UNKNOWN values

All inspected policies declare FREE plans, matching the user's confirmation and the supplied research. There is no policy JSON override selecting a paid plan. The account label is user-confirmed; provider account portals were not contacted.

| Provider | Effective protection observed in the status output | Remaining uncertainty |
|---|---|---|
| NOTAC | 10,000 credits/calendar month; 20% reserve gives 8,000 internal usable credits; independent 96-attempt/day cap; weighted pages and within-day spreading | Actual remaining credits UNKNOWN until response headers arrive. Calendar reset is documented as the first UTC day; zero ledger usage does not establish zero provider usage. |
| SkyLink | 1,000-call trailing 30-day allowance; 20% reserve; initial per-budget capacity 26 calls, approximately 26.67/day before prior usage and other restrictions | Actual balance/reset UNKNOWN. Known legacy counters are imported before the first guarded request. Legacy RapidAPI credential was absent from the inspected configuration and was therefore omitted by the status CLI. |
| VesselAPI | 150-call trailing allowance; 20% reserve gives an internal ceiling of 120; approximately four/day before prior usage and the existing five-hour floor | Actual balance/reset UNKNOWN. Verified absolute reset and remaining headers can establish an observed cycle. |
| ADSB.lol | Built-in anonymous tier 500/day, 10% reserve, shared 450/day usable cap across ingestion/search | Actual current IP balance UNKNOWN. Default anonymous account grouping is consistent between the inspected API and worker. |
| OpenSky | Configured authenticated free policy: 4,000 credits/day, 10% reserve, four credits/global states attempt; existing 15-minute polling floor retained | Current balance and feeder privileges UNKNOWN; no feeder upgrade is assumed. |
| REST Countries | Local country reference handles routine lookups without remote calls; enabled unresolved fallback has conservative shared accounting | Remote balance/reset UNKNOWN. |
| Copernicus | 120 catalog attempts/day, **three preview attempts/day** in the production file, 20 requests/minute | Monthly processing-unit/account entitlements and a verified maximum PU request weight remain unverified. Request caps are enforced; complete PU-budget protection cannot be claimed without the weight/entitlement evidence. |
| Airplanes.live | Existing internal 480/day cap, plus the provider's configured request floor | External account allowance UNKNOWN; 480 is not asserted to be the provider's free entitlement. |
| Cloudflare Radar | Shared 1,200-request rolling five-minute API ceiling, existing source caching | Account monthly Radar allowance and consumption by unrelated applications UNKNOWN. |
| CelesTrak, GNSS, OTX | Existing freshness/cache/backoff controls; no fabricated monthly allowance | Numeric monthly/account quotas UNKNOWN. CelesTrak two-hour refresh policy remains enforced. |

All 13 inspected diagnostic entries had zero recorded attempts and `observedRemaining: null`. This means the shared ledger has no provider-response evidence for those accounts; it does **not** mean every account has a full free allowance. `internalHeadroom` is a configured safety bound, not an observed provider balance. Diagnostic per-budget availability/forecast fields are subject to all companion rate, cache, pacing and backoff checks; short-window values are not measured account-wide requests/day.

Weighted FIRMS transaction costs and Copernicus PU/openEO limits remain as documented in the [quota rollout reference](provider-quota-protection.md). Unknown figures do not disable existing services, and no new provider entitlement is inferred.

## Final EC2 procedure and access limitation

**Direct EC2 inspection is blocked in this session.** SSH resolves to a disabled sandbox wrapper; the AWS CLI fails through the configured `http://127.0.0.1:9` proxy; no PowerShell remoting session exists. No proxy, credential, service or production setting was changed to bypass that restriction. The local `ecosystem.config.cjs` describes Windows PM2, not proof of the live server's configuration.

Use this procedure as the single remaining host check and deployment runbook. The earlier `stratops-quota-backend.zip` and its instructions are superseded by **`stratops-quota-backend-final.zip`**. No live EC2 result has been fabricated.

### 1. Stage the final package without deploying it

Upload the final ZIP through the existing approved Windows transfer method. Extract it into a protected staging directory outside the web root, for example `C:\StratOpsQuotaRelease`. Extraction there does not replace application files or restart anything.

Verify the archive SHA-256 against the checksum supplied with this release, then verify every `backend-manifest.json` entry. The package contains 23 runtime overlay files, the read-only host inspector, dependency requirements and the read-only role query. It contains no frontend assets, environment files, credentials, quota counters, `node_modules` or migration execution. All 27 packaged files plus the manifest passed archive/hash verification and the configured-secret scan; the 23 runtime files are byte-identical to the previously reviewed implementation.

```powershell
$quotaArchive = 'C:\StratOpsTransfer\stratops-quota-backend-final.zip' # actual approved upload location
$quotaStage = 'C:\StratOpsQuotaRelease' # new or empty protected staging directory
if ((Get-FileHash -LiteralPath $quotaArchive -Algorithm SHA256).Hash -ne 'C0C2B64F7B37A731A7A9E3F4543C32601E28D9258186FECA0794083DC2C9074E') { throw 'Release checksum mismatch.' }
if ((Test-Path -LiteralPath $quotaStage) -and @(Get-ChildItem -LiteralPath $quotaStage -Force).Count -gt 0) { throw 'Choose a new empty stage; do not delete existing artifacts.' }
Expand-Archive -LiteralPath $quotaArchive -DestinationPath $quotaStage
```

This is deliberately an **overlay**, not a standalone installation. Its existing dependencies are recorded in `dependency-requirements.json`: **114 required existing files and 40 NPM resolutions**. The package does not silently overwrite those prerequisites or install/upgrade libraries. One NPM resolution is optional `socket.io-client`; it is needed only for existing approved SkySpy aircraft Socket.IO streaming. Existing environment-configured licensed paths, browser/report resources and dynamic assets must remain intact.

Some backend reporting code imports an existing pure model and its module metadata under `dev/assets/js`. Those files are checked as prerequisites only; they are not included in the overlay or modified by this release. Do not copy frontend files merely to satisfy a hash check.

### 2. Run one host preflight under the existing PM2 owner

Open PowerShell as the account that owns the current PM2 daemon. Do not start a new PM2 daemon, change `PM2_HOME`, expose `pm2 env`/raw `pm2 jlist`, or paste environment files. Use the actual repository root from the server; the checked-in expected root is shown below, not assumed:

```powershell
& (Join-Path $quotaStage '.generated\quota-readiness\Inspect-WindowsQuotaHost.ps1') `
  -RepositoryRoot 'C:\websites\warzone-worker\warzone' `
  -CheckQuotaDatabase
```

If the existing process names differ, pass `-ApiProcessName 'ACTUAL-API-NAME' -WorkerProcessName 'ACTUAL-WORKER-NAME'`; do not rename services. Reuse those exact names below. The root must be the actual installation whose `apps/api` and `apps/worker` directories the processes use.

The inspector verifies an existing PM2 daemon before calling its metadata command. It reads the two backend process trees, exact recognized startup form, working directories, effective environment-file selection, current ports/listeners, actual Node executables/versions, source hashes, installed dependencies and reboot-service/task evidence. Raw inherited environment values pass only through local process stdin and are neither logged nor saved.

The optional database switch makes a small service-role read/CAS check using all unique effective backend connections. It creates one isolated readiness row, not a real provider counter. It makes no upstream provider requests. Omit the switch for a strictly non-writing database-free inspection.

The redacted result is saved beside the inspector as `ec2-preflight.json`. It verifies:

- Both actual startup selectors and loaded values select `NODE_ENV=production`, and effective quota storage is Supabase.
- Every API/worker instance targets the same project whose migration was checked. Quota policies and anonymous egress grouping agree.
- The proposed change of **only** `NODE_ENV` and `PROVIDER_QUOTA_STORE` would not alter other variables, API keys or ports. The worker's overriding loader and API's non-overriding loader are modeled separately.
- Existing source/data prerequisites match and installed packages satisfy their existing runtime contracts. A missing/different prerequisite is a stop-and-review result, never permission to overwrite it or run an upgrade.
- The actual child Node executables are supported and the configured listener belongs to the supervised process tree.

The collector also fingerprints the actual supervisor file. It does not execute supervisor JavaScript or guess additional `env_production` fields. Privately inspect that file's selected profile: preserve all existing command, directory, port and environment fields. The proposed-environment comparison applies only to the two specified flags; any other existing/planned profile changes require private review.

A `HOLD` caused solely by missing production/Supabase startup selection identifies a required planned correction, not permission to restart early. It may be addressed in the single controlled rollout only after confirming the planned values, zero protected-variable changes, matching database, dependencies, role permissions and a compatible rollback target. Any other blocker must be resolved before deployment. Do not alter keys, registries, source data or dependency versions to force the checker green.

### 3. Finish role verification with one read-only SQL query

No matching anonymous/publishable key or direct Supabase database connection was found in the available production/local configurations. Therefore anonymous-role verification remains **uncompleted here**, rather than being inferred from service-role success.

Run [verify-provider-quota-roles.sql](verify-provider-quota-roles.sql) once in the existing Supabase SQL editor for the same quota project. It only reads privilege metadata. Expected output:

| Role | Both RPC EXECUTE columns and all four table privilege columns |
|---|---|
| `anon` | All false |
| `authenticated` | All false |
| `service_role` | All true |

No API key is needed in the query or in chat. Any unexpected grant means **do not deploy** until the permission problem is reviewed. Do not rerun/reset the migration or remove quota rows as a workaround.

### 4. Prepare a reversible backend-only update

Before stopping services, confirm the host preflight, role results, release prerequisites and rollback compatibility. Select a protected backup directory outside the web root with access restricted to the existing operator/service accounts. Back up the existing supervisor configuration and every existing **runtime overlay** target. Keep the PM2/environment/key configuration intact; no `.env` replacement is included.

Before editing the existing supervisor profile, create the unique backup under an already-restricted parent:

```powershell
$quotaRoot = 'C:\websites\warzone-worker\warzone' # actual root from the preflight
# Reuse the exact staging directory selected in step 1.
$quotaBackupParent = 'C:\ProgramData\StratOps\QuotaBackups' # operator-created with restricted access
if (-not (Test-Path -LiteralPath $quotaBackupParent)) { throw 'Prepare the restricted backup parent first.' }
$quotaBackup = Join-Path $quotaBackupParent ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $quotaBackup -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath (Join-Path $quotaRoot 'ecosystem.config.cjs') -Destination (Join-Path $quotaBackup 'ecosystem.config.cjs') -ErrorAction Stop
```

Use the supervisor's existing two entries. If startup selection needs correction, add or retain these values in their reviewed production profile without changing other fields:

```javascript
env_production: {
  NODE_ENV: 'production',
  PROVIDER_QUOTA_STORE: 'supabase'
}
```

Do not replace the entire ecosystem file with this snippet. Preserve existing private profile variables. If production file selection would change other effective keys, flags or ports, reconcile that privately before rollout; do not apply it blindly. PM2's [environment selection](https://pm2.keymetrics.io/docs/usage/environment/) and [named-process selection](https://pm2.keymetrics.io/docs/usage/application-declaration/) document these switches.

### 5. Apply once during the approved update window

These are manual operator commands; none was executed by this task. Set variables from the verified host result, not an assumed installation:

```powershell
# Reuse the verified root, stage and unique backup from step 4.
$quotaManifest = Get-Content -LiteralPath (Join-Path $quotaStage '.generated\quota-readiness\backend-manifest.json') -Raw | ConvertFrom-Json
$quotaRuntimeFiles = @($quotaManifest.files | Where-Object { $_.path.StartsWith('apps/') })
if ($quotaRuntimeFiles.Count -ne 23) { throw 'Unexpected runtime overlay; stop for review.' }
foreach ($quotaFile in $quotaManifest.files) {
    if ((Get-FileHash -LiteralPath (Join-Path $quotaStage $quotaFile.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $quotaFile.sha256) {
        throw ('Release hash mismatch: ' + $quotaFile.path)
    }
}
# Confirm listener inspection works before stopping anything.
$quotaCurrentListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
$quotaBefore = Get-Content -LiteralPath (Join-Path $quotaStage '.generated\quota-readiness\ec2-preflight.json') -Raw | ConvertFrom-Json
$quotaApiName = ($quotaBefore.processes | Where-Object { $_.name -eq 'warzone-api' } | Select-Object -First 1).processName
$quotaWorkerName = ($quotaBefore.processes | Where-Object { $_.name -eq 'warzone-worker' } | Select-Object -First 1).processName
if ($quotaApiName -notmatch '^[A-Za-z0-9_.-]+$' -or $quotaWorkerName -notmatch '^[A-Za-z0-9_.-]+$' -or $quotaApiName -eq $quotaWorkerName) { throw 'Verify the two existing process names privately.' }
$quotaOriginalPorts = @($quotaBefore.processes | ForEach-Object { [int]$_.port } | Sort-Object -Unique)
Set-Location -LiteralPath $quotaRoot
pm2 stop $quotaWorkerName
if ($LASTEXITCODE -ne 0) { throw 'Worker stop failed; do not overlay source.' }
pm2 stop $quotaApiName
if ($LASTEXITCODE -ne 0) { throw 'API stop failed; do not overlay source.' }
$quotaRemainingListeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in $quotaOriginalPorts })
if ($quotaRemainingListeners.Count -gt 0) { throw 'An original backend listener is still bound; do not copy source or kill other services.' }
```

Verify that the two original process trees/listeners have stopped; if child processes or their original ports remain occupied, do not copy source or kill unrelated services. Preserve the frontend, reporting task and unrelated services. Once stopped, back up and copy only the reviewed runtime targets:

```powershell
foreach ($quotaFile in $quotaRuntimeFiles) {
    $quotaTarget = [IO.Path]::GetFullPath((Join-Path $quotaRoot $quotaFile.path))
    if (-not $quotaTarget.StartsWith($quotaRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid target path.' }
    $quotaSaved = Join-Path $quotaBackup $quotaFile.path
    if (Test-Path -LiteralPath $quotaTarget) {
        New-Item -ItemType Directory -Path (Split-Path $quotaSaved -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $quotaTarget -Destination $quotaSaved -ErrorAction Stop
    }
    New-Item -ItemType Directory -Path (Split-Path $quotaTarget -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $quotaStage $quotaFile.path) -Destination $quotaTarget -Force -ErrorAction Stop
}
pm2 restart ecosystem.config.cjs --only $quotaApiName --env production
if ($LASTEXITCODE -ne 0) { throw 'API start failed; use the reviewed rollback.' }
pm2 restart ecosystem.config.cjs --only $quotaWorkerName --env production
if ($LASTEXITCODE -ne 0) { throw 'Worker start failed; use the reviewed rollback.' }
```

No dependency installation, frontend publication, S3 upload, CloudFront invalidation, EC2 reboot, unrelated service restart or quota migration/reset is part of this update. Do not use a broad worktree archive or `git pull` alone: the reviewed quota fixes include uncommitted source.

### 6. Verify and persist the one rollout

Run the same staged inspector again as **post-deployment verification**, not another source audit. All 23 overlay entries must now report `already matches release`, both backends must be online on their original ports, actual startup/file selection must be production/Supabase, and the database check must pass. Any deliberate supervisor-profile edit needs the private review already described; the collector does not execute arbitrary ecosystem JavaScript.

Run the existing status command with production selection in the inspection shell:

```powershell
$quotaPreviousNodeEnv = $env:NODE_ENV
try {
  $env:NODE_ENV = 'production'
  node apps/worker/scripts/provider-quota-status.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Quota diagnostics failed.' }
} finally { $env:NODE_ENV = $quotaPreviousNodeEnv }
```

This shell diagnostic is supplemental; the inspector validates the supervisor startup environment. Check the API's `/health` on its **verified original port**. Through ordinary use, verify sign-in, entry, military air/naval tracking, NOTAMs, dated GNSS and satellites without quota-consuming force refreshes. Preserve observation timestamps; UNKNOWN balances remain UNKNOWN. After successful checks, `pm2 save` persists the process list. Verify the already-existing Windows service/task that restores that same PM2 owner after reboot; do not create a second startup service.

### 7. Rollback without resetting quotas

Preselect a backup/release that understands the current trailing-quota ledger before authorizing rollout. On failure, stop only the two replacement backends, restore the backed-up compatible runtime files and original supervisor configuration, then restart only those entries using their preserved startup settings. Recheck original ports, database access and health before saving the process list.

**An older unguarded/fixed-window release is not automatically a safe rollback.** Retaining the table does not make old clients respect it. If the backup cannot interpret the new ledger, stop and use a reviewed compatible roll-forward or counter-preserving migration; do not erase counters or claim that an incompatible rollback is safe. Retain all original environment files, identity caches, quota rows and keys throughout.

## Final decision

The already-completed Supabase checks passed. This pass did not repeat that broad audit or consume upstream provider requests. The final package's code/manifest hashes and configured-secret scan passed; all literal dependency references resolve locally, with the optional SkySpy transport explicitly identified. Eight synthetic inspector cases passed: healthy configuration, wrong environment selection, local-file storage, split databases, missing listeners, unsupported Node, preserved custom process names and a wrong database in one clustered instance. A local run correctly returned HOLD because no live PM2 owner was available. JavaScript and PowerShell syntax checks passed. No application runtime functions changed, so no additional application build was necessary during this pass.

**Unconditional production readiness is not established:** direct EC2 access is blocked, live host/dependency/profile results are unavailable, anonymous/authenticated privilege results are awaiting the one SQL query, and deployed operational flows/rollback compatibility are unverified. Run the single host preflight and role query once, resolve only their concrete findings, then perform one controlled backend update and normal post-update verification. No source audit, frontend change or automatic production action is needed.
