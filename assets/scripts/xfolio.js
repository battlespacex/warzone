// assets/scripts/xfolio.js
import { xfolioSlides } from "./images-data.js";

let items = [];
let renderedCount = 0;
let batchSize = 9;

let grid = null;
let showMoreBtn = null;
let messageEl = null;
let initialMessageSpan = null;
let finalMessageSpan = null;
let cardObserver = null;

let lightboxEl = null;
let lightboxImg = null;

let lightboxCaption = null;

let lightboxTitle = null;

let lightboxPrevBtn = null;
let lightboxNextBtn = null;
let lightboxCloseBtn = null;

let lightboxReturnFocusEl = null;
let lightboxPreviouslyFocusedEl = null;

let lightboxDownloadBtn = null;

let currentLightboxIndex = -1;
let lightboxFadeTimeoutId = null;

const sizePattern = ["Type3", "Type4", "Type3", "Type3", "Type4", "Type3", "Type3", "Type3", "Type4"];
const IMAGE_FADE_DURATION = 400;
const UI_FADE_DELAY_MS = 200;

// Cancel token for rapid next/prev clicks
let lightboxSwapToken = 0;

function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function preloadImage(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(false);

        const im = new Image();
        let settled = false;

        const done = (ok) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };

        im.onload = () => done(true);
        im.onerror = () => done(false);
        im.src = src;

        // Decode helps prevent pop-in
        if (typeof im.decode === "function") {
            im.decode().then(() => done(true)).catch(() => done(true));
        }
    });
}

async function decodeOrLoadImg(img, timeout = 1500) {
    if (!img) return;

    if (typeof img.decode === "function") {
        try {
            await Promise.race([img.decode(), waitMs(timeout)]);
            return;
        } catch (_) {
        }
    }

    if (img.complete) return;

    await Promise.race([
        new Promise((resolve) => {
            const finish = () => resolve();
            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
        }),
        waitMs(timeout),
    ]);
}

// Hard guarantee: wait for actual load/error event (best for loader “stay up”)
function waitForImgLoadEvent(img, timeout = 12000) {
    if (!img) return Promise.resolve();
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();

    return new Promise((resolve) => {
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(t);
            img.removeEventListener("load", finish);
            img.removeEventListener("error", finish);
            resolve();
        };

        const t = setTimeout(finish, timeout);
        img.addEventListener("load", finish, { once: true });
        img.addEventListener("error", finish, { once: true });
    });
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function getSizeForIndex(index) {
    const patternIndex = index % sizePattern.length;
    return sizePattern[patternIndex];
}

function sortAndFilterItems(list) {
    const activeItems = (list || []).filter((item) => {
        if (!item) return false;
        if (item.active === false) return false;
        return true;
    });

    return activeItems
        .slice()
        .sort((a, b) => {
            const aSort = typeof a.sort === "number" ? a.sort : Number.MAX_SAFE_INTEGER;
            const bSort = typeof b.sort === "number" ? b.sort : Number.MAX_SAFE_INTEGER;
            return aSort - bSort;
        });
}

function mapGalleryToxfolioItems() {
    const src = Array.isArray(xfolioSlides) ? xfolioSlides : [];

    return src.map((img, index) => {
        const sort =
            img && typeof img.sortOrder === "number"
                ? img.sortOrder
                : index + 1;

        const isActive = img && img.active !== false;

        return {
            active: isActive,
            sort,
            id: `tmp-${index + 1}`,
            imageKey: img && img.image ? String(img.image) : "",
            thumb: img && img.thumbnail ? img.thumbnail : img.imageLarge || "",
            full: img && img.imageLarge ? img.imageLarge : img.thumbnail || "",
            title: img && img.title ? img.title : "",
            description: img && img.description ? img.description : "",
            alt: img && img.alt ? img.alt : "",
            tags: safeArray(img && img.tags),
            aircraft: img && img.aircraft ? img.aircraft : "",
            location: img && img.location ? img.location : "",
        };
    });
}

function assignFolioIds(sortedItems) {
    const used = new Set();
    return (sortedItems || []).map((it, i) => {
        let id = `folio-${i + 1}`;
        if (used.has(id)) id = `${id}-${i + 1}`;
        used.add(id);
        return { ...it, id };
    });
}

function createCard(item, index, { eager = false } = {}) {
    const doc = document;

    const article = doc.createElement("article");
    article.className = "xfolioItem";
    article.setAttribute("role", "article");

    if (item && item.id) {
        article.id = String(item.id);
        article.dataset.itemId = String(item.id);
    }

    article.dataset.index = String(index);

    const sizeType = getSizeForIndex(index);
    article.classList.add("size" + sizeType);

    const tags = safeArray(item.tags);
    if (tags.length) {
        article.dataset.tags = tags.join(", ");
    }

    article.style.setProperty("--stagger-index", String(index));

    const media = doc.createElement("div");
    media.className = "xfolioItemMedia";

    if (item.full) {
        media.dataset.fullImage = item.full;
    }

    const img = doc.createElement("img");
    if (item.thumb) {
        img.src = item.thumb;

        // KEY: for newly appended batch, force eager start
        img.loading = eager ? "eager" : "lazy";
        img.decoding = "async";

        if (eager) {
            try { img.fetchPriority = "high"; } catch (_) { /* ignore */ }
        }
    }
    img.alt = typeof item.alt === "string" ? item.alt : "";

    media.appendChild(img);

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "xfolioItemOpen x-icon";
    button.setAttribute("aria-label", "Open image");
    button.innerHTML = "<span aria-hidden='true'>arrow_outward</span>";

    const body = doc.createElement("div");
    body.className = "xfolioItemBody sr-only";

    const title = doc.createElement("h3");
    const srTitle = item.title || item.aircraft || "Gallery image";
    title.textContent = srTitle;

    const desc = doc.createElement("p");
    const srDescParts = [];
    if (item.location) srDescParts.push(item.location);
    if (item.description) srDescParts.push(item.description);
    desc.textContent = srDescParts.join(" · ");

    body.appendChild(title);
    body.appendChild(desc);

    if (tags.length) {
        const srTags = doc.createElement("p");
        srTags.textContent = "Tags: " + tags.join(", ");
        body.appendChild(srTags);
    }

    article.appendChild(media);
    article.appendChild(button);
    article.appendChild(body);

    return article;
}

function showFinalMessageAndHideButton() {
    if (initialMessageSpan && finalMessageSpan) {
        initialMessageSpan.hidden = true;
        finalMessageSpan.hidden = false;
    }
    if (showMoreBtn) {
        showMoreBtn.setAttribute("hidden", "hidden");
        showMoreBtn.style.display = "none";
        showMoreBtn.setAttribute("aria-hidden", "true");
        showMoreBtn.setAttribute("tabindex", "-1");
    }
}

function afterRenderUpdateUI() {
    if (renderedCount >= items.length) {
        showFinalMessageAndHideButton();
    }
}

function renderNextBatch(count, { eager = false } = {}) {
    if (!grid) return;
    if (renderedCount >= items.length) return;

    const end = Math.min(renderedCount + count, items.length);
    const frag = document.createDocumentFragment();

    for (let i = renderedCount; i < end; i += 1) {
        const card = createCard(items[i] || {}, i, { eager });
        frag.appendChild(card);

        if (cardObserver) cardObserver.observe(card);
        else card.classList.add("is-visible");
    }

    grid.appendChild(frag);
    renderedCount = end;

    afterRenderUpdateUI();
}

function setupCardObserver() {
    if (!("IntersectionObserver" in window)) {
        cardObserver = null;
        return;
    }

    cardObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    cardObserver.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.01, rootMargin: "200px 0px" }
    );
}

function getSiteLoader() {
    const sl = window.SiteLoader;
    if (!sl) return null;
    if (typeof sl.start !== "function" || typeof sl.stop !== "function") return null;
    return sl;
}

function setupShowMore() {
    if (!showMoreBtn) return;

    showMoreBtn.addEventListener("click", async () => {
        if (showMoreBtn.disabled) return;

        showMoreBtn.disabled = true;
        showMoreBtn.classList.add("is-loading");
        showMoreBtn.setAttribute("aria-busy", "true");

        const SL = getSiteLoader();
        SL?.start();

        // Let loader paint immediately
        await new Promise((r) => requestAnimationFrame(r));

        const startIndex = renderedCount;
        const endIndex = Math.min(startIndex + batchSize, items.length);

        // 1) FORCE NETWORK: preload the next batch thumbs NOW (independent of DOM / lazy)
        const urlsToPreload = [];
        for (let i = startIndex; i < endIndex; i += 1) {
            const it = items[i];
            const url = it?.thumb || it?.full;
            if (url) urlsToPreload.push(url);
        }

        // Safety timeout so you never get stuck
        const PRELOAD_TIMEOUT_MS = 15000;

        const preloadAll = Promise.race([
            Promise.all(urlsToPreload.map((u) => preloadImage(u))),
            waitMs(PRELOAD_TIMEOUT_MS),
        ]);

        // 2) Render the batch immediately (so layout changes right away)
        renderNextBatch(batchSize, { eager: true });

        // Optional UX: bring the first new card into view a bit (so user sees change)
        const firstNewCard = grid.querySelector(`.xfolioItem[data-index="${startIndex}"]`);
        if (firstNewCard) {
            firstNewCard.scrollIntoView({ block: "nearest" });
        }

        // 3) Keep loader visible until preload completes (or timeout)
        await preloadAll;

        // 4) Stop loader (keep a tiny delay for smoother exit)
        if (SL) {
            await SL.stop({ delay: 250 });
        }

        showMoreBtn.classList.remove("is-loading");
        showMoreBtn.removeAttribute("aria-busy");
        showMoreBtn.disabled = false;
    });
}

// ------------------------------
// Auto caption + icon contrast (Lightbox)
// ------------------------------
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function isMobileViewport() {
    // matches your CSS breakpoint (<=768px)
    return window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
}

function getAvgLuminanceFromImageRegion(imgEl, region = { x: 0.30, y: 0.05, w: 0.40, h: 0.14 }) {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return null;

    const rect = imgEl.getBoundingClientRect();
    const drawW = Math.max(1, Math.floor(rect.width));
    const drawH = Math.max(1, Math.floor(rect.height));

    const canvas = document.createElement("canvas");
    canvas.width = drawW;
    canvas.height = drawH;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(imgEl, 0, 0, drawW, drawH);

    const sx = clamp(Math.floor(region.x * drawW), 0, drawW - 1);
    const sy = clamp(Math.floor(region.y * drawH), 0, drawH - 1);
    const sw = clamp(Math.floor(region.w * drawW), 1, drawW - sx);
    const sh = clamp(Math.floor(region.h * drawH), 1, drawH - sy);

    let data;
    try {
        data = ctx.getImageData(sx, sy, sw, sh).data;
    } catch (_) {
        // likely tainted canvas (cross-origin)
        return null;
    }

    const stride = 16;
    let sum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4 * stride) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0..255
        sum += lum;
        count += 1;
    }

    return count ? sum / count : null;
}

function applyAutoThemeClasses() {
    if (!lightboxEl || !lightboxImg) return;

    const inner = lightboxEl.querySelector(".xfolioLightboxInner");
    if (!inner) return;

    inner.classList.remove("caption--dark", "caption--light");

    // MOBILE: do not auto-change icon colors (you asked)
    if (isMobileViewport()) {
        inner.classList.add("caption--light");
        return;
    }

    const avgLum = getAvgLuminanceFromImageRegion(lightboxImg, {
        x: 0.30,
        y: 0.05,
        w: 0.40,
        h: 0.14
    });

    if (avgLum == null) {
        inner.classList.add("caption--light");
        return;
    }

    if (avgLum > 140) inner.classList.add("caption--dark");
    else inner.classList.add("caption--light");
}

function setUiVisible(isVisible) {
    if (lightboxTitle) lightboxTitle.classList.toggle("is-visible", !!isVisible);
    if (lightboxDownloadBtn) lightboxDownloadBtn.classList.toggle("is-visible", !!isVisible);
}

function lockUiHiddenInstant() {
    const els = [lightboxTitle, lightboxDownloadBtn].filter(Boolean);

    els.forEach((el) => {
        el.classList.remove("is-visible");
        el.classList.add("is-lock-hidden");
    });

    if (els[0]) void els[0].offsetHeight;

    els.forEach((el) => el.classList.remove("is-lock-hidden"));
}


// ---------- Lightbox ----------

function createLightbox() {
    if (lightboxEl) return;

    const doc = document;

    lightboxEl = doc.createElement("div");
    lightboxEl.className = "xfolioLightbox";
    lightboxEl.setAttribute("role", "dialog");
    lightboxEl.setAttribute("aria-modal", "true");
    lightboxEl.setAttribute("aria-hidden", "true");
    lightboxEl.setAttribute("inert", "");

    const inner = doc.createElement("div");
    inner.className = "xfolioLightboxInner";


    lightboxTitle = doc.createElement("div");
    lightboxTitle.className = "xfolioLightboxTitle h5";
    lightboxTitle.setAttribute("aria-hidden", "true");
    lightboxTitle.textContent = "";

    const mediaWrapper = doc.createElement("div");
    mediaWrapper.className = "xfolioLightboxMedia";

    lightboxImg = doc.createElement("img");
    lightboxImg.alt = "";
    lightboxImg.className = "xfolioLightboxImage";

    mediaWrapper.appendChild(lightboxImg);

    lightboxCaption = doc.createElement("p");
    lightboxCaption.className = "xfolioLightboxCaption sr-only";

    lightboxCloseBtn = doc.createElement("button");
    lightboxCloseBtn.type = "button";
    lightboxCloseBtn.className = "xfolioLightboxClose x-icon";
    lightboxCloseBtn.setAttribute("aria-label", "Close image");
    lightboxCloseBtn.innerHTML = "<span aria-hidden='true'>close</span>";

    lightboxPrevBtn = doc.createElement("button");
    lightboxPrevBtn.type = "button";
    lightboxPrevBtn.className = "xfolioLightboxNav xfolioLightboxNav--prev x-icon";
    lightboxPrevBtn.setAttribute("aria-label", "Previous image");
    lightboxPrevBtn.innerHTML = "<span aria-hidden='true'>chevron_left</span>";

    lightboxNextBtn = doc.createElement("button");
    lightboxNextBtn.type = "button";
    lightboxNextBtn.className = "xfolioLightboxNav xfolioLightboxNav--next x-icon";
    lightboxNextBtn.setAttribute("aria-label", "Next image");
    lightboxNextBtn.innerHTML = "<span aria-hidden='true'>chevron_right</span>";

    lightboxDownloadBtn = doc.createElement("button");
    lightboxDownloadBtn.type = "button";
    lightboxDownloadBtn.className = "xfolioLightboxDownload x-icon";
    lightboxDownloadBtn.setAttribute("aria-label", "Download full HD image");
    lightboxDownloadBtn.setAttribute("title", "Download full HD image");
    lightboxDownloadBtn.innerHTML = `
        <span aria-hidden="true">hd</span>
        <span aria-hidden="true">download</span>
        <span class="sr-only">Download full HD</span>
    `;

    inner.appendChild(lightboxTitle);
    inner.appendChild(mediaWrapper);
    inner.appendChild(lightboxCaption);

    inner.appendChild(lightboxCloseBtn);
    inner.appendChild(lightboxDownloadBtn);
    inner.appendChild(lightboxPrevBtn);
    inner.appendChild(lightboxNextBtn);

    lightboxEl.appendChild(inner);
    doc.body.appendChild(lightboxEl);

    lightboxEl.addEventListener("click", (evt) => {
        if (evt.target === lightboxEl) hideLightbox();
    });

    lightboxCloseBtn.addEventListener("click", () => hideLightbox());
    lightboxPrevBtn.addEventListener("click", () => showAdjacent(-1));
    lightboxNextBtn.addEventListener("click", () => showAdjacent(1));

    // Download current image
    lightboxDownloadBtn.addEventListener("click", () => {
        if (currentLightboxIndex < 0 || currentLightboxIndex >= items.length) return;

        const it = items[currentLightboxIndex];
        const url = it?.full || it?.thumb;
        if (!url) return;

        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    });

    doc.addEventListener("keydown", (evt) => {
        if (!lightboxEl || !lightboxEl.classList.contains("is-open")) return;

        if (evt.key === "Escape") hideLightbox();
        else if (evt.key === "ArrowLeft") showAdjacent(-1);
        else if (evt.key === "ArrowRight") showAdjacent(1);
    });

    // Handle resize: if user rotates / changes breakpoint while open
    window.addEventListener("resize", () => {
        if (!lightboxEl || !lightboxEl.classList.contains("is-open")) return;
        applyAutoThemeClasses();
    });
}

async function setLightboxContent(index, { useTransition = false } = {}) {
    if (!items[index] || !lightboxImg) return;

    const item = items[index];
    const src = item.full || item.thumb || "";
    const altText = item.alt || item.title || item.aircraft || "";
    const visibleTitleText = item.title || item.aircraft || "";
    const srCaptionText = item.title || item.description || item.aircraft || "";

    lightboxSwapToken += 1;
    const token = lightboxSwapToken;

    if (lightboxFadeTimeoutId !== null) {
        clearTimeout(lightboxFadeTimeoutId);
        lightboxFadeTimeoutId = null;
    }

    lockUiHiddenInstant();

    if (lightboxTitle) lightboxTitle.textContent = visibleTitleText;
    if (lightboxCaption) lightboxCaption.textContent = srCaptionText;

    if (!useTransition || !lightboxImg.src) {
        lightboxImg.classList.remove("is-visible");

        lightboxImg.src = src;
        lightboxImg.alt = altText;

        await decodeOrLoadImg(lightboxImg, 1500);
        if (token !== lightboxSwapToken) return;

        requestAnimationFrame(() => {
            if (token !== lightboxSwapToken) return;

            // decide theme based on background (web/tablet only)
            applyAutoThemeClasses();

            // fade image in
            lightboxImg.classList.add("is-visible");

            // fade UI in after delay
            window.setTimeout(() => {
                if (token !== lightboxSwapToken) return;
                setUiVisible(true);
            }, UI_FADE_DELAY_MS);
        });

        return;
    }

    // transition swap
    lightboxImg.classList.remove("is-visible");

    await Promise.all([waitMs(IMAGE_FADE_DURATION), preloadImage(src)]);
    if (token !== lightboxSwapToken) return;

    lightboxImg.src = src;
    lightboxImg.alt = altText;

    await decodeOrLoadImg(lightboxImg, 1500);
    if (token !== lightboxSwapToken) return;

    requestAnimationFrame(() => {
        if (token !== lightboxSwapToken) return;

        applyAutoThemeClasses();

        lightboxImg.classList.add("is-visible");

        window.setTimeout(() => {
            if (token !== lightboxSwapToken) return;
            setUiVisible(true);
        }, UI_FADE_DELAY_MS);
    });
}

function showLightbox(index, returnFocusEl = null) {
    if (!lightboxEl || !lightboxImg) return;
    if (index < 0 || index >= items.length) return;

    lightboxPreviouslyFocusedEl = document.activeElement;
    lightboxReturnFocusEl = returnFocusEl || lightboxPreviouslyFocusedEl;

    currentLightboxIndex = index;

    lightboxEl.classList.remove("is-closing");
    lightboxEl.classList.add("is-open");

    lightboxEl.removeAttribute("inert");
    lightboxEl.setAttribute("aria-hidden", "false");

    setUiVisible(false);
    setLightboxContent(index, { useTransition: false });

    requestAnimationFrame(() => {
        lightboxCloseBtn?.focus({ preventScroll: true });
    });
}

function hideLightbox() {
    if (!lightboxEl) return;

    lightboxSwapToken += 1;

    if (lightboxFadeTimeoutId !== null) {
        clearTimeout(lightboxFadeTimeoutId);
        lightboxFadeTimeoutId = null;
    }

    // fade UI out with image
    setUiVisible(false);

    if (lightboxImg) {
        lightboxImg.classList.remove("is-visible");
    }

    const returnTo = lightboxReturnFocusEl || lightboxPreviouslyFocusedEl;
    if (returnTo && typeof returnTo.focus === "function" && document.contains(returnTo)) {
        returnTo.focus({ preventScroll: true });
    } else {
        document.body.focus?.({ preventScroll: true });
    }

    lightboxEl.classList.add("is-closing");
    lightboxEl.setAttribute("aria-hidden", "true");
    lightboxEl.setAttribute("inert", "");

    currentLightboxIndex = -1;

    const onTransitionEnd = (evt) => {
        if (evt.target !== lightboxEl || evt.propertyName !== "opacity") return;

        lightboxEl.classList.remove("is-open");
        lightboxEl.classList.remove("is-closing");
        lightboxEl.removeEventListener("transitionend", onTransitionEnd);

        lightboxReturnFocusEl = null;
        lightboxPreviouslyFocusedEl = null;
    };

    lightboxEl.addEventListener("transitionend", onTransitionEnd);
}

function showAdjacent(delta) {
    if (!items.length) return;
    if (currentLightboxIndex === -1) return;

    let nextIndex = currentLightboxIndex + delta;

    if (nextIndex < 0) nextIndex = items.length - 1;
    else if (nextIndex >= items.length) nextIndex = 0;

    currentLightboxIndex = nextIndex;
    setLightboxContent(nextIndex, { useTransition: true });
}

function setupLightbox() {
    createLightbox();
    if (!grid) return;

    grid.addEventListener("click", (evt) => {
        const trigger = evt.target.closest(".xfolioItemMedia, .xfolioItemOpen");
        if (!trigger || !grid.contains(trigger)) return;

        const card = trigger.closest(".xfolioItem");
        if (!card) return;

        const indexAttr = card.dataset.index;
        const index = typeof indexAttr === "string" ? parseInt(indexAttr, 10) : -1;

        const returnFocusEl =
            trigger.classList.contains("xfolioItemOpen")
                ? trigger
                : card.querySelector(".xfolioItemOpen");

        if (!Number.isNaN(index) && index >= 0 && index < items.length) {
            showLightbox(index, returnFocusEl);
        }
    });
}

export function initXFolio(options = {}) {
    grid = document.getElementById("xfolio-grid");
    showMoreBtn = document.getElementById("xfolio-show-more");
    messageEl = document.getElementById("xfolio-message");

    if (messageEl) {
        initialMessageSpan = messageEl.querySelector('[data-message="initial"]');
        finalMessageSpan = messageEl.querySelector('[data-message="final"]');
    }

    if (!grid) {
        console.warn("initXFolio: #xfolio-grid not found");
        return;
    }

    renderedCount = 0;
    grid.innerHTML = "";

    if (typeof options.batchSize === "number" && options.batchSize > 0) {
        batchSize = options.batchSize;
    }

    const rawItems = mapGalleryToxfolioItems();
    const sorted = sortAndFilterItems(rawItems);
    items = assignFolioIds(sorted);

    if (!items.length) {
        console.warn("initXFolio: no items to render (check active flags).");
        if (showMoreBtn) {
            showMoreBtn.setAttribute("hidden", "hidden");
            showMoreBtn.style.display = "none";
        }
        return;
    }

    if (items.length <= batchSize && showMoreBtn) {
        showMoreBtn.setAttribute("hidden", "hidden");
        showMoreBtn.style.display = "none";
        showMoreBtn.setAttribute("aria-hidden", "true");
        showMoreBtn.setAttribute("tabindex", "-1");
    }

    setupCardObserver();
    setupShowMore();
    setupLightbox();

    renderNextBatch(batchSize);
}
