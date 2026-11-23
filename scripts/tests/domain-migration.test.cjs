const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),domains=require('../../apps/shared/stratops-domains.json');
test('operational metadata and public metadata identify their own origins',()=>{
 assert.equal(require('../../seo/site.js').baseUrl,domains.portalOrigin);assert.match(require('../../seo/pages.js').index.robots,/noindex/);
 const marketing=require('../../webpack.marketing.config.cjs')({}, {mode:'production'});assert.equal(marketing.output.path,path.join(root,'public-site'));assert.notEqual(marketing.entry,path.join(root,'dev/assets/js/index.js'));
 assert.match(read('dev/marketing/pages/index.html'),/domains\.publicOrigin/);assert.match(read('dev/marketing/pages/index.html'),/domains\.portalOrigin/);
});

test('default development opens marketing while the original portal launcher remains available',()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.equal(scripts.dev,'node scripts/dev.cjs --site');
 assert.equal(scripts['dev:marketing'],'node scripts/dev.cjs --config webpack.marketing.config.cjs');
 assert.equal(scripts['dev:app'],'node scripts/dev.cjs');
 const config=require('../../webpack.marketing.config.cjs')({}, {mode:'development'});
 assert.equal(config.devServer.port,4174);assert.deepEqual(config.devServer.open.target,['/']);
 assert.deepEqual(config.devServer.client.overlay,{errors:true,warnings:false,runtimeErrors:true});
 assert.equal(config.performance.hints,'warning','size warnings must remain visible in build output');
 assert.equal(config.module.rules[0].use[0],'style-loader');
 assert.equal(config.output.filename,'assets/site.js');
 assert.equal(config.devServer.hot,true);assert.equal(config.devServer.headers['Cache-Control'],'no-store');
 assert.ok(config.watchOptions,'marketing must use the existing local/network watch policy');
 const production=require('../../webpack.marketing.config.cjs')({}, {mode:'production'});
 assert.notEqual(production.module.rules[0].use[0],'style-loader');
 assert.match(production.output.filename,/contenthash/);
 const devPage = config.plugins.find(plugin => plugin.constructor.name === 'HtmlWebpackPlugin');
 const prodPage = production.plugins.find(plugin => plugin.constructor.name === 'HtmlWebpackPlugin');
 assert.equal(devPage.userOptions.templateParameters().domains.portalOrigin, 'http://localhost:4173');
 assert.equal(prodPage.userOptions.templateParameters().domains.portalOrigin, domains.portalOrigin);
 assert.equal(domains.portalOrigin,'https://app.stratops.space','development must not mutate the shared production contract');
});
test('direct portal startup opens the original consent modal without running showcase or granting consent',()=>{
 assert.match(read('dev/assets/js/index.js'),/initStratopsIntro\(\{ skipPreEntryShowcase: true \}\)/);
 const src=read('dev/assets/js/essential.js'),block=src.slice(src.indexOf('    if (!skipPreEntryShowcase &&'),src.indexOf('\n}\n',src.indexOf('    if (!skipPreEntryShowcase &&')));
 let opened=0,showcase=0,classes=[];vm.runInNewContext(block,{skipPreEntryShowcase:true,openImmediately:true,isStratOpsFeatureEnabled:()=>true,initPreEntryShowcase:()=>showcase++,openEntryIntroModal:()=>opened++,document:{body:{classList:{add:c=>classes.push(c)}}}});
 assert.equal(opened,1);assert.equal(showcase,0);assert.deepEqual(classes,['wz-pre-entry-complete']);assert.ok(!/checkbox|checked\s*=|acceptBtn\.click|__warzoneShowRegionModal/.test(block));
});
test('load runners reject all current production domains as well as retired domain',()=>{
 const {validateConfig}=require('../gnss-load-test.cjs');const example=JSON.parse(read('scripts/gnss-load-test.example.json'));
 for(const origin of [domains.portalOrigin,domains.publicOrigin,'https://www.stratops.space',domains.retiredOrigin])assert.throws(()=>validateConfig({...example,baseUrl:origin}),/production|permitted/i);
});
test('marketing runtime has no operational imports, API calls or recurring timers',()=>{
 const src=read('dev/marketing/assets/js/site.js');assert.doesNotMatch(src,/\bfetch\s*\(|\bsetInterval\s*\(|Cesium|supabase|warzone-globe/);
 assert.match(src,/prefers-reduced-motion/);assert.match(src,/saveData/);
 assert.match(read('dev/marketing/assets/js/contact.js'),/\/challenge/);
});

test('public www redirect keeps paths and repeated encoded query values and leaves the portal alone',()=>{
 const context=vm.createContext({});vm.runInContext(read('scripts/cloudfront/public-www-redirect.js'),context);
 const request={uri:'/research',headers:{host:{value:'www.stratops.space'}},querystring:{q:{multiValue:[{value:'a%20b'},{value:'c%26d'}]}}};
 const response=context.handler({request});assert.equal(response.statusCode,301);assert.equal(response.headers.location.value,'https://stratops.space/research?q=a%20b&q=c%26d');
 request.headers.host.value='app.stratops.space';assert.equal(context.handler({request}),request);
});
