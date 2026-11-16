// Serve the current local API module, rather than falling through to an older remote API.
function mountLocalNotices(app, options = {}) {
    const local = require('express')();
    local.disable('x-powered-by');
    // Keep backend-only keys out of webpack's process environment/DefinePlugin.
    const fs=require('node:fs'),path=require('node:path');
    const file=path.join(__dirname,'../apps/worker/.env.local');
    const env=options.env || {...(!['production','test'].includes(process.env.NODE_ENV)&&fs.existsSync(file)?require('dotenv').parse(fs.readFileSync(file)):{}),...process.env};
    let ready=null,service=null,disposed=false;
    let statusReady=null,statusCache=null;
    const load=options.load || (()=>import('../apps/api/src/routes.notices.js'));
    const ensure=()=>ready ||= load().then(({noticesRouter,createNoticeService})=>{
        if(disposed)return null;
        service=options.service || createNoticeService({env});return noticesRouter(service);
    }).catch(()=>null);
    local.use((req,res,next) => ensure().then(router=>router&&!disposed?router(req,res,next):res.status(503).json({error:'Local notice service unavailable',state:'unavailable'}))
        .catch(()=>res.status(503).json({error:'Local notice service unavailable',state:'unavailable'})));
    app.use('/api/notices',local);
    app.get('/api/events/status-feed',async(req,res)=>{
        try{
            statusReady ||= Promise.all([import('../apps/worker/src/status-feed-runner.js'),import('../apps/shared/status-signal-policy.js'),load()]).then(([worker,policy,notices])=>{
                if(disposed)return null;statusCache=options.statusCache || worker.createStatusFeedCache({env});return {policy,notices};
            });
            const modules=await statusReady;if(!modules||disposed)return res.status(503).json({error:'Status cache unavailable'});
            const result=await statusCache.list();let notices=[];
            if(req.query.include_notices==='true'&&['minLat','maxLat','minLon','maxLon'].every(k=>Number.isFinite(Number(req.query[k])))){
                await ensure();try{notices=modules.notices.toNoticeStatusSignals((await service.list({...req.query,military:'all',status:'live'})).notices);}catch{/* Other intelligence remains available. */}
            }
            const items=[...result.items.map(row=>modules.policy.toPublicStatusSignal(row)).filter(Boolean).slice(0,300),...notices];
            res.set('Cache-Control','private, max-age=15').json({items,state:result.state,refreshAfterMs:result.refreshAfterMs});
        }catch{res.status(503).json({error:'Status cache unavailable'});}
    });
    return ()=>{disposed=true;service?.dispose?.();statusCache?.dispose();};
}
module.exports = {mountLocalNotices};
