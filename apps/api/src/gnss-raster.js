import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile, stat, readdir, unlink, utimes, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gnssBoundary, unwrapGnssPolygon, gnssContains } from '../../shared/gnss-geometry.js';

const SEVERITIES = ['low', 'medium', 'high', 'severe', 'unknown'];
const DEFAULT_COLORS = [[13,233,79,51],[252,255,77,51],[138,67,254,51],[14,127,255,51],[100,114,133,51]];
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i=0;i<8;i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function chunk(type, data) {
    const content = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, content, tail]);
}
export function encodeGnssPng(pixels, width, height) {
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y=0;y<height;y++) pixels.copy(rows, y * (width*4+1)+1, y*width*4, (y+1)*width*4);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows,{level:3})),chunk('IEND',Buffer.alloc(0))]);
}
export function validateGnssStyle(raw) {
    let s;
    try { if (raw?.length > 1024) throw new Error(); s = raw ? JSON.parse(raw) : {}; if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(); } catch { throw fail(400,'Invalid GNSS style'); }
    const colors = value => {
        if (value === undefined) return DEFAULT_COLORS;
        if (!Array.isArray(value) || value.length !== 5 || value.some(c => !Array.isArray(c) || c.length!==4 || c.some(v=>!Number.isInteger(v)||v<0||v>255))) throw fail(400,'Invalid GNSS palette');
        return value;
    };
    const width = Number(s.width ?? 1), size = Number(s.size ?? 28);
    if (!Number.isFinite(width)||width<0||width>8||!Number.isFinite(size)||size<6||size>500) throw fail(400,'Invalid GNSS dimensions');
    return { fill: colors(s.fill), outline: colors(s.outline), width, size };
}
function tileBounds(z,x,y) {
    if (![z,x,y].every(Number.isInteger)||z<0||z>14||x<0||x>=2**(z+1)||y<0||y>=2**z) throw fail(400,'Invalid geographic GNSS tile');
    const span=180/2**z;
    return { west:-180+x*span, east:-180+(x+1)*span, north:90-y*span, south:90-(y+1)*span, span };
}
function entriesFor(cells, size) {
    const entries=[], buckets=new Map();
    for (const cell of cells) {
        const points=unwrapGnssPolygon(gnssBoundary(cell,size)); if(points.length<3) continue;
        for(const shift of [-360,0,360]) {
            const polygon=points.map(p=>({lat:p.lat,lon:p.lon+shift}));
            const box={west:Math.min(...polygon.map(p=>p.lon)),east:Math.max(...polygon.map(p=>p.lon)),south:Math.min(...polygon.map(p=>p.lat)),north:Math.max(...polygon.map(p=>p.lat))};
            if(box.east < -180 || box.west > 180) continue;
            const entry={cell,points:polygon,box,order:entries.length};entries.push(entry);
            for(let x=Math.max(0,Math.floor((box.west+180)/10));x<=Math.min(35,Math.floor((box.east+180)/10));x++)
                for(let y=Math.max(0,Math.floor((box.south+90)/10));y<=Math.min(17,Math.floor((box.north+90)/10));y++) {
                    const key=x+':'+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(entry);
                }
        }
    }
    return {entries,buckets};
}
function candidates(index, box) {
    const found=new Set();
    for(let x=Math.max(0,Math.floor((box.west+180)/10));x<=Math.min(35,Math.floor((box.east+180)/10));x++)
        for(let y=Math.max(0,Math.floor((box.south+90)/10));y<=Math.min(17,Math.floor((box.north+90)/10));y++)
            for(const entry of index.buckets.get(x+':'+y)||[]) if(entry.box.east>=box.west&&entry.box.west<=box.east&&entry.box.north>=box.south&&entry.box.south<=box.north)found.add(entry);
    return [...found].sort((a,b)=>a.order-b.order);
}
function blend(pixels, i, color, coverage=1) {
    const alpha=color[3]/255*coverage, old=pixels[i+3]/255, out=alpha+old*(1-alpha);
    if(!out)return;
    for(let c=0;c<3;c++) pixels[i+c]=Math.round((color[c]*alpha+pixels[i+c]*old*(1-alpha))/out);
    pixels[i+3]=Math.round(out*255);
}
async function render(index, box, style, filter) {
    // Supersampling keeps diagonal hex edges smooth without any client geometry jobs.
    const size=512,pixels=Buffer.alloc(size*size*4);let processed=0;
    const padding = (style.width + 1) * box.span / 256;
    const buffered = { west:box.west-padding, east:box.east+padding, south:box.south-padding, north:box.north+padding };
    for(const entry of candidates(index,buffered)) {
        const severity=SEVERITIES.indexOf(entry.cell.severity);if(filter!=='all'&&entry.cell.severity!==filter)continue;
        const c=severity<0?4:severity, points=entry.points.map(p=>({x:(p.lon-box.west)/box.span*size,y:(box.north-p.lat)/box.span*size}));
        const ymin=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),ymax=Math.min(size-1,Math.ceil(Math.max(...points.map(p=>p.y))));
        for(let y=ymin;y<=ymax;y++) {
            const hits=[];
            for(let i=0,j=points.length-1;i<points.length;j=i++) {const a=points[i],b=points[j];if((a.y>y+.5)!==(b.y>y+.5))hits.push(a.x+(y+.5-a.y)*(b.x-a.x)/(b.y-a.y));}
            hits.sort((a,b)=>a-b);
            for(let i=0;i+1<hits.length;i+=2)for(let x=Math.max(0,Math.ceil(hits[i]-.5));x<=Math.min(size-1,Math.floor(hits[i+1]-.5));x++)blend(pixels,(y*size+x)*4,style.fill[c]);
        }
        if(style.width)for(let i=0;i<points.length;i++) {
            const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy,radius=style.width;
            for(let y=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius));y<=Math.min(size-1,Math.ceil(Math.max(a.y,b.y)+radius));y++)
                for(let x=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius));x<=Math.min(size-1,Math.ceil(Math.max(a.x,b.x)+radius));x++) {
                    const t=len?Math.max(0,Math.min(1,((x+.5-a.x)*dx+(y+.5-a.y)*dy)/len)):0;
                    if(Math.hypot(x+.5-a.x-t*dx,y+.5-a.y-t*dy)<=radius)blend(pixels,(y*size+x)*4,style.outline[c]);
                }
        }
        if(++processed%64===0)await new Promise(resolve=>setImmediate(resolve));
    }
    const down=Buffer.alloc(256*256*4);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++) {
        let alpha=0;const rgb=[0,0,0];
        for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const i=((y*2+dy)*size+x*2+dx)*4;alpha+=pixels[i+3];for(let c=0;c<3;c++)rgb[c]+=pixels[i+c]*pixels[i+3];}
        const i=(y*256+x)*4;for(let c=0;c<3;c++)down[i+c]=alpha?Math.round(rgb[c]/alpha):0;down[i+3]=Math.round(alpha/4);
    }
    return encodeGnssPng(down,256,256);
}

export function createGnssRasterStore({ maxSnapshotBytes=32*1024*1024, maxTileBytes=32*1024*1024, maxSnapshots=16, now=Date.now, snapshotDirectory=null }={}) {
    const snapshots=new Map(),tiles=new Map(),pending=new Map();let snapshotBytes=0,tileBytes=0,queue=Promise.resolve();
    const pinned = new Map(), loading = new Map();
    let pinnedBytes = 0, publishingBytes = 0, loadQueue = Promise.resolve();
    let lastPrune = 0;
    const remember = (revision, payload, bytes, created) => {
        const { cells = [], ...meta } = payload;
        if (snapshots.has(revision)) snapshotBytes -= snapshots.get(revision).bytes;
        const snapshot = { cells, meta, bytes, created, index: entriesFor(cells, 28) };
        snapshots.set(revision, snapshot); snapshotBytes += bytes;
        while(snapshots.size>maxSnapshots||snapshotBytes>maxSnapshotBytes){const oldest=snapshots.keys().next().value;snapshotBytes-=snapshots.get(oldest).bytes;snapshots.delete(oldest);}
        return snapshot;
    };
    const get=async id=>{
        if (!/^[a-f0-9]{32}$/.test(id)) throw fail(400,'Invalid GNSS revision');
        let s=snapshots.get(id);
        if ((!s || now()-s.created>30*60*1000) && snapshotDirectory) {
            if (loading.has(id)) return loading.get(id);
            if (loading.size >= 32) throw fail(503,'GNSS snapshot queue full');
            const task = loadQueue.then(async () => {
            try {
                const filename = path.join(snapshotDirectory, id+'.json');
                const metadata = await stat(filename);
                if (metadata.size > maxSnapshotBytes || now()-metadata.mtimeMs>30*60*1000) throw new Error();
                const raw = await readFile(filename, 'utf8');
                if (digest(raw).slice(0,32)!==id) throw new Error();
                return remember(id,JSON.parse(raw),metadata.size,metadata.mtimeMs);
            } catch { throw fail(410,'GNSS revision unavailable; refresh observations'); }
            }).finally(()=>loading.delete(id));
            loading.set(id,task);loadQueue=task.catch(()=>{});
            return task;
        }
        if(!s||now()-s.created>30*60*1000)throw fail(410,'GNSS revision expired; refresh observations');
        return s;
    };
    async function persist(revision, raw) {
        if (!snapshotDirectory) return;
        await mkdir(snapshotDirectory, { recursive:true, mode:0o700 });
        const filename = path.join(snapshotDirectory, revision+'.json');
        let reusable = false;
        try { reusable = snapshots.has(revision) || digest(await readFile(filename)).slice(0,32) === revision; }
        catch(error) { if(error.code!=='ENOENT')throw error; }
        if (reusable) {
            try { await utimes(filename,new Date(),new Date()); }
            catch(error) { if(error.code!=='ENOENT')throw error; reusable=false; }
        }
        if (!reusable) {
            // Atomic cache publication prevents another API process reading a partial JSON file.
            const temporary = path.join(snapshotDirectory, revision+'-'+randomUUID()+'.tmp');
            try { await writeFile(temporary,raw,{flag:'wx',mode:0o600}); await rename(temporary,filename); }
            finally { await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
        }
        // Bounded disk cache, shared by processes on this API host. No recurring timer.
        if (now()-lastPrune<60_000) return;
        lastPrune=now();
        const files=[];
        for(const name of await readdir(snapshotDirectory)) if(/^[a-f0-9]{32}(\.json|-[a-f0-9-]{36}\.tmp)$/.test(name)) {
            try {const info=await stat(path.join(snapshotDirectory,name));files.push({name,...info});}catch{/* Another process may prune. */}
        }
        let total=files.reduce((n,f)=>n+f.size,0);
        for(const file of files.sort((a,b)=>a.mtimeMs-b.mtimeMs)) if(file.name!==revision+'.json'&&(now()-file.mtimeMs>30*60*1000||total>256*1024*1024)) {
            try {await unlink(path.join(snapshotDirectory,file.name));total-=file.size;}catch{/* Best-effort cache eviction. */}
        }
    }
    return {
        async publish(payload) {
            const {cells=[],...meta}=payload;
            if(payload.demoMode || cells.some(cell=>cell.isDemo===true||cell.is_demo===true))throw fail(503,'Operational GNSS raster requires genuine observations');
            const raw=JSON.stringify(payload),revision=digest(raw).slice(0,32);
            const bytes=Buffer.byteLength(raw);
            if(bytes>maxSnapshotBytes)throw fail(503,'GNSS snapshot capacity exceeded');
            if(publishingBytes+bytes>maxSnapshotBytes)throw fail(503,'GNSS snapshot preparation busy');
            publishingBytes+=bytes;
            try { await persist(revision,raw); }
            finally { publishingBytes-=bytes; }
            if(!snapshots.has(revision)) {
                remember(revision,JSON.parse(raw),Buffer.byteLength(raw),now());
            } else snapshots.get(revision).created=now();
            const counts=meta.severityCounts||cells.reduce((c,r)=>(c[r.severity]=(c[r.severity]||0)+1,c),{});
            return {...meta,cells:[],totalCells:meta.totalCells??cells.length,severityCounts:counts,truncated:false,raster:{revision,maximumLevel:14,
                tilePath:`/events/gnss-interference/raster/${revision}/{z}/{x}/{y}.png`,lookupPath:`/events/gnss-interference/raster/${revision}/lookup`}};
        },
        async lookup(revision,lon,lat,filter='all',rawStyle) {
            if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw fail(400,'Invalid lookup coordinate');
            if(!['all',...SEVERITIES].includes(filter))throw fail(400,'Invalid severity filter');
            const snapshot=await get(revision),style=validateGnssStyle(rawStyle);
            const index=style.size===28?snapshot.index:entriesFor(snapshot.cells,style.size);
            return candidates(index,{west:lon,east:lon,south:lat,north:lat}).reverse().find(e=>(filter==='all'||e.cell.severity===filter)&&gnssContains(e.points,lon,lat))?.cell||null;
        },
        async tile(revision,z,x,y,filter='all',rawStyle) {
            if(!['all',...SEVERITIES].includes(filter))return Promise.reject(fail(400,'Invalid severity filter'));
            let snapshot,style,box;
            try {style=validateGnssStyle(rawStyle);box=tileBounds(z,x,y);snapshot=await get(revision);}catch(error){return Promise.reject(error);}
            const key=[revision,z,x,y,filter,digest(JSON.stringify(style))].join('/');
            if(tiles.has(key)){const value=tiles.get(key);tiles.delete(key);tiles.set(key,value);return Promise.resolve(value);}
            if(pending.has(key))return pending.get(key);
            if(pending.size>=256)return Promise.reject(fail(503,'GNSS tile queue full'));
            if(!pinned.has(snapshot)&&pinnedBytes+snapshot.bytes>maxSnapshotBytes)throw fail(503,'GNSS tile snapshot capacity exceeded');
            if(!pinned.has(snapshot))pinnedBytes+=snapshot.bytes;
            pinned.set(snapshot,(pinned.get(snapshot)||0)+1);
            const task=queue.then(()=>render(style.size===28?snapshot.index:entriesFor(snapshot.cells,style.size),box,style,filter)).then(bytes=>{
                tiles.set(key,bytes);tileBytes+=bytes.length;while(tileBytes>maxTileBytes&&tiles.size){const oldest=tiles.keys().next().value;tileBytes-=tiles.get(oldest).length;tiles.delete(oldest);}return bytes;
            }).finally(()=>{
                pending.delete(key);
                const count=pinned.get(snapshot)-1;
                if(count)pinned.set(snapshot,count);else{pinned.delete(snapshot);pinnedBytes-=snapshot.bytes;}
            });
            pending.set(key,task);queue=task.catch(()=>{});return task;
        },
        diagnostics:()=>({snapshots:snapshots.size,snapshotBytes,tiles:tiles.size,tileBytes,pending:pending.size,pinnedBytes,publishingBytes,loading:loading.size}),
    };
}
export const gnssRasterStore=createGnssRasterStore({snapshotDirectory:fileURLToPath(new URL('../.cache/gnss-raster-v1/',import.meta.url))});
export function gnssRasterRoutes(router, store=gnssRasterStore) {
    const sendError=(res,error)=>res.set('Cache-Control','no-store').status(error.status||503).json({error:error.message||'GNSS raster unavailable'});
    router.get('/gnss-interference/raster/:revision/lookup',async(req,res)=>{
        try {res.set('Cache-Control','no-store').json({cell:await store.lookup(req.params.revision,Number(req.query.lon),Number(req.query.lat),req.query.filter||'all',req.query.style)});}catch(error){sendError(res,error);}
    });
    router.get('/gnss-interference/raster/:revision/:z/:x/:y.png',async(req,res)=>{
        try {const bytes=await store.tile(req.params.revision,Number(req.params.z),Number(req.params.x),Number(req.params.y),req.query.filter||'all',req.query.style);
            res.set('Cache-Control','private, max-age=300').type('png').send(bytes);
        }catch(error){sendError(res,error);}
    });
}
