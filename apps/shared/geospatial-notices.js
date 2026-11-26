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
    if(g.type==='GeometryCollection') {
        if(!Array.isArray(g.geometries)||!g.geometries.length||g.geometries.length>32)throw Error('Invalid geometry collection');
        const geometries=g.geometries.map(validateGeometry);
        if(geometries.some(g=>!g)||geometries.reduce((sum,g)=>sum+noticeGeometryPoints(g).length,0)>1000)throw Error('Geometry vertex limit exceeded');
        return {type:'GeometryCollection',geometries};
    }
    if(g.type==='Circle') {
        if(!Number.isFinite(g.radiusMeters)||g.radiusMeters<=0||g.radiusMeters>999*1852)throw Error('Invalid circle radius');
        return {...validateGeometry({type:'Point',coordinates:g.coordinates}),radiusMeters:g.radiusMeters};
    }
    if(['MultiPolygon','MultiLineString'].includes(g.type)){
        if(!Array.isArray(g.coordinates)||!g.coordinates.length||g.coordinates.length>32)throw Error('Invalid multi-area geometry');
        const type=g.type==='MultiPolygon'?'Polygon':'LineString';
        const parts=g.coordinates.map(coordinates=>validateGeometry({type,coordinates}));
        if(parts.reduce((sum,p)=>sum+noticeGeometryPoints(p).length,0)>1000)throw Error('Geometry vertex limit exceeded');
        return {type:g.type,coordinates:parts.map(p=>p.coordinates)};
    }
    if(g.type==='LineString'){
        if(!Array.isArray(g.coordinates)||g.coordinates.length<2||g.coordinates.length>1000)throw Error('Invalid route geometry');
        if(g.corridorWidthMeters!=null&&(!Number.isFinite(g.corridorWidthMeters)||g.corridorWidthMeters<=0||g.corridorWidthMeters>100000))throw Error('Invalid corridor width');
        return {type:'LineString',coordinates:g.coordinates.map(p=>validateGeometry({type:'Point',coordinates:p}).coordinates),...(g.corridorWidthMeters?{corridorWidthMeters:g.corridorWidthMeters}:{})};
    }
    if(g.type==='Point') {
        if(!Array.isArray(g.coordinates)||g.coordinates.length!==2||!g.coordinates.every(Number.isFinite)||Math.abs(g.coordinates[0])>180||Math.abs(g.coordinates[1])>90)throw Error('Invalid point');
        if(g.radiusMeters!=null&&(!Number.isFinite(g.radiusMeters)||g.radiusMeters<=0||g.radiusMeters>999*1852))throw Error('Invalid circle radius');
        return {type:'Point',coordinates:[...g.coordinates],...(g.radiusMeters?{radiusMeters:g.radiusMeters}:{})};
    }
    if(g.type!=='Polygon'||!Array.isArray(g.coordinates)||!g.coordinates.length||g.coordinates.length>32)throw Error('Invalid polygon rings');
    if(g.coordinates.length>1) {
        const rings=g.coordinates.map(ring=>validateGeometry({type:'Polygon',coordinates:[ring]}).coordinates[0]);
        if(rings.reduce((sum,ring)=>sum+ring.length,0)>1000)throw Error('Geometry vertex limit exceeded');
        for(const hole of rings.slice(1))if(!hole.every(([lon,lat])=>containsNotice({geometry:{type:'Polygon',coordinates:[rings[0]]}},lon,lat)))throw Error('Hole outside polygon');
        return {type:'Polygon',coordinates:rings};
    }
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
export function noticeGeometryParts(geometry){
    if(!geometry)return [];
    if(geometry.type==='GeometryCollection')return geometry.geometries.flatMap(noticeGeometryParts);
    if(geometry.type==='MultiPolygon')return geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates}));
    if(geometry.type==='MultiLineString')return geometry.coordinates.map(coordinates=>({type:'LineString',coordinates}));
    return [geometry];
}
export function noticeGeometryPoints(geometry){return noticeGeometryParts(geometry).flatMap(g=>g.type==='Point'?[g.coordinates]:g.type==='Polygon'?g.coordinates.flat():g.coordinates);}
export function publishedRadiusNm(raw=''){
    const match=raw.match(/\bRADIUS\s+(\d+(?:\.\d+)?)\s*(NM|NAUTICAL MILES|KM|METRES|METERS)\b/i)||raw.match(/\b(\d+(?:\.\d+)?)\s*(NM|NAUTICAL MILES|KM|METRES|METERS)\s+RADIUS\b/i);
    return match?+match[1]*(/KM/i.test(match[2])?1000/1852:/MET/i.test(match[2])?1/1852:1):null;
}
export function noticeGeometryClassification(n) {
    if(!n.geometry)return 'Unavailable';
    const area=noticeGeometryParts(n.geometry).some(g=>g.type!=='Point'||g.radiusMeters)||['published','derived'].includes(n.metadata?.radiusSource)&&n.metadata?.radiusNm;
    if(area)return /^derived/i.test(n.geometrySource||'')||n.metadata?.radiusSource==='derived'?'Derived boundary':/approximate/i.test(n.geometryAccuracy||'')?'Approximate coverage':'Published boundary';
    return n.metadata?.radiusSource==='q-line'||/q-line|approximate/i.test((n.geometrySource||'')+' '+(n.geometryAccuracy||''))?'Approximate coverage':'Location only';
}
// Explicit boundary wording only: collections of unrelated airport positions are not areas.
export function extractNoticeArea(raw='') {
    const body=raw.match(/(?:^|\n|\s)E\)\s*([\s\S]*?)(?=\s+[FG]\)|$)/i)?.[1]||raw;
    const areaLabel=/\bAREA\s+(?:\d+|[A-Z])\b\s*[:.)-]?\s*/i;
    const groups=body.split(areaLabel).slice(1).filter(s=>s.trim());
    if(groups.length&&areaLabel.test(body)) {
        const parts=groups.map(extractNoticeArea);
        if(parts.length===1)return parts[0];
        if(parts.every(p=>p?.geometry))return {geometry:{type:'GeometryCollection',geometries:parts.map(p=>({...p.geometry,...(p.metadata?.radiusNm?{radiusMeters:p.metadata.radiusNm*1852}:{}),...(p.metadata?.corridorWidthMeters?{corridorWidthMeters:p.metadata.corridorWidthMeters}:{})}))},metadata:{},geometrySource:'derived separate areas from notice text'};
        return null;
    }
    if(/\b(?:EXCLUDING|EXCEPT|EXCLUDE)\b/i.test(body)||(body.match(/\bBOUNDED BY\b/gi)||[]).length>1)return null;
    let points;try{points=parseCoordinates(body);}catch{return null;}
    const radius=publishedRadiusNm(body);
    const sector=body.match(/\bFROM\s+(\d{1,3}(?:\.\d+)?)\s*(?:DEG(?:REES)?\s*)?(?:TRUE|T)\s+TO\s+(\d{1,3}(?:\.\d+)?)\s*(?:DEG(?:REES)?\s*)?(?:TRUE|T)\b/i);
    if(/\bSECTOR\b/i.test(body)&&sector&&points.length===1&&radius&&/\b(?:CENTRED|CENTERED|CENTRE|CENTER)\b/i.test(body)&&/\b(?:CLOCKWISE|ANTICLOCKWISE|COUNTERCLOCKWISE)\b/i.test(body)&&+sector[1]<360&&+sector[2]<360) {
        const direction=/\b(?:ANTICLOCKWISE|COUNTERCLOCKWISE)\b/i.test(body)?-1:1,span=((+sector[2]-+sector[1])*direction+360)%360;
        if(!span||/\bMAG(?:NETIC)?\b/i.test(body))return null;
        const [lon,lat]=points[0],r=radius*1852/6371008.8,toRad=Math.PI/180,vertices=[points[0]],steps=Math.ceil(span/5);
        for(let i=0;i<=steps;i++){const b=(+sector[1]+direction*span*i/steps)*toRad,y=Math.asin(Math.sin(lat*toRad)*Math.cos(r)+Math.cos(lat*toRad)*Math.sin(r)*Math.cos(b));
            const x=lon*toRad+Math.atan2(Math.sin(b)*Math.sin(r)*Math.cos(lat*toRad),Math.cos(r)-Math.sin(lat*toRad)*Math.sin(y));vertices.push([((x/toRad+540)%360)-180,y/toRad]);}
        try{return {geometry:validateGeometry({type:'Polygon',coordinates:[vertices]}),metadata:{},geometrySource:'derived true-bearing circular sector from notice text'};}catch{return null;}
    }
    if(/\b(?:ARC|SECTOR|CLOCKWISE|COUNTERCLOCKWISE|ANTICLOCKWISE)\b/i.test(body))return null;
    if(radius&&points.length===1)return {geometry:{type:'Point',coordinates:points[0]},metadata:{radiusNm:radius,radiusSource:'derived'},geometrySource:'derived circle from notice text'};
    const width=body.match(/\b(?:WIDTH|WIDE)\s+(\d+(?:\.\d+)?)\s*(NM|KM|M|METRES|METERS)\b/i)||body.match(/\b(\d+(?:\.\d+)?)\s*(NM|KM|M|METRES|METERS)\s+(?:WIDE|WIDTH)\b/i);
    if(points.length>=2&&/\b(?:CORRIDOR|ROUTE|ALONG (?:THE )?LINE)\b/i.test(body)) {
        const meters=width?+width[1]*(/^NM$/i.test(width[2])?1852:/^KM$/i.test(width[2])?1000:1):null;
        if(/\b(?:EITHER|EACH) SIDE\b/i.test(body))return null;
        return {geometry:{type:'LineString',coordinates:points},metadata:meters?{corridorWidthMeters:meters}:{},geometrySource:'derived route from notice text'};
    }
    if(points.length>=3&&(/\b(?:BOUNDED BY|AREA DEFINED BY|FOLLOWING COORDINATES|WI(?:THIN)? (?:THE )?AREA)\b/i.test(body)||/^[\d\sNSEW.,\-/]+$/i.test(body))) {
        try{return {geometry:validateGeometry({type:'Polygon',coordinates:[points]}),metadata:{},geometrySource:'derived boundary from notice text'};}catch{return null;}
    }
    return null;
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
export function nextNoticeBoundary(n,now=Date.now()){
    const boundaries=[Date.parse(n.effectiveFrom),Date.parse(n.effectiveUntil)];
    const match=String(n.schedule||'').match(/^DAILY\s+(\d{2})(\d{2})-(\d{2})(\d{2})\s*(?:UTC)?$/i);
    if(match){const date=new Date(now);date.setUTCHours(0,0,0,0);for(const minute of [+match[1]*60+ +match[2],+match[3]*60+ +match[4]]){let at=date.getTime()+minute*60000;if(at<=now)at+=86400000;boundaries.push(at);}}
    return Math.min(...boundaries.filter(at=>Number.isFinite(at)&&at>now));
}
export function normalizeNotice(input,now=Date.now()) {
    if(!input||!text(input.provider)||!text(input.sourceId)||!text(input.issuer))throw Error('Notice requires provider, issuer and source ID');
    let url;try{url=new URL(input.sourceUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch{throw Error('HTTPS source link required');}
    const rawText=String(input.rawText??'').replace(/\u0000/g,'').trim();if(!rawText||rawText.length>50000)throw Error('Invalid notice text');
    const derived=(!input.geometry||input.geometry.type==='Point'&&!input.geometry.radiusMeters)&&!['published','derived'].includes(input.metadata?.radiusSource)?extractNoticeArea(rawText):null;
    if(derived) {
        input={...input,...derived,geometryAccuracy:'reliably parsed notice text',metadata:{...input.metadata,...derived.metadata}};
        if(derived.geometry.type!=='Point'){delete input.metadata.radiusNm;delete input.metadata.radiusSource;}
    }
    const geometry=validateGeometry(input.geometry);
    if(geometry?.type==='Point'&&geometry.radiusMeters)input={...input,metadata:{...input.metadata,radiusNm:geometry.radiusMeters/1852,radiusSource:/^derived/i.test(input.geometrySource||'')?'derived':'published'}};
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
            ...(['published','derived','q-line'].includes(input.metadata?.radiusSource)?{radiusSource:input.metadata.radiusSource}:{}),
            ...(['low','medium','high','critical'].includes(input.metadata?.severity)?{severity:input.metadata.severity}:{}),
            ...(Number.isFinite(input.metadata?.corridorWidthMeters)&&input.metadata.corridorWidthMeters>0&&input.metadata.corridorWidthMeters<=100000?{corridorWidthMeters:input.metadata.corridorWidthMeters}:{}),
            ...(Number.isFinite(input.metadata?.radiusNm)&&input.metadata.radiusNm>0&&input.metadata.radiusNm<=999?{radiusNm:input.metadata.radiusNm}:{})}});
    n.status=noticeStatus(n,now);return n;
}
export function parseNotam(raw,context) {
    const fields={};for(const m of raw.matchAll(/(?:^|\n|\s)([QABCDEFG])\)\s*([\s\S]*?)(?=\s+[QABCDEFG]\)|$)/g))fields[m[1]]=m[2].trim();
    const header=raw.match(/\b([A-Z]\d{4}\/\d{2})\s+(NOTAM[NRC])\b/),q=(fields.Q||'').split('/');
    if(!header)throw Error('Missing ICAO NOTAM identifier');
    const coordinates=parseCoordinates(fields.E||''),center=(q.at(-1)||'').match(/(\d{4}[NS]\d{5}[EW])(\d{3})/);
    const area=extractNoticeArea(fields.E||'');
    let geometry=area?.geometry||(coordinates.length===1?{type:'Point',coordinates:coordinates[0]}:null);
    const metadata={estimated:/EST\b/.test(fields.C||''),permanent:/PERM/.test(fields.C||''),version:header[1],...area?.metadata};
    if(!geometry&&center){geometry={type:'Point',coordinates:parseCoordinates(center[1])[0]};if(+center[2]>0){metadata.radiusNm=+center[2];metadata.radiusSource='q-line';}}
    const result=normalizeNotice({...context,sourceId:header[1],noticeType:'notam',rawText:raw,title:`NOTAM ${header[1]}`,fir:q[0]||fields.A,
        effectiveFrom:fields.B,effectiveUntil:(fields.C||'').replace(/\s*EST$/,''),schedule:fields.D||'',lowerAltitude:fields.F||(/^\d{3}$/.test(q[5]||'')?'FL'+q[5]:''),upperAltitude:fields.G||(/^\d{3}$/.test(q[6]||'')?'FL'+q[6]:''),
        geometry,geometrySource:area?.geometrySource||(coordinates.length===1?'published coordinates':center?'Q-line':'none'),geometryAccuracy:center&&!coordinates.length?'approximate area of influence':'source stated',
        isCancellation:header[2].includes('C'),replacesNoticeId:raw.match(/NOTAM[RC]\s+([A-Z]\d{4}\/\d{2})/)?.[1],metadata},context.now||Date.now());
    result.metadata.qCode=q[1]||'';result.metadata.qualifiers={traffic:q[2]||'',purpose:q[3]||'',scope:q[4]||''};
    result.metadata.altitudes={lower:parseAltitude(fields.F||(/^\d{3}$/.test(q[5]||'')?'FL'+q[5]:'')),upper:parseAltitude(fields.G||(/^\d{3}$/.test(q[6]||'')?'FL'+q[6]:''))};
    if(center&&!coordinates.length&&+center[2]>0)result.metadata.radiusNm=+center[2];return result;
}
export function containsNotice(n,lon,lat) {
    if(n.geometry?.type==='GeometryCollection')return noticeGeometryParts(n.geometry).some(geometry=>containsNotice({...n,geometry},lon,lat));
    if(n.geometry?.radiusMeters)return containsNotice({...n,geometry:{type:'Point',coordinates:n.geometry.coordinates},metadata:{...n.metadata,radiusNm:n.geometry.radiusMeters/1852}},lon,lat);
    if(n.geometry?.type==='MultiPolygon')return noticeGeometryParts(n.geometry).some(geometry=>containsNotice({...n,geometry},lon,lat));
    if(n.geometry?.type==='Point'&&n.metadata?.radiusNm){const [x,y]=n.geometry.coordinates,toRad=Math.PI/180;
        const a=Math.sin((lat-y)*toRad/2)**2+Math.cos(y*toRad)*Math.cos(lat*toRad)*Math.sin((lon-x)*toRad/2)**2;
        return 6371008.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))<=n.metadata.radiusNm*1852;}
    if(n.geometry?.type!=='Polygon')return false;
    if(n.geometry.coordinates.length>1)return containsNotice({...n,geometry:{type:'Polygon',coordinates:[n.geometry.coordinates[0]]}},lon,lat)&&!n.geometry.coordinates.slice(1).some(ring=>containsNotice({...n,geometry:{type:'Polygon',coordinates:[ring]}},lon,lat));
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
        replacesNoticeId:context.replacesNoticeId||cancellation?.[1],metadata:{...context.metadata,...(radiusNm&&points.length===1?{radiusNm,radiusSource:'published'}:{})}},context.now||Date.now());
}
export function intersectsBounds(n,bounds) {
    if(!n.geometry)return true; // Keep unlocated publications in the list, never place them on the globe.
    if(n.geometry.type==='GeometryCollection')return noticeGeometryParts(n.geometry).some(geometry=>intersectsBounds({...n,geometry},bounds));
    if(n.geometry.radiusMeters)return intersectsBounds({...n,geometry:{type:'Point',coordinates:n.geometry.coordinates},metadata:{...n.metadata,radiusNm:n.geometry.radiusMeters/1852}},bounds);
    if(['MultiPolygon','MultiLineString'].includes(n.geometry.type))return noticeGeometryParts(n.geometry).some(geometry=>intersectsBounds({...n,geometry},bounds));
    const points=noticeGeometryPoints(n.geometry);
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
