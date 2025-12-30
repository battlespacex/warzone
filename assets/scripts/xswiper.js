// assets/scripts/xswiper.js
/*!
 * XSwiper Slider — updated to match new data model
 * - No swiper / swiperOrder flags
 * - Uses sortOrder + active
 * - Auto IDs assigned after sorting: slide-1..N
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

    // Use new rules: active + sortOrder
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

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

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

        let pauseBtn = root.querySelector(":scope > .xswiper__pause");
        if (!pauseBtn) {
            pauseBtn = document.createElement("button");
            pauseBtn.className = "xswiper__nav xswiper__nav--pause x-icon sr-only";
            pauseBtn.type = "button";
            pauseBtn.setAttribute("aria-pressed", "false");
            pauseBtn.setAttribute("aria-label", "Pause slideshow");
            pauseBtn.dataset.xswiperUi = "1";
            pauseBtn.innerHTML = `<span aria-hidden="true">pause</span>`;
            root.appendChild(pauseBtn);
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

        return { viewport, track, prevBtn, nextBtn, pauseBtn, indicator };
    }

    const { viewport, track, prevBtn, nextBtn, pauseBtn, indicator } = ensureUI();

    const indicatorCurrent = indicator.querySelector(".xswiper__indicator-current");
    const indicatorTotal = indicator.querySelector(".xswiper__indicator-total");
    const indicatorThumb = indicator.querySelector(".xswiper__indicator-thumb");
    const indicatorRail = indicator.querySelector(".xswiper__indicator-rail");

    const sortedSlides = slideData
        .slice()
        .sort((a, b) => {
            const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
            const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
        })
        .map((s, i) => {
            // Auto ID after sorting (stable visual order)
            return { ...s, id: `slide-${i + 1}` };
        });

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

    function createSlideEl(slide) {
        const slideEl = document.createElement("article");
        slideEl.className = "xswiper__slide";
        slideEl.id = slide.id;

        slideEl.innerHTML = `
      <picture>
        <!-- Mobile -->
        <source media="(max-width: 768px)" srcset="${slide.mobImage}">
        <!-- Desktop -->
        <source media="(min-width: 769px)" srcset="${slide.deskImage}">
        <img
          class="xswiper__image"
          src="${slide.deskImage}"
          alt="${slide.alt || slide.title || ""}"
          draggable="false"
        />
      </picture>

      <div class="xswiper__content sr-only">
        <h2 class="xswiper__title">${slide.title || ""}</h2>
        <h3 class="xswiper__subtitle">${slide.subtitle || ""}</h3>
        <p>${slide.description || ""}</p>
      </div>
    `;
        return slideEl;
    }


    track.innerHTML = "";

    const slidesEls = [];

    const lastClone = createSlideEl(sortedSlides[sortedSlides.length - 1]);
    lastClone.dataset.clone = "last";
    track.appendChild(lastClone);
    slidesEls.push(lastClone);

    sortedSlides.forEach((slide) => {
        const el = createSlideEl(slide);
        track.appendChild(el);
        slidesEls.push(el);
    });

    const firstClone = createSlideEl(sortedSlides[0]);
    firstClone.dataset.clone = "first";
    track.appendChild(firstClone);
    slidesEls.push(firstClone);

    const images = slidesEls.map((s) => s.querySelector(".xswiper__image"));
    const contents = slidesEls.map((s) => s.querySelector(".xswiper__content"));
    const titles = slidesEls.map((s) => s.querySelector(".xswiper__title"));
    const subtitles = slidesEls.map((s) => s.querySelector(".xswiper__subtitle"));

    function getLogicalIndex(physicalIndex) {
        const lastPhysical = slidesEls.length - 1;
        if (physicalIndex === 0) return realSlidesCount - 1;
        if (physicalIndex === lastPhysical) return 0;
        return physicalIndex - 1;
    }

    let currentIndex = 1;
    let isAnimating = false;

    let autoplayEnabled = !reduceMotion;
    let autoplayTimer = null;

    function updateIndicator() {
        if (!realSlidesCount) return;
        const logicalIndex = getLogicalIndex(currentIndex);
        const currentNumber = logicalIndex + 1;

        if (indicatorCurrent) indicatorCurrent.textContent = String(currentNumber);

        if (indicatorThumb) {
            const segmentSize = 100 / realSlidesCount;
            indicatorThumb.style.top = `${logicalIndex * segmentSize}%`;
        }
    }

    function applyParallax(progress) {
        const baseGapImage = -90;

        const maxTitleOffsetRight = 40;
        const maxSubtitleOffsetRight = 80;

        const maxTitleOffsetLeft = 40;
        const maxSubtitleOffsetLeft = 80;

        const TITLE_CENTER_OFFSET = -10;
        const virtualIndex = currentIndex + progress;

        images.forEach((img, i) => {
            if (!img) return;
            const relative = i - virtualIndex;
            img.style.setProperty("--x-offset", `${relative * baseGapImage}vh`);
        });

        titles.forEach((el, i) => {
            if (!el) return;

            const relative = i - virtualIndex;
            const distance = Math.min(Math.abs(relative), 1);

            let offset;
            if (relative > 0) {
                offset = TITLE_CENTER_OFFSET + distance * (maxTitleOffsetRight - TITLE_CENTER_OFFSET);
            } else if (relative < 0) {
                offset = TITLE_CENTER_OFFSET + distance * (-maxTitleOffsetLeft - TITLE_CENTER_OFFSET);
            } else {
                offset = TITLE_CENTER_OFFSET;
            }

            el.style.setProperty("--title-offset", `${offset}vw`);
        });

        subtitles.forEach((el, i) => {
            if (!el) return;

            const relative = i - virtualIndex;
            const clamped = Math.min(Math.abs(relative), 1);

            let offset = 0;
            if (relative > 0) offset = maxSubtitleOffsetRight * clamped;
            else if (relative < 0) offset = -maxSubtitleOffsetLeft * clamped;

            el.style.setProperty("--subtitle-offset", `${offset}vw`);
        });
    }

    function goToSlide(index) {
        if (!slidesEls.length) return;

        clearTimeout(autoplayTimer);

        if (index < 0) index = 0;
        if (index > slidesEls.length - 1) index = slidesEls.length - 1;

        currentIndex = index;
        isAnimating = true;

        const offsetPercent = -currentIndex * 100;

        track.style.transition = `transform ${TRACK_DURATION}s ease-in-out`;
        images.forEach((img) => img && (img.style.transition = `transform ${TRACK_DURATION}s ease-in-out`));
        contents.forEach((el) => el && (el.style.transition = `transform ${TRACK_DURATION}s ease-in-out`));
        titles.forEach((el) => el && (el.style.transition = `transform ${TEXT_DURATION}s ease-in-out ${TEXT_DELAY}s`));
        subtitles.forEach((el) => el && (el.style.transition = `transform ${TEXT_DURATION}s ease-in-out ${TEXT_DELAY}s`));

        track.style.transform = `translate3d(${offsetPercent}%, 0, 0)`;

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

        track.style.transition = "none";
        images.forEach((img) => img && (img.style.transition = "none"));
        contents.forEach((el) => el && (el.style.transition = "none"));
        titles.forEach((el) => el && (el.style.transition = "none"));
        subtitles.forEach((el) => el && (el.style.transition = "none"));

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
            track.style.transition = "none";
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

    function syncPauseBtnUI() {
        if (!pauseBtn) return;

        const isPaused = !autoplayEnabled;
        pauseBtn.setAttribute("aria-pressed", String(isPaused));
        pauseBtn.setAttribute("aria-label", isPaused ? "Resume slideshow" : "Pause slideshow");
        pauseBtn.innerHTML = `<span aria-hidden="true">${isPaused ? "play_arrow" : "play_pause"}</span>`;
    }

    function setAutoplay(on) {
        autoplayEnabled = Boolean(on);
        syncPauseBtnUI();
        clearTimeout(autoplayTimer);
        if (autoplayEnabled) scheduleAutoplay();
    }

    // ---------- Events (with cleanup) ----------
    const onPrev = () => { if (!isAnimating) goToSlide(currentIndex - 1); };
    const onNext = () => { if (!isAnimating) goToSlide(currentIndex + 1); };
    const onPauseToggle = () => setAutoplay(!autoplayEnabled);

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
        else if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); onPauseToggle(); }
    };

    const onTransitionEnd = (e) => {
        if (e.propertyName !== "transform") return;

        const target = e.target;
        if (!target.classList.contains("xswiper__title") && !target.classList.contains("xswiper__subtitle")) return;
        if (!isAnimating) return;

        const lastRealIndex = slidesEls.length - 2;

        if (slidesEls[currentIndex].dataset.clone === "last") {
            track.style.transition = "none";
            images.forEach((img) => img && (img.style.transition = "none"));
            contents.forEach((el) => el && (el.style.transition = "none"));
            titles.forEach((el) => el && (el.style.transition = "none"));
            subtitles.forEach((el) => el && (el.style.transition = "none"));

            currentIndex = lastRealIndex;
            track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;
            applyParallax(0);
            updateIndicator();
        } else if (slidesEls[currentIndex].dataset.clone === "first") {
            track.style.transition = "none";
            images.forEach((img) => img && (img.style.transition = "none"));
            contents.forEach((el) => el && (el.style.transition = "none"));
            titles.forEach((el) => el && (el.style.transition = "none"));
            subtitles.forEach((el) => el && (el.style.transition = "none"));

            currentIndex = 1;
            track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;
            applyParallax(0);
            updateIndicator();
        }

        isAnimating = false;
        scheduleAutoplay();
    };

    prevBtn.addEventListener("click", onPrev);
    nextBtn.addEventListener("click", onNext);
    pauseBtn?.addEventListener("click", onPauseToggle);

    track.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    track.addEventListener("touchstart", onTouchStart, { passive: true });
    track.addEventListener("touchmove", onTouchMove, { passive: true });
    track.addEventListener("touchend", onTouchEnd);

    track.addEventListener("dragstart", onDragStart);
    root.addEventListener("transitionend", onTransitionEnd);
    root.addEventListener("keydown", onKeyDown);

    root.__xswiperCleanup = () => {
        clearTimeout(autoplayTimer);

        prevBtn.removeEventListener("click", onPrev);
        nextBtn.removeEventListener("click", onNext);
        pauseBtn?.removeEventListener("click", onPauseToggle);

        track.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);

        track.removeEventListener("touchstart", onTouchStart);
        track.removeEventListener("touchmove", onTouchMove);
        track.removeEventListener("touchend", onTouchEnd);

        track.removeEventListener("dragstart", onDragStart);
        root.removeEventListener("transitionend", onTransitionEnd);
        root.removeEventListener("keydown", onKeyDown);
    };

    // ---------- Initial state ----------
    track.style.transition = "none";
    images.forEach((img) => img && (img.style.transition = "none"));
    contents.forEach((el) => el && (el.style.transition = "none"));
    titles.forEach((el) => el && (el.style.transition = "none"));
    subtitles.forEach((el) => el && (el.style.transition = "none"));

    track.style.transform = `translate3d(${-currentIndex * 100}%, 0, 0)`;
    applyParallax(0);
    updateIndicator();

    syncPauseBtnUI();
    scheduleAutoplay();
}
