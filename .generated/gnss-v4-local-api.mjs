import http from "node:http";
import { getGpsInterferenceSnapshot, selectGpsInterferenceRegion } from "../apps/api/src/gnss-gpsinterference.js";
http.createServer(async (req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1:8080");
  if(url.pathname!=="/events/gnss-interference"){res.writeHead(404);res.end();return;}
  try{
    const names=["minLat","maxLat","minLon","maxLon"];
    const bounds=names.every(k=>url.searchParams.has(k))?Object.fromEntries(names.map(k=>[k,Number(url.searchParams.get(k))])):null;
    const date=url.searchParams.get("date")||"latest";
    const limit=Math.max(12,Math.min(12000,Number(url.searchParams.get("limit"))||12000));
    const snapshot=await getGpsInterferenceSnapshot(date);
    const payload=snapshot?selectGpsInterferenceRegion(snapshot,{bounds,limit}):{cells:[],sourceMode:"unavailable",sourceHealth:"unavailable"};
    res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(payload));
  }catch{res.writeHead(502,{"Content-Type":"application/json"});res.end('{"error":"Local GNSS fixture failed"}');}
}).listen(8080,"127.0.0.1",()=>console.log("GNSS local test API on 127.0.0.1:8080"));
