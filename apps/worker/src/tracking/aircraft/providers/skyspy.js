import WebSocket from 'ws';
import {createSkySpyClient} from '../../../../../shared/skyspy-client.js';
import {createSkySpyStream} from '../../../../../shared/skyspy-stream.js';
import {normalizeReadsbAircraft} from './readsb.js';
import {ProviderRequestError} from '../../http.js';

export function createSkySpyAircraftProvider({env={},fetchImpl,now=Date.now,createSocketIO,
    createWebSocket=(url,protocols)=>new WebSocket(url,protocols,{maxPayload:1e6,handshakeTimeout:15000})}={}) {
    const enabled=env.SKYSPY_ENABLED==='true'&&env.SKYSPY_AIRCRAFT_ENABLED==='true'&&env.SKYSPY_USAGE_APPROVED==='true';
    const options={enabled,usageApproved:env.SKYSPY_USAGE_APPROVED==='true',baseUrl:env.SKYSPY_BASE_URL,
        apiKey:env.SKYSPY_API_KEY,allowedHosts:String(env.SKYSPY_ALLOWED_HOSTS||'').split(','),fetchImpl,now};
    const client=createSkySpyClient(options),streamRows=new Map();let started=false,rejected=0,socketFactory=createSocketIO;
    function normalize(row,stamp){
        if(!row||typeof row!=='object')return null;
        const at=Number(stamp)<1e12?Number(stamp)*1000:Number(stamp);
        if(!Number.isFinite(at)||at>now()+60000||now()-at>300000)return null;
        const record=normalizeReadsbAircraft({...row,t:row.type??row.t,alt_baro:row.alt??row.alt_baro,mil:false},{source:'skyspy',militaryHint:false,now:at});
        if(!record.icao24||!Number.isFinite(record.latitude)||!Number.isFinite(record.longitude)||Math.abs(record.latitude)>90||Math.abs(record.longitude)>180)return null;
        return {...record,military_hint:false,metadata:{attribution:'SkySpy',provider_military_claim:row.military===true||row.is_military===true}};
    }
    const stream=createSkySpyStream({...options,token:env.SKYSPY_API_KEY,transport:env.SKYSPY_TRANSPORT||'native',
        enabled:enabled&&env.SKYSPY_STREAM_ENABLED==='true',createWebSocket,createSocketIO:(url,config)=>{if(!socketFactory)throw Error('Socket.IO client unavailable');return socketFactory(url,config);},topics:['aircraft'],
        onEvent(type,data){
            if(type==='aircraft:heartbeat')return;
            if(type==='aircraft:remove'){streamRows.delete(String(data?.hex||'').toLowerCase());return;}
            // Partial delta messages without identity/time/position cannot overwrite a valid observation.
            const collection=Array.isArray(data)?data:Array.isArray(data?.aircraft)?data.aircraft:[data];
            if(type==='aircraft:snapshot')streamRows.clear();
            for(const row of collection.slice(0,2000)){const record=normalize(row,data?.now||Date.parse(data?.timestamp||row?.timestamp));
                if(record){const old=streamRows.get(record.icao24);if(!old||record.observed_at>=old.observed_at)streamRows.set(record.icao24,record);}else rejected++;}
            while(streamRows.size>2000)streamRows.delete(streamRows.keys().next().value);
        }});
    return {id:'skyspy',enabled,minimumIntervalMs:60000,
        async fetchObservations(){if(!enabled)return {observations:[],diagnostics:{enabled:false}};
            if(!started){started=true;
                if(env.SKYSPY_TRANSPORT==='socketio'&&env.SKYSPY_STREAM_ENABLED==='true'&&!socketFactory)try{socketFactory=(await import('socket.io-client')).io;}catch{/* REST continues; transport health reports unavailable. */}
                stream.start();}let rest=[],unavailable=false;
            try{const data=await client.get('/aircraft/',{military:true});if(!Array.isArray(data.aircraft))throw Error('Malformed aircraft list');
                const stamp=data.now||Date.parse(data.timestamp);for(const row of data.aircraft.slice(0,2000)){const record=normalize(row,stamp);if(record)rest.push(record);else rejected++;}
            }catch{unavailable=true;}
            const merged=new Map();for(const row of [...rest,...streamRows.values()]){
                if(now()-Date.parse(row.observed_at)>300000){streamRows.delete(row.icao24);continue;}
                const old=merged.get(row.icao24);if(!old||row.observed_at>old.observed_at)merged.set(row.icao24,row);}
            if(unavailable&&!merged.size){const health=client.diagnostics();throw new ProviderRequestError('SkySpy unavailable',{status:health.lastStatus,code:'SKYSPY_UNAVAILABLE',retryAfterMs:Math.max(0,Date.parse(health.nextRetryAt)-now())});}
            return {observations:[...merged.values()],diagnostics:{...client.diagnostics(),stream:stream.diagnostics(),unavailable,rejected,coverage:'Configured SkySpy receiver/service coverage; not a global guarantee'}};
        },getDiagnostics(){return {...client.diagnostics(),stream:stream.diagnostics(),rejected};},dispose(){stream.stop();streamRows.clear();started=false;}};
}
