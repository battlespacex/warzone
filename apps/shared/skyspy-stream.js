import {skySpyOrigin} from './skyspy-client.js';

// Server-side only. Native WebSocket JSON actions are never sent to Socket.IO.
export function createSkySpyStream({enabled=false,usageApproved=false,baseUrl='',allowedHosts=[],token='',
    transport='native',topics=['aircraft'],createWebSocket,createSocketIO,onEvent=()=>{},
    setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,random=Math.random}={}) {
    let socket=null,reconnect=null,heartbeat=null,stopped=true,attempt=0,lastMessage=0,state='disabled',generation=0;
    const supported=['aircraft','notams','airspace'];
    if(topics.some(topic=>!supported.includes(topic)))throw Error('Unsupported SkySpy topic');
    function stopTimers(){clearTimer(reconnect);clearTimer(heartbeat);reconnect=heartbeat=null;}
    function scheduleHeartbeat(current){heartbeat=setTimer(()=>{
        if(stopped||current!==generation)return;
        if(now()-lastMessage>90000){socket?.close?.();socket?.disconnect?.();return;}
        if(transport==='native')socket?.send(JSON.stringify({action:'ping'}));else socket?.emit('ping',{timestamp:now()});
        scheduleHeartbeat(current);
    },30000);heartbeat?.unref?.();}
    function connect(){
        if(stopped)return;const current=++generation;state='connecting';
        const origin=skySpyOrigin(baseUrl,allowedHosts);
        const receive=(type,data)=>{if(stopped||current!==generation)return;lastMessage=now();if(type==='pong'||supported.some(topic=>type?.startsWith(topic+':')))attempt=0;
            if(type==='batch'){for(const item of (data?.messages||[]).slice(0,500))receive(item.type,item.data);return;}
            if(typeof type==='string'&&supported.some(topic=>type.startsWith(topic+':'))){try{onEvent(type,data);}catch{state='invalid-payload';}}};
        const closed=(code,retryMs=0)=>{if(stopped||current!==generation)return;generation++;stopTimers();state=[4001,4003,1008].includes(code)?'authentication-denied':'disconnected';
            if(state==='authentication-denied')return;
            const delay=Math.max(retryMs,Math.min(60000,1000*2**Math.min(attempt++,6))*(.75+random()*.5));
            reconnect=setTimer(connect,delay);reconnect?.unref?.();};
        const opened=()=>{if(stopped||current!==generation)return;state='connected';lastMessage=now();
            if(transport==='native')socket.send(JSON.stringify({action:'subscribe',topics}));else socket.emit('subscribe',{topics});
            scheduleHeartbeat(current);};
        try{
            if(transport==='native'){
                if(!createWebSocket)throw Error('Native transport unavailable');
                const url=new URL('/ws/all/',origin);url.protocol='wss:';
                socket=createWebSocket(url.href,token?['Bearer',token]:[]);
                socket.on?.('unexpected-response',(_request,response)=>{
                    const header=response.headers?.['retry-after'],seconds=Number(header),retry=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(header)-now())||0;
                    closed([401,403].includes(response.statusCode)?4001:undefined,Math.min(7*86400000,Math.max(response.statusCode===429?60000:0,retry)));
                    response.resume?.();socket?.terminate?.();
                });
                socket.onopen=opened;socket.onclose=event=>closed(event.code);socket.onerror=()=>{if(current===generation)socket?.close?.();};
                socket.onmessage=event=>{if(typeof event.data!=='string'||event.data.length>1e6)return;
                    try{const message=JSON.parse(event.data);receive(message.type,message.type==='batch'?message:message.data);}catch{state='invalid-payload';}};
            }else if(transport==='socketio'){
                if(!createSocketIO||topics.some(t=>t!=='aircraft'))throw Error('Socket.IO capability unavailable');
                socket=createSocketIO(origin.origin,{path:'/socket.io',auth:token?{token}:{},reconnection:false,autoConnect:false,transports:['websocket']});
                socket.on('connect',opened);socket.on('disconnect',()=>closed());
                socket.on('connect_error',error=>{closed([401,403].includes(Number(error?.data?.code))?4001:undefined);socket.disconnect();});
                for(const name of ['snapshot','update','new','remove','delta','heartbeat'])socket.on('aircraft:'+name,data=>receive('aircraft:'+name,data));
                socket.on('pong',()=>{lastMessage=now();});socket.connect();
            }else throw Error('Explicit supported transport required');
        }catch{state='unavailable';stopped=true;stopTimers();}
    }
    return {start(){if(!enabled||!usageApproved||!stopped)return;stopped=false;connect();},
        stop(){stopped=true;generation++;stopTimers();socket?.close?.();socket?.disconnect?.();socket=null;state='stopped';},
        diagnostics:()=>({state,transport,attempt,lastMessageAt:lastMessage?new Date(lastMessage).toISOString():null})};
}
