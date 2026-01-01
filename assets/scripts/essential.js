// assets/scripts/essential.js

// Handle header/body scroll state
document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    const main = document.querySelector("main");
    const docEl = document.scrollingElement || document.documentElement;

    let ticking = false;

    function getScrollTop() {
        return Math.max(
            window.pageYOffset || 0,
            docEl.scrollTop || 0,
            document.body.scrollTop || 0,
            main ? main.scrollTop : 0
        );
    }

    function apply() {
        const scrolled = getScrollTop() > 0;
        body.classList.toggle("on--scroll", scrolled);
        if (main) main.classList.toggle("on--scroll", scrolled);
        ticking = false;
    }

    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(apply);
    }

    apply();

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });

    if (main) main.addEventListener("scroll", onScroll, { passive: true });

    // iOS address bar / viewport changes
    window.visualViewport?.addEventListener("scroll", onScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", onScroll, { passive: true });
});

document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-target]");
    if (!btn) return;

    const el = document.querySelector(btn.dataset.target);
    if (el) el.scrollIntoView({ behavior: "smooth" });
});
/* -------- INIT ROOT -------- */
export function initGlobal() {
    // Ensure booting class exists (helps loader + prevents early visual flicker)
    document.body.classList.add("is-booting");

    // Always start at the top on refresh/reload
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    setTimeout(() => window.scrollTo(0, 0), 0);

    initSiteLoader();

    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initNav();
    initScrollToContact();
    initParallax();
}

/* -------- LOADER -------- */
function initSiteLoader() {
    const loader = document.getElementById("site-loader");
    if (!loader) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const params = new URLSearchParams(window.location.search);
    const hold =
        params.get("holdLoader") === "1" ||
        localStorage.getItem("HOLD_LOADER") === "1";

    let activeCount = 0;
    let hideTimer = null;

    const show = () => {
        clearTimeout(hideTimer);
        loader.setAttribute("aria-hidden", "false");
        loader.classList.remove("is-hidden");
        requestAnimationFrame(() => loader.classList.add("is-visible"));
    };

    const hide = () => {
        loader.classList.remove("is-visible");
        loader.classList.add("is-hidden");
        loader.setAttribute("aria-hidden", "true");
    };

    window.SiteLoader = {
        start() {
            activeCount += 1;
            show();
        },
        stop({ delay = 1000 } = {}) {
            activeCount = Math.max(0, activeCount - 1);
            if (activeCount === 0) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hide, delay);
            }
        },
    };

    const SiteLoader = window.SiteLoader;

    // Reduce motion: keep loader functional, just avoid heavy animations
    if (!reduceMotion) {
        (function setupLoaderText() {
            const windowEl = loader.querySelector(".loader__window");
            const list = loader.querySelector(".loader__list");
            if (!windowEl || !list) return;

            const items = Array.from(list.querySelectorAll(".loader__item"));
            const count = items.length;
            if (count < 2) return;

            const maxLen = Math.max(...items.map((li) => li.textContent.trim().length));
            windowEl.style.minWidth = `${Math.max(12, maxLen + 2)}ch`;

            const HOLD_RATIO = 0.95;
            const PER_ITEM_MS = 5000;

            list.style.animationDuration = `${count * PER_ITEM_MS}ms`;

            const oldStyle = document.getElementById("loader-dyn-kf");
            if (oldStyle) oldStyle.remove();

            const animName = `loaderChange_${count}`;
            const step = 100 / count;
            const holdEnd = step * HOLD_RATIO;

            let css = `@keyframes ${animName} {\n`;
            for (let i = 0; i < count; i++) {
                const t0 = i * step;
                const tHold = t0 + holdEnd;
                const y = -(i * (100 / count));
                css += `  ${t0.toFixed(3)}%, ${tHold.toFixed(
                    3
                )}% { transform: translate3d(0, ${y.toFixed(6)}%, 0); }\n`;
            }
            css += `  100% { transform: translate3d(0, 0%, 0); }\n}\n`;

            const styleTag = document.createElement("style");
            styleTag.id = "loader-dyn-kf";
            styleTag.textContent = css;
            document.head.appendChild(styleTag);

            list.style.animationName = animName;
            list.style.animationIterationCount = "infinite";
        })();
    }

    // Start loader now; it will remain until you call SiteLoader.stop() from index.js
    SiteLoader.start();

    // Safety fallback: avoid infinite lock if something fails
    const MAX_LOADER_MS = 30000;
    window.setTimeout(() => {
        activeCount = 0;
        hide();
        document.body.classList.remove("is-booting");
    }, MAX_LOADER_MS);

    if (hold) {
        loader.addEventListener("click", () => SiteLoader.stop({ delay: 0 }));
        return;
    }

    // If user navigates back/forward cache, ensure loader is not stuck visible
    window.addEventListener("pageshow", () => {
        activeCount = 0;
        hide();
    });
}

/* -------- NAV (drawer + smooth scroll + scroll spy) -------- */
function initNav() {
    const toggle = document.querySelector(".nav__toggle");
    const menu = document.getElementById("nav-menu");
    if (!menu) return;

    const links = Array.from(menu.querySelectorAll("a[href^='#']"));

    // underline (desktop only; hidden on mobile via CSS)
    const underline = document.createElement("span");
    underline.className = "nav__underline";
    menu.appendChild(underline);

    // backdrop for drawer
    let backdrop = document.querySelector(".nav__backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.className = "nav__backdrop";
        document.body.appendChild(backdrop);
    }

    // ARIA wiring
    if (toggle) {
        if (!toggle.getAttribute("aria-controls")) toggle.setAttribute("aria-controls", "nav-menu");
        if (!toggle.getAttribute("aria-expanded")) toggle.setAttribute("aria-expanded", "false");
    }

    const sectionMap = links
        .map((link) => {
            const href = link.getAttribute("href");
            if (!href || !href.startsWith("#")) return null;
            const section = document.querySelector(href);
            if (!section) return null;
            return { link, section, id: href };
        })
        .filter(Boolean);

    function getHeaderOffset() {
        const headerEl = document.getElementById("header");
        return headerEl ? headerEl.offsetHeight : 80;
    }

    function moveUnderline(link) {
        if (!link) return;
        const linkRect = link.getBoundingClientRect();
        const navRect = menu.getBoundingClientRect();
        underline.style.width = linkRect.width + "px";
        underline.style.left = linkRect.left - navRect.left + "px";
    }

    function setActiveLink(link) {
        if (!link) return;
        links.forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        moveUnderline(link);
    }

    function openMenu() {
        menu.classList.add("nav__menu--open");
        backdrop.classList.add("is-open");
        document.body.classList.add("nav--drawer-open");
        if (toggle) toggle.setAttribute("aria-expanded", "true");

        const firstLink = links[0];
        if (firstLink instanceof HTMLElement) setTimeout(() => firstLink.focus(), 0);
    }

    function closeMenu({ restoreFocus = true } = {}) {
        menu.classList.remove("nav__menu--open");
        backdrop.classList.remove("is-open");
        document.body.classList.remove("nav--drawer-open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        if (restoreFocus && toggle instanceof HTMLElement) toggle.focus();
    }

    function isMenuOpen() {
        return menu.classList.contains("nav__menu--open");
    }

    if (toggle) {
        toggle.addEventListener("click", () => {
            if (isMenuOpen()) closeMenu({ restoreFocus: false });
            else openMenu();
        });
    }

    backdrop.addEventListener("click", () => {
        if (isMenuOpen()) closeMenu();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && isMenuOpen()) closeMenu();
    });

    window.addEventListener("resize", () => {
        if (window.matchMedia("(min-width: 900px)").matches && isMenuOpen()) {
            closeMenu({ restoreFocus: false });
        }
        // keep underline aligned after resize
        const active = menu.querySelector("a.active");
        if (active) moveUnderline(active);
    });

    // Safer scroll target calc (doesn't depend on offsetTop)
    function scrollToSection(targetEl) {
        const headerOffset = getHeaderOffset();
        const y = targetEl.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    }

    links.forEach((link) => {
        link.addEventListener("click", (event) => {
            const href = link.getAttribute("href");

            if (href && href.startsWith("#")) {
                const target = document.querySelector(href);
                if (target) {
                    event.preventDefault();
                    scrollToSection(target);
                }
            }

            setActiveLink(link);

            if (isMenuOpen()) closeMenu({ restoreFocus: false });
        });
    });

    // ---------- Scroll spy (IntersectionObserver first, fallback to scroll math) ----------
    let io = null;

    function setupScrollSpy() {
        if (!sectionMap.length) return;

        const headerOffset = getHeaderOffset();

        // IntersectionObserver = what is actually on screen
        if ("IntersectionObserver" in window) {
            const visible = new Map(); // id -> intersectionRatio

            io = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        const id = "#" + entry.target.id;
                        if (!entry.isIntersecting) {
                            visible.delete(id);
                            continue;
                        }
                        // keep the best ratio for each target
                        visible.set(id, entry.intersectionRatio);
                    }

                    if (!visible.size) return;

                    // pick the most visible section (stable + matches what you see)
                    let bestId = null;
                    let bestRatio = -1;

                    for (const [id, ratio] of visible.entries()) {
                        if (ratio > bestRatio) {
                            bestRatio = ratio;
                            bestId = id;
                        }
                    }

                    if (!bestId) return;

                    const item = sectionMap.find((x) => x.id === bestId);
                    if (item) setActiveLink(item.link);
                },
                {
                    root: null,
                    // push the "top" down by header height so header doesn't steal the viewport
                    rootMargin: `-${headerOffset}px 0px -40% 0px`,
                    threshold: [0.15, 0.25, 0.35, 0.5, 0.65, 0.8],
                }
            );

            sectionMap.forEach(({ section }) => {
                if (section && section.id) io.observe(section);
            });

            return;
        }

        // Fallback: use bounding rect instead of offsetTop
        const onScrollFallback = () => {
            const header = getHeaderOffset();
            const line = header + 8; // "active line" under the header

            let current = sectionMap[0];

            for (const item of sectionMap) {
                const rect = item.section.getBoundingClientRect();
                if (rect.top <= line) current = item;
            }

            if (current) setActiveLink(current.link);
        };

        window.addEventListener("scroll", onScrollFallback, { passive: true });
        onScrollFallback();
    }

    setupScrollSpy();

    // Initial underline state
    if (links.length) setActiveLink(links[0]);
}


/* -------- SCROLL TO CONTACT -------- */
function initScrollToContact() {
    const btn = document.querySelector("[data-scroll-to-contact]");
    const target = document.getElementById("contact");
    if (!btn || !target) return;

    btn.addEventListener("click", () => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        const firstField = target.querySelector("input, textarea, select");
        if (firstField instanceof HTMLElement) {
            setTimeout(() => firstField.focus(), 650);
        }
    });
}

/* -------- PARALLAX SECTIONS -------- */
function initParallax() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;

    const sections = Array.from(document.querySelectorAll("[data-parallax]"));
    if (!sections.length) return;

    const instances = sections
        .map((section) => {
            const media = section.querySelector("[data-parallax-media]");
            const content = section.querySelector("[data-parallax-content]");
            if (!media && !content) return null;

            const computed = window.getComputedStyle(section);

            const mediaSpeedVar = parseFloat(
                computed.getPropertyValue("--parallax-media-speed")
            );
            const contentSpeedVar = parseFloat(
                computed.getPropertyValue("--parallax-content-speed")
            );

            return {
                section,
                media,
                content,
                mediaSpeed: Number.isNaN(mediaSpeedVar) ? 60 : mediaSpeedVar,
                contentSpeed: Number.isNaN(contentSpeedVar) ? 30 : contentSpeedVar,
            };
        })
        .filter(Boolean);

    if (!instances.length) return;

    let ticking = false;

    function update() {
        const viewportHeight =
            window.innerHeight || document.documentElement.clientHeight;

        instances.forEach((item) => {
            const rect = item.section.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > viewportHeight) return;

            const sectionHeight = rect.height || rect.bottom - rect.top;
            const sectionCenter = rect.top + sectionHeight / 2;
            const viewportCenter = viewportHeight / 2;

            const progress = (viewportCenter - sectionCenter) / viewportHeight;

            if (item.media instanceof HTMLElement) {
                item.media.style.transform = `translate3d(0, ${progress * item.mediaSpeed}px, 0)`;
            }
            if (item.content instanceof HTMLElement) {
                item.content.style.transform = `translate3d(0, ${progress * item.contentSpeed}px, 0)`;
            }
        });

        ticking = false;
    }

    function onScrollOrResize() {
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(update);
        }
    }

    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    update();
}

/* -------- BACKGROUND AUDIO (popup only if autoplay is blocked) -------- */
export function initBackgroundAudio() {
    const audio = document.getElementById("bg-audio");
    const fab = document.getElementById("audio-fab");
    const modal = document.getElementById("audio-consent");
    const allowBtn = document.getElementById("audio-allow");
    const denyBtn = document.getElementById("audio-deny");

    // If you didn't add the audio HTML yet, do nothing (no break)
    if (!audio || !fab || !modal || !allowBtn || !denyBtn) return;

    const setFabUI = (isPlaying) => {
        fab.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");

        const iconEl = fab.querySelector(".x-icon span");
        const isMobile = window.matchMedia("(max-width: 768px)").matches;

        if (isMobile) {
            // Mobile behavior:
            // - Playing: hide icon (CSS), show rotating GENRE
            // - Paused: show play_arrow
            if (iconEl) iconEl.textContent = isPlaying ? "play_pause" : "play_arrow";
            // Note: pause icon won't be visible while playing because we hide .x-icon on mobile via CSS,
            // but we keep it accurate for accessibility + future tweaks.
        } else {
            // Desktop behavior unchanged:
            if (iconEl) iconEl.textContent = isPlaying ? "play_pause" : "play_arrow";
        }

        fab.classList.toggle("is-playing", isPlaying);
    };


    const play = async () => {
        try {
            await audio.play();
            setFabUI(true);
            return true;
        } catch (_) {
            setFabUI(false);
            return false;
        }
    };

    const pause = () => {
        audio.pause();
        setFabUI(false);
    };

    const openModal = () => {
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("audio-consent-open");

        const panel = modal.querySelector(".modal__panel");
        if (panel instanceof HTMLElement) panel.focus();
    };

    const closeModal = () => {
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("audio-consent-open");
    };

    // Wait until loader/booting is done, then show popup
    const openModalWhenReady = () => {
        if (!document.body.classList.contains("is-booting")) {
            openModal();
            return;
        }

        const obs = new MutationObserver(() => {
            if (!document.body.classList.contains("is-booting")) {
                obs.disconnect();
                openModal();
            }
        });

        obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    };

    // Fixed button toggle (always available)
    fab.addEventListener("click", async () => {
        if (audio.paused) {
            const ok = await play();
            // If blocked even from FAB (rare), show popup
            if (!ok) openModalWhenReady();
        } else {
            pause();
        }
    });

    // Overlay click: just close and stay muted
    /*modal.addEventListener("click", (e) => {
        const overlay = modal.querySelector(".modal__overlay");
        if (e.target === overlay) {
            closeModal();
            pause();
        }
    });*/

    // Do NOT close when user clicks outside.
    // Prevent clicks inside the panel from bubbling to overlay.
    const panel = modal.querySelector(".modal__panel");
    if (panel) {
        panel.addEventListener("click", (e) => e.stopPropagation());
    }

    // Block overlay clicks completely (no close)
    modal.addEventListener("click", (e) => {
        const overlay = modal.querySelector(".modal__overlay");
        if (e.target === overlay) {
            // do nothing on outside click
            e.preventDefault();
        }
    });


    // Modal buttons
    allowBtn.addEventListener("click", async () => {
        closeModal();
        // Must be inside click for Safari/Chrome
        await play();
    });

    denyBtn.addEventListener("click", () => {
        closeModal();
        pause();
    });

    // ESC closes modal and stays muted
    /*document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("is-open")) {
            closeModal();
            pause();
        }
    });*/

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("is-open")) {
            e.preventDefault();
        }
    });

    // Keep UI synced
    audio.addEventListener("play", () => setFabUI(true));
    audio.addEventListener("pause", () => setFabUI(false));

    // Initial state
    setFabUI(false);
    closeModal();

    // Try autoplay on page load:
    // - If allowed: audio plays, NO popup.
    // - If blocked: show popup (every refresh where browser blocks it).
    (async () => {
        const ok = await play();
        if (!ok) {
            pause();
            openModalWhenReady();
        }
    })();

    // Mobile-only "GENRE" overlay (shown/hidden via .is-playing)
    let genreWrap = fab.querySelector(".x-icon.audio-fab__genres");

    if (!genreWrap) {
        genreWrap = document.createElement("span");
        genreWrap.className = "x-icon audio-fab__genres";
        genreWrap.setAttribute("aria-hidden", "true");

        const inner = document.createElement("span");
        inner.setAttribute("aria-hidden", "true");
        inner.textContent = "genres";

        genreWrap.appendChild(inner);
        fab.appendChild(genreWrap);
    } else {
        // Ensure inner span exists (in case markup was partially there)
        let inner = genreWrap.querySelector("span");
        if (!inner) {
            inner = document.createElement("span");
            inner.setAttribute("aria-hidden", "true");
            genreWrap.appendChild(inner);
        }
        if (!inner.textContent.trim()) inner.textContent = "genres";
    }

}

/* -------- CONTACT FORM + SIMPLE CAPTCHA -------- */
export function initContactForm() {
    const form = document.getElementById("contact-form");
    if (!form) return;

    const API_URL = "https://aa1udvkonl.execute-api.us-east-1.amazonaws.com/contact";

    const statusEl = document.getElementById("contact-status");
    const captchaQuestionEl = document.getElementById("captcha-question");
    const captchaInput = document.getElementById("captcha-answer");
    const resetBtn = document.getElementById("contact-reset");
    const submitBtn = form.querySelector('button[type="submit"]');

    const modal = document.getElementById("contact-modal");
    const modalMsg = document.getElementById("contact-modal-message");

    // Ensure modal isn't trapped inside <main>
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }

    // Ensure each error element has an id for aria-errormessage
    form.querySelectorAll(".form__error[data-error-for]").forEach((el) => {
        if (!el.id) el.id = `${el.getAttribute("data-error-for")}-error`;
    });

    // Captcha should be readable by screen readers
    if (captchaQuestionEl) {
        captchaQuestionEl.removeAttribute("aria-hidden");
        captchaQuestionEl.setAttribute("aria-live", "polite");
    }

    let captchaAnswer = null;

    let lastFocusedEl = null;
    let modalTrapHandler = null;

    function getFocusable(container) {
        return Array.from(
            container.querySelectorAll(
                'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
        ).filter((el) => el instanceof HTMLElement && !el.hasAttribute("disabled"));
    }

    function openModal(message) {
        if (!modal) return;

        lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        if (modalMsg) modalMsg.textContent = message || "Thanks. I’ll respond shortly.";
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");

        document.body.style.overflow = "hidden";
        const mainEl = document.querySelector("main");
        const headerEl = document.getElementById("header");
        const footerEl = document.querySelector("footer");
        [mainEl, headerEl, footerEl].forEach((n) => {
            if (!n) return;
            n.setAttribute("aria-hidden", "true");
            if ("inert" in n) n.inert = true;
        });

        const panel = modal.querySelector(".modal__panel");
        const focusables = panel ? getFocusable(panel) : [];
        const first = focusables[0] || panel;
        const last = focusables[focusables.length - 1] || panel;

        if (panel instanceof HTMLElement) panel.focus();
        if (first instanceof HTMLElement) first.focus();

        modalTrapHandler = (e) => {
            if (e.key !== "Tab" || !panel) return;
            if (!focusables.length) {
                e.preventDefault();
                panel.focus();
                return;
            }
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        if (panel) panel.addEventListener("keydown", modalTrapHandler);
    }

    function closeModal() {
        if (!modal) return;

        const panel = modal.querySelector(".modal__panel");
        if (panel && modalTrapHandler) {
            panel.removeEventListener("keydown", modalTrapHandler);
        }
        modalTrapHandler = null;

        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");

        document.body.style.overflow = "";
        const mainEl = document.querySelector("main");
        const headerEl = document.getElementById("header");
        const footerEl = document.querySelector("footer");
        [mainEl, headerEl, footerEl].forEach((n) => {
            if (!n) return;
            n.removeAttribute("aria-hidden");
            if ("inert" in n) n.inert = false;
        });

        if (lastFocusedEl) lastFocusedEl.focus();
    }

    if (modal) {
        modal.addEventListener("click", (e) => {
            const t = e.target;
            if (t instanceof HTMLElement && t.hasAttribute("data-modal-close")) closeModal();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
        });
    }

    function setError(id, message) {
        const errorEl = form.querySelector(`[data-error-for="${id}"]`);
        if (!errorEl) return;

        errorEl.textContent = message || "";
        errorEl.classList.toggle("is-visible", Boolean(message));

        const group = errorEl.closest(".form__group");
        if (group) group.classList.toggle("has-error", Boolean(message));

        const input = document.getElementById(id);
        if (
            input instanceof HTMLInputElement ||
            input instanceof HTMLTextAreaElement ||
            input instanceof HTMLSelectElement
        ) {
            input.setAttribute("aria-invalid", message ? "true" : "false");
            if (errorEl.id) input.setAttribute("aria-errormessage", errorEl.id);
        }
    }

    function clearAllErrors() {
        const allErrors = Array.from(form.querySelectorAll(".form__error"));
        allErrors.forEach((el) => {
            el.textContent = "";
            el.classList.remove("is-visible");
            const group = el.closest(".form__group");
            if (group) group.classList.remove("has-error");
        });

        const allFields = Array.from(form.querySelectorAll("input, textarea, select"));
        allFields.forEach((f) => {
            if (f instanceof HTMLElement) {
                f.setAttribute("aria-invalid", "false");
                f.removeAttribute("aria-errormessage");
            }
        });
    }

    function validateField(id) {
        const input = document.getElementById(id);
        if (
            !input ||
            !(
                input instanceof HTMLInputElement ||
                input instanceof HTMLTextAreaElement ||
                input instanceof HTMLSelectElement
            )
        ) return true;

        const value = (input.value || "").trim();

        if (input.required && !value) {
            setError(id, "This field is required.");
            return false;
        }

        if (id === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) {
            setError("email", "Enter a valid email.");
            return false;
        }

        setError(id, "");
        return true;
    }

    function generateCaptcha() {
        const a = Math.floor(Math.random() * 8) + 2;
        const b = Math.floor(Math.random() * 8) + 2;
        captchaAnswer = a + b;

        if (captchaQuestionEl) captchaQuestionEl.textContent = `${a} + ${b} = ?`;
        if (captchaInput) captchaInput.value = "";
        setError("captcha", "");
    }

    const fields = ["name", "organization", "email", "project-type", "message"];

    fields.forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;

        const eventName = input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(eventName, () => {
            validateField(id);
            if (statusEl) statusEl.textContent = "";
        });
    });

    if (captchaInput) {
        captchaInput.addEventListener("input", () => {
            if (statusEl) statusEl.textContent = "";
            if ((captchaInput.value || "").trim().length) setError("captcha", "");
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            form.reset();
            clearAllErrors();
            if (statusEl) statusEl.textContent = "";
            generateCaptcha();
        });
    }

    form.addEventListener("reset", () => {
        clearAllErrors();
        if (statusEl) statusEl.textContent = "";
        generateCaptcha();
    });

    generateCaptcha();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        let hasError = false;

        fields.forEach((id) => {
            if (!validateField(id)) hasError = true;
        });

        if (captchaInput && captchaAnswer !== null) {
            const value = parseInt(captchaInput.value, 10);
            if (Number.isNaN(value) || value !== captchaAnswer) {
                hasError = true;
                setError("captcha", "Incorrect answer. Please try again.");
                generateCaptcha();
            } else {
                setError("captcha", "");
            }
        }

        if (hasError) {
            if (statusEl) statusEl.textContent = "Fix the highlighted fields.";
            return;
        }

        const payload = {
            name: document.getElementById("name")?.value.trim() || "",
            organization: document.getElementById("organization")?.value.trim() || "",
            email: document.getElementById("email")?.value.trim() || "",
            phone: document.getElementById("phone")?.value.trim() || "",
            projectType: document.getElementById("project-type")?.value.trim() || "",
            dates: document.getElementById("dates")?.value.trim() || "",
            message: document.getElementById("message")?.value.trim() || "",
        };

        try {
            if (statusEl) statusEl.textContent = "Sending…";
            if (submitBtn) submitBtn.disabled = true;

            const res = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => null);

            if (!res.ok || !data || data.ok !== true) {
                throw new Error((data && data.error) || `Send failed (${res.status})`);
            }

            if (statusEl) statusEl.textContent = "";
            openModal("Request sent. I’ll respond shortly.");

            form.reset();
            clearAllErrors();
            generateCaptcha();
        } catch (err) {
            if (statusEl) statusEl.textContent = "Couldn’t send. Try again in a bit.";
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });
}
