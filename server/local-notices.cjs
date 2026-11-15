// Serve the current local API module, rather than falling through to an older remote API.
function mountLocalNotices(app, options = {}) {
    const local = require('express')();
    local.disable('x-powered-by');
    let ready=null,service=null,disposed=false;
    const load=options.load || (()=>import('../apps/api/src/routes.notices.js'));
    const ensure=()=>ready ||= load().then(({noticesRouter,createNoticeService})=>{
        if(disposed)return null;
        service=options.service || createNoticeService({env:options.env || process.env});return noticesRouter(service);
    }).catch(()=>null);
    local.use((req,res,next) => ensure().then(router=>router&&!disposed?router(req,res,next):res.status(503).json({error:'Local notice service unavailable',state:'unavailable'}))
        .catch(()=>res.status(503).json({error:'Local notice service unavailable',state:'unavailable'})));
    app.use('/api/notices',local);
    return ()=>{disposed=true;service?.dispose?.();};
}
module.exports = {mountLocalNotices};
