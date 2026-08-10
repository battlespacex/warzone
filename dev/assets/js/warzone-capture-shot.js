// File Path: /assets/js/warzone-capture-shot.js
const TOP_LOGO_SRC = "/assets/images/web/logo-stratops-battlespacex.svg";
const WATERMARK_LOGO_SRC = "/assets/images/web/Battlespacex-full-logo.svg";
export const CAPTURE_OPERATIONAL_OVERLAY_SELECTORS = Object.freeze([
    "#warzone-hotspot-layer",
    "#wz-radar-label-layer",
]);

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
    await waitForOverlayFrame();
    await drawOperationalOverlayLayers(ctx, output, viewer.scene.canvas);
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

function waitForOverlayFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function drawOperationalOverlayLayers(ctx, output, sourceCanvas) {
    const canvasRect = sourceCanvas?.getBoundingClientRect?.();
    if (!canvasRect?.width || !canvasRect?.height) return;
    const scaleX = output.width / canvasRect.width;
    const scaleY = output.height / canvasRect.height;
    for (const selector of CAPTURE_OPERATIONAL_OVERLAY_SELECTORS) {
        const layer = document.querySelector(selector);
        if (!isVisibleCaptureLayer(layer)) continue;
        const rect = layer.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        try {
            const image = await rasterizeDomLayer(layer, rect);
            if (!image) continue;
            ctx.drawImage(
                image,
                (rect.left - canvasRect.left) * scaleX,
                (rect.top - canvasRect.top) * scaleY,
                rect.width * scaleX,
                rect.height * scaleY
            );
        } catch (error) {
            console.warn(`Capture Shot could not composite ${selector}:`, error);
        }
    }
}

function isVisibleCaptureLayer(layer) {
    if (!layer || layer.hidden) return false;
    const style = window.getComputedStyle(layer);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
}

function rasterizeDomLayer(layer, rect) {
    const clone = layer.cloneNode(true);
    inlineComputedTree(layer, clone);
    clone.removeAttribute("id");
    clone.setAttribute("aria-hidden", "true");
    clone.style.position = "absolute";
    clone.style.inset = "0";
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = "0";
    clone.style.transform = "none";
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.style.position = "relative";
    wrapper.style.width = `${rect.width}px`;
    wrapper.style.height = `${rect.height}px`;
    wrapper.style.overflow = "visible";
    wrapper.appendChild(clone);
    const serialized = new XMLSerializer().serializeToString(wrapper);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(rect.width)}" height="${Math.ceil(rect.height)}" viewBox="0 0 ${rect.width} ${rect.height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Operational overlay rasterization failed."));
        };
        image.src = url;
    });
}

function inlineComputedTree(source, clone) {
    const style = window.getComputedStyle(source);
    for (let index = 0; index < style.length; index += 1) {
        const property = style[index];
        clone.style.setProperty(property, style.getPropertyValue(property), style.getPropertyPriority(property));
    }
    clone.style.setProperty("animation", "none", "important");
    clone.style.setProperty("transition", "none", "important");
    const sourceChildren = Array.from(source.children || []);
    const cloneChildren = Array.from(clone.children || []);
    sourceChildren.forEach((child, index) => {
        if (cloneChildren[index]) inlineComputedTree(child, cloneChildren[index]);
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
