import * as Cesium from 'cesium';
import {onLayerChange,isLayerEnabled} from './warzone-layers.js';
import {NOTICE_LAYERS,correlateObservation,matchesNoticeLayers} from '../../../apps/shared/geospatial-notices.js';
import {getAllLiveTrackSnapshots} from './warzone-live-airforce.js';
import {getAllNavalSnapshots} from './warzone-live-naval.js';
import {getActiveRegion,onRegionChange} from './warzone-region-selector.js';
import {getAssetFocusController} from './warzone-asset-focus-controller.js';
let owner=null;
export function initNoticeLayers(viewer, {bindFloatingPanel,canRefresh=()=>true} = {}) {
    if(!viewer||owner?.viewer===viewer)return;owner?.dispose();
    let source=null,handler=null,timer=null,controller=null,panel=null,selected=null,generation=0,frame=0;
    const records=new Map();
    const renderKeys=new Map();
    let panelKey='',retryFailures=0,scopePending=false,scopeTimer=0;
    let disposeDrag=null,noticePosition=null;
    const appearance=window.__stratopsConfig?.notices||{};
    const alpha=Number.isFinite(appearance.opacity)?Math.max(.01,Math.min(.5,appearance.opacity)):.2;
    const stripes=Number.isFinite(appearance.stripes)?Math.max(2,Math.min(64,appearance.stripes)):16;
    let viewStatus='live',militaryOnly=true,offset=0,total=0;
    const active=()=>NOTICE_LAYERS.some(isLayerEnabled);
    const matches=n=>matchesNoticeLayers(n,NOTICE_LAYERS.filter(isLayerEnabled));
    function close(){const highlighted=Boolean(selected?.polygon||selected?.ellipse);disposeDrag?.();disposeDrag=null;if(selected?.polygon)selected.polygon.outlineColor=Cesium.Color.ORANGE;if(selected?.ellipse)selected.ellipse.outlineColor=Cesium.Color.ORANGE;selected=null;panel?.remove();panel=null;panelKey='';if(highlighted)viewer.scene.requestRender();}
    function mountPanel(title){close();
        panel=document.createElement('aside');panel.id='warzone-notice-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Published notice details');
        panel.innerHTML='<div class="wz-widget-milbase"><header class="wz-widget-header"><div class="wz-widget-kicker"><span class="wz-widget-title">Published notice</span></div><div class="wz-widget-header-actions"><button type="button" class="static-icon" aria-label="Close"><span class="stratops-ico-close-1"></span></button></div></header><section class="wz-widget-body"><h3></h3><ul class="wz-widget-data-list"></ul></section></div>';
        panel.querySelector('button').onclick=close;panel.querySelector('h3').textContent=title;
        panel.setAttribute('tabindex','-1');document.body.append(panel);
        const width=panel.offsetWidth||448,height=panel.offsetHeight||260;
        const maxLeft=Math.max(0,(window.innerWidth||1024)-width),maxTop=Math.max(0,(window.innerHeight||768)-height);
        panel.style.left=Math.max(0,Math.min(noticePosition?.left??maxLeft-16,maxLeft))+'px';
        panel.style.top=Math.max(0,Math.min(noticePosition?.top??100,maxTop))+'px';
        disposeDrag=bindFloatingPanel?.(panel,{headerSelector:'.wz-widget-header',fixed:true,onPosition:position=>{noticePosition=position;}});
        const collapse=document.createElement('button');collapse.className='static-icon';collapse.setAttribute('aria-label','Collapse notice widget');collapse.setAttribute('aria-expanded','true');
        collapse.innerHTML='<span class="stratops-ico-top-1" aria-hidden="true"></span>';
        collapse.onclick=()=>{const body=panel?.querySelector('.wz-widget-body');if(body){body.hidden=!body.hidden;collapse.setAttribute('aria-expanded',String(!body.hidden));collapse.setAttribute('aria-label',body.hidden?'Expand notice widget':'Collapse notice widget');}};
        panel.querySelector('.wz-widget-header-actions').append(collapse);
    }
    function showState(title,message){const key=title+'|'+message;if(panel&&panelKey===key)return;mountPanel(title);panelKey=key;panel.querySelector('ul').hidden=true;const p=document.createElement('p');p.textContent=message;panel.querySelector('.wz-widget-body').append(p);}
    function details(n,entity){if(!n?.id)return;mountPanel(n.title||n.sourceId);selected=entity;if(entity?.polygon)entity.polygon.outlineColor=Cesium.Color.WHITE;if(entity?.ellipse)entity.ellipse.outlineColor=Cesium.Color.WHITE;
        const list=panel.querySelector('ul');for(const [key,value]of Object.entries({Category:n.noticeType,ID:n.sourceId,Issuer:n.issuer,Country:n.country,Region:n.region,FIR:n.fir,NAVAREA:n.navarea,Activity:n.activityType,Status:n.status,Issued:n.issuedAt,From:n.effectiveFrom,Until:n.effectiveUntil,Schedule:n.schedule,Altitude:[n.lowerAltitude,n.upperAltitude,n.altitudeReference].filter(Boolean).join(' / '),Coordinates:JSON.stringify(n.geometry?.coordinates||null),Radius:n.metadata?.radiusNm?`${n.metadata.radiusNm} NM`:'Not published',Precision:n.geometryAccuracy||'Location unavailable',Confidence:n.geometryConfidence,Verified:n.lastVerifiedAt||'Unverified',Fetched:n.lastFetchedAt,Summary:n.summary,'Original notice':n.rawText,Provenance:n.provenance?.extraction})){
            const li=document.createElement('li'),label=document.createElement('strong'),span=document.createElement('span');label.textContent=key;span.textContent=value||'Unknown';li.append(label,span);list.append(li);}
        const link=document.createElement('a');link.href=n.sourceUrl;link.rel='noopener noreferrer';link.target='_blank';link.textContent='Original source';list.append(link);
        for(const ref of n.sourceRecords||[]){const li=document.createElement('li'),label=document.createElement('strong'),value=document.createElement('span');label.textContent=ref.provider;value.textContent=ref.rawText;li.append(label,value);list.append(li);}
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
    }
    function showList(message='Published notices'){
        const key=JSON.stringify([message,viewStatus,militaryOnly,offset,total,[...records.values()].map(n=>[n.id,n.sourceId,n.status,Boolean(n.geometry)])]);
        if(panel&&panelKey===key)return;
        mountPanel(message);
        panelKey=key;
        const body=panel.querySelector('.wz-widget-body');body.querySelector('ul').hidden=true;
        const status=document.createElement('select');status.setAttribute('aria-label','Notice time filter');
        for(const value of ['live','active','upcoming','expired','cancelled','all']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===viewStatus;status.append(option);}
        status.onchange=()=>{viewStatus=status.value;offset=0;void refresh();};body.append(status);
        const coverage=document.createElement('button');coverage.className='btn-secondary white';coverage.textContent=militaryOnly?'Military-related':'All notices';coverage.onclick=()=>{militaryOnly=!militaryOnly;offset=0;void refresh();};body.append(coverage);
        for(const [label,next]of [['Previous',offset-200],['Next',offset+200]])if(next>=0&&next<total){const button=document.createElement('button');button.className='btn-secondary white';button.textContent=label;button.onclick=()=>{offset=next;void refresh();};body.append(button);}
        for(const n of records.values()){const button=document.createElement('button');button.className='btn-secondary white';button.textContent=`${n.sourceId} · ${n.status} · ${n.geometry?'Published location':'Location unavailable'}`;button.onclick=()=>details(records.get(n.id)||n,source?.entities.getById(n.id));body.append(button);}
    }
    function clear(){generation++;controller?.abort();controller=null;if(frame)cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=null;clearTimeout(scopeTimer);scopeTimer=0;scopePending=false;handler?.destroy();handler=null;close();if(source){viewer.dataSources.remove(source,true);viewer.scene.requestRender();}source=null;records.clear();renderKeys.clear();}
    async function refresh(){if(!active()){clear();return;}if(!canRefresh()){scopePending=true;return;}scopePending=false;clearTimeout(timer);timer=null;controller?.abort();controller=new AbortController();const current=++generation;
        let pollDelay=60000;
        if(frame)cancelAnimationFrame(frame);frame=0;
        if(!source&&!panel)showState('Loading notices','Retrieving published notices for the selected area.');
        try{const bounds=getActiveRegion()?.bounds||{},query=new URLSearchParams({...bounds,limit:'200',offset:String(offset),layers:NOTICE_LAYERS.filter(isLayerEnabled).join(','),status:viewStatus,military:militaryOnly?'related':'all'});const base=window.__stratopsConfig?.apiBase||((typeof STRATOPS_API_BASE_URL==='string'&&STRATOPS_API_BASE_URL)||'https://api.battlespacex.com');
            const response=await fetch(base.replace(/\/$/,'')+'/notices?'+query,{signal:controller.signal});if(!response.ok){const error=Error('Notice feed unavailable');error.status=response.status;throw error;}const data=await response.json();if(current!==generation)return;
            if(data.state==='unconfigured'){pollDelay=null;retryFailures=0;if(source||handler||records.size)clear();showState('No permitted provider configured','Configure an approved notice source or administrator import in the backend.');return;}
            if(!source){const candidate=new Cesium.CustomDataSource('published-notices');await viewer.dataSources.add(candidate);if(current!==generation){viewer.dataSources.remove(candidate,true);return;}source=candidate;}
            retryFailures=0;
            total=data.total||0;const notices=(data.notices||[]).filter(matches),ids=new Set(notices.map(n=>n.id));for(const entity of source.entities.values.slice())if(!ids.has(entity.id))source.entities.remove(entity);
            for(const id of records.keys())if(!ids.has(id)){if(selected?.id===id)close();records.delete(id);renderKeys.delete(id);}
            const missing=notices.filter(n=>{const key=JSON.stringify([n.geometry,n.metadata?.radiusNm]);if(renderKeys.has(n.id)&&renderKeys.get(n.id)!==key){if(selected?.id===n.id)close();source.entities.removeById(n.id);}renderKeys.set(n.id,key);records.set(n.id,n);return n.geometry&&!source.entities.getById(n.id);});let index=0;
            const chunk=()=>{if(current!==generation)return;frame=0;for(let count=0;index<missing.length&&count<8;count++,index++){
                const n=missing[index];records.set(n.id,n);const material=new Cesium.StripeMaterialProperty({evenColor:Cesium.Color.ORANGE.withAlpha(alpha),oddColor:Cesium.Color.ORANGE.withAlpha(alpha/5),repeat:stripes});
                if(n.geometry?.type==='Polygon')source.entities.add({id:n.id,polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(n.geometry.coordinates[0].flat()),height:30,material,stRotation:Math.PI/4,outline:true,outlineColor:Cesium.Color.ORANGE}});
                else if(n.geometry?.type==='Point'){const [lon,lat]=n.geometry.coordinates;source.entities.add({id:n.id,position:Cesium.Cartesian3.fromDegrees(lon,lat),...(n.metadata?.radiusNm?{ellipse:{semiMajorAxis:n.metadata.radiusNm*1852,semiMinorAxis:n.metadata.radiusNm*1852,height:30,material,stRotation:Math.PI/4,outline:true,outlineColor:Cesium.Color.ORANGE}}:{point:{pixelSize:7,color:Cesium.Color.ORANGE}})});}
            }viewer.scene.requestRender();if(index<missing.length)frame=requestAnimationFrame(chunk);};chunk();
            if(!handler){handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{const entity=viewer.scene.pick(click.position)?.id;const n=entity&&records.get(entity.id);if(n)details(n,entity);},Cesium.ScreenSpaceEventType.LEFT_CLICK);}
            if(!selected){if(!notices.length)showList('No notices in selected area');else showList(`${data.state==='stale'?'Provider temporarily unavailable; cached notices':'Published notices'} (${notices.length}${data.total>200?' of '+data.total:''})`);}
        }catch(error){if(error.name!=='AbortError'&&current===generation){pollDelay=[401,403,404].includes(error.status)?null:Math.min(300000,60000*2**retryFailures++);showState([401,403].includes(error.status)?'Notice access denied':'Provider temporarily unavailable',`Notice request failed${error.status?' (HTTP '+error.status+')':''}. Existing trackers remain independent.`);}}
        finally{if(current===generation&&active()&&pollDelay!==null)timer=setTimeout(refresh,pollDelay);}}
    function sync(){offset=0;if(active()){
        // Disabling one notice category must unload it immediately, even if the next request stalls.
        for(const [id,n]of records)if(!matches(n)){if(selected?.id===id)close();source?.entities.removeById(id);records.delete(id);renderKeys.delete(id);}
        viewer.scene.requestRender();retryFailures=0;void refresh();
    }else clear();}
    const unsubscribe=onLayerChange((id)=>{if(id==='*'||NOTICE_LAYERS.includes(id))sync();});
    function resumeScope(){clearTimeout(scopeTimer);scopeTimer=0;if(scopePending&&active()&&canRefresh()){scopePending=false;void refresh();}}
    const unsubscribeRegion=onRegionChange(()=>{if(!active())return;generation++;controller?.abort();controller=null;if(frame)cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=null;clearTimeout(scopeTimer);offset=0;scopePending=true;scopeTimer=setTimeout(resumeScope,0);});
    document.addEventListener('wz:region-camera-settled',resumeScope);
    const removeMoveEnd=viewer.camera?.moveEnd?.addEventListener?.(resumeScope);
    owner={viewer,dispose(){clear();unsubscribe?.();unsubscribeRegion?.();document.removeEventListener('wz:region-camera-settled',resumeScope);removeMoveEnd?.();}};sync();
}
export function disposeNoticeLayers(){owner?.dispose();owner=null;}
