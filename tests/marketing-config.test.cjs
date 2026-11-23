'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const project=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(project,'webpack.marketing.config.cjs'),'utf8');
class FakePlugin { constructor(options){ this.options=options; } }
function stubRequire(name){
 if(name==='node:path') return path;
 if(name==='node:fs') return fs;
 if(name==='webpack') return {DefinePlugin:FakePlugin};
 if(['html-webpack-plugin','copy-webpack-plugin','mini-css-extract-plugin','css-minimizer-webpack-plugin'].includes(name)){
  if(name==='mini-css-extract-plugin') FakePlugin.loader='fake-mini-css-loader';
  return FakePlugin;
 }
 if(name==='./apps/shared/stratops-domains.json')return {publicOrigin:'https://stratops.space',portalOrigin:'https://app.stratops.space'};
 if(name==='./dev/marketing/config/contact.json')return {contactApiBaseUrl:''};
 if(name==='./scripts/dev-environment.cjs')return {getDevelopmentEnvironment:()=>({watchOptions:{}})};
 throw Error('Unexpected require: '+name);
}
const context={module:{exports:{}},require:stubRequire,__dirname:project,process:{env:{}},console};
vm.runInNewContext(source,context,{filename:'webpack.marketing.config.cjs'});
const make=context.module.exports;
test('production output remains separate from operational application',()=>{
 const config=make({}, {mode:'production'});
 assert.equal(config.output.path,path.join(project,'public-site'));
 assert.equal(config.entry,path.join(project,'dev/marketing/assets/js/site.js'));
 const plugins=config.plugins.map(p=>p.options);
 const pages=plugins.filter(p=>p && p.filename && p.template);
 assert.deepEqual(Array.from(pages.map(p=>p.filename)),['index.html','capabilities/index.html','intelligence/index.html','about/index.html','contact/index.html','404.html']);
 const copies=plugins.find(p=>p && p.patterns)?.patterns || [];
 assert.ok(copies.some(p=>p.from==='dev/assets/fonts/stratops' && p.to==='assets/fonts/stratops'));
 assert.ok(copies.some(p=>p.from==='dev/marketing/seo/sitemap.xml'));
});
test('partials resolve the original portal URL and current nav state',()=>{
 const cfg=make({}, {mode:'production'});
 const plugins=cfg.plugins.map(p=>p.options);
 const contact=plugins.find(p=>p && p.filename==='contact/index.html');
 const params=contact.templateParameters();
 const header=params.partials('header');
 const footer=params.partials('footer');
 assert.match(header,/href="https:\/\/app\.stratops\.space\/"/);
 assert.match(header,/href="\/contact\/" aria-current="page"/);
 assert.match(footer,/href="\/capabilities\/\#sea"/);
 assert.ok(!header.includes('{{NAV_'));
 const home=plugins.find(p=>p && p.filename==='index.html').templateParameters();
 assert.match(home.partials('footer'),/href="\#domains"/);
});
test('marketing dev-server retains 4174 and clean URL rewrites',()=>{
 const cfg=make({}, {mode:'development'});
 assert.equal(cfg.devServer.port,4174);
 for(const item of ['capabilities','intelligence','about','contact']){
  const match=cfg.devServer.historyApiFallback.rewrites.find(r=>r.from.test('/'+item+'/'));
  assert.equal(match.to,'/'+item+'/index.html');
 }
});
