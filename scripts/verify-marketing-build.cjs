"use strict";
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = path.join(root, 'public-site');
const test = (relative) => fs.existsSync(path.join(site,relative));
const required = ['pages/index.html','pages/advantage.html','pages/capabilities.html','pages/intelligence.html','pages/about.html',
 'pages/partners.html','pages/contact.html','pages/404.html','sitemap.xml','robots.txt','assets/stratops.svg',
 'assets/images/web/stratops-aircraft-telemetry.webp','assets/images/web/stratops-orbital-tracking.webp',
 'assets/fonts/stratops/stratops-icon-font.woff'];
let errors = [];
for (const rel of required) if (!test(rel)) errors.push('Missing marketing artifact: public-site/'+rel);
if (!fs.existsSync(path.join(site,'assets'))) errors.push('Marketing assets directory missing');
else {
 const assetNames = fs.readdirSync(path.join(site,'assets'));
 if (!assetNames.some(n => /^site\.[a-f0-9]{8}\.js$/.test(n))) errors.push('Compiled marketing JS missing');
 if (!assetNames.some(n => /^site\.[a-f0-9]{8}\.css$/.test(n))) errors.push('Compiled marketing CSS missing');
}
for(const p of ['pages/index.html','pages/advantage.html','pages/capabilities.html','pages/intelligence.html','pages/about.html','pages/partners.html','pages/contact.html']){
 const filename=path.join(site,p);
 if (!fs.existsSync(filename)) continue;
 const content=fs.readFileSync(filename,'utf8');
 if (/\<\%[=-]?|\{\{NAV_/.test(content)) errors.push('Unresolved template in '+p);
 if(!/<title>/.test(content) || !/rel="canonical"/.test(content)) errors.push('Missing SEO metadata in '+p);
}
if(!process.argv.includes('--marketing-only') && !fs.existsSync(path.join(root,'production/pages/index.html'))) errors.push('Operational production/pages/index.html is missing');
if(errors.length){errors.forEach(e=>console.error('[build-check] '+e));process.exit(1)}
console.log('[build-check] Marketing pages/ HTML files, assets, icon font and bundled JS/CSS present.');
if(!process.env.STRATOPS_CONTACT_API_URL){
 try{const c=require('../dev/marketing/config/contact.json'); if(!c.contactApiBaseUrl) console.warn('[build-check] Contact form requires AWS API endpoint configuration before live submissions work.')}catch{}
}
