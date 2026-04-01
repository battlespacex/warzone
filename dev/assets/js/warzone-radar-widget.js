// File Path: /assets/js/warzone-radar-widget.js
let __radarCanvas = null;
let __radarCtx = null;
let __radarAnimId = null;
let __radarAngle = 0;
function getRadarCanvas() {
    return document.getElementById("wz-radar-canvas");
}
function resizeRadarCanvas() {
    __radarCanvas = getRadarCanvas();
    if (!__radarCanvas) return;
    const size = Math.min(__radarCanvas.clientWidth || 260, __radarCanvas.clientHeight || 260);
    __radarCanvas.width = size * window.devicePixelRatio;
    __radarCanvas.height = size * window.devicePixelRatio;
    __radarCtx = __radarCanvas.getContext("2d");
    __radarCtx.setTransform(1, 0, 0, 1, 0, 0);
    __radarCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}
function drawRadar() {
    if (!__radarCanvas || !__radarCtx) return;
    const w = __radarCanvas.clientWidth;
    const h = __radarCanvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.42;
    __radarCtx.clearRect(0, 0, w, h);
    // outer ring
    __radarCtx.beginPath();
    __radarCtx.arc(cx, cy, r, 0, Math.PI * 2);
    __radarCtx.strokeStyle = "rgba(24,226,219,0.95)";
    __radarCtx.lineWidth = 2;
    __radarCtx.stroke();
    // faint inner ring
    __radarCtx.beginPath();
    __radarCtx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
    __radarCtx.strokeStyle = "rgba(24,226,219,0.18)";
    __radarCtx.lineWidth = 1;
    __radarCtx.stroke();
    // sweep wedge
    const sweepWidth = Math.PI * 0.34;
    const start = __radarAngle - sweepWidth * 0.5;
    const end = __radarAngle + sweepWidth * 0.5;
    const grad = __radarCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, "rgba(24,226,219,0.38)");
    grad.addColorStop(0.55, "rgba(24,226,219,0.22)");
    grad.addColorStop(1, "rgba(24,226,219,0)");
    __radarCtx.beginPath();
    __radarCtx.moveTo(cx, cy);
    __radarCtx.arc(cx, cy, r, start, end);
    __radarCtx.closePath();
    __radarCtx.fillStyle = grad;
    __radarCtx.fill();
    // sweep line
    const lx = cx + Math.cos(__radarAngle) * r;
    const ly = cy + Math.sin(__radarAngle) * r;
    __radarCtx.beginPath();
    __radarCtx.moveTo(cx, cy);
    __radarCtx.lineTo(lx, ly);
    __radarCtx.strokeStyle = "rgba(24,226,219,1)";
    __radarCtx.lineWidth = 3;
    __radarCtx.stroke();
    // center dot
    __radarCtx.beginPath();
    __radarCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    __radarCtx.fillStyle = "rgba(24,226,219,1)";
    __radarCtx.fill();
}
function tick() {
    __radarAngle += 0.02;
    drawRadar();
    __radarAnimId = requestAnimationFrame(tick);
}
export function initRadarWidget() {
    resizeRadarCanvas();
    if (!__radarCanvas) return;
    if (__radarAnimId) cancelAnimationFrame(__radarAnimId);
    tick();
    window.addEventListener("resize", resizeRadarCanvas, { passive: true });
}