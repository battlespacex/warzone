// Operator tool: read-only plan by default. No application/runtime imports this file.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { verifyBuild, sha256 } = require('./cesium-assets.cjs');

const CACHE = 'public, max-age=31536000, immutable';
const POLICY = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const FIELDS = ['ContentType', 'ContentEncoding', 'ContentDisposition', 'ContentLanguage',
    'Expires', 'WebsiteRedirectLocation', 'Metadata'];
const properties = (head) => Object.fromEntries(FIELDS.filter((f) => f === 'Metadata' || head[f] !== undefined)
    .map((f) => [f, f === 'Metadata' ? (head.Metadata || {}) : head[f]]));
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function parseJson(text, source, allowEmpty = false) {
    const value = String(text ?? '').replace(/^\uFEFF/, '').trim();
    if (!value) {
        assert(allowEmpty, `Empty JSON from ${source}; no response content logged`);
        return {};
    }
    let parsed;
    try { parsed = JSON.parse(value); }
    catch { throw new Error(`Malformed JSON from ${source}; response content omitted`); }
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `Expected a JSON object from ${source}; response content omitted`);
    return parsed;
}
function readJson(file) {
    let bytes;
    try { bytes = fs.readFileSync(file, 'utf8'); }
    catch (error) { throw new Error(`Cannot read JSON file ${file} (${['ENOENT', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'I/O error'})`); }
    return parseJson(bytes, `file ${file}`);
}
const pattern = (value) => new RegExp('^' + value.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

function validateTarget(target) {
    assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(target.bucket)
        && /^[A-Z0-9]+$/.test(target.distribution), 'Explicit bucket and distribution required');
    assert(/^\d{12}$/.test(target.owner), '--owner must be the real 12-digit bucket-owner account ID; replace the placeholder');
    assert(target.profile && target.profile !== 'YOUR_APPROVED_AWS_PROFILE', '--profile must be an existing AWS CLI profile name; replace the placeholder');
    const url = new URL(target.origin);
    assert(url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
        && !url.username && !url.password && url.port === '', 'Expected an HTTPS site origin');
    return url;
}

function assertTarget(api, target, files, baseUrl, unversioned = false) {
    const url = validateTarget(target);
    const d = api.call('cloudfront', 'get-distribution', { Id: target.distribution }).Distribution;
    const c = d.DistributionConfig;
    assert(d.Id === target.distribution && d.Status === 'Deployed' && c.Enabled
        && (c.Aliases?.Items || []).includes(url.hostname), 'Distribution/alias must match and be deployed/enabled');
    for (const file of files) {
        const key = `${baseUrl.slice(1)}/${file.path}`;
        const b = (c.CacheBehaviors?.Items || []).find((item) => pattern(item.PathPattern).test(key)) || c.DefaultCacheBehavior;
        const origin = c.Origins.Items.find((item) => item.Id === b.TargetOriginId);
        assert(origin?.S3OriginConfig && !origin.OriginPath
            && new RegExp('^' + target.bucket.replace(/\./g, '\\.') + '\\.s3(?:[.-][a-z0-9-]+)*\\.amazonaws\\.com$').test(origin.DomainName),
        `Unexpected origin for ${key}; origin paths/groups/website endpoints require separate review`);
        assert(b.CachePolicyId === POLICY && b.Compress, `Expected Managed-CachingOptimized and compression for ${key}`);
        assert(!b.FunctionAssociations?.Quantity && !b.LambdaFunctionAssociations?.Quantity,
            'Associated edge code requires separate review before this repair');
        if (b.ResponseHeadersPolicyId) {
            const policy = api.cached('cloudfront', 'get-response-headers-policy', { Id: b.ResponseHeadersPolicyId })
                .ResponseHeadersPolicy.ResponseHeadersPolicyConfig;
            const names = [...(policy.RemoveHeadersConfig?.Items || []), ...(policy.CustomHeadersConfig?.Items || [])];
            assert(!names.some((item) => item.Header.toLowerCase() === 'cache-control'),
                'Response policy alters Cache-Control; investigate it instead of copying S3 objects');
        }
    }
    const policy = api.cached('cloudfront', 'get-cache-policy', { Id: POLICY }).CachePolicy.CachePolicyConfig;
    const key = policy.ParametersInCacheKeyAndForwardedToOrigin;
    assert(policy.MinTTL === 1 && policy.DefaultTTL === 86400 && policy.MaxTTL === 31536000
        && key.CookiesConfig.CookieBehavior === 'none' && key.QueryStringsConfig.QueryStringBehavior === 'none'
        && key.HeadersConfig.HeaderBehavior === 'none' && key.EnableAcceptEncodingGzip && key.EnableAcceptEncodingBrotli,
    'Managed policy settings differ from reviewed immutable-asset policy');
    assert(api.call('s3api', 'get-bucket-ownership-controls', api.bucket()).OwnershipControls.Rules
        .some((r) => r.ObjectOwnership === 'BucketOwnerEnforced'), 'ACL-enabled bucket requires separate permission-preservation review');
    const versioning = api.call('s3api', 'get-bucket-versioning', api.bucket()).Status;
    if (unversioned) {
        assert(target.bucket === 'warzone.battlespacex.com', 'Unversioned repair is pinned to warzone.battlespacex.com');
        assert(versioning === undefined || versioning === 'Suspended', 'Unversioned mode requires versioning disabled/suspended');
    } else {
        assert(versioning === 'Enabled', 'Enabled versioning required; use the explicit backed-up --unversioned mode for the reviewed bucket');
    }
    assert(!api.lockConfiguration()?.ObjectLockConfiguration?.ObjectLockEnabled,
        'Object Lock buckets require separate retention review');
}

function inspect(api, manifest, unversioned = false, backup) {
    return manifest.files.map((file) => {
        const Key = `${manifest.baseUrl.slice(1)}/${file.path}`;
        const head = api.call('s3api', 'head-object', { ...api.bucket(), Key });
        assert(unversioned ? (!head.VersionId || head.VersionId === 'null') && head.LastModified
            : head.VersionId && head.VersionId !== 'null', `Unexpected version/state for ${Key}`);
        assert(typeof head.ETag === 'string' && head.ETag.length > 2 && file.bytes <= 5 * 1024 ** 3,
            `Missing ETag or object exceeds single-copy limit: ${Key}`);
        assert(head.ServerSideEncryption === 'AES256' && !head.SSECustomerAlgorithm && !head.SSEKMSKeyId
            && (!head.StorageClass || head.StorageClass === 'STANDARD')
            && !head.ObjectLockMode && !head.ObjectLockRetainUntilDate && !head.ObjectLockLegalHoldStatus
            && !head.ReplicationStatus && !head.Restore && !head.MissingMeta, `Unsupported encryption/storage/retention/replication/metadata for ${Key}`);
        assert(head.ContentType && (!Key.endsWith('.js') || /^(application|text)\/(?:x-)?javascript\b/i.test(head.ContentType)),
            `Missing or invalid Content-Type for ${Key}; MIME repair is separate`);
        assert(!head.ContentEncoding, `Encoded S3 object ${Key} requires separate byte/encoding review`);
        const request = { ...api.bucket(), Key, ...(unversioned ? {} : { VersionId: head.VersionId }) };
        const tagsBefore = unversioned ? api.call('s3api', 'get-object-tagging', request).TagSet.sort((a, b) => a.Key.localeCompare(b.Key)) : null;
        const bytes = api.bytes({ ...request, IfMatch: head.ETag });
        assert(bytes.length === file.bytes && sha256(bytes) === file.sha256, `Deployed bytes do not match saved release: ${Key}`);
        const tags = api.call('s3api', 'get-object-tagging', request).TagSet.sort((a, b) => a.Key.localeCompare(b.Key));
        if (unversioned) {
            assert(stable(head) === stable(api.call('s3api', 'head-object', { ...api.bucket(), Key }))
                && stable(tags) === stable(tagsBefore), `Object changed during backup inspection: ${Key}`);
        }
        const row = { Key, VersionId: head.VersionId ?? null, ETag: head.ETag, bytes: file.bytes, sha256: file.sha256,
            CacheControl: head.CacheControl ?? null, properties: properties(head), tags,
            ...(unversioned ? { originalHead: head } : {}) };
        if (backup && row.CacheControl !== CACHE) backup(row, bytes);
        return row;
    });
}

function copyInput(api, row) {
    return { ...api.bucket(), Key: row.Key,
        CopySource: `${api.target.bucket}/${row.Key.split('/').map(encodeURIComponent).join('/')}`
            + (row.VersionId && row.VersionId !== 'null' ? `?versionId=${encodeURIComponent(row.VersionId)}` : ''),
        ExpectedSourceBucketOwner: api.target.owner, CopySourceIfMatch: row.ETag, IfMatch: row.ETag,
        MetadataDirective: 'REPLACE', ...row.properties, CacheControl: CACHE,
        TaggingDirective: 'REPLACE', Tagging: row.tags.map((tag) => `${encodeURIComponent(tag.Key)}=${encodeURIComponent(tag.Value)}`).join('&'),
        ServerSideEncryption: 'AES256', StorageClass: 'STANDARD' };
}

function execute(api, approved, current, journal) {
    assert(stable(approved) === stable(current), 'Plan changed: regenerate and review the read-only plan');
    if (current.mode === 'unversioned') verifyBackups(current);
    for (const row of current.objects.filter((r) => r.CacheControl !== CACHE)) {
        const before = api.call('s3api', 'head-object', { ...api.bucket(), Key: row.Key });
        assert((before.VersionId ?? null) === row.VersionId && before.ETag === row.ETag, `Object changed: ${row.Key}`);
        if (current.mode === 'unversioned') {
            const tags = api.call('s3api', 'get-object-tagging', { ...api.bucket(), Key: row.Key }).TagSet.sort((a, b) => a.Key.localeCompare(b.Key));
            assert(stable(before) === stable(row.originalHead) && stable(tags) === stable(row.tags), `Object metadata/tags changed: ${row.Key}`);
            journal({ phase: 'intent', Key: row.Key, originalETag: row.ETag, backupFile: backupName(row) });
        }
        const result = api.call('s3api', 'copy-object', copyInput(api, row));
        // Persist both version IDs before post-copy checks; retain the source version on any failure.
        journal({ Key: row.Key, originalVersion: row.VersionId, newVersion: result.VersionId, originalETag: row.ETag,
            newETag: result.CopyObjectResult?.ETag });
        const after = api.call('s3api', 'head-object', { ...api.bucket(), Key: row.Key });
        assert((current.mode === 'unversioned' ? !after.VersionId || after.VersionId === 'null'
            : result.VersionId && after.VersionId === result.VersionId) && after.CacheControl === CACHE,
            `Post-copy version/header check failed: ${row.Key}`);
        const props = properties(after);
        assert(stable(props) === stable(row.properties) && after.ServerSideEncryption === 'AES256'
            && (!after.StorageClass || after.StorageClass === 'STANDARD'), `Post-copy metadata changed: ${row.Key}`);
        const request = { ...api.bucket(), Key: row.Key, ...(current.mode === 'unversioned' ? {} : { VersionId: after.VersionId }) };
        const bytes = api.bytes({ ...request, IfMatch: after.ETag });
        const tags = api.call('s3api', 'get-object-tagging', request).TagSet.sort((a, b) => a.Key.localeCompare(b.Key));
        assert(bytes.length === row.bytes && sha256(bytes) === row.sha256 && stable(tags) === stable(row.tags),
            `Post-copy bytes/tags changed: ${row.Key}`);
        if (current.mode === 'unversioned') journal({ phase: 'verified', Key: row.Key, ETag: after.ETag });
    }
}

const backupName = (row) => sha256(Buffer.from(row.Key)) + '.bin';
function writeExclusive(file, bytes) {
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function saveBackup(directory, row, bytes) {
    assert(bytes.length === row.bytes && sha256(bytes) === row.sha256, `Invalid backup bytes: ${row.Key}`);
    writeExclusive(path.join(directory, backupName(row)), bytes);
    writeExclusive(path.join(directory, backupName(row) + '.json'), JSON.stringify(row, null, 2) + '\n');
}
function verifyBackups(plan) {
    assert(path.isAbsolute(plan.backupDirectory) && fs.lstatSync(plan.backupDirectory).isDirectory()
        && !fs.lstatSync(plan.backupDirectory).isSymbolicLink(), 'Expected original local backup directory');
    assert(stable(readJson(path.join(plan.backupDirectory, 'original-plan.json'))) === stable(plan),
        'Backup plan differs from approved plan');
    for (const row of plan.objects.filter((r) => r.CacheControl !== CACHE)) {
        const file = path.join(plan.backupDirectory, backupName(row));
        assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), `Invalid backup file: ${row.Key}`);
        const bytes = fs.readFileSync(file);
        assert(bytes.length === row.bytes && sha256(bytes) === row.sha256
            && stable(readJson(file + '.json')) === stable(row), `Backup failed integrity check: ${row.Key}`);
    }
}

// Generates a conditional recovery request only; this tool never sends PutObject.
function prepareRecovery(api, plan, key) {
    assert(plan.mode === 'unversioned', 'Recovery preparation requires an unversioned backup plan');
    verifyBackups(plan);
    const row = plan.objects.find((r) => r.Key === key && r.CacheControl !== CACHE);
    assert(row, 'Recovery key must be an affected object in the original backup plan');
    let head;
    try { head = api.call('s3api', 'head-object', { ...api.bucket(), Key: key }); }
    catch (error) { if (!/\((?:NotFound|NoSuchKey|404)\)/.test(error.message)) throw error; }
    if (head) {
        const bytes = api.bytes({ ...api.bucket(), Key: key, IfMatch: head.ETag });
        const tags = api.call('s3api', 'get-object-tagging', { ...api.bucket(), Key: key }).TagSet.sort((a, b) => a.Key.localeCompare(b.Key));
        assert((!head.VersionId || head.VersionId === 'null') && head.ServerSideEncryption === 'AES256'
            && (!head.StorageClass || head.StorageClass === 'STANDARD') && stable(properties(head)) === stable(row.properties)
            && stable(tags) === stable(row.tags) && bytes.length === row.bytes && sha256(bytes) === row.sha256
            && [CACHE, row.CacheControl].includes(head.CacheControl ?? null),
        'Current object differs from original/repaired state: stop for individual recovery review');
    }
    const input = { ...api.bucket(), Key: row.Key,
        ...row.properties, ...(row.CacheControl === null ? {} : { CacheControl: row.CacheControl }),
        Tagging: row.tags.map((tag) => `${encodeURIComponent(tag.Key)}=${encodeURIComponent(tag.Value)}`).join('&'),
        ServerSideEncryption: 'AES256', StorageClass: 'STANDARD', ContentLength: row.bytes,
        ChecksumSHA256: Buffer.from(row.sha256, 'hex').toString('base64'),
        ...(head ? { IfMatch: head.ETag } : { IfNoneMatch: '*' }) };
    return { input, body: { path: path.join(plan.backupDirectory, backupName(row)), sha256: row.sha256, bytes: row.bytes } };
}
function writeRecovery(file, recovery) {
    const json = JSON.stringify(recovery.input, null, 2) + '\n';
    writeExclusive(file, json);
    writeExclusive(file + '.body.json', JSON.stringify({ ...recovery.body, requestSha256: sha256(Buffer.from(json)) }, null, 2) + '\n');
}

function client(target, run = spawnSync) {
    const cache = new Map();
    const api = { target, bucket: () => ({ Bucket: target.bucket, ExpectedBucketOwner: target.owner }) };
    api.call = (service, operation, input, destination) => {
        assert(service === 'cloudfront' && ['get-distribution', 'get-response-headers-policy', 'get-cache-policy'].includes(operation)
            || service === 's3api' && ['get-bucket-ownership-controls', 'get-bucket-versioning', 'get-object-lock-configuration',
                'head-object', 'get-object', 'get-object-tagging', ...(api.allowCopy ? ['copy-object'] : [])].includes(operation), 'Unreviewed/unauthorized AWS operation');
        const resource = [input.Bucket && /^[a-z0-9.-]+$/.test(input.Bucket) ? `bucket=${input.Bucket}` : '',
            input.Key && /^assets\/cesium\/releases\/[A-Za-z0-9._/-]+$/.test(input.Key) ? `key=${input.Key}` : '',
            input.Id && /^[A-Za-z0-9-]+$/.test(input.Id) ? `id=${input.Id}` : ''].filter(Boolean).join(', ');
        let command = `aws ${service} ${operation}${resource ? ' [' + resource + ']' : ''}`; // Never log JSON input, credentials or raw output.
        const args = ['--profile', target.profile, '--no-cli-pager', service, operation];
        if (service === 's3api' && operation === 'get-object') {
            // Streaming-output commands do not support --cli-input-json. Keep outfile as one final argv entry.
            const flags = { Bucket: '--bucket', Key: '--key', ExpectedBucketOwner: '--expected-bucket-owner',
                IfMatch: '--if-match', VersionId: '--version-id' };
            assert(Object.keys(input).every((key) => Object.hasOwn(flags, key)), 'Unreviewed get-object parameter');
            assert(typeof input.Bucket === 'string' && input.Bucket && typeof input.Key === 'string' && input.Key,
                'aws s3api get-object requires explicit Bucket and Key');
            assert(typeof destination === 'string' && destination && !destination.includes('\0'), 'aws s3api get-object requires an output filename');
            const file = path.resolve(destination);
            for (const [key, flag] of Object.entries(flags)) {
                if (input[key] !== undefined) {
                    assert(typeof input[key] === 'string', `Invalid get-object ${key} argument`);
                    args.push(flag, input[key]);
                }
            }
            args.push('--output', 'json', file);
            command += ` [outfile=${file}]`;
        } else {
            assert(destination === undefined, 'Output filename is only supported for get-object');
            args.push('--cli-input-json', JSON.stringify(input), '--output', 'json');
        }
        const result = run('aws', args,
        { encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_RETRY_MODE: 'standard' } });
        const diagnostic = String(result.stderr || '');
        const denied = /AccessDenied|UnauthorizedOperation|\bForbidden\b|not authorized/i.test(diagnostic);
        const code = diagnostic.match(/\((ObjectLockConfigurationNotFoundError|NoSuchKey|NotFound|404|NoSuchBucket|PreconditionFailed|ConditionalRequestConflict|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|InvalidToken)\)/)?.[1];
        if (result.error || result.status !== 0 || denied || code) {
            let cliReason = result.status === 253 ? 'CLI configuration/credentials failure' : 'CLI/transport failure';
            if (result.status === 252 || result.status === 2) {
                const missing = diagnostic.match(/the following arguments are required:([^\r\n]+)/i);
                const unknown = diagnostic.match(/Unknown options:([^\r\n]+)/i);
                const flags = (missing?.[1] || unknown?.[1] || '').match(/--[a-z][a-z0-9-]*/gi) || [];
                cliReason = 'CLI argument validation failed' + (missing ? `; missing required ${flags.join(', ') || 'argument'}`
                    : unknown ? `; unknown options ${flags.join(', ') || '(values omitted)'}`
                        : /Error parsing parameter/i.test(diagnostic) ? '; invalid parameter value (value omitted)' : '');
            }
            const reason = denied ? 'AccessDenied' : code || (result.error?.code === 'ENOENT' ? 'AWS CLI unavailable' : cliReason);
            throw new Error(`${command} failed (${reason}); exit ${Number.isInteger(result.status) ? result.status : 'unavailable'}; raw output omitted`);
        }
        // AWS CLI's JSON formatter suppresses the empty {} response of never-versioned buckets.
        const parsed = parseJson(result.stdout, command, service === 's3api' && operation === 'get-bucket-versioning');
        assert(!Object.hasOwn(parsed, 'Error') && !Object.hasOwn(parsed, 'Code'), `${command} returned an error object; response content omitted`);
        if (operation === 'get-bucket-versioning') {
            assert(Object.keys(parsed).every((key) => ['Status', 'MFADelete'].includes(key))
                && [undefined, 'Enabled', 'Suspended'].includes(parsed.Status)
                && [undefined, 'Enabled', 'Disabled'].includes(parsed.MFADelete),
            `Invalid JSON response shape from ${command}; unexpected versioning state; response content omitted`);
        }
        const roots = { 'get-distribution': 'Distribution', 'get-cache-policy': 'CachePolicy',
            'get-response-headers-policy': 'ResponseHeadersPolicy', 'get-bucket-ownership-controls': 'OwnershipControls',
            'get-object-lock-configuration': 'ObjectLockConfiguration', 'get-object-tagging': 'TagSet',
            'head-object': 'ETag', 'get-object': 'ETag', 'copy-object': 'CopyObjectResult' };
        const root = roots[operation];
        assert(!root || (root === 'ETag' ? typeof parsed[root] === 'string' && parsed[root].length > 0
            : root === 'TagSet' ? Array.isArray(parsed[root]) : parsed[root] && typeof parsed[root] === 'object' && !Array.isArray(parsed[root])),
        `Invalid JSON response shape from ${command}; missing/invalid ${root}; response content omitted`);
        return parsed;
    };
    api.cached = (s, o, i) => { const key = stable([s, o, i]); if (!cache.has(key)) cache.set(key, api.call(s, o, i)); return cache.get(key); };
    api.lockConfiguration = () => {
        try { return api.call('s3api', 'get-object-lock-configuration', api.bucket()); }
        catch (error) { if (/\(ObjectLockConfigurationNotFoundError\)/.test(error.message)) return null; throw error; }
    };
    api.bytes = (input) => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cesium-metadata-'));
        const file = path.join(folder, 'object');
        try { api.call('s3api', 'get-object', input, file); return fs.readFileSync(file); }
        finally { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); }
    };
    return api;
}

function main(args) {
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        assert(['--build-dir', '--bucket', '--owner', '--profile', '--distribution', '--origin', '--plan', '--backup-dir', '--unversioned',
            '--dry-run', '--execute', '--confirm-release-frozen', '--prepare-recovery', '--recovery-output'].includes(key)
            && options[key] === undefined, `Unknown/duplicate option: ${key}`);
        options[key] = ['--unversioned', '--dry-run', '--execute', '--confirm-release-frozen'].includes(key) ? true : args[++i];
        assert(options[key] && !String(options[key]).startsWith('--'), `Missing value: ${key}`);
    }
    assert(options['--build-dir'] && options['--plan'], 'Required: --build-dir --bucket --owner --profile --distribution --origin --plan');
    const unversioned = Boolean(options['--unversioned']);
    assert(!(options['--dry-run'] && options['--execute']), '--dry-run cannot be combined with --execute');
    assert(unversioned === Boolean(options['--backup-dir']), '--unversioned requires --backup-dir; versioned mode must omit it');
    const recovery = Boolean(options['--prepare-recovery']);
    assert(recovery === Boolean(options['--recovery-output']) && (!recovery || unversioned && !options['--execute']),
        'Recovery preparation requires --unversioned, --prepare-recovery KEY, --recovery-output FILE and no --execute');
    if (options['--execute']) assert(options['--confirm-release-frozen'], 'Execute requires an operator freeze of writes to this release prefix');
    const target = { bucket: options['--bucket'], owner: options['--owner'], profile: options['--profile'],
        distribution: options['--distribution'], origin: options['--origin'] };
    validateTarget(target); // Reject placeholders before filesystem creation or AWS calls.
    const backupDirectory = unversioned ? path.resolve(options['--backup-dir']) : null;
    if (unversioned) {
        const relative = path.relative(path.resolve(options['--build-dir']), backupDirectory);
        assert(path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep), 'Backups must be outside the build directory');
        if (!options['--execute'] && !recovery) {
            assert(!fs.existsSync(backupDirectory), 'Backup directory already exists; preserve it and choose a fresh --backup-dir and --plan');
            assert(!fs.existsSync(options['--plan']), 'Plan already exists; preserve it and choose a fresh --plan');
        }
    }
    readJson(path.join(options['--build-dir'], 'cesium-assets.json')); // Name malformed/empty local manifest before integrity verification.
    const manifest = verifyBuild(options['--build-dir']);
    assert(manifest.release === '1.143.0-a5a84813c72de745-standard', 'This repair is pinned to the reviewed deployed standard release');
    const api = client(target);
    assertTarget(api, target, manifest.files, manifest.baseUrl, unversioned);
    if (unversioned && !options['--execute'] && !recovery) fs.mkdirSync(backupDirectory); // Exclusive creation after target inspection succeeds.
    if (recovery) {
        const original = readJson(options['--plan']);
        assert(stable(original.target) === stable(target) && original.backupDirectory === backupDirectory
            && original.manifestHash === sha256(Buffer.from(stable(manifest))) && original.release === manifest.release,
        'Recovery target/artifact differs from original plan');
        writeRecovery(options['--recovery-output'], prepareRecovery(api, original, options['--prepare-recovery']));
        console.info('Conditional recovery request prepared locally; no AWS writes. Review and obtain separate approval before sending it.');
        return;
    }
    const plan = { schemaVersion: 1, target, release: manifest.release, manifestHash: sha256(Buffer.from(stable(manifest))),
        ...(unversioned ? { mode: 'unversioned', backupDirectory } : {}),
        objects: inspect(api, manifest, unversioned, unversioned && !options['--execute']
            ? (row, bytes) => saveBackup(backupDirectory, row, bytes) : null) };
    if (!options['--execute']) {
        if (unversioned) {
            writeExclusive(path.join(backupDirectory, 'original-plan.json'), JSON.stringify(plan, null, 2) + '\n');
            verifyBackups(plan);
        }
        writeExclusive(options['--plan'], JSON.stringify(plan, null, 2) + '\n');
        console.info(`Read-only plan saved: ${plan.objects.filter((r) => r.CacheControl !== CACHE).length} metadata copies; no AWS writes.`);
        return;
    }
    assert(options['--confirm-release-frozen'], 'Execute requires an operator freeze of writes to this release prefix');
    const approved = readJson(options['--plan']);
    const journal = options['--plan'] + '.execution.jsonl';
    const fd = fs.openSync(journal, 'wx');
    try { api.allowCopy = true; execute(api, approved, plan, (row) => {
        fs.writeSync(fd, JSON.stringify(row) + '\n'); fs.fsyncSync(fd);
    }); } finally { fs.closeSync(fd); }
    console.info('S3 metadata repair verified. No CloudFront invalidation or application deployment performed.');
}

module.exports = { CACHE, POLICY, FIELDS, stable, assertTarget, inspect, copyInput, execute, client,
    backupName, saveBackup, verifyBackups, prepareRecovery, writeRecovery, main, readJson };
if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
