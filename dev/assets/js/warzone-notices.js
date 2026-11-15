import * as Cesium from 'cesium';
import {onLayerChange,isLayerEnabled} from './warzone-layers.js';
import {NOTICE_LAYERS,correlateObservation,matchesNoticeLayers} from '../../../apps/shared/geospatial-notices.js';
import {getAllLiveTrackSnapshots} from './warzone-live-airforce.js';
import {getAllNavalSnapshots} from './warzone-live-naval.js';
import {getActiveRegion,onRegionChange} from './warzone-region-selector.js';
import {getAssetFocusController} from './warzone-asset-focus-controller.js';
let owner=null;
export function initNoticeLayers(viewer) {
    if(!viewer||owner?.viewer===viewer)return;owner?.dispose();
    let source=null,handler=null,timer=null,controller=null,panel=null,selected=null,generation=0,frame=0;
    const records=new Map();
    const appearance=window.__stratopsConfig?.notices||{};
    const alpha=Number.isFinite(appearance.opacity)?Math.max(.01,Math.min(.5,appearance.opacity)):.2;
    const stripes=Number.isFinite(appearance.stripes)?Math.max(2,Math.min(64,appearance.stripes)):16;
    let viewStatus='live',militaryOnly=true,offset=0,total=0;
    const active=()=>NOTICE_LAYERS.some(isLayerEnabled);
    const matches=n=>matchesNoticeLayers(n,NOTICE_LAYERS.filter(isLayerEnabled));
    function close(){if(selected?.polygon)selected.polygon.outlineColor=Cesium.Color.ORANGE;if(selected?.ellipse)selected.ellipse.outlineColor=Cesium.Color.ORANGE;selected=null;panel?.remove();panel=null;viewer.scene.requestRender();}
    function details(n,entity){close();selected=entity;if(entity?.polygon)entity.polygon.outlineColor=Cesium.Color.WHITE;if(entity?.ellipse)entity.ellipse.outlineColor=Cesium.Color.WHITE;
        panel=document.createElement('aside');panel.id='warzone-notice-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Published notice details');
        panel.innerHTML='<div class="wz-widget-milbase"><header class="wz-widget-header"><div class="wz-widget-kicker"><span class="wz-widget-title">Published notice</span></div><div class="wz-widget-header-actions"><button type="button" class="static-icon" aria-label="Close"><span class="stratops-ico-close-1"></span></button></div></header><section class="wz-widget-body"><h3></h3><ul class="wz-widget-data-list"></ul></section></div>';
        panel.querySelector('button').onclick=close;panel.querySelector('h3').textContent=n.title||n.sourceId;
        const list=panel.querySelector('ul');for(const [key,value]of Object.entries({Category:n.noticeType,ID:n.sourceId,Issuer:n.issuer,Country:n.country,Region:n.region,FIR:n.fir,NAVAREA:n.navarea,Activity:n.activityType,Status:n.status,Issued:n.issuedAt,From:n.effectiveFrom,Until:n.effectiveUntil,Schedule:n.schedule,Altitude:[n.lowerAltitude,n.upperAltitude,n.altitudeReference].filter(Boolean).join(' / '),Coordinates:JSON.stringify(n.geometry?.coordinates||null),Radius:n.metadata?.radiusNm?`${n.metadata.radiusNm} NM`:'Not published',Precision:n.geometryAccuracy||'Location unavailable',Confidence:n.geometryConfidence,Verified:n.lastVerifiedAt||'Unverified',Fetched:n.lastFetchedAt,Summary:n.summary,'Original notice':n.rawText,Provenance:n.provenance?.extraction})){
            const li=document.createElement('li'),label=document.createElement('strong'),span=document.createElement('span');label.textContent=key;span.textContent=value||'Unknown';li.append(label,span);list.append(li);}
        const link=document.createElement('a');link.href=n.sourceUrl;link.rel='noopener noreferrer';link.target='_blank';link.textContent='Original source';list.append(link);
        const collapse=document.createElement('button');collapse.className='btn-secondary white';collapse.textContent='Collapse';collapse.onclick=()=>{list.hidden=!list.hidden;collapse.textContent=list.hidden?'Expand':'Collapse';};panel.append(collapse);
        if(entity){const focus=document.createElement('button');focus.className='btn-primary';focus.textContent='Focus area';focus.onclick=()=>{if(!viewer.trackedEntity&&!getAssetFocusController().getState().assetId)void viewer.flyTo(entity,{duration:1});};panel.append(focus);}
        const copy=document.createElement('button');copy.className='btn-secondary white';copy.textContent='Copy coordinates';copy.onclick=()=>navigator.clipboard?.writeText(JSON.stringify(n.geometry?.coordinates||null));panel.append(copy);
        if(records.has(n.id)){
            const back=document.createElement('button');back.className='btn-secondary white';back.textContent='Notice list';back.onclick=()=>showList();panel.append(back);
            const overlap=document.createElement('button');overlap.className='btn-secondary white';overlap.textContent='Check observed position overlaps';overlap.onclick=()=>{
                const observations=[...getAllLiveTrackSnapshots(),...getAllNavalSnapshots()];let count=0;
                for(const row of observations){const result=correlateObservation(n,{longitude:row.lon??row.lng??row.longitude,latitude:row.lat??row.latitude,observed_at:row.observed_at||row.metadata?.observed_at||row.occurred_at||''});
                    if(result.geographicOverlap&&result.temporalOverlap)count++;}
                overlap.textContent=`${count} spatial/time overlaps; participation unverified`;
            };panel.append(overlap);
        }
        document.body.append(panel);
        // Use the same screen-edge inset as the existing widgets; no CSS declaration changes.
        panel.style.left='1rem';panel.style.top='10rem';
    }
    function showList(message='Published notices'){
        details({title:message,rawText:'Published warnings are not observed aircraft or vessel positions.',sourceUrl:'https://skyspy.readme.io/docs/rest-api'});
        const body=panel.querySelector('.wz-widget-body');body.querySelector('ul').hidden=true;
        const status=document.createElement('select');status.setAttribute('aria-label','Notice time filter');
        for(const value of ['live','active','upcoming','expired','cancelled','all']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===viewStatus;status.append(option);}
        status.onchange=()=>{viewStatus=status.value;offset=0;void refresh();};body.append(status);
        const coverage=document.createElement('button');coverage.className='btn-secondary white';coverage.textContent=militaryOnly?'Military-related':'All notices';coverage.onclick=()=>{militaryOnly=!militaryOnly;offset=0;void refresh();};body.append(coverage);
        for(const [label,next]of [['Previous',offset-200],['Next',offset+200]])if(next>=0&&next<total){const button=document.createElement('button');button.className='btn-secondary white';button.textContent=label;button.onclick=()=>{offset=next;void refresh();};body.append(button);}
        for(const n of records.values()){const button=document.createElement('button');button.className='btn-secondary white';button.textContent=`${n.sourceId} · ${n.status} · ${n.geometry?'Published location':'Location unavailable'}`;button.onclick=()=>details(n,source?.entities.getById(n.id));body.append(button);}
    }
    function clear(){generation++;controller?.abort();controller=null;if(frame)cancelAnimationFrame(frame);frame=0;clearInterval(timer);timer=null;handler?.destroy();handler=null;close();if(source)viewer.dataSources.remove(source,true);source=null;records.clear();}
    async function refresh(){if(!active()){clear();return;}controller?.abort();controller=new AbortController();const current=++generation;
        if(frame)cancelAnimationFrame(frame);frame=0;
        try{const bounds=getActiveRegion()?.bounds||{},query=new URLSearchParams({...bounds,limit:'200',offset:String(offset),layers:NOTICE_LAYERS.filter(isLayerEnabled).join(','),status:viewStatus,military:militaryOnly?'related':'all'});const base=window.__stratopsConfig?.apiBase||((typeof STRATOPS_API_BASE_URL==='string'&&STRATOPS_API_BASE_URL)||'https://api.battlespacex.com');
            const response=await fetch(base.replace(/\/$/,'')+'/notices?'+query,{signal:controller.signal});if(!response.ok)throw Error('Notice feed unavailable');const data=await response.json();if(current!==generation)return;
            if(!source){const candidate=new Cesium.CustomDataSource('published-notices');await viewer.dataSources.add(candidate);if(current!==generation){viewer.dataSources.remove(candidate,true);return;}source=candidate;}
            total=data.total||0;const notices=(data.notices||[]).filter(matches),ids=new Set(notices.map(n=>n.id));for(const entity of source.entities.values.slice())if(!ids.has(entity.id))source.entities.remove(entity);
            for(const id of records.keys())if(!ids.has(id)){if(selected?.id===id)close();records.delete(id);}
            const missing=notices.filter(n=>{const old=records.get(n.id);if(old&&JSON.stringify([old.geometry,old.metadata])!==JSON.stringify([n.geometry,n.metadata])){if(selected?.id===n.id)close();source.entities.removeById(n.id);}records.set(n.id,n);return n.geometry&&!source.entities.getById(n.id);});let index=0;
            const chunk=()=>{if(current!==generation)return;frame=0;for(let count=0;index<missing.length&&count<8;count++,index++){
                const n=missing[index];records.set(n.id,n);const material=new Cesium.StripeMaterialProperty({evenColor:Cesium.Color.ORANGE.withAlpha(alpha),oddColor:Cesium.Color.ORANGE.withAlpha(alpha/5),repeat:stripes});
                if(n.geometry?.type==='Polygon')source.entities.add({id:n.id,polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(n.geometry.coordinates[0].flat()),height:30,material,stRotation:Math.PI/4,outline:true,outlineColor:Cesium.Color.ORANGE}});
                else if(n.geometry?.type==='Point'){const [lon,lat]=n.geometry.coordinates;source.entities.add({id:n.id,position:Cesium.Cartesian3.fromDegrees(lon,lat),...(n.metadata?.radiusNm?{ellipse:{semiMajorAxis:n.metadata.radiusNm*1852,semiMinorAxis:n.metadata.radiusNm*1852,height:30,material,stRotation:Math.PI/4,outline:true,outlineColor:Cesium.Color.ORANGE}}:{point:{pixelSize:7,color:Cesium.Color.ORANGE}})});}
            }viewer.scene.requestRender();if(index<missing.length)frame=requestAnimationFrame(chunk);};chunk();
            if(!handler){handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{const entity=viewer.scene.pick(click.position)?.id;const n=entity&&records.get(entity.id);if(n)details(n,entity);},Cesium.ScreenSpaceEventType.LEFT_CLICK);}
            if(!selected)showList(notices.length?`Published notices (${notices.length}${data.total>200?' of '+data.total:''})`:'No approved notices available');
        }catch(error){if(error.name!=='AbortError'&&current===generation)details({title:'Notices unavailable',rawText:'Notice source unavailable. Existing trackers remain independent.',sourceUrl:'https://skyspy.readme.io/docs/rest-api'});}}
    function sync(){offset=0;if(active()){
        // Disabling one notice category must unload it immediately, even if the next request stalls.
        for(const [id,n]of records)if(!matches(n)){if(selected?.id===id)close();source?.entities.removeById(id);records.delete(id);}
        viewer.scene.requestRender();void refresh();if(!timer)timer=setInterval(refresh,60000);
    }else clear();}
    const unsubscribe=onLayerChange((id)=>{if(id==='*'||NOTICE_LAYERS.includes(id))sync();});
    const unsubscribeRegion=onRegionChange(sync);owner={viewer,dispose(){clear();unsubscribe?.();unsubscribeRegion?.();}};sync();
}
export function disposeNoticeLayers(){owner?.dispose();owner=null;}
