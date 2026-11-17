import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {authorizeNavalHistory} from './naval-history-access.js';
import {selectNavalActivities} from '../../shared/naval-intelligence.js';
export function publicNavalSource(source={}){
    // Operator permission documents and catalog payloads stay backend-only.
    return Object.fromEntries(['id','name','country','category','url','access_status','last_success','last_error','records_ingested','canonical_source_id'].filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
}
export function createNavalIntelService({getDb=()=>createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY),now=Date.now}={}){
    let db,cache=null,expires=0,pending=null;
    const database=()=>db||=getDb();
    async function snapshot(){
        if(cache&&now()<expires)return cache;if(pending)return pending;
        pending=(async()=>{const since=new Date(now()-90*86400000).toISOString();
            const [events,sources]=await Promise.all([database().from('naval_activity').select('payload').gte('published_at',since).order('published_at',{ascending:false}).limit(1000),database().from('naval_source').select('payload')]);
            if(events.error||sources.error)throw Error('Naval intelligence unavailable');
            cache={events:events.data.map(r=>r.payload),sources:sources.data.map(r=>publicNavalSource(r.payload))};expires=now()+60000;return cache;
        })().finally(()=>{pending=null;});return pending;
    }
    return {database,snapshot};
}
export function navalIntelRouter({service=createNavalIntelService(),authorize=authorizeNavalHistory}={}){
    const router=express.Router();router.use(async(req,res,next)=>{const access=await authorize(req,{getSupabaseClient:service.database});if(!access.allowed)return res.status(access.status).json({state:'restricted'});res.set('Cache-Control','private, no-store');next();});
    router.get(['/events','/summary'],async(req,res)=>{try{
        const q=req.query,limit=q.limit===undefined?100:Number(q.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid limit');
        let bbox;if(q.bbox){const v=String(q.bbox).split(',').map(Number);if(v.length!==4||!v.every(Number.isFinite)||Math.abs(v[0])>180||Math.abs(v[2])>180||Math.abs(v[1])>90||Math.abs(v[3])>90||v[1]>v[3])throw Error('Invalid bbox');bbox={minLon:v[0],minLat:v[1],maxLon:v[2],maxLat:v[3]};}
        const since=q.since?Date.parse(q.since):null;if(q.since&&!Number.isFinite(since))throw Error('Invalid since');
        const data=await service.snapshot();const rows=selectNavalActivities(data.events,{bbox,history:q.history==='true',limit:1000});const filtered=since?rows.filter(r=>Date.parse(r.published_at)>=since):rows;
        res.json({events:req.path==='/summary'?[]:filtered.slice(0,limit),count:filtered.length,truncated:filtered.length>limit||data.events.length===1000,sources:data.sources,live:false});
    }catch(error){res.status(error.message.startsWith('Invalid')?400:503).json({state:'unavailable'});}});
    router.get('/event/:id',async(req,res)=>{try{if(!/^[a-f0-9]{64}$/.test(req.params.id))return res.status(400).json({state:'invalid_id'});
        const {data,error}=await service.database().from('naval_activity').select('payload').eq('activity_id',req.params.id).maybeSingle();if(error)throw error;if(!data||data.payload.review_status!=='published')return res.status(404).json({state:'not_found'});res.json(data.payload);
    }catch{res.status(503).json({state:'unavailable'});}});return router;
}
