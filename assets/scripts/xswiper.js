// assets/scripts/xswiper.js
/*!
 * XSwiper Slider — SEO + Accessibility tuned + TRUE seamless loop (triple-set)
 * - Keeps original Title + Subtitle for desktop
 * - Adds xswiper__seo INSIDE xswiper__content (renders raw HTML from slide.description)
 * - You control visibility via CSS:
 *   Desktop: .xswiper__seo { display:none }
 *   Mobile:  hide .xswiper__title/.xswiper__subtitle and show .xswiper__seo
 */

import { xswiperSlides } from "./images-data.js";

export function initXSwiper(rootSelector) {
    const root =
        typeof rootSelector === "string"
            ? document.querySelector(rootSelector)
            : rootSelector;

    if (!root) {
        console.warn("[XSwiper] Root element not found:", rootSelector);
        return;
    }

    if (typeof root.__xswiperCleanup === "function") {
        root.__xswiperCleanup();
        root.__xswiperCleanup = null;
    }

    const slideData = (Array.isArray(xswiperSlides) ? xswiperSlides : []).filter(
        (s) => s && s.active !== false
    );

    if (!slideData.length) {
        console.warn("[XSwiper] No slides provided (check xswiperSlides).");
        return;
    }

    const TRACK_DURATION = 0.7;
    const TEXT_DURATION = 0.8;
    const TEXT_DELAY = 0.2;
    const AUTO_DELAY = 5000;

    const reduceMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    root.classList.add("xswiper");
    root.setAttribute("tabindex", "0");
    root.setAttribute("role", "region");
    root.setAttribute("aria-roledescription", "carousel");
    root.setAttribute("aria-label", root.getAttribute("aria-label") || "Image carousel");

    function ensureUI() {
        let viewport = root.querySelector(":scope > .xswiper__viewport");
        if (!viewport) {
            viewport = document.createElement("div");
            viewport.className = "xswiper__viewport";
            viewport.dataset.xswiperUi = "1";
            root.prepend(viewport);
        }

        let track = viewport.querySelector(":scope > .xswiper__track");
        if (!track) {
            track = document.createElement("div");
            track.className = "xswiper__track";
            track.dataset.xswiperUi = "1";
            viewport.appendChild(track);
        }

        let prevBtn = root.querySelector(":scope > .xswiper__nav--prev");
        if (!prevBtn) {
            prevBtn = document.createElement("button");
            prevBtn.className = "xswiper__nav xswiper__nav--prev x-icon";
            prevBtn.type = "button";
            prevBtn.setAttribute("aria-label", "Previous slide");
            prevBtn.dataset.xswiperUi = "1";
            prevBtn.innerHTML = `<span aria-hidden="true">chevron_left</span>`;
            root.appendChild(prevBtn);
        }

        let nextBtn = root.querySelector(":scope > .xswiper__nav--next");
        if (!nextBtn) {
            nextBtn = document.createElement("button");
            nextBtn.className = "xswiper__nav xswiper__nav--next x-icon";
            nextBtn.type = "button";
            nextBtn.setAttribute("aria-label", "Next slide");
            nextBtn.dataset.xswiperUi = "1";
            nextBtn.innerHTML = `<span aria-hidden="true">chevron_right</span>`;
            root.appendChild(nextBtn);
        }

        let indicator = root.querySelector(":scope > .xswiper__indicator");
        if (!indicator) {
            indicator = document.createElement("div");
            indicator.className = "xswiper__indicator";
            indicator.dataset.xswiperUi = "1";
            indicator.innerHTML = `
        <span class="xswiper__indicator-current"></span>
        <div class="xswiper__indicator-rail">
          <div class="xswiper__indicator-line"></div>
          <div class="xswiper__indicator-thumb"></div>
        </div>
        <span class="xswiper__indicator-total"></span>
      `;
            root.appendChild(indicator);
        }

        return { viewport, track, prevBtn, nextBtn, indicator };
    }

    const { viewport, track, prevBtn, nextBtn, indicator } = ensureUI();

    const indicatorCurrent = indicator.querySelector(".xswiper__indicator-current");
    const indicatorTotal = indicator.querySelector(".xswiper__indicator-total");
    const indicatorThumb = indicator.querySelector(".xswiper__indicator-thumb");
    const indicatorRail = indicator.querySelector(".xswiper__indicator-rail");

    const sortedSlides = slideData
        .slice()
        .sort((a, b) => {
            const aOrder =
                typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
            const bOrder =
                typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
        })
        .map((s, i) => ({ ...s, id: `slide-${i + 1}` }));

    const realSlidesCount = sortedSlides.length;

    root.style.setProperty("--xswiper-indicator-steps", String(realSlidesCount));
    if (indicatorTotal) indicatorTotal.textContent = String(realSlidesCount);

    if (indicatorRail) {
        indicatorRail.querySelectorAll(".xswiper__indicator-tick").forEach((n) => n.remove());

        for (let i = 1; i < realSlidesCount; i++) {
            const tick = document.createElement("div");
            tick.className = "xswiper__indicator-tick";
            tick.style.setProperty("--tick-pos", String(i / realSlidesCount));
            indicatorRail.appendChild(tick);
        }
    }

    function escapeHtml(str = "") {
        return String(str)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function joinTitleSubtitle(title, subtitle) {
        const t = String(title || "").trim();
        const s = String(subtitle || "").trim();
        if (t && s) return `${t} ${s}`;
        return t || s || "";
    }

    function logicalIndexFromPhysical(physicalIndex) {
        const m = physicalIndex % realSlidesCount;
        return m < 0 ? m + realSlidesCount : m;
    }

    function createSlideEl(slide, isFirstReal = false) {
        const slideEl = document.createElement("article");
        slideEl.className = "xswiper__slide";
        slideEl.id = slide.id;

        slideEl.setAttribute("role", "group");
        slideEl.setAttribute("aria-roledescription", "slide");

        const title = String(slide.title || "");
        const subtitle = String(slide.subtitle || "");
        const combined = joinTitleSubtitle(title, subtitle);

        const titleEsc = escapeHtml(title);
        const subtitleEsc = escapeHtml(subtitle);

        // IMPORTANT:
        // description is rendered as RAW HTML inside .xswiper__seo
        // You control it in your data: `<span class="h2">..</span> ...`
        const descriptionHtml = String(slide.description || "").trim();

        const alt = escapeHtml(slide.alt || combined || "Carousel image");

        const mobImage = slide.mobImage || slide.deskImage || "";
        const deskImage = slide.deskImage || slide.mobImage || "";

        slideEl.innerHTML = `
      <picture>
        ${mobImage ? `<source media="(max-width: 768px)" srcset="${mobImage}">` : ``}
        ${deskImage ? `<source media="(min-width: 769px)" srcset="${deskImage}">` : ``}
        <img
          class="xswiper__image"
          src="${deskImage || mobImage}"
          alt="${alt}"
          draggable="false"
          decoding="async"
          ${isFirstReal ? `fetchpriority="high" loading="eager"` : `loading="lazy"`}
        />
      </picture>

        <div class="xswiper__content">
          ${titleEsc ? `<span class="xswiper__title h2" aria-hidden="true" data-nosnippet="true">${titleEsc}</span>` : ``}
          ${subtitleEsc ? `<span class="xswiper__subtitle h1" aria-hidden="true" data-nosnippet="true">${subtitleEsc}</span>` : ``}
          ${descriptionHtml ? `<div class="xswiper__seo" data-nosnippet="false">${descriptionHtml}</div>` : ``}
        </div>`;

        slideEl.dataset.seoTitle = combined;
        return slideEl;
    }

    // ----------------------------
    // Build DOM: 3 full sets
    // ----------------------------
    track.innerHTML = "";
    const slidesEls = [];

    for (let set = 0; set < 3; set++) {
        sortedSlides.forEach((slide, i) => {
            const isMiddleFirst = set === 1 && i === 0;
            const el = createSlideEl(slide, isMiddleFirst);
            el.dataset.set = String(set);
            el.dataset.logical = String(i);
            track.appendChild(el);
            slidesEls.push(el);
        });
    }

    // Aria-labels like "3 of 7: ..."
    slidesEls.forEach((el, physicalIndex) => {
        const li = logicalIndexFromPhysical(physicalIndex);
        const n = li + 1;
        const t = el.dataset.seoTitle || "";
        el.setAttribute(
            "aria-label",
            t ? `${n} of ${realSlidesCount}: ${t}` : `${n} of ${realSlidesCount}`
        );
    });

    const images = slidesEls.map((s) => s.querySelector(".xswiper__image"));
    const contents = slidesEls.map((s) => s.querySelector(".xswiper__content"));
    const titles = slidesEls.map((s) => s.querySelector(".xswiper__title"));
    const subtitles = slidesEls.map((s) => s.querySelector(".xswiper__subtitle"));

    // Start in the middle set (set B)
    let currentIndex = realSlidesCount;
    let isAnimating = false;

    let autoplayEnabled = !reduceMotion;
    let autoplayTimer = null;

    function updateIndicator() {
        if (!realSlidesCount) return;
        const logicalIndex = logicalIndexFromPhysical(currentIndex);
        const currentNumber = logicalIndex + 1;

        if (indicatorCurrent) indicatorCurrent.textContent = String(currentNumber);

        if (indicatorThumb) {
            const segmentSize = 100 / realSlidesCount;
            indicatorThumb.style.top = `${logicalIndex * segmentSize}%`;
        }
    }

    function applyParallax(progress) {
        const baseGapImage = -90;

        // Mobile: end centered at 0 / 0
        // Desktop: end centered at -2 / +2 (your original feel)
        const isMobile = window.matchMedia("(max-width: 768px)").matches;

        const maxTitleOffsetRight = 40;
        const maxSubtitleOffsetRight = 80;

        const maxTitleOffsetLeft = 40;
        const maxSubtitleOffsetLeft = 80;

        const TITLE_CENTER_OFFSET = isMobile ? -4 : -2;
        const SUBTITLE_CENTER_OFFSET = isMobile ? 4 : 2;

        const virtualIndex = currentIndex + progress;

        images.forEach((img, i) => {
            if (!img) return;
            const relative = i - virtualIndex;
            img.style.setProperty("--x-offset", `${relative * baseGapImage}vh`);
        });

        slidesEls.forEach((slideEl, i) => {
            const titleEl = slideEl.querySelector(".xswiper__title");
            const subtitleEl = slideEl.querySelector(".xswiper__subtitle");
            if (!titleEl && !subtitleEl) return;

            const relative = i - virtualIndex;
            const distance = Math.min(Math.abs(relative), 1);

            let titleOffset;
            let subtitleOffset;

            if (relative > 0) {
                titleOffset =
                    TITLE_CENTER_OFFSET + distance * (maxTitleOffsetRight - TITLE_CENTER_OFFSET);

                subtitleOffset =
                    SUBTITLE_CENTER_OFFSET +
                    distance * (maxSubtitleOffsetRight - SUBTITLE_CENTER_OFFSET);
            } else if (relative < 0) {
                titleOffset =
                    TITLE_CENTER_OFFSET + distance * (-maxTitleOffsetLeft - TITLE_CENTER_OFFSET);

                subtitleOffset =
                    SUBTITLE_CENTER_OFFSET +
                    distance * (-maxSubtitleOffsetLeft - SUBTITLE_CENTER_OFFSET);
            } else {
                titleOffset = TITLE_CENTER_OFFSET;
                subtitleOffset = SUBTITLE_CENTER_OFFSET;
            }

            if (titleEl) titleEl.style.setProperty("--title-offset", `${titleOffset}vw`);
            if (subtitleEl) subtitleEl.style.setProperty("--subtitle-offset", `${subtitleOffset}vw`);
        });
    }

    function setTransitions(on) {
        if (on) {
            track.style.transition = `transform ${TRACK_DURATION}s ease-in-out`;
            images.forEach((img) => img && (img.style.transition = `transform ${TRACK_DURATION}s ease-in-out`));
            contents.forEach((el) => el && (el.style.transition = `transform ${TRACK_DURATION}s ease-in-out`));
            titles.forEach((el) => el && (el.style.transition = `transform ${TEXT_DURATION}s ease-in-out ${TEXT_DELAY}s`));
            subtitles.forEach((el) => el && (el.style.transition = `transform ${TEXT_DURATION}s ease-in-out ${TEXT_DELAY}s`));
        } else {
            track.style.transition = "none";
            images.forEach((img) => img && (img.style.transition = "none"));
            contents.forEach((el) => el && (el.style.transition = "none"));
            titles.forEach((el) => el && (el.style.transition = "none"));
            subtitles.forEach((el) => el && (el.style.transition = "none"));
        }
    }

    function goToSlide(index) {
        if (!slidesEls.length) return;

        clearTimeout(autoplayTimer);

        if (index < 0) index = 0;
        if (index > slidesEls.length - 1) index = slidesEls.length - 1;

        currentIndex = index;
        isAnimating = true;

        setTransitions(true);

        track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;

        applyParallax(0);
        updateIndicator();
    }

    function teleportBy(delta) {
        setTransitions(false);

        currentIndex = currentIndex + delta;
        track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;

        applyParallax(0);
        updateIndicator();
    }

    // ---------- Drag ----------
    let isDragging = false;
    let hasDragged = false;
    let startX = 0;
    let currentOffset = 0;
    const DRAG_SNAP_RATIO = 0.1;

    function getSliderWidth() {
        return viewport ? viewport.offsetWidth || 1 : 1;
    }

    function pointerDown(clientX) {
        if (isAnimating) return;

        isDragging = true;
        hasDragged = false;
        startX = clientX;
        currentOffset = 0;

        setTransitions(false);

        root.classList.add("xswiper--grabbing");
        clearTimeout(autoplayTimer);
    }

    function pointerMove(clientX) {
        if (!isDragging) return;

        const sliderWidth = getSliderWidth();
        currentOffset = clientX - startX;

        if (currentOffset !== 0) hasDragged = true;

        const dragPercent = (currentOffset / sliderWidth) * 100;
        const baseOffset = -currentIndex * 100;

        track.style.transform = `translate3d(${baseOffset + dragPercent}%, 0, 0)`;

        let progress = -currentOffset / sliderWidth;
        if (progress > 1.2) progress = 1.2;
        if (progress < -1.2) progress = -1.2;

        applyParallax(progress);
    }

    function pointerUp() {
        if (!isDragging) return;

        isDragging = false;
        root.classList.remove("xswiper--grabbing");

        if (!hasDragged) {
            setTransitions(false);
            track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;
            applyParallax(0);
            return;
        }

        const sliderWidth = getSliderWidth();
        const threshold = sliderWidth * DRAG_SNAP_RATIO;

        if (currentOffset < -threshold) goToSlide(currentIndex + 1);
        else if (currentOffset > threshold) goToSlide(currentIndex - 1);
        else goToSlide(currentIndex);
    }

    // ---------- Autoplay ----------
    function scheduleAutoplay() {
        clearTimeout(autoplayTimer);
        if (!realSlidesCount) return;
        if (!autoplayEnabled) return;

        autoplayTimer = setTimeout(() => {
            if (isDragging || isAnimating) {
                scheduleAutoplay();
                return;
            }
            goToSlide(currentIndex + 1);
        }, AUTO_DELAY);
    }

    // ---------- Events ----------
    const onPrev = () => { if (!isAnimating) goToSlide(currentIndex - 1); };
    const onNext = () => { if (!isAnimating) goToSlide(currentIndex + 1); };

    const onMouseDown = (e) => { if (!e.target.closest("button")) pointerDown(e.clientX); };
    const onMouseMove = (e) => { if (isDragging) pointerMove(e.clientX); };
    const onMouseUp = () => pointerUp();

    const onTouchStart = (e) => { pointerDown(e.touches[0].clientX); };
    const onTouchMove = (e) => { if (isDragging) pointerMove(e.touches[0].clientX); };
    const onTouchEnd = () => pointerUp();

    const onDragStart = (e) => e.preventDefault();

    const onKeyDown = (e) => {
        if (document.activeElement !== root) return;

        if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); onNext(); }
    };

    const onTransitionEnd = (e) => {
        if (e.target !== track) return;
        if (e.propertyName !== "transform") return;
        if (!isAnimating) return;

        if (currentIndex < realSlidesCount) {
            teleportBy(realSlidesCount);
        } else if (currentIndex >= realSlidesCount * 2) {
            teleportBy(-realSlidesCount);
        }

        isAnimating = false;
        scheduleAutoplay();
    };

    prevBtn.addEventListener("click", onPrev);
    nextBtn.addEventListener("click", onNext);

    track.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchmove", onTouchMove, { passive: true });
    track.addEventListener("touchend", onTouchEnd);

    track.addEventListener("dragstart", onDragStart);
    track.addEventListener("transitionend", onTransitionEnd);
    root.addEventListener("keydown", onKeyDown);

    root.__xswiperCleanup = () => {
        clearTimeout(autoplayTimer);

        prevBtn.removeEventListener("click", onPrev);
        nextBtn.removeEventListener("click", onNext);

        track.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        track.removeEventListener("touchstart", onTouchStart);
        track.removeEventListener("touchmove", onTouchMove);
        track.removeEventListener("touchend", onTouchEnd);

        track.removeEventListener("dragstart", onDragStart);
        track.removeEventListener("transitionend", onTransitionEnd);

        root.removeEventListener("keydown", onKeyDown);
    };

    // ---------- Initial state ----------
    setTransitions(false);
    track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;
    applyParallax(0);
    updateIndicator();

    scheduleAutoplay();
}
