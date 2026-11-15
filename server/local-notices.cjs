// Serve the current local API module, rather than falling through to an older remote API.
function mountLocalNotices(app, options = {}) {
    const local = require('express')();
    local.disable('x-powered-by');
    const ready = import('../apps/api/src/routes.notices.js').then(({noticesRouter,createNoticeService}) =>
        noticesRouter(options.service || createNoticeService({env:options.env || process.env}))).catch(()=>null);
    local.use((req,res,next) => ready.then(router=>router?router(req,res,next):res.status(503).json({error:'Local notice service unavailable',state:'unavailable'}))
        .catch(()=>res.status(503).json({error:'Local notice service unavailable',state:'unavailable'})));
    app.use('/api/notices',local);
}
module.exports = {mountLocalNotices};
