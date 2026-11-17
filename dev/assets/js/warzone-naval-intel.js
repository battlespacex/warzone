import * as Cesium from 'cesium';
import {api} from './supabase.js';
import {onLayerChange,isLayerEnabled} from './warzone-layers.js';
import {onRegionChange,getActiveRegion,isRegionTransitionInFlight} from './warzone-region-selector.js';
import {selectNavalActivities} from '../../../apps/shared/naval-intelligence.js';
let owner=null;
export function initNavalIntelligence(viewer,{bindFloatingPanel,request=options=>api.getNavalIntelligence(options)}={}){
    if(owner?.viewer===viewer)return owner;owner?.dispose();
    let generation=0,controller=null,source=null,panel=null,drag=null,handler=null,timer=0,settleTimer=0,cache=null,cachedAt=0,history=false,areas=true,detail=null,disposed=false,mapKey='',viewportOff=null,clusterOff=null;
    const enabled=()=>!disposed&&isLayerEnabled('naval');
    const close=()=>{drag?.();drag=null;panel?.remove();panel=null;detail=null;};
    const clearMap=()=>{mapKey='';handler?.destroy();handler=null;clusterOff?.();clusterOff=null;if(source)viewer.dataSources.remove(source,true);source=null;viewer.scene.requestRender();};
    const clear=()=>{generation++;controller?.abort();controller=null;viewportOff?.();viewportOff=null;clearTimeout(timer);clearTimeout(settleTimer);timer=settleTimer=0;clearMap();close();};
    const element=(tag,text,cls,parent)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;parent?.append(el);return el;};
    function mount(){if(panel)return;panel=element('aside',undefined,'warzone-panel warzone-panel--floating warzone-widget wz-naval-intel');panel.setAttribute('aria-label','Reported naval intelligence');
        const shell=element('div',undefined,'wz-widget-milbase',panel),header=element('header',undefined,'wz-widget-header',shell);element('h2','NAVAL INTELLIGENCE','wz-widget-title',header);
        const hide=element('button','×','static-icon',header);hide.setAttribute('aria-label','Close naval intelligence');hide.onclick=close;
        element('section',undefined,'wz-widget-body',shell);document.body.append(panel);drag=bindFloatingPanel?.(panel,{headerSelector:'.wz-widget-header',fixed:true});
    }
    function render(message=''){
        if(!enabled())return;mount();const body=panel.querySelector('.wz-widget-body');body.replaceChildren();element('p','Public reports · separate from live AIS','wz-notice-summary',body);
        const controls=element('div',undefined,'wz-notice-controls',body);
        for(const [label,value,set]of [['Historical sightings',history,v=>{history=v;cachedAt=0;load();}],['Operating areas',areas,v=>{areas=v;draw();render();}]]){const wrapper=element('label',undefined,'',controls),input=element('input',undefined,'',wrapper);input.type='checkbox';input.checked=value;input.onchange=()=>set(input.checked);element('span',label,'',wrapper);}
        const rows=visible();if(message)element('p',message,'wz-notice-summary',body);
        if(!rows.length)element('p','No eligible reports available. Live AIS remains independent.','wz-notice-summary',body);
        if(cache?.truncated)element('p','Showing a bounded recent report window.','wz-notice-summary',body);
        const ready=(cache?.sources||[]).filter(s=>s.access_status==='ready').length;element('p',`${ready} configured sources · ${(cache?.sources||[]).length} directory references`,'wz-notice-summary',body);
        for(const row of detail?[detail]:rows){const card=element('article',undefined,'wz-notice-card',body);element('h3',row.vessel_name||row.group_name||row.title,'',card);
            element('p',[row.confidence,row.navy_country_iso2||'Nationality not established',row.event_type.replaceAll('_',' '),row.region||'Location not published',row.status==='historical'?'HISTORICAL':'REPORTED — NOT LIVE'].join(' · '),'wz-notice-summary',card);
            element('p','Reported: '+(row.publication_precision==='day'?row.published_at.slice(0,10)+' (date only; source timezone not stated)':row.published_at)+(row.observation_at?' · Observed: '+row.observation_at:''),'',card);
            for(const evidence of row.evidence||[]){const link=element('a',evidence.label||row.source_name,'',card);link.href=evidence.source_url;link.target='_blank';link.rel='noopener noreferrer';}
            const more=element('details',undefined,'',card);element('summary','Details and precision','',more);element('p',row.summary,'',more);element('p',`${row.geometry_role} · ${row.geometry_evidence||'No vessel coordinates inferred'} · ${row.license_status}`,'',more);
        }
        if(detail){const back=element('button','All reports','btn-secondary white',body);back.onclick=()=>{detail=null;render();};}
    }
    function visible(){return selectNavalActivities(cache?.events||[],{history,bbox:getActiveRegion()?.bounds,limit:100});}
    function draw(){
        if(!enabled()||!areas){viewportOff?.();viewportOff=null;clearMap();return;}
        const candidates=visible().filter(r=>r.geometry);
        if(!candidates.length){viewportOff?.();viewportOff=null;}
        if(candidates.length&&!viewportOff)viewportOff=viewer.camera?.moveEnd?.addEventListener(()=>{if(enabled())draw();});
        const view=viewer.camera?.computeViewRectangle?.(Cesium.Ellipsoid.WGS84),bbox=view?{minLon:Cesium.Math.toDegrees(view.west),maxLon:Cesium.Math.toDegrees(view.east),minLat:Cesium.Math.toDegrees(view.south),maxLat:Cesium.Math.toDegrees(view.north)}:null;
        const rows=selectNavalActivities(candidates,{history,bbox,limit:40}),key=JSON.stringify(rows.map(r=>[r.id,r.geometry]));if(key===mapKey)return;clearMap();mapKey=key;if(!rows.length)return;
        source=new Cesium.CustomDataSource('naval-intelligence');
        const addedSource=source;Promise.resolve(viewer.dataSources.add(source)).then(added=>{if(added&&(!enabled()||source!==addedSource))viewer.dataSources.remove(added,true);}).catch(()=>{if(source===addedSource){clearMap();render('Reported geometry unavailable.');}});
        if(source.clustering){source.clustering.enabled=true;source.clustering.pixelRange=40;source.clustering.minimumClusterSize=3;
            clusterOff=source.clustering.clusterEvent.addEventListener((entities,cluster)=>{cluster.billboard.show=false;cluster.label.show=true;cluster.label.text=entities.length+' reports';cluster.point.show=true;cluster.point.color=Cesium.Color.ORANGE;});}
        for(const row of rows){const geometry=row.geometry,parts=geometry.type==='MultiPolygon'?geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates})):[geometry];
            parts.slice(0,4).forEach((part,i)=>{const color=Cesium.Color.ORANGE;
                const entity=source.entities.add({id:row.id+':'+i,...(part.type==='Point'?{position:Cesium.Cartesian3.fromDegrees(...part.coordinates),point:{pixelSize:7,color,outlineColor:Cesium.Color.BLACK,outlineWidth:1}}:part.type==='Polygon'?{polygon:{hierarchy:Cesium.Cartesian3.fromDegreesArray(part.coordinates[0].flat()),material:color.withAlpha(.08)},polyline:{positions:Cesium.Cartesian3.fromDegreesArray(part.coordinates[0].flat()),width:1,material:color,clampToGround:true}}:{})});entity.__navalIntel=row;});
        }
        handler=new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{const picked=viewer.scene.pick(click.position)?.id;if(Array.isArray(picked)){detail=null;render();return;}const row=picked?.__navalIntel;if(row){detail=visible().find(item=>item.id===row.id)||null;if(detail)render();}},Cesium.ScreenSpaceEventType.LEFT_CLICK);viewer.scene.requestRender();
    }
    async function load(){
        if(!enabled()||isRegionTransitionInFlight())return;
        if(controller)return;if(cache&&Date.now()-cachedAt<60000&&cache.history===history){draw();render();return;}
        const token=++generation;controller=new AbortController();try{const data=await request({signal:controller.signal,history});if(token!==generation||!enabled())return;cache={...data,history};cachedAt=Date.now();draw();render();
            armExpiry();
        }catch(error){if(token===generation&&error.name!=='AbortError')render('Intelligence unavailable or access restricted.');}finally{if(token===generation)controller=null;}
    }
    function armExpiry(){clearTimeout(timer);const next=Math.min(...(cache?.events||[]).map(r=>Date.parse(r.valid_until)).filter(t=>t>Date.now()));if(Number.isFinite(next))timer=setTimeout(()=>{detail=null;draw();render();armExpiry();},Math.min(2147483647,next-Date.now()+1));}
    const off=onLayerChange(id=>{if(id!=='naval'&&id!=='*')return;if(enabled())load();else clear();});
    const regionOff=onRegionChange(()=>{detail=null;clearTimeout(settleTimer);settleTimer=setTimeout(load,250);});
    const settled=()=>{if(enabled())load();};document.addEventListener('wz:region-camera-settled',settled);
    owner={viewer,dispose(){disposed=true;clear();off();regionOff();document.removeEventListener('wz:region-camera-settled',settled);if(owner===this)owner=null;}};if(enabled())load();return owner;
}
export function disposeNavalIntelligence(){owner?.dispose();}
