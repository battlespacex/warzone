import * as Cesium from 'cesium';
import {onLayerChange,isLayerEnabled} from './warzone-layers.js';
import {NOTICE_LAYERS,correlateObservation,matchesNoticeLayers} from '../../../apps/shared/geospatial-notices.js';
import {getAllLiveTrackSnapshots} from './warzone-live-airforce.js';
import {getAllNavalSnapshots} from './warzone-live-naval.js';
import {getActiveRegion,onRegionChange} from './warzone-region-selector.js';
import {getAssetFocusController} from './warzone-asset-focus-controller.js';
let owner=null;
export function initNoticeLayers(viewer, {bindFloatingPanel,canRefresh=()=>true,showOnInit=true} = {}) {
    if(!viewer||owner?.viewer===viewer)return;owner?.dispose();
    let source=null,handler=null,timer=null,controller=null,panel=null,selected=null,generation=0,frame=0;
    const records=new Map();
    const renderKeys=new Map();
    let panelKey='',retryFailures=0,scopePending=false,scopeTimer=0,requestKey='',pointerHeld=false,wheelActive=false,wheelTimer=0,scenePending=null;
    let widgetRequested=showOnInit;
    let terminalState=false;
    let disposeDrag=null,noticePosition=null;
    let noticeFocus=null,focusButton=null;
    let layerKey=NOTICE_LAYERS.filter(isLayerEnabled).join(',');
    function unfocusNotice({restore=true}={}){
        const previous=noticeFocus;noticeFocus=null;
        if(focusButton)focusButton.textContent='Focus area';
        if(!restore||!previous||viewer.trackedEntity||getAssetFocusController().getState().assetId)return;
        viewer.camera.cancelFlight?.();
        viewer.camera.flyTo({destination:previous.view.position,orientation:{direction:previous.view.direction,up:previous.view.up},endTransform:Cesium.Matrix4.IDENTITY,duration:1});
    }
    function focusNotice(n){
        if(viewer.trackedEntity||getAssetFocusController().getState().assetId)return;
        if(noticeFocus?.id===n.id){unfocusNotice();return;}
        const camera=viewer.camera;if(!camera?.positionWC||!camera.directionWC||!camera.upWC)return;
        const coords=n.geometry?.type==='Polygon'?n.geometry.coordinates.flat():n.geometry?.type==='Point'?[n.geometry.coordinates]:[];
        if(!coords.length)return;
        const sphere=Cesium.BoundingSphere.fromPoints(coords.map(([lon,lat])=>Cesium.Cartesian3.fromDegrees(lon,lat)));
        sphere.radius=Math.max(sphere.radius,n.geometry.type==='Point'?(n.metadata?.radiusNm||0)*1852:0,250);
        const view=noticeFocus?.view||{position:Cesium.Cartesian3.clone(camera.positionWC),direction:Cesium.Cartesian3.clone(camera.directionWC),up:Cesium.Cartesian3.clone(camera.upWC)};
        noticeFocus={id:n.id,view};
        camera.cancelFlight?.();camera.flyToBoundingSphere(sphere,{duration:1});
        if(focusButton)focusButton.textContent='Unfocus';
    }
    // Cached presentation tokens: never parse CSS inside the render loop.
    function readStyle(){
        const css=typeof getComputedStyle==='function'?getComputedStyle(document.documentElement):null;
        const value=(name,fallback)=>css?.getPropertyValue('--wz-notice-'+name)?.trim()||fallback;
        const number=(name,fallback,min,max)=>{const n=Number.parseFloat(value(name,''));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
        const color=(name,fallback)=>Cesium.Color.fromCssColorString(value(name,fallback))||Cesium.Color.ORANGE;
        return {line:color('line-color','#ff9f1c'),fill:color('fill-color','#ff9f1c'),hatch:color('hatch-color','#ff9f1c'),
            opacity:number('fill-opacity',.07,0,1),hatchOpacity:number('hatch-opacity',.22,0,1),stripes:number('hatch-repeat',32,2,128),
            width:number('line-width',2,1,10),height:number('height',60,1,1000),point:number('marker-size',9,3,32),enclosures:number('show-radius',0,0,1)===1};
    }
    let style=readStyle(),detailOpen=false;
    function graphics(n){
        const material=new Cesium.StripeMaterialProperty({evenColor:style.hatch.withAlpha(style.hatchOpacity),oddColor:style.fill.withAlpha(style.opacity),repeat:style.stripes});
        if(n.geometry?.type==='Polygon'){
            const rings=n.geometry.coordinates,positions=ring=>Cesium.Cartesian3.fromDegreesArray(ring.flat());
            return {polygon:{hierarchy:new Cesium.PolygonHierarchy(positions(rings[0]),rings.slice(1).map(r=>new Cesium.PolygonHierarchy(positions(r)))),material,stRotation:Math.PI/4,outline:false},
                polyline:{positions:positions(rings[0]),clampToGround:true,width:style.width,material:style.line}};
        }
        if(n.geometry?.type==='Point'){
            const [lon,lat]=n.geometry.coordinates;
            return {position:Cesium.Cartesian3.fromDegrees(lon,lat,style.height),point:{pixelSize:style.point,color:style.line,outlineColor:Cesium.Color.BLACK,outlineWidth:1},
                ...(style.enclosures&&n.metadata?.radiusNm?{ellipse:{semiMajorAxis:n.metadata.radiusNm*1852,semiMinorAxis:n.metadata.radiusNm*1852,height:style.height,material,outline:true,outlineColor:style.line}}:{})};
        }
        return {};
    }
    let viewStatus='live',militaryOnly=false,offset=0,total=0;
    const active=()=>NOTICE_LAYERS.some(isLayerEnabled);
    const matches=n=>matchesNoticeLayers(n,NOTICE_LAYERS.filter(isLayerEnabled));
    function close(){const highlighted=Boolean(selected);disposeDrag?.();disposeDrag=null;if(selected?.polyline)selected.polyline.material=style.line;if(selected?.ellipse)selected.ellipse.outlineColor=style.line;selected=null;focusButton=null;detailOpen=false;panel?.remove();panel=null;panelKey='';if(highlighted)viewer.scene.requestRender();}
    function dismissDetails(){close();if(widgetRequested&&active())showList();}
    function mountPanel(title){close();
        panel=document.createElement('aside');panel.id='warzone-notice-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Published notice details');
        panel.innerHTML='<div class="wz-widget-milbase"><header class="wz-widget-header"><div class="wz-widget-kicker"><span class="wz-widget-title">Published notice</span></div><div class="wz-widget-header-actions"><button type="button" class="static-icon" aria-label="Close"><span class="stratops-ico-close-1"></span></button></div></header><section class="wz-widget-body"><h3></h3><ul class="wz-widget-data-list"></ul></section></div>';
        panel.querySelector('button').onclick=()=>{if(detailOpen)dismissDetails();else{widgetRequested=false;close();}};panel.querySelector('h3').textContent=title;
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
    function showState(title,message){if(!widgetRequested)return;const key=title+'|'+message;if(panel&&panelKey===key)return;mountPanel(title);panelKey=key;panel.querySelector('ul').hidden=true;const p=document.createElement('p');p.textContent=message;panel.querySelector('.wz-widget-body').append(p);}
    function details(n,entity,position){if(!n?.id)return;widgetRequested=true;mountPanel(n.title||n.sourceId);detailOpen=true;panel.className='wz-notice-popup';selected=entity;if(entity?.polyline)entity.polyline.material=Cesium.Color.WHITE;if(entity?.ellipse)entity.ellipse.outlineColor=Cesium.Color.WHITE;
        if(position&&Number.isFinite(position.x)&&Number.isFinite(position.y)){const rect=viewer.scene.canvas.getBoundingClientRect?.()||{left:0,top:0};panel.style.left=Math.max(8,Math.min(rect.left+position.x+16,(window.innerWidth||1024)-(panel.offsetWidth||320)-8))+'px';panel.style.top=Math.max(8,Math.min(rect.top+position.y+16,(window.innerHeight||768)-(panel.offsetHeight||300)-8))+'px';}
        const body=panel.querySelector('.wz-widget-body'),list=panel.querySelector('ul');
        const brief=document.createElement('p');brief.className='wz-notice-summary';brief.textContent=[n.activityType,n.status,n.country,n.fir,n.effectiveFrom&&'From '+n.effectiveFrom,n.effectiveUntil&&'Until '+n.effectiveUntil,n.summary].filter(Boolean).join(' · ');body.append(brief);
        const disclosure=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Full notice and provenance';disclosure.append(heading,list);body.append(disclosure);
        const actions=document.createElement('div');actions.className='wz-notice-actions';body.append(actions);
        for(const [key,value]of Object.entries({Category:n.noticeType,ID:n.sourceId,Issuer:n.issuer,Country:n.country,Region:n.region,FIR:n.fir,NAVAREA:n.navarea,Activity:n.activityType,Status:n.status,Issued:n.issuedAt,From:n.effectiveFrom,Until:n.effectiveUntil,Schedule:n.schedule,Altitude:[n.lowerAltitude,n.upperAltitude,n.altitudeReference].filter(Boolean).join(' / '),Coordinates:JSON.stringify(n.geometry?.coordinates||null),Radius:n.metadata?.radiusNm?`${n.metadata.radiusNm} NM`:'Not published',Precision:[n.geometryAccuracy||'Location unavailable',n.metadata?.boundaryError].filter(Boolean).join('; '),Confidence:n.geometryConfidence,Verified:n.lastVerifiedAt||'Unverified',Fetched:n.lastFetchedAt,Summary:n.summary,'Original notice':n.rawText,Provenance:n.provenance?.extraction})){
            const li=document.createElement('li'),label=document.createElement('strong'),span=document.createElement('span');label.textContent=key;span.textContent=value||'Unknown';li.append(label,span);list.append(li);}
        const link=document.createElement('a');link.href=n.sourceUrl;link.rel='noopener noreferrer';link.target='_blank';link.textContent='Original source';list.append(link);
        for(const ref of n.sourceRecords||[]){const li=document.createElement('li'),label=document.createElement('strong'),value=document.createElement('span');label.textContent=ref.provider;value.textContent=ref.rawText;li.append(label,value);list.append(li);}
        if(entity){focusButton=document.createElement('button');focusButton.className='btn-primary';focusButton.textContent=noticeFocus?.id===n.id?'Unfocus':'Focus area';focusButton.onclick=()=>focusNotice(n);actions.append(focusButton);}
        const copy=document.createElement('button');copy.className='btn-secondary white';copy.textContent='Copy coordinates';copy.onclick=()=>navigator.clipboard?.writeText(JSON.stringify(n.geometry?.coordinates||null));actions.append(copy);
        if(records.has(n.id)){
            const back=document.createElement('button');back.className='btn-secondary white';back.textContent='Notice list';back.onclick=()=>showList();actions.append(back);
            const overlap=document.createElement('button');overlap.className='btn-secondary white';overlap.textContent='Check observed position overlaps';overlap.onclick=()=>{
                const observations=[...getAllLiveTrackSnapshots(),...getAllNavalSnapshots()];let count=0;
                for(const row of observations){const result=correlateObservation(n,{longitude:row.lon??row.lng??row.longitude,latitude:row.lat??row.latitude,observed_at:row.observed_at||row.metadata?.observed_at||row.occurred_at||''});
                    if(result.geographicOverlap&&result.temporalOverlap)count++;}
                overlap.textContent=`${count} spatial/time overlaps; participation unverified`;
            };actions.append(overlap);
        }
    }
    function showList(message='Published notices'){
        if(!widgetRequested)return;
        const key=JSON.stringify([message,viewStatus,militaryOnly,offset,total,[...records.values()].map(n=>[n.id,n.sourceId,n.status,Boolean(n.geometry)])]);
        if(panel&&panelKey===key)return;
        mountPanel(message);
        panelKey=key;
        const body=panel.querySelector('.wz-widget-body');body.querySelector('ul').hidden=true;
        const geometrySummary=document.createElement('p');geometrySummary.className='wz-notice-summary';
        geometrySummary.textContent=`Published areas: ${[...records.values()].filter(n=>n.geometry?.type==='Polygon').length} · Location-only notices: ${[...records.values()].filter(n=>n.geometry?.type==='Point').length}`;body.append(geometrySummary);
        const controls=document.createElement('div');controls.className='wz-notice-controls';body.append(controls);
        if(noticeFocus){const unfocus=document.createElement('button');unfocus.className='btn-primary';unfocus.textContent='Unfocus';unfocus.onclick=()=>{unfocusNotice();panelKey='';showList();};controls.append(unfocus);}
        const status=document.createElement('select');status.setAttribute('aria-label','Notice time filter');
        for(const value of ['live','active','upcoming','expired','cancelled','all']){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===viewStatus;status.append(option);}
        status.onchange=()=>{viewStatus=status.value;offset=0;void refresh();};controls.append(status);
        const coverage=document.createElement('button');coverage.className='btn-secondary white';coverage.textContent=militaryOnly?'Military-related':'All notices';coverage.onclick=()=>{militaryOnly=!militaryOnly;offset=0;void refresh();};controls.append(coverage);
        for(const [label,next]of [['Previous',offset-200],['Next',offset+200]])if(next>=0&&next<total){const button=document.createElement('button');button.className='btn-secondary white';button.textContent=label;button.onclick=()=>{offset=next;void refresh();};controls.append(button);}
        const cards=document.createElement('div');cards.className='wz-notice-cards';body.append(cards);
        for(const n of records.values()){
            const card=document.createElement('article');card.className='wz-notice-card';
            const title=document.createElement('strong');title.textContent=n.sourceId||n.title;
            const badge=document.createElement('span');badge.className='status-pill status-pill--elevated';badge.textContent=n.status||'Unknown';
            const head=document.createElement('div');head.className='wz-notice-card__head';head.append(title,badge);
            const text=document.createElement('p');text.textContent=[n.country,n.fir,n.activityType,n.geometry?.type==='Polygon'?'Published area boundary':n.geometry?.type==='Point'?'Location only; no valid published area boundary':'Location unavailable'].filter(Boolean).join(' · ');
            const button=document.createElement('button');button.className='btn-secondary white';button.textContent='View notice';button.onclick=()=>details(records.get(n.id)||n,source?.entities.getById(n.id));
            card.append(head,text,button);cards.append(card);
        }
    }
    function clear(){unfocusNotice();generation++;controller?.abort();controller=null;requestKey='';scenePending=null;clearTimeout(wheelTimer);wheelTimer=0;wheelActive=false;if(frame)cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=null;clearTimeout(scopeTimer);scopeTimer=0;scopePending=false;handler?.destroy();handler=null;close();if(source){viewer.dataSources.remove(source,true);viewer.scene.requestRender();}source=null;records.clear();renderKeys.clear();}
    const interactionBusy=()=>pointerHeld||wheelActive;
    function queueSceneWork(work){scenePending=work;if(interactionBusy()||frame)return;frame=requestAnimationFrame(()=>{frame=0;if(interactionBusy())return;const next=scenePending;scenePending=null;next?.();});}
    async function refresh(){style=readStyle();if(!active()){clear();return;}if(terminalState)return;if(!canRefresh()||interactionBusy()){scopePending=true;return;}scopePending=false;
        const bounds=getActiveRegion()?.bounds||{},query=new URLSearchParams({...bounds,limit:'200',offset:String(offset),layers:NOTICE_LAYERS.filter(isLayerEnabled).join(','),status:viewStatus,military:militaryOnly?'related':'all'});
        const key=query.toString();if(controller&&requestKey===key&&!controller.signal.aborted)return;
        clearTimeout(timer);timer=null;controller?.abort();controller=new AbortController();requestKey=key;const current=++generation;
        let pollDelay=60000;
        if(frame)cancelAnimationFrame(frame);frame=0;
        if(!source&&!panel)showState('Loading notices','Retrieving published notices for the selected area.');
        try{const base=window.__stratopsConfig?.apiBase||((typeof STRATOPS_API_BASE_URL==='string'&&STRATOPS_API_BASE_URL)||'https://api.battlespacex.com');
            const response=await fetch(base.replace(/\/$/,'')+'/notices?'+query,{signal:controller.signal});if(!response.ok){const error=Error('Notice feed unavailable');error.status=response.status;throw error;}const data=await response.json();if(current!==generation)return;
            if(data.state==='unconfigured'){terminalState=true;pollDelay=null;retryFailures=0;if(source||handler||records.size)clear();showState('No permitted provider configured','Configure an approved notice source or administrator import in the backend.');return;}
            if(!source){const candidate=new Cesium.CustomDataSource('published-notices');await viewer.dataSources.add(candidate);if(current!==generation){viewer.dataSources.remove(candidate,true);return;}source=candidate;}
            retryFailures=0;
            // A response arriving mid-drag must not mutate the scene on the input frame.
            const apply=()=>{if(current!==generation||!source)return;
            total=data.total||0;const notices=(data.notices||[]).filter(matches),ids=new Set(notices.map(n=>n.id));source.entities.suspendEvents();try{for(const entity of source.entities.values.slice())if(!ids.has(entity.id))source.entities.remove(entity);
            for(const id of records.keys())if(!ids.has(id)){if(noticeFocus?.id===id)unfocusNotice();if(selected?.id===id)close();records.delete(id);renderKeys.delete(id);}
            }finally{source.entities.resumeEvents();}
            const missing=[];source.entities.suspendEvents();try{for(const n of notices){const key=JSON.stringify([n.geometry,n.metadata?.radiusNm,style]);if(renderKeys.has(n.id)&&renderKeys.get(n.id)!==key){if(selected?.id===n.id)close();source.entities.removeById(n.id);}renderKeys.set(n.id,key);records.set(n.id,n);if(n.geometry&&!source.entities.getById(n.id))missing.push(n);}}finally{source.entities.resumeEvents();}let index=0;
            const chunk=()=>{if(current!==generation||!source)return;if(interactionBusy()){queueSceneWork(chunk);return;}const start=performance.now();source.entities.suspendEvents();try{for(let count=0;index<missing.length&&count<8;count++,index++){
                const n=missing[index];records.set(n.id,n);source.entities.add({id:n.id,...graphics(n)});
                if(performance.now()-start>=4){index++;break;}
            }}finally{source.entities.resumeEvents();}if(missing.length)viewer.scene.requestRender();if(index<missing.length)queueSceneWork(chunk);};chunk();
            if(!handler){handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{const entity=viewer.scene.pick(click.position)?.id;const n=entity&&records.get(entity.id);if(n)details(n,entity,click.position);else if(detailOpen)dismissDetails();},Cesium.ScreenSpaceEventType.LEFT_CLICK);}
            if(!selected){if(!notices.length)showList('No notices in selected area');else showList(`${data.state==='stale'?'Provider temporarily unavailable; cached notices':'Published notices'} (${notices.length}${data.total>200?' of '+data.total:''}${data.partial?'; partial feed':''})`);}
            };queueSceneWork(apply);
        }catch(error){if(error.name!=='AbortError'&&current===generation){terminalState=[401,403,404].includes(error.status);pollDelay=terminalState?null:Math.min(300000,60000*2**retryFailures++);showState([401,403].includes(error.status)?'Notice access denied':'Provider temporarily unavailable',`Notice request failed${error.status?' (HTTP '+error.status+')':''}. Existing trackers remain independent.`);}}
        finally{if(current===generation){controller=null;if(active()&&pollDelay!==null)timer=setTimeout(refresh,pollDelay);}}}
    function sync(){offset=0;if(active()){
        // Disabling one notice category must unload it immediately, even if the next request stalls.
        for(const [id,n]of records)if(!matches(n)){if(noticeFocus?.id===id)unfocusNotice();if(selected?.id===id)close();source?.entities.removeById(id);records.delete(id);renderKeys.delete(id);}
        if(!panel&&widgetRequested)showList('Loading notices');
        viewer.scene.requestRender();retryFailures=0;void refresh();
    }else clear();}
    const unsubscribe=onLayerChange((id)=>{if(id==='*'||NOTICE_LAYERS.includes(id)){const next=NOTICE_LAYERS.filter(isLayerEnabled).join(',');if(next!==layerKey||(id!=='*'&&isLayerEnabled(id))){widgetRequested=active();terminalState=false;layerKey=next;if(detailOpen)close();}sync();}});
    function resumeScope(){clearTimeout(scopeTimer);scopeTimer=0;if(interactionBusy())return;if(scenePending)queueSceneWork(scenePending);if(scopePending&&active()&&canRefresh()){scopePending=false;void refresh();}}
    const unsubscribeRegion=onRegionChange(()=>{unfocusNotice({restore:false});if(!active()||terminalState)return;generation++;controller?.abort();controller=null;scenePending=null;if(frame)cancelAnimationFrame(frame);frame=0;clearTimeout(timer);timer=null;clearTimeout(scopeTimer);offset=0;scopePending=true;scopeTimer=setTimeout(resumeScope,0);});
    function dismiss(event){if(event.type==='pointerdown'&&event.target===viewer.scene.canvas)pointerHeld=true;if(detailOpen&&(event.type==='keydown'?event.key==='Escape':!panel?.contains?.(event.target)))dismissDetails();}
    function yieldFocus(){if(viewer.trackedEntity||getAssetFocusController().getState().assetId){const hadFocus=Boolean(noticeFocus);unfocusNotice({restore:false});if(hadFocus&&!detailOpen&&panel){close();showList();}}}
    function releasePointer(){pointerHeld=false;resumeScope();}
    function wheel(event){if(event.target!==viewer.scene.canvas||!active())return;wheelActive=true;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=0;wheelActive=false;resumeScope();},120);}
    function restyle(){const next=readStyle();if(JSON.stringify(next)===JSON.stringify(style))return;style=next;for(const n of records.values()){const entity=source?.entities.getById(n.id);if(!entity)continue;const next=graphics(n);entity.polygon=next.polygon;entity.polyline=next.polyline;entity.ellipse=next.ellipse;entity.point=next.point;if(next.position)entity.position=next.position;renderKeys.set(n.id,JSON.stringify([n.geometry,n.metadata?.radiusNm,style]));}viewer.scene.requestRender();}
    document.addEventListener('pointerdown',dismiss);
    document.addEventListener('wz:asset-focus-changed',yieldFocus);
    document.addEventListener('pointerup',releasePointer);
    document.addEventListener('pointercancel',releasePointer);
    document.addEventListener('wheel',wheel,{passive:true});
    window.addEventListener?.('blur',releasePointer);
    document.addEventListener('keydown',dismiss);
    window.addEventListener?.('resize',restyle);
    document.addEventListener('wz:notice-style-refresh',restyle);
    document.addEventListener('wz:region-camera-settled',resumeScope);
    const removeMoveEnd=viewer.camera?.moveEnd?.addEventListener?.(resumeScope);
    owner={viewer,dispose(){clear();unsubscribe?.();unsubscribeRegion?.();document.removeEventListener('pointerdown',dismiss);document.removeEventListener('wz:asset-focus-changed',yieldFocus);document.removeEventListener('pointerup',releasePointer);document.removeEventListener('pointercancel',releasePointer);document.removeEventListener('wheel',wheel);window.removeEventListener?.('blur',releasePointer);document.removeEventListener('keydown',dismiss);window.removeEventListener?.('resize',restyle);document.removeEventListener('wz:notice-style-refresh',restyle);document.removeEventListener('wz:region-camera-settled',resumeScope);removeMoveEnd?.();}};sync();
}
export function disposeNoticeLayers(){owner?.dispose();owner=null;}
