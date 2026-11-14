# Backed-up Cache-Control repair for warzone.battlespacex.com

Prepared November 13, 2026, Toronto. Operator confirms production bucket **warzone.battlespacex.com has versioning disabled**. No AWS inspection, backup, mutation, invalidation or deployment has been executed here. This is an executable procedure prepared for review. It does not enable versioning or change any bucket/CloudFront configuration.

## Scope and supported state

`scripts/repair-cesium-cache-control.cjs --unversioned` is pinned to this bucket and saved release `1.143.0-a5a84813c72de745-standard`. It checks the actual distribution/alias, winning direct S3 origin, Managed-CachingOptimized policy and absence of Cache-Control overrides or edge functions. It accepts an absent bucket versioning Status (never enabled), or Suspended with null/unversioned current objects. It never calls PutBucketVersioning or any configuration-writing API.

Permission preservation remains fail-closed: **BucketOwnerEnforced must already be active**, so ACLs do not affect access and no ACL is assigned by the tool. Bucket policy, OAC and ownership controls remain untouched. Verify in S3 → bucket → Permissions → Object Ownership. If the bucket uses ACLs, stop for an ACL-preserving extension; do not disable ACLs to bypass the refusal. AES256/SSE-S3 and STANDARD storage must already apply. KMS/SSE-C, replication, Object Lock, encoded origin objects, missing user metadata and other unsupported settings are refused rather than replaced. Verify Properties → Default encryption, Versioning, Object Lock and individual object metadata; no changes should be saved during review.

This retains the earlier tool's safety boundaries. It does not claim compatibility with uninspected permissions/encryption. Content types, custom metadata, Content-Disposition, Content-Language, Expires, redirect metadata and tags are preserved individually. Last-Modified necessarily changes when S3 performs the copy, and an ETag may change; original values are recorded and body SHA-256 is verified. No application, workers, GLBs, density, geometry, trackers, satellites or camera code changes.

## Read-only dry run and mandatory local backups

Planning performs AWS reads only. It downloads each release object directly from S3 using an ETag condition and compares its bytes/size to the saved local manifest. For every object whose Cache-Control needs repair it writes:

- `<SHA256-of-object-key>.bin`: original object bytes, with exclusive creation and fsync;
- the adjacent `.bin.json`: original key, ETag, full HEAD response (including encryption and Last-Modified), preserved metadata, original Cache-Control, tags, size and body SHA-256;
- `original-plan.json`: complete original inventory, target identity, manifest hash and backup location. An additional reviewed plan is saved at `--plan`.

Backup filenames are derived from full keys, avoiding basename collisions or path traversal. Existing backup directories, backup files, plan files and execution journals are not overwritten. Planning checks HEAD before/after the conditional download and tags before/after to detect concurrent changes. A failed/incomplete plan cannot execute. Backup files are local operator artifacts, not new S3 objects, so no AWS writes or additional storage service is needed for planning.

Before execution the tool re-reads the release, requires exact equality with the approved plan, and verifies **every affected object's original backup body and JSON snapshot, plus the backup plan, before changing the first object**. Keep the backup directory private and outside build output. Copy it and the reviewed plan to a second trusted durable local location before approving execution; do not store the only copy on a temporary build agent or in a directory a build cleans.

From repository root, set your verified bucket-owner account ID and approved AWS CLI profile. All other production identifiers are explicit:

```powershell
aws configure list-profiles
$cesiumRepairOwner = Read-Host '12-digit AWS account ID that owns warzone.battlespacex.com'
$cesiumRepairProfile = Read-Host 'Existing AWS CLI profile name from the list above'
New-Item -ItemType Directory -Force .generated/cesium-unversioned-repair | Out-Null
$cesiumRepairAttempt = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$repairArgs = @(
    '--unversioned',
    '--build-dir', 'production',
    '--bucket', 'warzone.battlespacex.com',
    '--owner', $cesiumRepairOwner,
    '--profile', $cesiumRepairProfile,
    '--distribution', 'E2EFV9935XX3MV',
    '--origin', 'https://stratops.battlespacex.com',
    '--plan', ".generated/cesium-unversioned-repair/reviewed-plan-$cesiumRepairAttempt.json",
    '--backup-dir', ".generated/cesium-unversioned-repair/original-backup-$cesiumRepairAttempt"
)
node scripts/repair-cesium-cache-control.cjs @repairArgs --dry-run
```

**Do not pre-create the timestamped backup directory; the tool exclusively creates it.** The owner is the bucket-owning account's 12-digit ID shown in the AWS Console account menu, not a placeholder or distribution ID. The profile is an actual configured CLI profile. Use the exact saved production artifact directory; the tool verifies all 392 manifest assets and refuses deployed-byte differences. A stale/mismatching artifact is not repaired by inventing a new manifest. Run from the same repository/path for planning and execution, since the backup location is absolute in the plan.

If an earlier run reported `Explicit bucket, 12-digit owner, distribution and profile required`, the example owner/profile values were not replaced. Earlier tool revisions created an empty backup directory before this validation; the corrected tool validates target inputs and inspects the remote target first, then creates the directory. Keep any old directory/plan intact and use a fresh timestamped attempt. An `already exists` error is not a reason to delete backups or run `--execute`. Only run the dry run until a complete verified plan exists and has been reviewed.

### Successful blank versioning output and JSON diagnostics

The earlier AWS adapter unconditionally called `JSON.parse(result.stdout)`. AWS CLI's JSON formatter suppresses `{}`, so a successful `s3api get-bucket-versioning` for a never-versioned bucket can have **empty stdout and exit 0**, reproducing `Unexpected end of JSON input`. This is not a malformed local Cesium manifest. The corrected adapter permits that empty response **only for successful get-bucket-versioning**, interpreting it as `{}`. Nonzero exits, permission failures and error objects still fail; missing/empty JSON from every other operation is rejected. Object Lock absence is accepted only for its specific documented not-configured error, never AccessDenied.

CLI failures now identify `aws SERVICE OPERATION` and safe resource identifiers without printing profile credentials, input metadata, raw stdout/stderr or malformed response snippets. Local JSON failures identify the exact file path. This behavior is tested through the real adapter with an injected process runner, not only through high-level AWS mocks. A live run's exact failing operation is identifiable in these new errors; this environment's live inspection attempts failed at its configured proxy before any AWS response.

### Narrow IAM planning requirements

The reported profile is **stratops-repair**, authenticating as **stratops-cesium-repair**. The operator supplied the attached read-only policy JSON. **Static inspection confirms it covers all eight IAM actions used by unversioned planning**: the three bucket reads below are allowed on the correct bucket ARN, both object reads are allowed on `assets/cesium/releases/*` (including the current release), and all three CloudFront reads are allowed with Resource `*`. No additional permissions or policy edits are needed for planning. The policy also contains other read actions not used by this planner; they are not modified by this task.

This verifies the supplied policy document, not effective live authorization. The operator confirmed successful STS authentication/GetDistribution; this environment's further read-only attempts were proxy-blocked. A permissions boundary, SCP, session policy, explicit deny or bucket policy could still limit access. The corrected tool reports such failures without treating them as absent configuration. The supplied policy has no S3 writes and cannot authorize execution/copy/invalidation; keep it read-only for this task. Do not request IAM policy-list permissions or broad managed access merely to run the planner.

| Planner operation | Exact IAM action | Required resource scope |
| --- | --- | --- |
| CloudFront get-distribution | `cloudfront:GetDistribution` | Selected distribution E2EFV9935XX3MV in the owning account |
| Get managed cache policy | `cloudfront:GetCachePolicy` | Managed policy ID 658327ea-f89d-4fab-a63d-7e88639e58f6, using the applicable cache-policy resource; a distribution-only resource does not cover policy reads |
| Get response-header policy, only if one is attached | `cloudfront:GetResponseHeadersPolicy` | Only the policy IDs referenced by the winning behaviors |
| Bucket ownership controls | `s3:GetBucketOwnershipControls` | `arn:aws:s3:::warzone.battlespacex.com` |
| Bucket versioning | `s3:GetBucketVersioning` | Same bucket ARN |
| Object Lock configuration | `s3:GetBucketObjectLockConfiguration` | Same bucket ARN; CLI operation name is get-object-lock-configuration |
| Object HEAD and GET | `s3:GetObject` | `arn:aws:s3:::warzone.battlespacex.com/assets/cesium/releases/1.143.0-a5a84813c72de745-standard/*` |
| Read current object tags | `s3:GetObjectTagging` | Same object-prefix ARN |

Unversioned planning does not list S3 objects (keys come from the verified manifest), so it does not require ListBucket, GetObjectVersion, IAM policy-list permissions, KMS permissions or any write action. Lack of ListBucket can make a missing object appear as a 403; that still fails safely. No GetBucketPolicy/PutObject/CreateInvalidation permission is needed to plan. Policy inspection can be done by an existing authorized administrator in IAM → Users → stratops-cesium-repair → Permissions → attached/inline policies and permissions boundary, without expanding this user's policy. The tool never alters IAM.

For an isolated read-only diagnostic from your working terminal, an empty response to the following with `$LASTEXITCODE -eq 0` is valid and now handled:

```powershell
aws --profile stratops-repair --no-cli-pager s3api get-bucket-versioning `
    --bucket warzone.battlespacex.com --expected-bucket-owner $cesiumRepairOwner --output json
$LASTEXITCODE
```

References: [AWS CLI JSON formatter](https://github.com/aws/aws-cli/blob/develop/awscli/formatter.py), [S3 API-to-IAM action mapping](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html), [CloudFront action/resource mapping](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html).

### GetObject exit 252: streaming CLI argument fix

Follow-up November 14, 2026, Toronto: the operator confirmed successful manual HEAD/GET using stratops-repair, with Cache-Control absent directly in S3. The remaining script failure on `Assets/approximateTerrainHeights.json` was independently reproduced as CLI argument validation: `the following arguments are required: --bucket, --key` (exit 252). AWS CLI's streaming `s3api get-object` command does not support the generic `--cli-input-json` approach used by the adapter. Moving the same JSON into a file does not fix it. Exit 252 is an argument/parameter failure, not evidence of a CloudFront or S3 transport rejection.

The corrected adapter uses explicit `--bucket`, `--key`, `--expected-bucket-owner`, optional `--if-match` and optional `--version-id` for GetObject. It appends `--output json`, then the absolute local destination filename as **one final argv element**. There are no manually added quote characters around the filename; Node's `spawnSync(..., {shell:false})` passes it as an argument, including Windows backslashes/spaces. Other supported non-streaming commands retain their JSON input. No conditions, metadata validation, backup requirements or body/hash checks are removed. No extra S3 requests are introduced.

The installed AWS CLI 2.40.3 rejected the old JSON call with exit 252. Explicit flags passed parsing and reached the deliberately configured loopback endpoint (connection failure/exit 255, not an AWS call). A cross-process loopback transfer could not complete here, and Node child-process launch is restricted (`EPERM`); neither a real Node-to-AWS transfer nor a production dry run is claimed. Mocked adapter/file tests verify binary round-trip handling, quoted ETag/version preservation, output filenames with spaces and temporary cleanup.

Error reporting now distinguishes exit 252/2 (CLI argument validation), exit 253 (configuration/credentials), service errors and transport/startup failures. Known missing/unknown flag names and the destination path are shown, while raw stderr, JSON input, credential values and parameter values remain omitted. For example, a rejected old-style call reports `CLI argument validation failed; missing required --bucket, --key`, rather than generic transport failure. Retain old partial backup directories; retry with fresh timestamped paths as above and profile stratops-repair. Run only the dry run until its complete plan/backups have been reviewed.

References: [GetObject CLI synopsis and outfile argument](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html), [AWS CLI exit codes](https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-returncodes.html).

AWS CLI v2 must support CopyObject destination IfMatch. Read-only permissions include distribution/policy, bucket ownership/versioning/lock configuration, HEAD/GET and object tag reads. A planning identity need not have write permission. Planning incurs ordinary metered GET/HEAD/tag/configuration reads and downloads the release; it is sequential, not a load test. If direct S3 headers are already correct, there are no repair copies; investigate stale/modified CDN headers instead.

Review the plan and backup hashes before authorizing any write. The manifest 404 and CloudFront LimitExceeded remain separate investigations.

## Execution command: requires separate approval

First stop every uploader/operator/automation from writing this exact immutable release prefix for the whole operation. This is an operator maintenance freeze, **not** a bucket-policy or configuration change. Make the durable backup copy and review the target/affected keys and proposed Cache-Control before giving approval.

Only after that approval, in the same PowerShell session with the reviewed `$repairArgs`:

```powershell
node scripts/repair-cesium-cache-control.cjs @repairArgs --execute --confirm-release-frozen
```

The tool's AWS mutation allowlist permits only CopyObject after `--execute`. It copies each affected key to itself, changing Cache-Control to `public, max-age=31536000, immutable`, explicitly preserving original properties, tags, AES256 encryption and STANDARD storage. It does not re-upload local worker files or delete objects. It does not change already-correct objects. No versioning, policy, ACL, HTML, manifest or CDN changes are made.

Before each copy it rechecks HEAD and tags against the approved original snapshot. Source `CopySourceIfMatch` and destination `IfMatch` guard ETags. GET checks also use IfMatch. **These conditions do not provide an atomic metadata/Last-Modified/tag compare-and-swap.** Same-ETag metadata changes and changes inside the remaining race window require the maintenance freeze; no client script can promise race-free safety without it. Unversioned overwrites cannot be recovered from S3 version history.

Automatic AWS CLI retries are disabled for this tool. Each object gets a write-ahead **intent** record, a response record, and then a **verified** record after read-back SHA-256/size/metadata/tag checks. The journal is `<plan>.execution.jsonl`, fsynced at each record. A failure stops before the next object. No multi-object transaction or automatic rollback is claimed.

## Interrupted or partial execution

1. Keep the write freeze. Preserve the original backup, both plan copies and execution journal. Never delete them or rerun the original command blindly. The journal refuses overwrite.
2. An `intent` without `verified` means the copy may or may not have completed, even if the CLI reported a network error. Read HEAD/GET/tags for that key and compare its SHA-256 and metadata to the original backup. Other completed objects have corrected caching and unchanged contents. Do not infer state solely from the last CLI exit code.
3. To **finish forward**, create a fresh dry-run plan with a new `--plan` filename and a new `--backup-dir`, retaining the original backup. The new inventory skips objects whose Cache-Control is already correct and backs up the remaining affected keys. Review that new plan, then obtain approval again before execution. This is usually preferable to restoring missing Cache-Control.
4. To **restore original state**, prepare one conditional recovery request per affected key using the original plan/backups as below. Recovery is separately approved; never overwrite an unexpected newer object. Correct-byte/current metadata matching either original or repaired state is accepted. Different content, unexpected metadata/tags/encryption/storage or a permission error is refused for individual review. A confirmed missing key gets a create-only `IfNoneMatch: *` request; a 403 is never treated as missing.

Read-only recovery preparation, using the **original** `$repairArgs` and a real affected object key:

```powershell
node scripts/repair-cesium-cache-control.cjs @repairArgs `
    --prepare-recovery 'assets/cesium/releases/1.143.0-a5a84813c72de745-standard/Workers/createPolygonGeometry.js' `
    --recovery-output '.generated/cesium-unversioned-repair/restore-polygon.json'
```

This verifies the original backups, target/configuration and present object, then writes a **local PutObject request JSON and adjacent `.body.json` receipt only**. It never sends PutObject. The request contains original content type/metadata/tags/encryption/storage and original Cache-Control (omitted to restore an originally absent header), expected owner, destination condition, body size and base64 SHA-256 for S3 validation. The receipt contains the backup file path/body hash and a hash binding the request JSON. The binary body is deliberately supplied separately with `--body`, not encoded as a pathname/string in JSON. Missing original attributes stay absent. Inspect the generated JSON and current object before approving recovery. Backup paths must still exist on the execution machine.

Only after **separate recovery approval**, with the freeze still in place and the generated request freshly reviewed:

```powershell
$restoreFile = '.generated/cesium-unversioned-repair/restore-polygon.json'
$receipt = Get-Content -LiteralPath ($restoreFile + '.body.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $restoreFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.requestSha256) {
    throw 'Recovery request changed; stop and review.'
}
if ((Get-FileHash -LiteralPath $receipt.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $receipt.sha256) {
    throw 'Recovery backup changed; stop.'
}
aws --profile YOUR_APPROVED_AWS_PROFILE --no-cli-pager s3api put-object `
    --cli-input-json "file://$restoreFile" --body $receipt.path
```

For this manual recovery command set `$env:AWS_MAX_ATTEMPTS='1'` temporarily and retain/restore its previous value afterward, so an uncertain PUT is inspected rather than retried. Do not run a bulk unconditional upload or remove the IfMatch/IfNoneMatch condition after a 409/412. A condition failure requires renewed read-only inspection and a freshly reviewed recovery request. Inspect the backup's hash again immediately before sending. After recovery verify direct S3 SHA-256/size, original properties, tags and encryption; Last-Modified/ETag are not promised to return to their original values. S3 checksum algorithms may differ after a local PUT; byte SHA-256 is the integrity criterion. If an unknown overwrite or backup corruption is detected, stop; this utility will not replace that unknown object automatically.

## After successful repair

No automatic CloudFront invalidation runs. Cached CDN response metadata may remain stale after S3 repair. Prepare and separately approve a release-prefix invalidation only if required, as in the existing repair runbook. Then run the existing sequential live verifier with the saved artifact and confirm normal-cache browser reuse. Do not run production stress tests. Fixing explicit cache headers reduces avoidable repeat transfers; it does not identify or resolve the separate CloudFront enforcement quota. AWS Support still needs failing request IDs/timestamps/POP.

## Validation boundary

Tests use mocked AWS and temporary local backups. Actual versioning/ownership/encryption/behavior inspection and plan generation require the approved AWS identity. AWS CLI 2.40.3 is now installed here, but live read-only inspection attempts fail through this environment's configured proxy before any AWS response. No AWS backup or repair result is claimed. The supplied read-only IAM policy has been statically checked as described above.

Local checks completed:

- **53 tests passed, zero failed**: `node --test --test-isolation=none scripts/tests/repair-cesium-cache-control.test.cjs scripts/tests/cesium-assets.test.cjs scripts/tests/frontend-assets.test.cjs scripts/tests/gnss-concurrency.test.cjs scripts/tests/gnss-load-test.test.cjs`. This includes **36 repair tests**, covering the prior safeguards plus explicit GetObject flags, one final Windows-style output path, preserved ETag/version values, binary download/cleanup and redacted exit-252 diagnostics. These are not AWS integration tests.
- **17 mocked deployment-safety scenarios passed** using `scripts/tests/deploy-production.test.ps1`.
- `npm run build -- --config .generated/cesium-get-object-cli-validation/webpack.config.cjs`: passed, webpack 5.108.4, **96,149 ms**. Output-only wrapper preserves checked-in production output.
- Isolated build Cesium verification: **392 assets**; frontend verification: **24 assets**; deployment `-SkipBuild -ValidateOnly`: passed without AWS requests.
- JavaScript syntax and Git whitespace checks passed. Existing sources.json CRLF normalization warning remains.

The latest GetObject argument follow-up changes only the repair utility's `client`, its tests and this guide. Existing versioned/unversioned repair safeguards remain. Pre-existing sources.json/root.css work remains untouched. Latest logs: `.generated/cesium-get-object-cli-validation/`; CLI parser fixtures: `.generated/cesium-cli-arguments/`. Earlier checks remain in their original directories. No browser/concurrent production tests, invalidation, deployment, commit or push occurred.

References: [AWS CopyObject conditions/metadata](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html), [AWS GetObject conditions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
