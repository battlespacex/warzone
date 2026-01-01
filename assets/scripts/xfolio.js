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
let lightboxPrevBtn = null;
let lightboxNextBtn = null;
let lightboxCloseBtn = null;

// Download button (now inside xfolioLightboxInner)
let lightboxDownloadBtn = null;

let currentLightboxIndex = -1;
let lightboxFadeTimeoutId = null;

const sizePattern = ["Type3", "Type4", "Type3", "Type3", "Type4", "Type3", "Type3", "Type3", "Type4"];
const IMAGE_FADE_DURATION = 400;

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
            // fall through
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

function createCard(item, index) {
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
        img.loading = "lazy";
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

function renderNextBatch(count) {
    if (!grid) return;
    if (renderedCount >= items.length) return;

    const end = Math.min(renderedCount + count, items.length);
    const frag = document.createDocumentFragment();

    for (let i = renderedCount; i < end; i += 1) {
        const card = createCard(items[i] || {}, i);
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

function waitForImg(img, timeout = 1200) {
    if (!img) return Promise.resolve();
    if (img.complete) return Promise.resolve();

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

async function waitForImagesInCards(cards, timeout = 1200) {
    const imgs = cards.flatMap((c) => Array.from(c.querySelectorAll("img")));
    if (!imgs.length) return;
    await Promise.all(imgs.map((img) => waitForImg(img, timeout)));
}

function setupShowMore() {
    if (!showMoreBtn) return;

    showMoreBtn.addEventListener("click", async () => {
        const SL = getSiteLoader();
        SL?.start();

        const startIndex = renderedCount;
        renderNextBatch(batchSize);

        const newCards = Array.from(grid.querySelectorAll(".xfolioItem")).filter((card) => {
            const i = parseInt(card.dataset.index || "-1", 10);
            return i >= startIndex;
        });

        await waitForImagesInCards(newCards, 1200);

        SL?.stop({ delay: 200 });
    });
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

    const inner = doc.createElement("div");
    inner.className = "xfolioLightboxInner";

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
        <span aria-hidden="true">download</span>
        <span class="sr-only">Download full HD</span>
    `;

    inner.appendChild(mediaWrapper);
    inner.appendChild(lightboxCaption);

    // order: close + download + prev/next
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
        a.download = ""; // browser chooses filename
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
}

async function setLightboxContent(index, { useTransition = false } = {}) {
    if (!items[index] || !lightboxImg) return;

    const item = items[index];
    const src = item.full || item.thumb || "";
    const altText = item.alt || item.title || item.aircraft || "";
    const captionText = item.title || item.description || item.aircraft || "";

    lightboxSwapToken += 1;
    const token = lightboxSwapToken;

    if (lightboxFadeTimeoutId !== null) {
        clearTimeout(lightboxFadeTimeoutId);
        lightboxFadeTimeoutId = null;
    }

    if (lightboxCaption) lightboxCaption.textContent = captionText;

    if (!useTransition || !lightboxImg.src) {
        lightboxImg.classList.remove("is-visible");

        lightboxImg.src = src;
        lightboxImg.alt = altText;

        await decodeOrLoadImg(lightboxImg, 1500);
        if (token !== lightboxSwapToken) return;

        requestAnimationFrame(() => {
            if (token !== lightboxSwapToken) return;
            lightboxImg.classList.add("is-visible");
        });

        return;
    }

    lightboxImg.classList.remove("is-visible");

    await Promise.all([waitMs(IMAGE_FADE_DURATION), preloadImage(src)]);
    if (token !== lightboxSwapToken) return;

    lightboxImg.src = src;
    lightboxImg.alt = altText;

    await decodeOrLoadImg(lightboxImg, 1500);
    if (token !== lightboxSwapToken) return;

    requestAnimationFrame(() => {
        if (token !== lightboxSwapToken) return;
        lightboxImg.classList.add("is-visible");
    });
}

function showLightbox(index) {
    if (!lightboxEl || !lightboxImg) return;
    if (index < 0 || index >= items.length) return;

    currentLightboxIndex = index;

    lightboxEl.classList.remove("is-closing");
    lightboxEl.classList.add("is-open");
    lightboxEl.setAttribute("aria-hidden", "false");

    setLightboxContent(index, { useTransition: false });
}

function hideLightbox() {
    if (!lightboxEl) return;

    lightboxSwapToken += 1;

    if (lightboxFadeTimeoutId !== null) {
        clearTimeout(lightboxFadeTimeoutId);
        lightboxFadeTimeoutId = null;
    }

    if (lightboxImg) {
        lightboxImg.classList.remove("is-visible");
    }

    lightboxEl.classList.add("is-closing");
    lightboxEl.setAttribute("aria-hidden", "true");
    currentLightboxIndex = -1;

    const onTransitionEnd = (evt) => {
        if (evt.target !== lightboxEl || evt.propertyName !== "opacity") return;

        lightboxEl.classList.remove("is-open");
        lightboxEl.classList.remove("is-closing");
        lightboxEl.removeEventListener("transitionend", onTransitionEnd);
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

        if (!Number.isNaN(index) && index >= 0 && index < items.length) {
            showLightbox(index);
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
