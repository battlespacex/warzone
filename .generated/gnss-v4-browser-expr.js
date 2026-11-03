(async () => {
  for (let i=0;i<20 && !window.harnessData;i++) await new Promise(r=>setTimeout(r,300));
  const state=()=>({cells:getGnssDiagnostics().activeCellEntities,
    primitives:window.harnessViewer.scene.groundPrimitives.length});
  await new Promise(r=>setTimeout(r,800));
  const initial=state();
  const severity=document.getElementById("wz-gnss-severity");
  severity.value="high";severity.dispatchEvent(new Event("change"));
  await new Promise(r=>setTimeout(r,800));const high=state();
  const show=document.getElementById("wz-gnss-show-hexagons");
  show.click();await new Promise(r=>setTimeout(r,200));const off=state();
  show.click();await new Promise(r=>setTimeout(r,800));const on=state();
  severity.value="all";severity.dispatchEvent(new Event("change"));
  await new Promise(r=>setTimeout(r,800));const restored=state();
  return JSON.stringify({sourceMode:window.harnessData?.sourceMode,
    sourceCells:window.harnessData?.cells.length,initial,high,off,on,restored});
})()
