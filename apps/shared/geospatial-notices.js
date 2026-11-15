// Published notices are evidence of a notice, never of a nearby military asset.
const text = value => String(value ?? '').replace(/[\u0000-\u001f<>]/g,' ').trim();
export const NOTICE_LAYERS = ['aviation-notam','airspace-tfr','naval-warnings','military-exercises'];
export function matchesNoticeLayers(n,layers) {
    return (layers.includes('aviation-notam')&&n.noticeType==='notam')||(layers.includes('airspace-tfr')&&['tfr','airspace'].includes(n.noticeType))
        ||(layers.includes('naval-warnings')&&['navarea','maritime','mariners','coastal'].includes(n.noticeType))
        ||(layers.includes('military-exercises')&&n.isMilitaryRelated&&(n.noticeType==='exercise'||/exercise|firing|missile|rocket|weapon/i.test(n.activityType)));
}
export function coordinate(degrees,minutes=0,seconds=0,hemisphere='N') {
    const max=/[NS]/i.test(hemisphere)?90:180;
    if(![degrees,minutes,seconds].every(Number.isFinite)||degrees<0||minutes<0||minutes>=60||seconds<0||seconds>=60)throw Error('Invalid coordinate');
    const value=degrees+minutes/60+seconds/3600;if(value>max)throw Error('Coordinate out of range');
    return /[SW]/i.test(hemisphere)?-value:value;
}
export function parseCoordinates(raw='') {
    const points=[];
    // Separated DMS, degrees/decimal minutes and decimal degrees; axis order is explicit.
    const separated=/(?<![\d.])(\d{1,2}(?:\.\d+)?)\s*[°:\s-]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′:]?\s*(?:(\d{1,2}(?:\.\d+)?)\s*["″]?)?)?\s*([NS])\s*[, /-]*\s*(\d{1,3}(?:\.\d+)?)\s*[°:\s-]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′:]?\s*(?:(\d{1,2}(?:\.\d+)?)\s*["″]?)?)?\s*([EW])/gi;
    for(const m of raw.matchAll(separated))points.push([coordinate(+m[5],+(m[6]||0),+(m[7]||0),m[8]),coordinate(+m[1],+(m[2]||0),+(m[3]||0),m[4])]);
    if(points.length)return points;
    const decimal=/(?<![\d.])(\d{1,2}\.\d+)\s*([NS])\s*[, /]*\s*(\d{1,3}\.\d+)\s*([EW])/gi;
    for(const m of raw.matchAll(decimal))points.push([coordinate(+m[3],0,0,m[4]),coordinate(+m[1],0,0,m[2])]);
    if(points.length)return points;
    const re=/(?<![\d.])(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?\s*([NS])\s*[, /-]?\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?\s*([EW])/gi;
    for(const m of raw.matchAll(re))points.push([coordinate(+m[5],+m[6],+(m[7]||0),m[8]),coordinate(+m[1],+m[2],+(m[3]||0),m[4])]);
    return points;
}
function stamp(value) {
    if(/^\d{10}$/.test(value||'')) {
        const y=2000+Number(value.slice(0,2)),mo=+value.slice(2,4),d=+value.slice(4,6),h=+value.slice(6,8),mi=+value.slice(8,10);
        const date=new Date(Date.UTC(y,mo-1,d,h,mi));
        return date.getUTCMonth()===mo-1&&date.getUTCDate()===d&&h<24&&mi<60?date.toISOString():null;
    }
    if(!value||!/(?:Z|[+-]\d\d:\d\d)$/.test(value))return null;
    const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export function validateGeometry(g) {
    if(!g)return null;
    if(g.type==='Point') {
        if(!Array.isArray(g.coordinates)||g.coordinates.length!==2||!g.coordinates.every(Number.isFinite)||Math.abs(g.coordinates[0])>180||Math.abs(g.coordinates[1])>90)throw Error('Invalid point');
        return {type:'Point',coordinates:[...g.coordinates]};
    }
    if(g.type!=='Polygon'||!Array.isArray(g.coordinates)||g.coordinates.length!==1)throw Error('Only validated point/single-ring polygon supported');
    let ring=g.coordinates[0].map(p=>validateGeometry({type:'Point',coordinates:p}).coordinates);
    if(ring.length>1000||ring.length<3)throw Error('Invalid polygon size');
    if(JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))ring.push([...ring[0]]);
    const unwrapped=[];for(const [x,y] of ring){let lon=x;if(unwrapped.length){while(lon-unwrapped.at(-1)[0]>180)lon-=360;while(lon-unwrapped.at(-1)[0]<-180)lon+=360;}unwrapped.push([lon,y]);}
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const on=(a,b,c)=>Math.abs(cross(a,b,c))<1e-10&&c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
    let area=0;for(let i=0;i<unwrapped.length-1;i++){const a=unwrapped[i],b=unwrapped[i+1];area+=a[0]*b[1]-b[0]*a[1];
        if(a[0]===b[0]&&a[1]===b[1])throw Error('Duplicate polygon vertex');
        for(let j=i+2;j<unwrapped.length-1;j++){if(i===0&&j===unwrapped.length-2)continue;const c=unwrapped[j],d=unwrapped[j+1];if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))throw Error('Self-intersecting polygon');}}
    if(Math.abs(area)<1e-9)throw Error('Degenerate polygon');
    return {type:'Polygon',coordinates:[ring]};
}
export function noticeStatus(n,now=Date.now()) {
    if(n.isCancellation)return 'cancelled';if(n.superseded)return 'superseded';
    const start=Date.parse(n.effectiveFrom),end=Date.parse(n.effectiveUntil);
    if(!Number.isFinite(start)||(!Number.isFinite(end)&&n.metadata?.permanent!==true))return 'unknown';
    if(now<start)return 'upcoming';if(Number.isFinite(end)&&now>=end)return n.metadata?.estimated?'unknown':'expired';
    if(n.schedule){const match=n.schedule.match(/^DAILY\s+(\d{2})(\d{2})-(\d{2})(\d{2})\s*(?:UTC)?$/i);if(!match)return 'unknown';
        const a=+match[1]*60+ +match[2],b=+match[3]*60+ +match[4];if(+match[1]>23||+match[3]>23||+match[2]>59||+match[4]>59)return 'unknown';
        const d=new Date(now),t=d.getUTCHours()*60+d.getUTCMinutes();if(!(a<=b?t>=a&&t<b:t>=a||t<b))return 'upcoming';}
    return 'active';
}
export function normalizeNotice(input,now=Date.now()) {
    if(!input||!text(input.provider)||!text(input.sourceId)||!text(input.issuer))throw Error('Notice requires provider, issuer and source ID');
    let url;try{url=new URL(input.sourceUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{throw Error('HTTPS source link required');}
    const rawText=String(input.rawText??'').replace(/\u0000/g,'').trim();if(!rawText||rawText.length>50000)throw Error('Invalid notice text');
    const geometry=validateGeometry(input.geometry);
    const sourceId=text(input.sourceId).toUpperCase(),version=text(input.metadata?.version||'original');
    if(sourceId.length>128||version.length>128||text(input.issuer).length>160||text(input.provider).length>64)throw Error('Notice identity too long');
    if(input.metadata?.radiusNm!=null&&(!Number.isFinite(input.metadata.radiusNm)||input.metadata.radiusNm<=0||input.metadata.radiusNm>999))throw Error('Invalid notice radius');
    const n={};for(const key of ['provider','noticeType','title','summary','country','region','fir','navarea','issuer','schedule','geometrySource','geometryAccuracy','geometryConfidence','lowerAltitude','upperAltitude','altitudeReference','activityType','sourceReliability','replacesNoticeId'])n[key]=text(input[key]).slice(0,2000);
    n.noticeType=n.noticeType.toLowerCase();if(!['notam','tfr','airspace','navarea','maritime','mariners','coastal','exercise'].includes(n.noticeType))throw Error('Unsupported notice type');
    Object.assign(n,{id:[n.issuer,sourceId,version].map(encodeURIComponent).join(':'),sourceId,sourceUrl:url.href,rawText,geometry,
        issuedAt:stamp(input.issuedAt),effectiveFrom:stamp(input.effectiveFrom),effectiveUntil:stamp(input.effectiveUntil),
        lastVerifiedAt:stamp(input.lastVerifiedAt),lastFetchedAt:new Date(now).toISOString(),isMilitaryRelated:input.isMilitaryRelated===true,
        isCancellation:input.isCancellation===true,keywords:Array.isArray(input.keywords)?input.keywords.slice(0,30).map(text):[],
        provenance:{publication:url.href,extraction:text(input.provenance?.extraction||'administrator import'),verification:text(input.provenance?.verification||'unverified')},
        metadata:{version,updatedAt:stamp(input.metadata?.updatedAt),estimated:input.metadata?.estimated===true,permanent:input.metadata?.permanent===true,qCode:text(input.metadata?.qCode).slice(0,5),
            altitudes:{lower:parseAltitude(input.lowerAltitude),upper:parseAltitude(input.upperAltitude)},
            ...(Number.isFinite(input.metadata?.radiusNm)&&input.metadata.radiusNm>0&&input.metadata.radiusNm<=999?{radiusNm:input.metadata.radiusNm}:{})}});
    n.status=noticeStatus(n,now);return n;
}
export function parseNotam(raw,context) {
    const fields={};for(const m of raw.matchAll(/(?:^|\n|\s)([QABCDEFG])\)\s*([\s\S]*?)(?=\s+[QABCDEFG]\)|$)/g))fields[m[1]]=m[2].trim();
    const header=raw.match(/\b([A-Z]\d{4}\/\d{2})\s+(NOTAM[NRC])\b/),q=(fields.Q||'').split('/');
    if(!header)throw Error('Missing ICAO NOTAM identifier');
    const coordinates=parseCoordinates(fields.E||''),center=(q.at(-1)||'').match(/(\d{4}[NS]\d{5}[EW])(\d{3})/);
    let geometry=coordinates.length>=3?{type:'Polygon',coordinates:[coordinates]}:coordinates.length===1?{type:'Point',coordinates:coordinates[0]}:null;
    const metadata={estimated:/EST\b/.test(fields.C||''),permanent:/PERM/.test(fields.C||''),version:header[1]};
    if(!geometry&&center){geometry={type:'Point',coordinates:parseCoordinates(center[1])[0]};if(+center[2]>0)metadata.radiusNm=+center[2];}
    const result=normalizeNotice({...context,sourceId:header[1],noticeType:'notam',rawText:raw,title:`NOTAM ${header[1]}`,fir:q[0]||fields.A,
        effectiveFrom:fields.B,effectiveUntil:(fields.C||'').replace(/\s*EST$/,''),schedule:fields.D||'',lowerAltitude:fields.F||(/^\d{3}$/.test(q[5]||'')?'FL'+q[5]:''),upperAltitude:fields.G||(/^\d{3}$/.test(q[6]||'')?'FL'+q[6]:''),
        geometry,geometrySource:coordinates.length?'published coordinates':center?'Q-line':'none',geometryAccuracy:center&&!coordinates.length?'approximate area of influence':'source stated',
        isCancellation:header[2].includes('C'),replacesNoticeId:raw.match(/NOTAM[RC]\s+([A-Z]\d{4}\/\d{2})/)?.[1],metadata},context.now||Date.now());
    result.metadata.qCode=q[1]||'';result.metadata.qualifiers={traffic:q[2]||'',purpose:q[3]||'',scope:q[4]||''};
    result.metadata.altitudes={lower:parseAltitude(fields.F||(/^\d{3}$/.test(q[5]||'')?'FL'+q[5]:'')),upper:parseAltitude(fields.G||(/^\d{3}$/.test(q[6]||'')?'FL'+q[6]:''))};
    if(center&&!coordinates.length&&+center[2]>0)result.metadata.radiusNm=+center[2];return result;
}
export function containsNotice(n,lon,lat) {
    if(n.geometry?.type==='Point'&&n.metadata?.radiusNm){const [x,y]=n.geometry.coordinates,toRad=Math.PI/180;
        const a=Math.sin((lat-y)*toRad/2)**2+Math.cos(y*toRad)*Math.cos(lat*toRad)*Math.sin((lon-x)*toRad/2)**2;
        return 6371008.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))<=n.metadata.radiusNm*1852;}
    if(n.geometry?.type!=='Polygon')return false;
    const ring=[];for(let [x,y]of n.geometry.coordinates[0]){if(ring.length){while(x-ring.at(-1)[0]>180)x-=360;while(x-ring.at(-1)[0]<-180)x+=360;}ring.push([x,y]);}
    const center=ring.reduce((sum,p)=>sum+p[0],0)/ring.length;while(lon-center>180)lon-=360;while(lon-center< -180)lon+=360;
    let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;
}
export function parseAltitude(value='') {
    const raw=text(value).toUpperCase();if(['SFC','GND'].includes(raw))return {raw,value:0,unit:'FT',reference:'surface'};
    if(raw==='UNL')return {raw,value:null,unit:null,reference:'unlimited'};
    const fl=raw.match(/^FL\s*(\d{1,3})$/);if(fl)return {raw,value:+fl[1]*100,unit:'FT',reference:'standard pressure'};
    const m=raw.match(/^(\d+(?:\.\d+)?)\s*(FT|M)\s*(AMSL|MSL|AGL)?$/);return m?{raw,value:+m[1],unit:m[2],reference:m[3]||'unspecified'}:{raw,value:null,unit:null,reference:'unknown'};
}
export function parseMaritimeWarning(raw,context={}) {
    const id=raw.match(/(?:NAVAREA\s+([IVX]+)\s+)?(?:WARNING\s+)?(\d{1,4}\/\d{2,4})/i);
    if(!id)throw Error('Missing warning number/year');
    const points=parseCoordinates(raw),radius=raw.match(/RADIUS\s+(\d+(?:\.\d+)?)\s*(NM|NAUTICAL MILES|KM|METRES|METERS)\b/i);
    const geometry=points.length>=3?{type:'Polygon',coordinates:[points]}:points.length===1?{type:'Point',coordinates:points[0]}:null;
    const radiusNm=radius?+radius[1]*(/KM/i.test(radius[2])?1000/1852:/MET/i.test(radius[2])?1/1852:1):null;
    const cancellation=raw.match(/(?:^|\n)\s*CANCEL(?:LED|S)?\s+(?:NAVAREA\s+[IVX]+\s+)?(\d{1,4}\/\d{2,4})\b/i);
    return normalizeNotice({...context,noticeType:context.noticeType||'navarea',sourceId:id[2],navarea:id[1]||context.navarea,
        title:context.title||`Navigational warning ${id[2]}`,rawText:raw,geometry,geometrySource:points.length?'published coordinates':'none',
        geometryAccuracy:points.length?'source stated':'Location unavailable',isCancellation:context.isCancellation===true||Boolean(cancellation),
        replacesNoticeId:context.replacesNoticeId||cancellation?.[1],metadata:{...context.metadata,...(radiusNm?{radiusNm}:{})}},context.now||Date.now());
}
export function intersectsBounds(n,bounds) {
    if(!n.geometry)return true; // Keep unlocated publications in the list, never place them on the globe.
    const points=n.geometry.type==='Point'?[n.geometry.coordinates]:n.geometry.coordinates[0];
    const longitudes=points.map(p=>p[0]);let min=Math.min(...longitudes),max=Math.max(...longitudes);
    const latRadius=(n.metadata?.radiusNm||0)/60;
    if(Math.max(...points.map(p=>p[1]))+latRadius<bounds.minLat||Math.min(...points.map(p=>p[1]))-latRadius>bounds.maxLat)return false;
    if(n.geometry.type==='Point'&&latRadius){const pad=latRadius/Math.max(.01,Math.cos(points[0][1]*Math.PI/180));min-=pad;max+=pad;}
    // Dateline-spanning rings use two longitude intervals, avoiding a world-wide bounding box.
    const intervals=n.geometry.type==='Point'&&max-min>=360?[[-180,180]]:n.geometry.type==='Point'&&max>180?[[min,180],[-180,max-360]]:n.geometry.type==='Point'&&min< -180?[[min+360,180],[-180,max]]:
        max-min>180&&points.length>1?[[Math.min(...longitudes.filter(x=>x>=0)),180],[-180,Math.max(...longitudes.filter(x=>x<0))]]:[[min,max]];
    const requested=bounds.minLon<=bounds.maxLon?[[bounds.minLon,bounds.maxLon]]:[[bounds.minLon,180],[-180,bounds.maxLon]];
    return intervals.some(([a,b])=>requested.some(([c,d])=>a<=d&&b>=c));
}
export function correlateObservation(notice,observation,now=Date.now()) {
    const stamp=Date.parse(observation.observed_at),status=noticeStatus(notice,now);
    const geographicOverlap=Number.isFinite(observation.longitude)&&Number.isFinite(observation.latitude)&&containsNotice(notice,observation.longitude,observation.latitude);
    const temporalOverlap=Number.isFinite(stamp)&&noticeStatus(notice,stamp)==='active';
    return {noticeId:notice.id,observationId:observation.icao24||observation.mmsi||null,geographicOverlap,temporalOverlap,status,
        evidence:'Published notice and separately observed position; proximity does not establish participation or intent'};
}
