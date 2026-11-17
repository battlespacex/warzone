import {randomUUID} from 'node:crypto';
import {getQuotaStore,fingerprint} from './provider-quota-store.js';
import {QuotaHeldError} from './provider-quota.js';

// One shared backend ingestion owner, not an invented provider connection quota.
// Existing poll cycles renew ownership. A single expiry timeout closes a socket
// before another owner can take over; there is no additional polling loop.
export function createProviderStreamLease({provider,credential,close,store,ttlMs=90000,now=Date.now,env=process.env}) {
    const owner=randomUUID(),key='stream:'+provider+':'+fingerprint(String(credential).trim());
    let timer=null,released=false;
    const storage=()=>store || getQuotaStore(env);
    return {
        async renew() {
            if(released)throw new QuotaHeldError('stream lease released');
            const until=now()+ttlMs;
            const granted=await storage().transact(key,state=>{
                if(state.owner&&state.owner!==owner&&state.until>now())return false;
                state.owner=owner;state.until=until;return true;
            });
            if(!granted){close();throw new QuotaHeldError('shared stream owned by another ingestion worker',until,now());}
            clearTimeout(timer);timer=setTimeout(()=>{timer=null;close();},ttlMs);timer.unref?.();
        },
        async release() {
            released=true;clearTimeout(timer);timer=null;
            await storage().transact(key,state=>{if(state.owner===owner){delete state.owner;delete state.until;}});
        }
    };
}
