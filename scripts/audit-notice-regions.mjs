import fs from 'node:fs/promises';
import {noticeGeometryClassification,noticeStatus} from '../apps/shared/geospatial-notices.js';

// Read-only API audit: never reads provider credentials or connects directly to providers.
const base=process.argv[2]||process.env.STRATOPS_API_BASE_URL||'https://api.battlespacex.com';
const regions={
    'United States':[-125,24,-66,50], 'Western Europe':[-12,35,20,62],
    'Eastern Europe':[20,35,45,62], 'Middle East':[30,12,63,42], 'South Asia':[60,5,93,37],
};
const report={measuredAt:new Date().toISOString(),scope:'Explicit diagnostic bounding boxes, not country borders',regions:[]};
for(const [region,[minLon,minLat,maxLon,maxLat]] of Object.entries(regions)) {
    const records=new Map();let offset=0,total=null,state=null,partial=false,server=null,error=null;
    try {
        while(true) {
            const url=new URL(base.replace(/\/$/,'')+'/notices');
            url.search=new URLSearchParams({minLon,minLat,maxLon,maxLat,layers:'aviation-notam',status:'all',military:'all',offset,limit:200});
            const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
            if(!response.ok)throw Error('HTTP '+response.status);
            if(!/json/.test(response.headers.get('content-type')||''))throw Error('Non-JSON response');
            const data=await response.json();if(!Array.isArray(data.notices))throw Error('Notice schema unavailable');
            state=data.state;server=data.diagnostics||null;partial ||= data.partial===true;total=data.total;
            const previous=records.size;for(const n of data.notices)records.set(n.id,n);
            if(!data.notices.length||offset+data.notices.length>=total)break;
            if(records.size===previous||offset>=4800){partial=true;break;}
            offset+=data.notices.length;
        }
    }catch(e){error=e.message.startsWith('HTTP ')?e.message:'API unavailable or incompatible';}
    const rows=[...records.values()],matched=rows.filter(n=>['active','upcoming','unknown'].includes(noticeStatus(n)));
    report.regions.push({region,state,error,partial,bounds:{minLon,minLat,maxLon,maxLat},
        recordsReceived:error?null:rows.length,recordsFilteredOut:error?null:rows.length-matched.length,
        recordsWithGeometry:error?null:matched.filter(n=>n.geometry).length,
        geometry:error?null:Object.fromEntries(['Published boundary','Derived boundary','Approximate coverage','Location only','Unavailable'].map(kind=>[kind,matched.filter(n=>noticeGeometryClassification(n)===kind).length])),
        rendered:null,server,note:'Rendered counts require the browser __stratopsNoticeDiagnostics() probe; no GPU rendering is measured here.'});
}
await fs.mkdir('.generated',{recursive:true});
await fs.writeFile('.generated/notam-regions-audit.json',JSON.stringify(report,null,2)+'\n');
console.table(report.regions.map(({region,error,recordsReceived,recordsFilteredOut,recordsWithGeometry,rendered})=>({region,error,recordsReceived,recordsFilteredOut,recordsWithGeometry,rendered})));
