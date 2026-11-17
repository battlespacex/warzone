// Backend only. No network or environment loading occurs at import time.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const fingerprint = value => createHash('sha256').update(String(value)).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const defaultDirectory = fileURLToPath(new URL('../worker/.cache/provider-quota/', import.meta.url));

export function createFileQuotaStore(directory = defaultDirectory) {
    return {kind:'file', async transact(key, update) {
        await fs.mkdir(directory, {recursive:true});
        const file = path.join(directory, fingerprint(key)+'.json'), lock = file+'.lock';
        let acquired = false;
        for(let attempt=0;attempt<100;attempt++) {
            try {await fs.mkdir(lock); acquired=true; break;}
            catch(error) {if(error.code!=='EEXIST')throw error; await pause(20);}
        }
        // Do not guess whether another process is dead and steal its lock.
        if(!acquired)throw Error('Quota store locked; request held');
        try {
            let state = {};
            try {state=JSON.parse(await fs.readFile(file,'utf8'));}
            catch(error) {if(error.code!=='ENOENT')throw error;}
            const result=update(state);
            const temporary=file+'.'+randomUUID()+'.tmp';
            const handle=await fs.open(temporary,'wx',0o600);
            try{await handle.writeFile(JSON.stringify(state));await handle.sync();}finally{await handle.close();}
            await fs.rename(temporary,file);
            return result;
        } finally {await fs.rmdir(lock);}
    }};
}

export function createSupabaseQuotaStore({url,key,fetchImpl=globalThis.fetch}) {
    async function rpc(name,args) {
        const response=await fetchImpl(url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{
            method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
            body:JSON.stringify(args),signal:AbortSignal.timeout(5000),redirect:'error'
        });
        if(!response.ok)throw Error('Shared quota store unavailable; request held');
        return response.json();
    }
    return {kind:'supabase',async transact(key,update) {
        const id=fingerprint(key);
        for(let attempt=0;attempt<80;attempt++) {
            const snapshot=await rpc('stratops_quota_read',{p_key:id});
            const state=snapshot.state || {},result=update(state);
            if(await rpc('stratops_quota_cas',{p_key:id,p_version:snapshot.version,p_state:state}))return result;
            await pause(10+Math.random()*30);
        }
        throw Error('Shared quota contention; request held');
    }};
}

let selectedStore,selectedSignature;
export function getQuotaStore(env=process.env) {
    env={...process.env,...env};
    const mode=env.PROVIDER_QUOTA_STORE || (env.NODE_ENV==='production'?'supabase':'file');
    const signature=[mode,env.PROVIDER_QUOTA_DIRECTORY,env.SUPABASE_URL, fingerprint(env.SUPABASE_SERVICE_ROLE_KEY || '')].join('|');
    if(selectedStore&&selectedSignature===signature)return selectedStore;
    if(mode==='supabase') {
        if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Shared quota configuration missing; request held');
        selectedStore=createSupabaseQuotaStore({url:env.SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY});
    } else if(mode==='file')selectedStore=createFileQuotaStore(env.PROVIDER_QUOTA_DIRECTORY);
    else throw Error('Invalid PROVIDER_QUOTA_STORE');
    selectedSignature=signature;
    return selectedStore;
}
