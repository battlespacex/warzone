// File Path: /assets/js/warzone-capture-shot.js
const TOP_LOGO_SRC = "/assets/images/web/logo-stratops-battlespacex.svg";
const WATERMARK_LOGO_SRC = "/assets/images/web/Battlespacex-full-logo.svg";

let captureInFlight = false;

export function initWarzoneCaptureShot(viewer) {
    if (!viewer?.scene?.canvas) return null;
    const buttons = [
        document.getElementById("dock-capture-shot"),
        document.getElementById("wz-mobile-capture-shot"),
    ].filter(Boolean);
    buttons.forEach((button) => {
        if (button.__wzCaptureBound) return;
        button.__wzCaptureBound = true;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void captureShot(viewer, buttons);
            closeMobileMenu();
        });
    });
    window.__warzoneCaptureShot = () => captureShot(viewer, buttons);
    return window.__warzoneCaptureShot;
}

async function captureShot(viewer, buttons = [], options = {}) {
    if (captureInFlight || !viewer?.scene?.canvas) return false;
    captureInFlight = true;
    setButtonsBusy(buttons, true);
    const filename = makeCaptureFilename();
    let fileHandle = null;
    try {
        if (canUseSavePicker()) {
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: "PNG image",
                        accept: { "image/png": [".png"] },
                    }],
                });
            } catch (error) {
                if (error?.name === "AbortError") return false;
                console.warn("Capture Shot file picker unavailable; falling back to browser download:", error);
            }
        }
        const blob = await composeCaptureBlob(viewer);
        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return true;
        }
        if (await tryShareCapture(blob, filename)) return true;
        downloadBlob(blob, filename);
        return true;
    } catch (error) {
        console.warn("Capture Shot failed:", error);
        window.alert?.(getCaptureErrorMessage(error));
        return false;
    } finally {
        void options;
        setButtonsBusy(buttons, false);
        captureInFlight = false;
    }
}

async function composeCaptureBlob(viewer) {
    const output = await copyNextSceneFrame(viewer);
    const width = output.width;
    const height = output.height;
    const ctx = output.getContext("2d");
    if (!ctx) throw new Error("Capture canvas is unavailable.");
    await drawBranding(ctx, width, height);
    return new Promise((resolve, reject) => {
        try {
            output.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Browser returned an empty capture image."));
            }, "image/png", 1);
        } catch (error) {
            reject(error);
        }
    });
}

function copyNextSceneFrame(viewer) {
    return new Promise((resolve, reject) => {
        const scene = viewer?.scene;
        const sourceCanvas = scene?.canvas;
        if (!scene || !sourceCanvas) {
            reject(new Error("Cesium scene is unavailable."));
            return;
        }
        let removePostRender = null;
        const timeoutId = window.setTimeout(() => {
            removePostRender?.();
            reject(new Error("Timed out waiting for the map frame."));
        }, 2500);
        removePostRender = scene.postRender.addEventListener(() => {
            try {
                const width = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 0);
                const height = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 0);
                const output = document.createElement("canvas");
                output.width = width;
                output.height = height;
                const ctx = output.getContext("2d");
                if (!ctx) throw new Error("Capture canvas is unavailable.");
                // Copy during postRender while the WebGL framebuffer is still readable.
                ctx.drawImage(sourceCanvas, 0, 0, width, height);
                window.clearTimeout(timeoutId);
                removePostRender?.();
                resolve(output);
            } catch (error) {
                window.clearTimeout(timeoutId);
                removePostRender?.();
                reject(error);
            }
        });
        scene.requestRender?.();
    });
}

async function drawBranding(ctx, width, height) {
    const [topLogo, watermarkLogo] = await Promise.all([
        loadImage(TOP_LOGO_SRC),
        loadImage(WATERMARK_LOGO_SRC),
    ]);
    if (topLogo) {
        const logoWidth = Math.min(width * 0.285, 385);
        const logoHeight = logoWidth * (topLogo.naturalHeight / Math.max(1, topLogo.naturalWidth));
        drawImageContain(ctx, topLogo, (width - logoWidth) / 2, 20, logoWidth, logoHeight, 0.98);
    }
    if (watermarkLogo) {
        const markWidth = Math.min(width * 0.18, 260);
        const markHeight = markWidth * (watermarkLogo.naturalHeight / Math.max(1, watermarkLogo.naturalWidth));
        drawImageContain(ctx, watermarkLogo, width - markWidth - 26, height - markHeight - 24, markWidth, markHeight, 0.72);
    }
}

function drawImageContain(ctx, image, x, y, width, height, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,0.72)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
}

function loadImage(src) {
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function canUseSavePicker() {
    return typeof window.showSaveFilePicker === "function" &&
        window.isSecureContext === true &&
        !isLikelyMobile();
}

async function tryShareCapture(blob, filename) {
    if (!isLikelyMobile() || typeof File !== "function" || !navigator?.canShare || !navigator?.share) return false;
    const file = new File([blob], filename, { type: "image/png" });
    if (!navigator.canShare({ files: [file] })) return false;
    try {
        await navigator.share({
            files: [file],
            title: "StratOps Capture Shot",
        });
        return true;
    } catch (error) {
        if (error?.name !== "AbortError") console.warn("Capture Shot share failed; falling back to download:", error);
        return false;
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function makeCaptureFilename() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `stratops-capture-${date}-${hh}${mm}.png`;
}

function setButtonsBusy(buttons, busy) {
    buttons.forEach((button) => {
        button.classList.toggle("is-active", busy);
        button.disabled = busy;
        button.setAttribute("aria-busy", String(busy));
    });
}

function isLikelyMobile() {
    return window.matchMedia?.("(pointer: coarse), (max-width: 767px)")?.matches === true;
}

function getCaptureErrorMessage(error) {
    if (error?.name === "SecurityError") {
        return "Capture blocked by browser canvas security. A visible map tile, imagery layer, or asset is not CORS-readable.";
    }
    return "Capture Shot failed. Try again after the map finishes loading.";
}

function closeMobileMenu() {
    const menu = document.getElementById("wz-mobile-dock-menu");
    const backdrop = document.getElementById("wz-mobile-dock-backdrop");
    menu?.classList?.remove("is-open");
    backdrop?.classList?.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
    backdrop?.setAttribute("aria-hidden", "true");
}
