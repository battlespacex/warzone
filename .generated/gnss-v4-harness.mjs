import http from "node:http";
import { readFileSync } from "node:fs";
import { getGpsInterferenceSnapshot, selectGpsInterferenceRegion } from "../apps/api/src/gnss-gpsinterference.js";

const gnssSource = readFileSync(new URL("../dev/assets/js/warzone-gnss.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
const renderer = "const setDataSourceActive = () => {};\n" + gnssSource +
    "\nwindow.renderGnssInterferenceLayer = renderGnssInterferenceLayer; window.getGnssDiagnostics = getGnssDiagnostics;";
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/cesium/Widgets/widgets.css"><style>
html,body,#globe{margin:0;width:100%;height:100%;overflow:hidden;background:#050b14}
#globe .cesium-widget,#globe .cesium-viewer,#globe .cesium-viewer-cesiumWidgetContainer{width:100%;height:100%}
#status{position:absolute;top:12px;left:12px;padding:10px;background:#152432;color:white;z-index:3}
</style><script>window.CESIUM_BASE_URL="/assets/cesium/";</script>
<script src="/assets/cesium/Cesium.js"></script>
<script src="/renderer.js"></script></head><body><div id="globe"></div>
<div id="status"><span id="status-text">Loading real provider cells</span>
<label><input id="wz-gnss-show-hexagons" type="checkbox" checked>Show</label>
<select id="wz-gnss-severity"><option value="all">All</option><option value="high">High</option></select></div>
<aside id="wz-gnss-legend" hidden><div id="wz-gnss-legend-status"></div></aside>
<div id="wz-gnss-tooltip" hidden></div>
<script>
(async()=>{
  const viewer=new Cesium.Viewer("globe",{animation:false,timeline:false,
    baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,
    navigationHelpButton:false,infoBox:false,selectionIndicator:false,baseLayer:false});
  window.harnessViewer=viewer;
  viewer.scene.globe.baseColor=Cesium.Color.DARKSLATEGRAY;
  viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(45,28,3000000)});
  const response=await fetch("/cells");const data=await response.json();
  window.harnessData=data;
  renderGnssInterferenceLayer(viewer,data.cells,{visible:true,sourceMode:data.sourceMode,
    sourceHealth:data.sourceHealth,totalCells:data.totalCells,severityCounts:data.severityCounts,
    observationPeriod:data.observationPeriod,updatedAt:data.updatedAt});
  document.getElementById("status-text").textContent=data.totalCells+" observed GNSS hexagons; "+data.sourceMode;
})().catch(error=>{window.harnessError=String(error);document.getElementById("status").textContent=String(error)});
</script></body></html>`;

http.createServer(async (req, res) => {
    if (req.url.startsWith("/assets/cesium/")) {
        const upstream = await fetch("http://127.0.0.1:4174" + req.url);
        res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream" });
        res.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); return; }
    if (req.url === "/renderer.js") { res.writeHead(200, { "Content-Type": "application/javascript" }); res.end(renderer); return; }
    if (req.url === "/cells") {
        const snapshot = await getGpsInterferenceSnapshot();
        const payload = snapshot ? selectGpsInterferenceRegion(snapshot, {
            bounds: { minLat: 12, maxLat: 42, minLon: 28, maxLon: 65 }, limit: 12000,
        }) : { cells: [], sourceMode: "unavailable" };
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); return;
    }
    res.writeHead(404); res.end();
}).listen(8081, "127.0.0.1", () => console.log("GNSS visual fixture on 127.0.0.1:8081"));
