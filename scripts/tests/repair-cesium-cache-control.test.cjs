const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256 } = require('../cesium-assets.cjs');
const { CACHE, POLICY, assertTarget, inspect, copyInput, execute, client, backupName, saveBackup, verifyBackups, prepareRecovery, writeRecovery, main, readJson } = require('../repair-cesium-cache-control.cjs');

function fixture(unversioned = false) {
    const body = Buffer.from('export default 1;');
    const manifest = { baseUrl: '/assets/cesium/releases/test', files: ['Workers/a.js', 'Workers/b.js'].map((path) => ({ path, bytes: body.length, sha256: sha256(body) })) };
    const target = { bucket: unversioned ? 'warzone.battlespacex.com' : 'reviewed-bucket', owner: '123456789012', profile: 'reviewed', distribution: 'TEST123', origin: 'https://staging.example.test' };
    const objects = new Map(manifest.files.map((f) => [`${manifest.baseUrl.slice(1)}/${f.path}`, {
        VersionId: 'v1', ETag: '"original"', ContentType: 'application/javascript', ContentLanguage: 'en',
        ContentDisposition: 'inline', Expires: '2030-01-01T00:00:00+00:00',
        Metadata: { 'checksum-sha256': sha256(body), custom: 'preserve' }, ServerSideEncryption: 'AES256',
        ...(unversioned ? { VersionId: undefined, LastModified: '2026-11-13T00:00:00Z' } : {}) }]));
    const tags = [{ Key: 'release', Value: 'test & preserved' }];
    const behavior = { TargetOriginId: 's3', CachePolicyId: POLICY, Compress: true };
    const distribution = { Id: target.distribution, Status: 'Deployed', DistributionConfig: { Enabled: true,
        Aliases: { Items: ['staging.example.test'] }, Origins: { Items: [{ Id: 's3', DomainName: target.bucket + '.s3.us-east-1.amazonaws.com', S3OriginConfig: {} }] }, DefaultCacheBehavior: behavior } };
    const events = [];
    const api = { target, bucket: () => ({ Bucket: target.bucket, ExpectedBucketOwner: target.owner }),
        bytes: () => Buffer.from(body), lockConfiguration: () => null,
        call(service, operation, input) {
            events.push({ service, operation, input });
            if (operation === 'get-distribution') return { Distribution: distribution };
            if (operation === 'get-cache-policy') return { CachePolicy: { CachePolicyConfig: { MinTTL: 1, DefaultTTL: 86400, MaxTTL: 31536000,
                ParametersInCacheKeyAndForwardedToOrigin: { CookiesConfig: { CookieBehavior: 'none' }, QueryStringsConfig: { QueryStringBehavior: 'none' },
                    HeadersConfig: { HeaderBehavior: 'none' }, EnableAcceptEncodingGzip: true, EnableAcceptEncodingBrotli: true } } } };
            if (operation === 'get-response-headers-policy') return { ResponseHeadersPolicy: { ResponseHeadersPolicyConfig: {
                RemoveHeadersConfig: { Items: [{ Header: 'Cache-Control' }] } } } };
            if (operation === 'get-bucket-ownership-controls') return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
            if (operation === 'get-bucket-versioning') return unversioned ? {} : { Status: 'Enabled' };
            if (operation === 'head-object') return structuredClone(objects.get(input.Key));
            if (operation === 'get-object-tagging') return { TagSet: structuredClone(tags) };
            if (operation === 'copy-object') {
                const head = objects.get(input.Key);
                head.VersionId = unversioned ? undefined : 'v2'; head.CacheControl = input.CacheControl;
                if (unversioned) head.LastModified = '2026-11-13T01:00:00Z';
                return { ...(unversioned ? {} : { VersionId: 'v2' }), CopyObjectResult: { ETag: head.ETag } };
            }
            throw new Error(`Unexpected operation: ${operation}`);
        } };
    api.cached = api.call.bind(api);
    const plan = () => ({ schemaVersion: 1, target, objects: inspect(api, manifest) });
    return { api, target, manifest, objects, tags, behavior, distribution, events, plan };
}

function backedUp(t) {
    const f = fixture(true);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cesium-backup-test-'));
    t.after(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
    const plan = { schemaVersion: 1, target: f.target, mode: 'unversioned', backupDirectory: directory,
        objects: inspect(f.api, f.manifest, true, (row, bytes) => saveBackup(directory, row, bytes)) };
    fs.writeFileSync(path.join(directory, 'original-plan.json'), JSON.stringify(plan));
    return { ...f, original: plan, directory };
}

test('read-only inventory verifies target and bytes; copy preserves metadata, tags, owner and source version', () => {
    const f = fixture(); assertTarget(f.api, f.target, f.manifest.files, f.manifest.baseUrl);
    const p = f.plan(); const input = copyInput(f.api, p.objects[0]);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
    assert.equal(input.CacheControl, CACHE); assert.equal(input.ContentType, 'application/javascript');
    assert.deepEqual(input.Metadata, p.objects[0].properties.Metadata);
    assert.equal(input.ContentDisposition, 'inline'); assert.equal(input.ContentLanguage, 'en');
    assert.equal(input.Expires, p.objects[0].properties.Expires);
    assert.equal(input.ExpectedBucketOwner, f.target.owner); assert.equal(input.ExpectedSourceBucketOwner, f.target.owner);
    assert.equal(input.CopySource, 'reviewed-bucket/assets/cesium/releases/test/Workers/a.js?versionId=v1');
    assert.equal(input.CopySourceIfMatch, '"original"'); assert.equal(input.IfMatch, '"original"'); assert.equal(input.ACL, undefined);
    assert.equal(input.Tagging, 'release=test%20%26%20preserved');
});
test('repair verifies preserved bytes/properties/tags and journals old/new versions', () => {
    const f = fixture(); const p = f.plan(); const journal = [];
    execute(f.api, p, f.plan(), (row) => journal.push(row));
    assert.equal(journal.length, 2); assert.equal(journal[0].originalVersion, 'v1'); assert.equal(journal[0].newVersion, 'v2');
    assert.equal(f.events.filter((e) => e.operation === 'copy-object').length, 2);
});
test('already correct objects are skipped', () => {
    const f = fixture(); for (const head of f.objects.values()) head.CacheControl = CACHE;
    const p = f.plan(); execute(f.api, p, p, () => assert.fail('No mutation expected'));
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('absent and empty custom metadata are equivalent and explicitly preserved', () => {
    const f = fixture(); for (const head of f.objects.values()) delete head.Metadata;
    const p = f.plan(); assert.deepEqual(copyInput(f.api, p.objects[0]).Metadata, {});
    execute(f.api, p, p, () => {});
});
test('changed approved plan or latest version refuses copies', () => {
    const f = fixture(); const p = f.plan(); const changed = structuredClone(p); changed.target.owner = '000000000000';
    assert.throws(() => execute(f.api, changed, p, () => {}), /Plan changed/);
    f.objects.values().next().value.VersionId = 'v2';
    assert.throws(() => execute(f.api, p, p, () => {}), /Object changed/);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('corrupt remote bytes stop preflight without writes', () => {
    const f = fixture(); f.api.bytes = () => Buffer.from('wrong bytes');
    assert.throws(f.plan, /bytes do not match/);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('KMS, retention, replication, encoded content and invalid MIME require separate review', () => {
    for (const patch of [{ ServerSideEncryption: 'aws:kms' }, { ObjectLockMode: 'GOVERNANCE' },
        { ReplicationStatus: 'COMPLETED' }, { ContentEncoding: 'gzip' }, { ContentType: 'text/html' }, { VersionId: 'null' }, { MissingMeta: 1 }]) {
        const f = fixture(); Object.assign(f.objects.values().next().value, patch); assert.throws(f.plan);
    }
});
test('wrong origin, alias, policy, edge associations and response header stripping refuse repair', () => {
    for (const change of [
        (f) => { f.distribution.DistributionConfig.Origins.Items[0].DomainName = 'other-bucket.s3.amazonaws.com'; },
        (f) => { f.distribution.DistributionConfig.Aliases.Items = ['other.example.test']; },
        (f) => { f.behavior.CachePolicyId = 'wrong'; },
        (f) => { f.behavior.FunctionAssociations = { Quantity: 1 }; },
        (f) => { f.behavior.ResponseHeadersPolicyId = 'strips-cache-control'; },
        (f) => { f.distribution.DistributionConfig.CacheBehaviors = { Items: [{ ...f.behavior, PathPattern: '/assets/cesium/*', TargetOriginId: 'missing' }] }; },
    ]) {
        const f = fixture(); change(f);
        assert.throws(() => assertTarget(f.api, f.target, f.manifest.files, f.manifest.baseUrl));
    }
});
test('ACL-enabled, unversioned and locked buckets refuse repair', () => {
    for (const op of ['get-bucket-ownership-controls', 'get-bucket-versioning', 'lock']) {
        const f = fixture(); const call = f.api.call;
        f.api.call = (s, o, i) => o === op ? (o.includes('ownership')
            ? { OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] } } : { Status: 'Suspended' }) : call(s, o, i);
        f.api.cached = f.api.call;
        if (op === 'lock') f.api.lockConfiguration = () => ({ ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } });
        assert.throws(() => assertTarget(f.api, f.target, f.manifest.files, f.manifest.baseUrl));
    }
});
test('post-copy failure is journaled and stops before next object', () => {
    const f = fixture(); const p = f.plan(); const journal = [];
    const call = f.api.call;
    f.api.call = (s, o, i) => {
        const result = call(s, o, i);
        if (o === 'copy-object') f.objects.get(i.Key).Metadata = { lost: 'metadata' };
        return result;
    };
    assert.throws(() => execute(f.api, p, p, (row) => journal.push(row)), /metadata changed/);
    assert.equal(journal.length, 1); assert.equal(f.events.filter((e) => e.operation === 'copy-object').length, 1);
});
test('real AWS adapter rejects every mutation without its execution gate', () => {
    const api = client({ profile: 'unused' });
    for (const [service, op] of [['s3api', 'copy-object'], ['s3api', 'put-object'], ['cloudfront', 'create-invalidation'], ['s3api', 'delete-object']]) {
        assert.throws(() => api.call(service, op, {}), /Unreviewed\/unauthorized/);
    }
});

test('unversioned inspection saves complete verified backups without any AWS mutation', (t) => {
    const f = backedUp(t); assertTarget(f.api, f.target, f.manifest.files, f.manifest.baseUrl, true);
    verifyBackups(f.original);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
    for (const row of f.original.objects) {
        assert.equal(row.VersionId, null); assert.equal(row.originalHead.ServerSideEncryption, 'AES256');
        const request = copyInput(f.api, row);
        assert.equal(request.CopySource.includes('?versionId='), false);
        assert.equal(request.IfMatch, row.ETag); assert.equal(request.CopySourceIfMatch, row.ETag);
        assert.equal(fs.readFileSync(path.join(f.directory, backupName(row))).length, row.bytes);
    }
});
test('unversioned execution requires all backups before first write and journals intent/completion', (t) => {
    const f = backedUp(t); const journal = [];
    const current = { ...f.original, objects: inspect(f.api, f.manifest, true) };
    execute(f.api, f.original, current, (r) => journal.push(r));
    assert.equal(f.events.filter((e) => e.operation === 'copy-object').length, 2);
    assert.equal(journal.length, 6); assert.equal(journal[0].phase, 'intent'); assert.equal(journal[2].phase, 'verified');
});
test('last backup missing or corrupt prevents every unversioned copy', (t) => {
    const f = backedUp(t);
    const last = path.join(f.directory, backupName(f.original.objects.at(-1)));
    fs.writeFileSync(last, 'corrupt');
    assert.throws(() => execute(f.api, f.original, f.original, () => {}), /Backup failed/);
    fs.unlinkSync(last);
    assert.throws(() => execute(f.api, f.original, f.original, () => {}));
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('backup files cannot be overwritten', (t) => {
    const f = backedUp(t); const row = f.original.objects[0];
    assert.throws(() => saveBackup(f.directory, row, Buffer.from('export default 1;')), /EEXIST/);
});
test('same-ETag metadata/tag changes are rejected immediately before unversioned copy', (t) => {
    const f = backedUp(t); f.objects.values().next().value.Metadata.custom = 'concurrent write';
    assert.throws(() => execute(f.api, f.original, f.original, () => {}), /metadata\/tags changed/);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('changed HEAD during unversioned GET refuses backup', () => {
    const f = fixture(true); f.api.bytes = () => {
        f.objects.values().next().value.LastModified = '2026-11-13T02:00:00Z'; return Buffer.from('export default 1;');
    };
    assert.throws(() => inspect(f.api, f.manifest, true), /changed during backup/);
});
test('interrupted unversioned copy leaves write-ahead intent and stops next object', (t) => {
    const f = backedUp(t); const call = f.api.call; const journal = [];
    f.api.call = (s, o, i) => { const result = call(s, o, i); if (o === 'copy-object') throw new Error('lost response'); return result; };
    assert.throws(() => execute(f.api, f.original, f.original, (row) => journal.push(row)), /lost response/);
    assert.equal(journal.length, 1); assert.equal(journal[0].phase, 'intent');
    assert.equal(f.events.filter((e) => e.operation === 'copy-object').length, 1); verifyBackups(f.original);
});
test('recovery preparation preserves original headers/tags and backup body with destination condition', (t) => {
    const f = backedUp(t); const row = f.original.objects[0];
    f.objects.get(row.Key).CacheControl = CACHE;
    const { input: request, body } = prepareRecovery(f.api, f.original, row.Key);
    assert.equal(request.CacheControl, undefined); assert.equal(request.IfMatch, row.ETag);
    assert.equal(body.path, path.join(f.directory, backupName(row))); assert.equal(request.Body, undefined);
    assert.equal(request.ChecksumSHA256, Buffer.from(row.sha256, 'hex').toString('base64'));
    assert.deepEqual(request.Metadata, row.properties.Metadata);
    assert.equal(request.Tagging, 'release=test%20%26%20preserved');
    assert.equal(f.events.some((e) => e.operation === 'copy-object' || e.operation === 'put-object'), false);
});
test('recovery refuses unexpected contents and uses create-only condition for confirmed missing key', (t) => {
    const f = backedUp(t); const row = f.original.objects[0]; const bytes = f.api.bytes;
    f.api.bytes = () => Buffer.from('unexpected');
    assert.throws(() => prepareRecovery(f.api, f.original, row.Key), /differs/); f.api.bytes = bytes;
    const call = f.api.call;
    f.api.call = (s, o, i) => { if (o === 'head-object') throw new Error('An error occurred (NotFound)'); return call(s, o, i); };
    const { input: request } = prepareRecovery(f.api, f.original, row.Key);
    assert.equal(request.IfNoneMatch, '*'); assert.equal(request.IfMatch, undefined);
    f.api.call = () => { throw new Error('An error occurred (AccessDenied)'); };
    assert.throws(() => prepareRecovery(f.api, f.original, row.Key), /AccessDenied/);
});
test('recovery JSON keeps binary body out of JSON input and binds request/body hashes', (t) => {
    const f = backedUp(t); const row = f.original.objects[0];
    const file = path.join(f.directory, 'recovery.json');
    writeRecovery(file, prepareRecovery(f.api, f.original, row.Key));
    const request = JSON.parse(fs.readFileSync(file)); const receipt = JSON.parse(fs.readFileSync(file + '.body.json'));
    assert.equal(request.Body, undefined); assert.equal(receipt.sha256, row.sha256);
    assert.equal(receipt.requestSha256, sha256(fs.readFileSync(file)));
    assert.equal(sha256(fs.readFileSync(receipt.path)), row.sha256);
    assert.throws(() => writeRecovery(file, prepareRecovery(f.api, f.original, row.Key)), /EEXIST/);
});
test('invalid owner/profile is rejected before backup creation or local/AWS inspection', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cesium-invalid-args-'));
    t.after(() => fs.rmdirSync(directory));
    const backup = path.join(directory, 'backup');
    for (const [owner, profile, error] of [['YOUR_12_DIGIT_BUCKET_OWNER_ID', 'YOUR_APPROVED_AWS_PROFILE', /--owner/],
        ['123456789012', 'YOUR_APPROVED_AWS_PROFILE', /--profile/]]) {
        assert.throws(() => main(['--unversioned', '--dry-run', '--build-dir', path.join(directory, 'missing-build'),
            '--bucket', 'warzone.battlespacex.com', '--owner', owner, '--profile', profile,
            '--distribution', 'E2EFV9935XX3MV', '--origin', 'https://stratops.battlespacex.com',
            '--plan', path.join(directory, 'plan.json'), '--backup-dir', backup]), error);
        assert.equal(fs.existsSync(backup), false);
    }
});
test('an existing backup directory is preserved with a clear fresh-path instruction', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cesium-existing-backup-'));
    const marker = path.join(directory, 'preserve.txt'); fs.writeFileSync(marker, 'existing evidence');
    t.after(() => { fs.unlinkSync(marker); fs.rmdirSync(directory); });
    assert.throws(() => main(['--unversioned', '--dry-run', '--build-dir', path.join(directory, 'missing-build'),
        '--bucket', 'warzone.battlespacex.com', '--owner', '123456789012', '--profile', 'reviewed',
        '--distribution', 'E2EFV9935XX3MV', '--origin', 'https://stratops.battlespacex.com',
        '--plan', path.join(directory, 'plan.json'), '--backup-dir', directory]), /choose a fresh/);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'existing evidence');
});
test('AWS CLI empty success is accepted only for get-bucket-versioning', () => {
    const api = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout: '', stderr: '' }));
    assert.deepEqual(api.call('s3api', 'get-bucket-versioning', { Bucket: 'warzone.battlespacex.com' }), {});
    for (const [service, op] of [['cloudfront', 'get-distribution'], ['s3api', 'head-object'], ['s3api', 'get-object-lock-configuration'], ['s3api', 'get-object-tagging']]) {
        assert.throws(() => api.call(service, op, {}), (e) => e.message.includes(`aws ${service} ${op}`) && /Empty JSON/.test(e.message));
    }
});
test('target preflight works through the actual CLI adapter with a blank unversioned result', () => {
    const f = fixture(true);
    const api = client(f.target, (_name, args) => {
        const [service, op] = args.slice(3, 5);
        const input = JSON.parse(args[args.indexOf('--cli-input-json') + 1]);
        if (op === 'get-bucket-versioning') return { status: 0, stdout: '', stderr: '' };
        if (op === 'get-object-lock-configuration') return { status: 254, stdout: '', stderr: 'An error occurred (ObjectLockConfigurationNotFoundError)' };
        return { status: 0, stdout: JSON.stringify(f.api.call(service, op, input)), stderr: '' };
    });
    assertTarget(api, f.target, f.manifest.files, f.manifest.baseUrl, true);
    assert.equal(f.events.some((e) => e.operation === 'copy-object'), false);
});
test('malformed CLI JSON names the command/resource but never logs response or input secrets', () => {
    const secret = 'DO_NOT_EXPOSE_CREDENTIAL';
    const api = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout: '{"secret":"' + secret, stderr: '' }));
    assert.throws(() => api.call('s3api', 'head-object', { Bucket: 'warzone.battlespacex.com', Key: 'assets/cesium/releases/test/Workers/a.js', Metadata: { secret } }),
        (e) => /Malformed JSON/.test(e.message) && /aws s3api head-object/.test(e.message)
            && /bucket=warzone.battlespacex.com/.test(e.message) && /Workers\/a.js/.test(e.message) && !e.message.includes(secret));
});
test('permission denied never becomes an empty successful versioning result', () => {
    for (const status of [0, 254]) {
        const secret = 'AWS_SECRET_ACCESS_KEY=DO_NOT_EXPOSE';
        const api = client({ profile: 'stratops-repair' }, () => ({ status, stdout: '', stderr: `An error occurred (AccessDenied): ${secret}` }));
        assert.throws(() => api.call('s3api', 'get-bucket-versioning', {}), (e) => /aws s3api get-bucket-versioning/.test(e.message)
            && /AccessDenied/.test(e.message) && !e.message.includes(secret));
    }
});
test('wrong JSON root or absent required response fields fail closed', () => {
    for (const stdout of ['null', '[]', '"text"', '{}', '{"Distribution":null}']) {
        const api = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout, stderr: '' }));
        assert.throws(() => api.call('cloudfront', 'get-distribution', {}), /aws cloudfront get-distribution/);
    }
    const api = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout: '{"Code":"AccessDenied","Message":"PRIVATE"}', stderr: '' }));
    assert.throws(() => api.call('s3api', 'get-bucket-versioning', {}), (e) => /error object/.test(e.message) && !e.message.includes('PRIVATE'));
    for (const stdout of ['{"Status":null}', '{"Status":"Disabled"}', '{"unexpected":"value"}']) {
        const bad = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout, stderr: '' }));
        assert.throws(() => bad.call('s3api', 'get-bucket-versioning', {}), /Invalid JSON response shape/);
    }
});
test('CLI startup failure names command without exposing raw process error', () => {
    const api = client({ profile: 'stratops-repair' }, () => ({ status: null, error: { code: 'ENOENT', message: 'PRIVATE PROCESS DETAIL' } }));
    assert.throws(() => api.call('s3api', 'get-bucket-versioning', {}), (e) => /AWS CLI unavailable/.test(e.message)
        && /aws s3api get-bucket-versioning/.test(e.message) && !e.message.includes('PRIVATE'));
});
test('valid CLI JSON and BOM are accepted; arbitrary metadata is not treated as an error', () => {
    const api = client({ profile: 'stratops-repair' }, () => ({ status: 0, stdout: '\uFEFF{"ETag":"test","Metadata":{"note":"AccessDenied"}}', stderr: '' }));
    assert.equal(api.call('s3api', 'head-object', {}).Metadata.note, 'AccessDenied');
});
test('empty/malformed/missing local JSON names the exact file and omits its contents', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cesium-json-error-'));
    const file = path.join(directory, 'original-plan.json');
    t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(directory); });
    for (const value of ['', '{"private":"DO_NOT_EXPOSE']) {
        fs.writeFileSync(file, value);
        assert.throws(() => readJson(file), (e) => e.message.includes(file) && !e.message.includes('DO_NOT_EXPOSE'));
    }
    fs.unlinkSync(file); assert.throws(() => readJson(file), (e) => e.message.includes(file) && /ENOENT/.test(e.message));
});
test('get-object uses explicit flags, preserves conditions and keeps Windows outfile as one final argument', () => {
    let captured;
    const api = client({ profile: 'stratops-repair' }, (name, args, options) => {
        captured = { name, args, options }; return { status: 0, stdout: '{"ETag":"test"}', stderr: '' };
    });
    const destination = path.resolve('Windows temporary folder with spaces', 'download.bin');
    const input = { Bucket: 'warzone.battlespacex.com', ExpectedBucketOwner: '123456789012',
        Key: 'assets/cesium/releases/test/Assets/approximateTerrainHeights.json', IfMatch: '"quoted-etag"', VersionId: 'version+with/slash=' };
    api.call('s3api', 'get-object', input, destination);
    assert.equal(captured.name, 'aws'); assert.equal(captured.options.shell, false);
    assert.equal(captured.args.includes('--cli-input-json'), false);
    for (const [field, flag] of Object.entries({ Bucket: '--bucket', Key: '--key', ExpectedBucketOwner: '--expected-bucket-owner', IfMatch: '--if-match', VersionId: '--version-id' })) {
        assert.equal(captured.args[captured.args.indexOf(flag) + 1], input[field]);
    }
    assert.equal(captured.args.at(-1), destination);
    assert.equal(captured.args.filter((arg) => arg === destination).length, 1);
    assert.equal(captured.args[captured.args.indexOf('--profile') + 1], 'stratops-repair');
});
test('get-object download reads the output file unchanged and removes only its temporary files', () => {
    const body = Buffer.from([0, 255, 13, 10, 32, 34, 123, 125]); let destination;
    const api = client({ profile: 'stratops-repair' }, (_name, args) => {
        destination = args.at(-1); assert.equal(fs.existsSync(path.dirname(destination)), true);
        fs.writeFileSync(destination, body); return { status: 0, stdout: '{"ETag":"test"}', stderr: '' };
    });
    assert.deepEqual(api.bytes({ Bucket: 'warzone.battlespacex.com', Key: 'assets/cesium/releases/test/Assets/approximateTerrainHeights.json', IfMatch: '"etag"' }), body);
    assert.equal(fs.existsSync(destination), false); assert.equal(fs.existsSync(path.dirname(destination)), false);
});
test('get-object rejects missing destination or unreviewed parameters before invoking CLI', () => {
    const api = client({ profile: 'stratops-repair' }, () => assert.fail('CLI must not run'));
    const input = { Bucket: 'warzone.battlespacex.com', Key: 'assets/cesium/releases/test/a.js' };
    assert.throws(() => api.call('s3api', 'get-object', input), /output filename/);
    assert.throws(() => api.call('s3api', 'get-object', { ...input, Unexpected: 'value' }, 'output'), /Unreviewed get-object parameter/);
});
test('exit 252 identifies missing CLI flags without exposing raw diagnostics or credentials', () => {
    const api = client({ profile: 'stratops-repair' }, () => ({ status: 252, stdout: '',
        stderr: 'aws: [ERROR]: An error occurred (ParamValidation): the following arguments are required: --bucket, --key\nSECRET_CREDENTIAL_VALUE' }));
    assert.throws(() => api.call('s3api', 'get-object', { Bucket: 'warzone.battlespacex.com', Key: 'assets/cesium/releases/test/Assets/approximateTerrainHeights.json' }, 'output with spaces'),
        (e) => /CLI argument validation failed; missing required --bucket, --key/.test(e.message)
            && /aws s3api get-object/.test(e.message) && /approximateTerrainHeights.json/.test(e.message)
            && /outfile=/.test(e.message) && !e.message.includes('SECRET_CREDENTIAL_VALUE') && !e.message.includes('transport failure'));
});
test('unknown-option and invalid-value diagnostics omit argument values', () => {
    for (const stderr of ['Unknown options: --bad-option, SECRET_VALUE', 'Error parsing parameter: SECRET_VALUE']) {
        const api = client({ profile: 'stratops-repair' }, () => ({ status: 252, stdout: '', stderr }));
        assert.throws(() => api.call('s3api', 'get-bucket-versioning', {}), (e) => /CLI argument validation failed/.test(e.message)
            && !e.message.includes('SECRET_VALUE'));
    }
});
