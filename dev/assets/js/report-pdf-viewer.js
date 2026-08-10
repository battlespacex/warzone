import "../css/root.css";
import "pdfjs-dist/web/pdf_viewer.css";
import "../css/report-pdf-viewer.css";

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import {
    EventBus,
    PDFLinkService,
    PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";

GlobalWorkerOptions.workerSrc = "/assets/pdfjs/pdf.worker.min.mjs";

const elements = {
    container: document.getElementById("report-pdf-viewer-container"),
    viewer: document.getElementById("report-pdf-viewer"),
    thumbnails: document.getElementById("report-pdf-thumbnails"),
    loading: document.getElementById("report-pdf-loading"),
    error: document.getElementById("report-pdf-error"),
    sidebarToggle: document.getElementById("report-pdf-sidebar-toggle"),
    previous: document.getElementById("report-pdf-prev"),
    next: document.getElementById("report-pdf-next"),
    pageNumber: document.getElementById("report-pdf-page-number"),
    pageCount: document.getElementById("report-pdf-page-count"),
    zoomOut: document.getElementById("report-pdf-zoom-out"),
    zoomIn: document.getElementById("report-pdf-zoom-in"),
    scale: document.getElementById("report-pdf-scale"),
    rotate: document.getElementById("report-pdf-rotate"),
    print: document.getElementById("report-pdf-print"),
    download: document.getElementById("report-pdf-download"),
};

function readHttpUrl(name) {
    const value = new URLSearchParams(window.location.search).get(name);
    if (!value) return "";
    try {
        const parsed = new URL(value, window.location.href);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
    } catch {
        return "";
    }
}

function readFilename() {
    const value = new URLSearchParams(window.location.search).get("filename") || "StratOps-Report.pdf";
    const safe = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
    return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe || "StratOps-Report"}.pdf`;
}

function showLoadError(message = "The selected PDF report could not be loaded.") {
    elements.loading.hidden = true;
    elements.error.textContent = message;
    elements.error.hidden = false;
}

function updateNavigation(pdfViewer, pageNumber, pageCount) {
    elements.pageNumber.value = String(pageNumber);
    elements.pageNumber.max = String(pageCount);
    elements.pageCount.textContent = `/ ${pageCount}`;
    elements.previous.disabled = pageNumber <= 1;
    elements.next.disabled = pageNumber >= pageCount;
}

function setActiveThumbnail(pageNumber) {
    const active = elements.thumbnails.querySelector(".report-pdf-thumbnail.is-active");
    if (active?.dataset.pageNumber === String(pageNumber)) return;
    if (active) {
        active.classList.remove("is-active");
        active.removeAttribute("aria-current");
    }
    const next = elements.thumbnails.querySelector(`[data-page-number="${pageNumber}"]`);
    if (!next) return;
    next.classList.add("is-active");
    next.setAttribute("aria-current", "page");
    next.scrollIntoView({ block: "nearest" });
}

async function renderThumbnail(pdfDocument, pageNumber, pdfViewer) {
    const page = await pdfDocument.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const cssWidth = 132;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const cssScale = cssWidth / unscaled.width;
    const renderViewport = page.getViewport({ scale: cssScale * dpr });
    const cssHeight = renderViewport.height / dpr;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "report-pdf-thumbnail";
    button.dataset.pageNumber = String(pageNumber);
    button.setAttribute("aria-label", `Go to page ${pageNumber}`);

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const context = canvas.getContext("2d", { alpha: false });
    button.append(canvas);

    const label = document.createElement("span");
    label.className = "report-pdf-thumbnail__label";
    label.textContent = `Page ${pageNumber}`;
    button.append(label);
    button.addEventListener("click", () => {
        pdfViewer.currentPageNumber = pageNumber;
        elements.container.focus({ preventScroll: true });
    });
    elements.thumbnails.append(button);

    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    if (pageNumber === pdfViewer.currentPageNumber) setActiveThumbnail(pageNumber);
}

async function renderThumbnails(pdfDocument, pdfViewer) {
    elements.thumbnails.replaceChildren();
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        await renderThumbnail(pdfDocument, pageNumber, pdfViewer);
    }
}

function createDownload(fileUrl, downloadUrl, filename) {
    const anchor = document.createElement("a");
    anchor.href = downloadUrl || fileUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
}

async function loadPdfBytes(fileUrl) {
    const parsed = new URL(fileUrl, window.location.href);
    const response = await fetch(parsed.href, {
        cache: "no-store",
        credentials: parsed.origin === window.location.origin ? "same-origin" : "omit",
        headers: { Accept: "application/pdf" },
    });
    if (!response.ok) throw new Error(`PDF request failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
        throw new Error("The report response was not a PDF document.");
    }
    return bytes;
}

async function initReportPdfViewer() {
    const fileUrl = readHttpUrl("file");
    const downloadUrl = readHttpUrl("download");
    const filename = readFilename();
    if (!fileUrl || !elements.container || !elements.viewer) {
        showLoadError("No valid PDF report was provided.");
        return;
    }

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({
        container: elements.container,
        viewer: elements.viewer,
        eventBus,
        linkService,
        imageResourcesPath: "/assets/pdfjs/images/",
    });
    linkService.setViewer(pdfViewer);

    elements.sidebarToggle.addEventListener("click", () => {
        const isClosed = document.body.classList.toggle("report-pdf-sidebar-closed");
        elements.sidebarToggle.setAttribute("aria-pressed", String(!isClosed));
    });
    elements.previous.addEventListener("click", () => {
        if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1;
    });
    elements.next.addEventListener("click", () => {
        if (pdfViewer.currentPageNumber < pdfViewer.pagesCount) pdfViewer.currentPageNumber += 1;
    });
    elements.pageNumber.addEventListener("change", () => {
        const pageNumber = Math.min(Math.max(Number(elements.pageNumber.value) || 1, 1), pdfViewer.pagesCount);
        pdfViewer.currentPageNumber = pageNumber;
    });
    elements.zoomOut.addEventListener("click", () => pdfViewer.decreaseScale());
    elements.zoomIn.addEventListener("click", () => pdfViewer.increaseScale());
    elements.scale.addEventListener("change", () => {
        pdfViewer.currentScaleValue = elements.scale.value;
    });
    elements.rotate.addEventListener("click", () => {
        pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
    });
    elements.print.addEventListener("click", () => window.print());
    elements.download.addEventListener("click", () => createDownload(fileUrl, downloadUrl, filename));

    eventBus.on("pagechanging", ({ pageNumber }) => {
        updateNavigation(pdfViewer, pageNumber, pdfViewer.pagesCount);
        setActiveThumbnail(pageNumber);
    });
    eventBus.on("scalechanging", ({ presetValue, scale }) => {
        const value = presetValue || String(Math.round(scale * 100) / 100);
        const option = [...elements.scale.options].find((candidate) => candidate.value === value);
        if (option) elements.scale.value = option.value;
    });
    eventBus.on("pagesinit", () => {
        pdfViewer.currentScaleValue = "page-width";
        updateNavigation(pdfViewer, 1, pdfViewer.pagesCount);
    });

    try {
        const bytes = await loadPdfBytes(fileUrl);
        const loadingTask = getDocument({ data: bytes });
        const pdfDocument = await loadingTask.promise;
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        elements.loading.hidden = true;
        elements.error.hidden = true;
        void renderThumbnails(pdfDocument, pdfViewer).catch((error) => {
            console.warn("[report-pdf-viewer] thumbnail rendering failed", error);
        });
    } catch (error) {
        console.error("[report-pdf-viewer] PDF load failed", error);
        showLoadError(error?.message || undefined);
    }
}

void initReportPdfViewer();
