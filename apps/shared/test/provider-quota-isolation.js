// Test preload only: each fixture owns a fresh ledger, never a developer's cache.
import {beforeEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
beforeEach(()=>{
    process.env.PROVIDER_QUOTA_STORE='file';
    process.env.PROVIDER_QUOTA_DIRECTORY=fileURLToPath(new URL('../../../.generated/quota-tests/'+randomUUID()+'/',import.meta.url));
});
