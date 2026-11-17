import '../assets/css/root.css';
import './site.css';
const menu=document.querySelector('.public-menu'),nav=document.getElementById('public-nav');
const closeMenu=()=>{menu.setAttribute('aria-expanded','false');nav.classList.remove('is-open');};
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);});
nav.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
const tools={
 focus:['Examine an asset','Keep the details in view.',"Focus on an aircraft, vessel or orbital asset using the platform's existing tracking and camera controls. Inspect available telemetry and identity information without losing the geographic context."],
 aoi:['Define your question','Draw an area. Explore its context.','Use areas of interest and regional filtering to examine available events and intelligence. Results reflect the underlying sources and selected observation period.'],
 notices:['Read the original evidence','Published boundaries. Source-linked detail.','Inspect available NOTAMs and other published notices, their validity periods and supplied geometry. Where a source provides no boundary, a precise area cannot be inferred.'],
 reports:['Communicate the context','From exploration to a report.','Use existing operational reports and capture/export tools where available. Keep timestamps, attribution and data limitations alongside your findings.']
};
const tabs=[...document.querySelectorAll('[data-tool]')],panel=document.getElementById('tool-panel');
function selectTool(tab){for(const button of tabs){button.setAttribute('aria-selected',String(button===tab));button.tabIndex=button===tab?0:-1;}const [label,title,copy]=tools[tab.dataset.tool];panel.setAttribute('aria-labelledby',tab.id);panel.querySelector('span').textContent=label;panel.querySelector('h3').textContent=title;panel.querySelector('p').textContent=copy;}
for(const tab of tabs){tab.addEventListener('click',()=>selectTool(tab));tab.addEventListener('keydown',event=>{let index=tabs.indexOf(tab);if(event.key==='ArrowDown'||event.key==='ArrowRight')index=(index+1)%tabs.length;else if(event.key==='ArrowUp'||event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;event.preventDefault();selectTool(tabs[index]);tabs[index].focus();});}
document.getElementById('public-year').textContent=String(new Date().getFullYear());
const film=document.getElementById('public-film'),toggle=document.getElementById('public-film-toggle'),motion=matchMedia('(prefers-reduced-motion: reduce)');
// The existing film is large. Mobile/save-data visitors get its poster until they opt in.
let userPaused=false,videoVisible=true,userRequested=false;
const automaticVideo=()=>!motion.matches&&!navigator.connection?.saveData&&!matchMedia('(max-width: 800px)').matches;
toggle.hidden=false;
toggle.textContent='Play background video';
async function playFilm(){if(userPaused||document.hidden||!videoVisible||(!userRequested&&!automaticVideo()))return;if(!film.src)film.src=film.dataset.src;try{await film.play();toggle.textContent='Pause background video';}catch{toggle.textContent='Play background video';}}
toggle.addEventListener('click',()=>{userPaused=!film.paused;if(userPaused){film.pause();toggle.textContent='Play background video';}else{userRequested=true;playFilm();}});
motion.addEventListener('change',()=>{if(motion.matches){userRequested=false;film.pause();toggle.textContent='Play background video';}else playFilm();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)film.pause();else playFilm();});
if('IntersectionObserver' in window){new IntersectionObserver(entries=>{videoVisible=entries[0].isIntersecting;if(videoVisible)playFilm();else film.pause();},{threshold:0.05}).observe(film);}else playFilm();
