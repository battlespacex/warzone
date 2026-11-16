import * as Cesium from 'cesium';
import {copyNextSceneFrame,assertCaptureReadable,loadImage,downloadBlob,canUseSavePicker} from './warzone-capture-shot.js';
import {noticeGeometryPoints,noticeStatus} from '../../../apps/shared/geospatial-notices.js';
let activeCancel=null;
export function captureRectangle(start,end,width,height){
    const clamp=(v,max)=>Math.max(0,Math.min(max,v));const x1=clamp(start.x,width),x2=clamp(end.x,width),y1=clamp(start.y,height),y2=clamp(end.y,height);
    return {x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)};
}
export function noticeCaptureAnchor(notice){
    const points=noticeGeometryPoints(notice.geometry);if(!points.length)return null;
    if(notice.geometry.type==='Point')return Cesium.Cartesian3.fromDegrees(...points[0]);
    const sphere=Cesium.BoundingSphere.fromPoints(points.map(p=>Cesium.Cartesian3.fromDegrees(...p)));
    return Cesium.Ellipsoid.WGS84.scaleToGeodeticSurface(sphere.center);
}
export function noticeExportDate(value,{dateOnly=false}={}){
    if(typeof value!=='string'||!value.trim()||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value))return 'N/A';
    const day=new Date(value.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))return 'N/A';
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'N/A';
    return dateOnly?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'2-digit',timeZone:'UTC'}).format(date).toUpperCase():date.toISOString().replace('T',' ').slice(0,16)+'Z';
}
function exportComponent(notice,logos,capturedAt,width,height,anchor){
    const root=document.createElement('div');root.className='notam-export';
    const css=getComputedStyle(document.documentElement),number=name=>parseFloat(css.getPropertyValue(name));
    const minWidth=number('--notam-export-layout-min-width'),minHeight=number('--notam-export-layout-min-height');
    if(!(minWidth>0&&minHeight>0))throw Error('NOTAM export stylesheet is unavailable.');
    const scale=Math.min(1,width/minWidth,height/minHeight);
    Object.assign(root.style,{width:width/scale+'px',height:height/scale+'px'});
    const add=(name,text,parent=root)=>{const el=document.createElement('div');el.className='notam-export__'+name;if(text!==undefined){el.textContent=text;el.setAttribute('data-export-text','');}parent.append(el);return el;};
    const top=document.createElement('img');top.className='notam-export__stratops-logo';top.src=logos[0].src;top.alt='StratOps';root.append(top);
    add('timestamp',capturedAt.toISOString().replace('T',' ').slice(0,19)+' UTC');
    const info=add('intelligence');add('identifier',notice.sourceId||notice.title||'N/A',info);add('type',notice.noticeType||'NOTAM',info);
    const details=add('details',undefined,info);
    for(const [key,value]of Object.entries({STATUS:noticeStatus(notice,capturedAt.getTime()),AREA:notice.region||notice.fir||'N/A',PLACE:notice.country||'N/A',DATES:noticeExportDate(notice.effectiveFrom,{dateOnly:true})+' – '+noticeExportDate(notice.effectiveUntil,{dateOnly:true}),UNTIL:noticeExportDate(notice.effectiveUntil)}))add('detail',key+': '+value,details);
    add('source','Source: '+(notice.provider||notice.source_name||notice.issuer||'N/A'));
    const bottom=document.createElement('img');bottom.className='notam-export__battlespacex-logo';bottom.src=logos[1].src;bottom.alt='BattlespaceX';root.append(bottom);
    const marker=add('marker');Object.assign(marker.style,{left:anchor.x/scale+'px',top:anchor.y/scale+'px'});
    document.body.append(root);return {root,scale,images:[top,bottom]};
}
function polygonPath(ctx,clip,box,inset=0){
    const match=clip.match(/^polygon\((.*)\)$/);if(!match)throw Error('NOTAM export clip-path must be a polygon.');
    const points=match[1].split(',').map(pair=>pair.trim().split(/\s+/));
    ctx.beginPath();points.forEach((pair,i)=>{if(pair.length!==2)throw Error('Invalid NOTAM export polygon.');const coords=pair.map((v,axis)=>{if(!/^-?[\d.]+(?:%|px)?$/.test(v))throw Error('Use percentage or pixel export polygon coordinates.');return parseFloat(v)*(v.endsWith('%')?(axis?box.height:box.width)-2*inset:100)/100;});const x=box.x+inset+coords[0],y=box.y+inset+coords[1];if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.closePath();
}
// Use browser layout and computed CSS rather than a second set of Canvas design values.
// Only this small export component is measured, once per user-requested capture.
export async function paintNoticeExport(ctx,notice,logos,capturedAt,width,height,anchor,pixelRatio=1){
    const component=exportComponent(notice,logos,capturedAt,width,height,anchor),{root,scale,images}=component;
    try{
        await Promise.all(images.map(image=>image.decode()));await document.fonts?.ready;
        const origin=root.getBoundingClientRect(),nodes=[...root.querySelectorAll('[data-export-text], img, .notam-export__marker')];
        ctx.save();ctx.scale(scale*pixelRatio,scale*pixelRatio);
        for(const el of nodes){const css=getComputedStyle(el),rect=el.getBoundingClientRect(),box={x:rect.left-origin.left,y:rect.top-origin.top,width:rect.width,height:rect.height};
            if(el.className!=='notam-export__marker'&&(box.x<-.5||box.y<-.5||box.x+box.width>origin.width+.5||box.y+box.height>origin.height+.5))throw Error('Export styling exceeds the selection. Adjust export margins or sizes.');
            ctx.save();ctx.globalAlpha=parseFloat(css.opacity);const clip=css.clipPath;
            if(clip&&clip!=='none'){polygonPath(ctx,clip,box);ctx.clip();}
            ctx.fillStyle=css.backgroundColor;ctx.fillRect(box.x,box.y,box.width,box.height);
            if(el.tagName==='IMG'){
                const image=logos[images.indexOf(el)],ratio=Math.min(box.width/image.naturalWidth,box.height/image.naturalHeight),w=image.naturalWidth*ratio,h=image.naturalHeight*ratio;
                ctx.drawImage(image,box.x+(box.width-w)/2,box.y+(box.height-h)/2,w,h);
            }else if(el.className==='notam-export__marker'){
                const border=parseFloat(css.borderTopWidth);polygonPath(ctx,clip,box,border/2);ctx.strokeStyle=css.borderTopColor;ctx.lineWidth=border;ctx.stroke();
            }else{
                ctx.font=[css.fontStyle,css.fontWeight,css.fontSize,css.fontFamily].join(' ');ctx.fillStyle=css.color;ctx.textBaseline='alphabetic';ctx.letterSpacing=css.letterSpacing==='normal'?'0px':css.letterSpacing;
                const text=el.firstChild,range=document.createRange(),lines=[];
                // Range positions preserve actual wrapping, padding, alignment and font metrics.
                for(let i=0;i<text.length;i++){range.setStart(text,i);range.setEnd(text,i+1);const r=range.getBoundingClientRect();let line=lines.at(-1);if(!line||Math.abs(line.top-r.top)>.5){line={top:r.top,left:r.left,height:r.height,text:''};lines.push(line);}line.text+=text.textContent[i];}
                for(const line of lines){const value=css.textTransform==='uppercase'?line.text.toUpperCase():line.text,metrics=ctx.measureText(value),ascent=metrics.fontBoundingBoxAscent??metrics.actualBoundingBoxAscent,descent=metrics.fontBoundingBoxDescent??metrics.actualBoundingBoxDescent;
                    ctx.fillText(value,line.left-origin.left,line.top-origin.top+(line.height-ascent-descent)/2+ascent);}
            }ctx.restore();
        }ctx.restore();
    }finally{root.remove();}
}
export async function composeNoticeCapture(viewer,notice,selection,{entity=null,now=null}={}){
    let capturedAt=now||new Date();
    const canvas=viewer.scene.canvas,rect=canvas.getBoundingClientRect();
    if(!selection||![selection.x,selection.y,selection.width,selection.height].every(Number.isFinite))throw Error('Draw a valid screenshot rectangle.');
    if(selection.width<220||selection.height<180)throw Error('Select at least 220 × 180 screen pixels.');
    if(viewer.scene.globe?.tilesLoaded===false)throw Error('Map imagery is still loading. Wait before saving.');
    if(['expired','cancelled','superseded'].includes(noticeStatus(notice,capturedAt.getTime())))throw Error('This notice is no longer current. Refresh notices before capturing it.');
    const sx=canvas.width/rect.width,sy=canvas.height/rect.height;
    if(!(sx>0&&sy>0)||selection.x<0||selection.y<0||selection.x+selection.width>rect.width+.5||selection.y+selection.height>rect.height+.5)throw Error('The viewport changed. Redraw the selection.');
    const ratio=Math.min(sx,sy),width=Math.round(selection.width*ratio),height=Math.round(selection.height*ratio);
    const maxPixels=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wz-notice-export-max-pixels'));
    if(!Number.isFinite(maxPixels)||width*height>maxPixels)throw Error('Selection exceeds the export pixel limit. Select a smaller region.');
    const logos=await Promise.all([loadImage('/assets/images/web/logo-stratops-battlespacex.svg'),loadImage('/assets/images/web/Battlespacex-full-logo.svg')]);
    if(logos.some(logo=>!logo))throw Error('Capture branding could not be loaded.');
    let projected;
    const frame=await copyNextSceneFrame(viewer,()=>{
        capturedAt=now||new Date();if(['expired','cancelled','superseded'].includes(noticeStatus(notice,capturedAt.getTime())))throw Error('Notice expired before the capture frame.');
        if(entity&&viewer.dataSourceDisplay?.getBoundingSphere){const state=viewer.dataSourceDisplay.getBoundingSphere(entity,false,new Cesium.BoundingSphere());if(state!==Cesium.BoundingSphereState.DONE)throw Error('Notice geometry is not ready. Wait before saving.');}
        const anchor=entity?.position?.getValue?.(Cesium.JulianDate.now())||noticeCaptureAnchor(notice);projected=anchor&&Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene,anchor);
        if(projected)projected={x:projected.x*rect.width/(canvas.clientWidth||rect.width),y:projected.y*rect.height/(canvas.clientHeight||rect.height)};
    });
    assertCaptureReadable(frame,'NOTAM map frame');
    if(!projected||projected.x<selection.x||projected.y<selection.y||projected.x>selection.x+selection.width||projected.y>selection.y+selection.height)throw Error('Include the selected notice location inside the screenshot rectangle.');
    const output=document.createElement('canvas');output.width=width;output.height=height;const ctx=output.getContext('2d');if(!ctx)throw Error('Canvas export is unavailable.');
    ctx.drawImage(frame,selection.x*sx,selection.y*sy,selection.width*sx,selection.height*sy,0,0,width,height);
    const anchor={x:projected.x-selection.x,y:projected.y-selection.y};
    await paintNoticeExport(ctx,notice,logos,capturedAt,selection.width,selection.height,anchor,ratio);
    assertCaptureReadable(output,'NOTAM annotations and branding');
    return new Promise((resolve,reject)=>{output.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding failed; no image was saved.')),'image/png');});
}
export function startNoticeCapture(viewer,notice,{entity=null,onClose=()=>{}}={}){
    activeCancel?.();const controller=viewer?.scene?.screenSpaceCameraController,canvas=viewer?.scene?.canvas;
    if(!canvas||controller?.enableInputs===false)throw Error('Finish the current map drawing or camera transition before TAKE SHOT.');
    const previous=controller?.enableInputs;if(controller)controller.enableInputs=false;
    const bounds=canvas.getBoundingClientRect(),overlay=document.createElement('div');overlay.className='wz-notice-capture';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Select NOTAM screenshot area');
    Object.assign(overlay.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px'});
    const selectionBox=document.createElement('div');selectionBox.className='wz-notice-capture__selection';selectionBox.hidden=true;
    const resize=document.createElement('span');resize.className='wz-notice-capture__resize';selectionBox.append(resize);overlay.append(selectionBox);
    const toolbar=document.createElement('div');toolbar.className='wz-notice-capture__toolbar';
    const status=document.createElement('span');status.textContent='Drag a rectangle containing the notice. Move or resize it, or DRAW again.';status.setAttribute('aria-live','polite');toolbar.append(status);
    let selection=null,gesture=null,pointer=null,draw=true,closed=false,saving=false;
    const buttons={};for(const label of ['DRAW','RESET','CANCEL','SAVE AS']){const b=document.createElement('button');b.type='button';b.className='btn-secondary white';b.textContent=label;buttons[label]=b;toolbar.append(b);}
    buttons['SAVE AS'].disabled=true;overlay.append(toolbar);document.body.append(overlay);
    const point=e=>({x:Math.max(0,Math.min(bounds.width,e.clientX-bounds.left)),y:Math.max(0,Math.min(bounds.height,e.clientY-bounds.top))});
    function render(){selectionBox.hidden=!selection;overlay.classList.toggle('has-selection',Boolean(selection));buttons.DRAW.disabled=saving;buttons.RESET.disabled=saving;buttons['SAVE AS'].disabled=saving||!selection||selection.width<220||selection.height<180;if(selection)Object.assign(selectionBox.style,{left:selection.x+'px',top:selection.y+'px',width:selection.width+'px',height:selection.height+'px'});}
    function cancel(){if(closed)return;closed=true;overlay.remove();document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',cancel);if(controller)controller.enableInputs=previous;activeCancel=null;onClose();}
    function escape(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}}
    overlay.addEventListener('pointerdown',e=>{e.stopPropagation();if(saving||e.target.closest?.('button')||e.target===status||e.button>0)return;e.preventDefault();pointer=e.pointerId;overlay.setPointerCapture?.(pointer);const p=point(e);
      gesture={start:p,original:selection&&{...selection},mode:e.target===resize?'resize':!draw&&e.target===selectionBox?'move':'draw'};if(gesture.mode==='draw')selection=captureRectangle(p,p,bounds.width,bounds.height);render();});
    overlay.addEventListener('pointermove',e=>{e.stopPropagation();if(saving||!gesture||e.pointerId!==pointer)return;e.preventDefault();const p=point(e),g=gesture;
      if(g.mode==='move'){selection={...g.original,x:Math.max(0,Math.min(bounds.width-g.original.width,g.original.x+p.x-g.start.x)),y:Math.max(0,Math.min(bounds.height-g.original.height,g.original.y+p.y-g.start.y))};}
      else selection=captureRectangle(g.mode==='resize'?{x:g.original.x,y:g.original.y}:g.start,p,bounds.width,bounds.height);render();});
    const up=e=>{e.stopPropagation();if(e.pointerId!==pointer)return;gesture=null;draw=false;overlay.releasePointerCapture?.(pointer);pointer=null;render();};
    overlay.addEventListener('pointerup',up);overlay.addEventListener('pointercancel',up);
    toolbar.addEventListener('pointerdown',e=>e.stopPropagation());toolbar.addEventListener('click',e=>e.stopPropagation());
    buttons.DRAW.onclick=()=>{draw=true;status.textContent='Drag to draw a new screenshot rectangle.';};
    buttons.RESET.onclick=()=>{selection=null;gesture=null;draw=true;render();};buttons.CANCEL.onclick=cancel;
    buttons['SAVE AS'].onclick=async()=>{if(saving||buttons['SAVE AS'].disabled)return;let handle=null;const chosen={...selection},now=new Date(),filename='StratOps_NOTAM_'+now.toISOString().slice(0,10)+'_'+now.toISOString().slice(11,19).replaceAll(':','')+'Z.png';
      saving=true;render();try{if(canUseSavePicker())handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'PNG image',accept:{'image/png':['.png']}}]});
        const blob=await composeNoticeCapture(viewer,notice,chosen,{entity});if(closed)return;
        if(handle){const writer=await handle.createWritable();await writer.write(blob);await writer.close();}else downloadBlob(blob,filename);cancel();
      }catch(error){if(!closed&&error.name!=='AbortError')status.textContent='Capture failed: '+error.message+' No complete image was saved.';}finally{saving=false;if(!closed)render();}};
    document.addEventListener('keydown',escape,true);window.addEventListener('resize',cancel);activeCancel=cancel;return cancel;
}
