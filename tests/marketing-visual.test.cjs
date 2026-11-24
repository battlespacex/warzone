'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const m=path.join(root,'dev','marketing');
const pages=['index','advantage','capabilities','intelligence','about','partners','contact'];
const read=(name)=>fs.readFileSync(path.join(m,'pages',name+'.html'),'utf8');

test('all public pages have unique h1, canonical, description, Open Graph and schema',()=>{
 for (const name of pages){
   const s=read(name);
   assert.equal((s.match(/<h1\b/g)||[]).length,1,`${name}: h1 count`);
   assert.match(s,/<meta name="description"/);
   assert.match(s,/rel="canonical"/);
   assert.match(s,/property="og:image"/);
   assert.match(s,/<script type="application\/ld\+json">/);
 }
});
test('new pages are included in sitemap, navigation and webpack config',()=>{
 const sitemap=fs.readFileSync(path.join(m,'seo','sitemap.xml'),'utf8');
 const header=fs.readFileSync(path.join(m,'partials','header.html'),'utf8');
 const config=fs.readFileSync(path.join(root,'webpack.marketing.config.cjs'),'utf8');
 const server=fs.readFileSync(path.join(root,'server','serve-public-site.cjs'),'utf8');
 for(const name of ['advantage','partners']){
   assert.ok(sitemap.includes('/'+name+'/'));
   assert.ok(header.includes('href="/'+name+'/"'));
   assert.ok(config.includes("'"+name+"'"));
   assert.ok(server.includes("'"+name+"'"));
 }
});
test('existing project icon font is reused and all editorial cards have image sizes',()=>{
 const js=fs.readFileSync(path.join(m,'assets','js','site.js'),'utf8');
 const css=fs.readFileSync(path.join(m,'assets','css','marketing-refinement.css'),'utf8');
 assert.match(js,/assets\/fonts\/stratops\/style\.css/);
 assert.match(css,/--marketing-logo-initial-height/);
 assert.match(css,/--marketing-logo-scrolled-height/);
 assert.match(css,/max-width:640px/);
 for(const name of ['index','advantage','partners']){
   assert.match(read(name),/IMAGE \/ [A-Z0-9-]+/);
 }
});
test('contact validation form contract not changed',()=>{
 const s=read('contact');
 for(const id of ['stratops-contact-form','contact-name','contact-email','contact-topic','contact-captcha-answer','contact-submit']) assert.ok(s.includes(`id="${id}"`));
});

test('site-wide maximum width, original capabilities chapters and smooth details',()=>{
 const css=fs.readFileSync(path.join(m,'assets/css/marketing-refinement.css'),'utf8');
 const page=read('capabilities');
 const js=fs.readFileSync(path.join(m,'assets/js/site.js'),'utf8');
 assert.match(css,/max-width:2560px/);
 assert.match(css,/\.page-capabilities \.chapter:nth-child\(even\) \.chapter-media/);
 assert.doesNotMatch(css,/3-column intelligence domain catalog/);
 assert.equal((page.match(/class=\"chapter\" id=/g)||[]).length,9);
 assert.equal((page.match(/class=\"mkt-chapter-details-body\"/g)||[]).length,9);
 assert.match(js,/details\.mkt-chapter-details/);
});
test('attribution is on About only and business CTAs use allowed topics',()=>{
 assert.match(read('about'),/id="technology"/);
 assert.match(read('about'),/CesiumJS/);
 assert.match(read('partners'),/id="commercial"/);
 assert.doesNotMatch(read('partners'),/id="technology"/);
 const c=fs.readFileSync(path.join(m,'assets/js/contact.js'),'utf8');
 assert.match(c,/intentChoices/);
 assert.match(read('index'),/Request a product demo/);
});
