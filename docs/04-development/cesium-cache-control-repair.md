# Current-release Cache-Control repair

**Unversioned production bucket:** `warzone.battlespacex.com` has versioning disabled, as confirmed by the operator. Use the [backed-up unversioned procedure](cesium-cache-control-repair-unversioned.md), not the versioned execution instructions below. The utility now supports an explicit `--unversioned` mode without enabling versioning or changing bucket configuration. The older versioned mode remains available for other reviewed buckets.

Prepared November 13, 2026, Toronto. **Not executed against AWS.** This procedure changes only S3 Cache-Control on verified objects in `1.143.0-a5a84813c72de745-standard`. It does not publish HTML, upload local worker files, change CloudFront configuration or repair the separate manifest 404.

## Why the current upload command is insufficient for repair

`scripts/deploy-production.ps1` publishes Cesium using `aws s3 sync` to the manifest-selected versioned prefix with `--cache-control 'public, max-age=31536000, immutable'`. MIME guessing is enabled by default; the script does **not** explicitly assign every vendor object's Content-Type. Its live gate requires correct JavaScript MIME, immutable caching and exact bytes before HTML publication. Sampled JavaScript responses already have `application/javascript`.

AWS CLI documents that metadata changes do not apply to unchanged files skipped by sync. Re-running that command cannot be relied upon to repair old metadata. The observed missing header could instead be old CDN metadata, a response-header removal rule, edge code, or an earlier upload path that did not set it. The historical uploader has not been established. The observed `x-amz-meta-s3b-last-modified` is an uploader clue, not proof of which tool or person published the objects.

**S3 metadata has not been queried.** Determine which case applies before writing:

| Direct S3 Cache-Control | CloudFront response | Action |
| --- | --- | --- |
| Missing/wrong | Missing/wrong | Prepare metadata repair, also inspect behavior/policies. |
| Correct | Missing/wrong | No S3 copy is justified; inspect stale edge object, response-header policy and edge functions. |
| Correct | Correct | No metadata repair. Continue the independent LimitExceeded investigation. |

## Exact console inspection, without saving changes

1. CloudFront → Distributions → **E2EFV9935XX3MV** → Behaviors. Locate the **first matching** behavior for `/assets/cesium/releases/1.143.0-a5a84813c72de745-standard/Workers/createPolygonGeometry.js`. Repeat for all relevant asset types if narrower behaviors exist. Open its details and record target origin, compression, cache-policy ID, response-header policy and function/Lambda associations. Do not edit or save yet.
2. Confirm **Managed-CachingOptimized**, ID `658327ea-f89d-4fab-a63d-7e88639e58f6`. CloudFront → Policies → Cache → CachingOptimized: minimum TTL **1**, default **86400**, maximum **31536000**, cookies/query strings excluded, normalized Accept-Encoding compression enabled. This policy is compatible with the proposed one-year immutable object header; it does not itself add Cache-Control to S3 responses. Do not use it for no-store entry HTML. The repair tool independently checks these values against AWS before permitting a copy; actual attachment is not yet verified here.
3. View the behavior's response-header policy. Check both **Remove headers** and **Custom headers** for Cache-Control. Inspect any associated function/Lambda's exact published version for URI/header changes. If any exist, this tool refuses the repair pending separate review, rather than guessing that S3 is the cause.
4. Distribution → Origins → actual origin: record bucket, origin path and OAC. This tool supports only a direct S3 REST origin without an origin path. Do not substitute an assumed production bucket name.
5. S3 → actual bucket → Objects → `assets/cesium/releases/1.143.0-a5a84813c72de745-standard/Workers/createPolygonGeometry.js` → Properties → Metadata: record **Cache-Control**, **Content-Type**, custom metadata, storage class and encryption. Check `chunk-ML6MR2RA.js` too. If an origin path/rewrite exists, translate to the real key first. CloudFront headers alone are not a direct S3 metadata inspection.
6. Bucket → Permissions → Object Ownership: confirm **Bucket owner enforced**. Bucket → Properties: confirm versioning already **Enabled**, no Object Lock. Inspect lifecycle rules, bucket policy, access points and replication. Confirm no version-ID-specific access rules would make newly created current versions inaccessible to OAC. Do not enable versioning, change permissions or relax policy just to run this utility.
7. Record the bucket owner's 12-digit AWS account ID from the authenticated account, the selected CLI profile, actual bucket and distribution. No bucket/profile defaults are embedded in the tool.

Do not use the S3 Console's bulk Edit metadata on the prefix: entries can have different Content-Type/custom metadata and ACL/encryption behavior. The tool snapshots each object's individual properties and tags.

## Executable preparation

New tool: `scripts/repair-cesium-cache-control.cjs`. Prerequisites: Node, AWS CLI v2 with CopyObject destination `IfMatch` support, and an approved AWS identity. Planning uses read-only AWS operations and local temporary downloads; it makes no AWS mutation. It requires the complete **saved artifact matching the live release**, not a fresh rebuild offered as proof of what is deployed. An older CLI that rejects the IfMatch input must not be worked around by removing the condition; review CLI compatibility first.

It verifies the local manifest, distribution/alias/winning origin, managed policy, header policy, bucket ownership/versioning and each object's original S3 version, MIME, SHA-256 and size. It checks all manifest objects before the first possible copy. Already-correct Cache-Control values are skipped. A refusal is a request for review, not permission to bypass the check.

From repository root, replace every placeholder with verified values:

```powershell
New-Item -ItemType Directory -Force .generated/cesium-cache-repair | Out-Null
$repairArgs = @(
    '--build-dir', 'production',
    '--bucket', 'YOUR_VERIFIED_BUCKET',
    '--owner', 'YOUR_12_DIGIT_BUCKET_OWNER_ID',
    '--profile', 'YOUR_APPROVED_AWS_PROFILE',
    '--distribution', 'E2EFV9935XX3MV',
    '--origin', 'https://stratops.battlespacex.com',
    '--plan', '.generated/cesium-cache-repair/reviewed-plan.json'
)
node scripts/repair-cesium-cache-control.cjs @repairArgs
```

This inventories all **392 assets** in the reviewed manifest, not only the two sampled JS files. Plan generation requires approximately one HEAD, one version-specific GET and one tag read per object, plus a few configuration reads; these are normal metered AWS requests, not a production concurrency test. Downloads go to temporary files which are removed afterward. The plan records original metadata, tags, ETags, version IDs, hashes and target identity; keep it private. The tool refuses to overwrite an existing plan.

Read permissions include CloudFront distribution/policy reads, S3 bucket ownership/versioning/Object Lock configuration, object/version GETs and tag reads. Do not grant write permissions merely to generate a plan. If all S3 headers are already correct, the plan contains zero copies; investigate CloudFront instead. Permission-denied responses fail closed; they are not interpreted as absent configuration.

## Execution, only after reviewing the actual plan and receiving approval

The following is an operator command **prepared for later approval; it has not been run**:

```powershell
# Use the same verified $repairArgs and the reviewed plan file.
# First freeze every uploader/operator's writes to this immutable release prefix.
node scripts/repair-cesium-cache-control.cjs @repairArgs --execute --confirm-release-frozen
```

Execution re-inventories the entire release and refuses any difference from the approved plan. It rechecks each current version immediately before copying. It sends both source `CopySourceIfMatch` and destination `IfMatch` ETag conditions. A prefix write freeze is still required: an ETag condition cannot detect a concurrent metadata-only write with unchanged ETag and does not compare the destination VersionId. Another writer must not race this repair.

For each affected object it uses **same-bucket/same-key CopyObject from the exact original VersionId**, `CopySourceIfMatch` with the original ETag, `MetadataDirective: REPLACE` with that object's original Content-Type, Content-Disposition, Content-Language, Expires, website redirect and complete custom metadata, changing only Cache-Control. Original tags are explicitly retained. AES256 encryption and STANDARD storage are kept. Bucket owner enforced means ACLs are disabled; the tool never sets ACLs, ownership controls, bucket policy or OAC. It does not download-and-reupload worker contents.

The narrow supported case is an already-versioned, BucketOwnerEnforced, non-Object-Lock bucket with unencoded STANDARD/AES256 objects and no replication. ACL-enabled buckets, SSE-KMS/SSE-C, Object Lock, replication, archive storage, encoded origin objects, unfamiliar edge code/policies and mismatching content require an individually reviewed extension/procedure. The utility does not silently change these settings or enable a paid service. Browser-visible Brotli applied by CloudFront is distinct from a Content-Encoding stored on the S3 object.

Each copy creates a new version and changes Last-Modified. **ETags are not promised to remain identical**; AWS copying, multipart history, encryption/checksum rules can affect them. The tool records old/new ETags and verifies body SHA-256/length, all preserved metadata and tags after each copy. Original versions remain available, subject to independently configured lifecycle rules. No attempt is made to force a CDN weak/compressed ETag to equal the S3 ETag.

Results are fsynced to `<plan>.execution.jsonl` before post-copy validation. On failure it stops; this is not a transaction across 392 objects. Earlier successful copies remain, with unchanged bytes and corrected metadata. A network/process failure during CopyObject can leave an unjournaled completed copy; the original version IDs remain in the plan and S3 version history must be inspected before any retry. A repeat execution cannot overwrite the existing journal. Generate/review a new plan for any remaining work. Do not delete versions or automatically roll back.

## Refresh cached response metadata and verify

S3 correction does not immediately refresh already-cached CloudFront headers. After S3 post-copy verification, request separate approval for a scoped invalidation if necessary. Prepared command (not executed):

```powershell
aws --profile YOUR_APPROVED_AWS_PROFILE cloudfront create-invalidation `
    --distribution-id E2EFV9935XX3MV `
    --paths '/assets/cesium/releases/1.143.0-a5a84813c72de745-standard/*'
```

This changes CDN cache state and can cause a temporary origin refetch; it is deliberately not part of the tool. Confirm invalidation allowance/cost and distribution identity first. Wait for completion in CloudFront → Invalidations. Without invalidation, existing cached responses may retain old headers until freshness/revalidation permits refresh; do not advertise an immediate repair.

Then sequentially verify through CloudFront:

```powershell
node scripts/cesium-assets.cjs --verify-live production https://stratops.battlespacex.com
```

This is 392 normal sequential GETs, checking status, JS MIME, immutable header and exact bytes. It does not require the public `/cesium-assets.json`; the manifest 404 remains a separate release-provenance issue. Do not add cache-busting queries or re-publish HTML. Inspect initial and subsequent worker responses with normal browser caching: `Cache-Control: public, max-age=31536000, immutable`, correct MIME, stable versioned URL, and expected cache reuse. Repeat ordinary feature activation in an authorized cold/warm browser; do not clear authentication storage. Staging concurrency acceptance remains the matrix in the remediation runbook, not a production stress test.

Metadata repair improves explicit browser reuse and can reduce repeat CDN transfers. It does not reduce a genuinely cold client's native worker graph or establish the exact request-rate/concurrency enforcement. The screenshot confirms CloudFront LimitExceeded; it does **not** identify a numerical rate threshold or scope. AWS Support must correlate failing request IDs, November 14 01:15:57–01:16:01 UTC and YTO53-P3. Do not close that case because metadata is corrected or a warm load succeeds.

## Local validation completed

- New repair tests plus existing Cesium/frontend integrity, GNSS concurrency and load-harness tests: **28 passed, zero failed** using `node --test --test-isolation=none scripts/tests/repair-cesium-cache-control.test.cjs scripts/tests/cesium-assets.test.cjs scripts/tests/frontend-assets.test.cjs scripts/tests/gnss-concurrency.test.cjs scripts/tests/gnss-load-test.test.cjs`. Eleven tests cover the new repair tool, including preserved metadata/tags, unchanged bytes, target checks, changed plans/versions, partial failure and blocked unauthorized mutations. AWS is mocked; this is not a live repair test.
- Existing `scripts/tests/deploy-production.test.ps1`: **17 mocked scenarios passed**.
- Production build using the output-only wrapper `.generated/cesium-cache-repair-validation/webpack.config.cjs`: **passed**, webpack 5.108.4, 64,214 ms. Checked-in production output was preserved.
- Fresh isolated build verification: **392 Cesium assets**, **24 application JS/CSS assets**, and deployment **ValidateOnly passed**, no AWS requests.
- Repair script/test syntax checks and Git whitespace check passed. Existing sources.json CRLF normalization warning remains.

Logs are in `.generated/cesium-cache-repair-validation/`. AWS CLI is unavailable here: no plan was generated from AWS, no copy or invalidation ran, and no live compatibility/permission/preservation result is claimed. The script is prepared and locally tested; actual bucket support and the origin-vs-CDN cause still require the stated read-only checks. No browser/concurrent production test was run. No existing application function, deployment script, CSS, source ingestion or worker file was edited.

## References

- [AWS S3 sync metadata semantics](https://docs.aws.amazon.com/cli/latest/reference/s3/sync.html)
- [AWS CopyObject metadata, permissions and versioning behavior](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)
- [Managed CachingOptimized policy settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)
