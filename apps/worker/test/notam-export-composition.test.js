import {installNoticeTemplates} from './notice-template-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {noticeStatus} from '../../shared/geospatial-notices.js';

const source=fs.readFileSync(new URL('../../../dev/assets/js/warzone-notice-capture.js',import.meta.url),'utf8');
const require=createRequire(import.meta.url),{createCanvas}=require('canvas');
// Computed-layout fixture: tests the Canvas adapter, not browser CSS layout/WebGL.
function harness(overrides={}){
 const mounted=[],draws=[],texts=[],scales=[];
 const vars={'--notam-export-layout-min-width':'900','--notam-export-layout-min-height':'600',...overrides};
 const defaults={opacity:'1',clipPath:'none',backgroundColor:'transparent',color:'#ffffff',fontStyle:'normal',fontWeight:'500',fontSize:'15px',fontFamily:'Arial',letterSpacing:'0px',textTransform:'uppercase',borderTopWidth:'5px',borderTopColor:'#00d9d2'};
 let root;
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.children=[];this.attributes={};this.textContent='';}
  append(el){el.parent=this;this.children.push(el);}
  setAttribute(key,value){this.attributes[key]=value;}
  get firstChild(){return {textContent:this.textContent,length:this.textContent.length,owner:this};}
  querySelectorAll(){const result=[];const visit=e=>{for(const child of e.children){if('data-export-text'in child.attributes||child.tagName==='IMG'||child.className==='notam-export__marker')result.push(child);visit(child);}};visit(this);return result;}
  decode(){return Promise.resolve();}
  remove(){mounted.splice(mounted.indexOf(this),1);}
  getBoundingClientRect(){
   if(this===root){const width=parseFloat(this.style.width),height=parseFloat(this.style.height);return {left:-100000,top:0,width,height,right:-100000+width,bottom:height};}
   const base=root.getBoundingClientRect(),w=base.width,h=base.height,role=this.className.replace('notam-export__','');let x=42,y=h-245,width=390,height=22;
   if(role==='stratops-logo'){width=+(vars.logoWidth||240);height=width/5;x=(w-width)/2;y=24;}
   if(role==='battlespacex-logo'){width=190;height=38;x=w-width-20;y=h-height-20;}
   if(role==='timestamp'){x=w-240-24;y=parseFloat(this.style.top)||26;width=240;}
   if(role==='type'){y+=30;width=120;height=38;}
   if(role==='detail'){y+=86+this.parent.children.indexOf(this)*22;}
   if(role==='detail'||role==='identifier')width=Math.min(width,w-42-20-190-4);
   if(role==='source'){x=12;y=h-22;width=220;height=12;}
   if(role==='marker'){x=parseFloat(this.style.left)-20;y=parseFloat(this.style.top)-20;width=height=40;}
   return {left:base.left+x,top:y,width,height,right:base.left+x+width,bottom:y+height};
  }
 }
 const document={documentElement:{},fonts:{ready:Promise.resolve()},createElement:tag=>new Element(tag),body:{append(el){root=el;mounted.push(el);}},createRange(){let node,start;return {setStart(n,i){node=n;start=i;},setEnd(){},getBoundingClientRect(){const box=node.owner.getBoundingClientRect();return {left:box.left+start*7,top:box.top,height:18};}};}};
 const context=vm.createContext({document,noticeStatus,getComputedStyle(el){if(el===document.documentElement)return {getPropertyValue:key=>vars[key]||''};const style={...defaults};if(el.className==='notam-export__type')Object.assign(style,{backgroundColor:vars.labelColor||'#00d9d2',clipPath:vars.clip||'polygon(0 0,100% 0,100% 75%,90% 100%,0 100%)',fontSize:'26px',fontWeight:'800',color:'#071a1d'});if(el.className==='notam-export__marker')style.clipPath='polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)';if(el.className==='notam-export__timestamp')style.color=vars.timeColor||'#00d9d2';return style;}});
 installNoticeTemplates(context);
 vm.runInContext(source.replace(/^\uFEFF/,'').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
 const canvas=createCanvas(1000,700),ctx=canvas.getContext('2d');ctx.fillStyle='#17242c';ctx.fillRect(0,0,1000,700);
 const logos=[createCanvas(400,80),createCanvas(400,80)];for(const logo of logos){Object.assign(logo,{naturalWidth:400,naturalHeight:80,src:'fixture.svg'});logo.getContext('2d').fillStyle='#ffffff';logo.getContext('2d').fillRect(0,0,400,80);}
 const draw=ctx.drawImage.bind(ctx),fillText=ctx.fillText.bind(ctx),scale=ctx.scale.bind(ctx);
 ctx.drawImage=(...args)=>{draws.push(args);draw(...args);};ctx.fillText=(...args)=>{texts.push(args);fillText(...args);};ctx.scale=(...args)=>{scales.push(args);scale(...args);};
 return {context,mounted,draws,texts,scales,canvas,ctx,logos};
}
const now=new Date('2026-11-16T19:08:06Z');
const notice={sourceId:'A0672/25',noticeType:'notam',region:'Al Farwaniyah',country:'Kuwait',provider:'notac',effectiveFrom:'2026-11-02T03:00:00Z',effectiveUntil:null,metadata:{permanent:true}};
test('missing/invalid dates never become Unix epoch and valid offsets format in UTC',()=>{
 const h=harness();for(const value of [null,undefined,'',0,'invalid','2026-02-30T12:00:00Z'])assert.equal(h.context.noticeExportDate(value),'N/A');
 assert.equal(h.context.noticeExportDate('2026-11-16T21:08:06+02:00'),'2026-11-16 19:08Z');
});
test('normal export draws separate centered/top-right/bottom-left/bottom-right elements and no connector',async()=>{
 const h=harness();await h.context.paintNoticeExport(h.ctx,notice,h.logos,now,1000,700,{x:500,y:300});
 assert.equal(h.draws.length,2);assert.deepEqual(h.draws[0].slice(1),[380,24,240,48]);assert.deepEqual(h.draws[1].slice(1),[790,642,190,38]);
 assert.ok(h.texts.some(([text])=>text==='UNTIL: N/A'));assert.ok(h.texts.some(([text])=>text==='PLACE: KUWAIT'));assert.ok(h.texts.some(([text])=>text==='2026-11-16 19:08:06 UTC'));
 assert.ok(h.texts.some(([text,x,y])=>text==='A0672/25'&&x===42&&y>400));assert.equal(h.mounted.length,0);
 const png=h.canvas.toBuffer('image/png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>1000);
});
test('computed style changes affect real PNG pixels, logo dimensions and clip-path',async()=>{
 const first=harness(),second=harness({labelColor:'#ff0000',logoWidth:300,timeColor:'#00ff00',clip:'polygon(0 0,100% 0,100% 50%,50% 100%,0 100%)'});
 for(const h of [first,second])await h.context.paintNoticeExport(h.ctx,notice,h.logos,now,1000,700,{x:500,y:300});
 assert.equal(second.draws[0][3],300);assert.notDeepEqual(first.canvas.toBuffer(),second.canvas.toBuffer());
 const pixel=(h,x,y)=>Array.from(h.ctx.getImageData(x,y,1,1).data);assert.notDeepEqual(pixel(first,150,490),pixel(second,150,490));
});
test('minimum exports keep readable typography, preserve DPI, and remove temporary component even on invalid styling',async()=>{
 const h=harness();await h.context.paintNoticeExport(h.ctx,notice,h.logos,now,512,512,{x:256,y:256},2);
 assert.equal(h.scales[0][0],2);assert.equal(h.scales[0][0],h.scales[0][1]);assert.equal(h.mounted.length,0);
 const invalid=harness({clip:'circle(50%)'});await assert.rejects(invalid.context.paintNoticeExport(invalid.ctx,notice,invalid.logos,now,1000,700,{x:500,y:300}),/polygon/);assert.equal(invalid.mounted.length,0);
});
