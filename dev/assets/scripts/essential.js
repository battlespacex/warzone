// assets/scripts/essential.js

/* ------------------------------------------------------------------
   BOOT + GLOBAL UTILITIES
   - Keeps your existing functions intact
   - Moves boot orchestration here so index.js stays small
   - Prevents bg audio from downloading on initial load
------------------------------------------------------------------- */

let __scrollClassBound = false;
let __scrollToTargetBound = false;

function bindScrollClassToggles() {
    if (__scrollClassBound) return;
    __scrollClassBound = true;

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
}

function bindScrollToTargets() {
    if (__scrollToTargetBound) return;
    __scrollToTargetBound = true;

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-target]");
        if (!btn) return;

        const el = document.querySelector(btn.dataset.target);
        if (el) el.scrollIntoView({ behavior: "smooth" });
    });
}

/* -------- INIT ROOT -------- */
export function initGlobal() {
    // global event bindings (previously at top-level)
    bindScrollClassToggles();
    bindScrollToTargets();

    initSiteLoader();

    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initNav();
    initScrollToContact();
    initParallax();

    function handleScrollIntent() {
        const url = new URL(window.location.href);
        const targetId = url.searchParams.get("scroll");
        if (!targetId) return;

        // clean URL first (removes ?scroll=contact)
        url.searchParams.delete("scroll");
        window.history.replaceState({}, "", url.pathname + url.hash);

        requestAnimationFrame(() => {
            const el = document.getElementById(targetId);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            else window.location.replace("/404");
        });
    }

    handleScrollIntent();
}

/* ------------------------------------------------------------------
   BOOT ORCHESTRATOR (moved from index.js)
   Keeps your same logic but centralizes it here.
------------------------------------------------------------------- */
export function initBoot({
    initXSwiper,
    initXFolio,
    initContactForm,
    initBackgroundAudio,
} = {}) {
    const waitWithTimeout = (promise, ms) => {
        let t;
        const timeout = new Promise((resolve) => {
            t = setTimeout(resolve, ms);
        });
        return Promise.race([promise.catch(() => { }), timeout]).finally(() => clearTimeout(t));
    };

    document.addEventListener("DOMContentLoaded", () => {
        const body = document.body;
        body.classList.add("is-booting");
        window.SiteLoader?.start?.();

        const boot = (async () => {
            initGlobal();

            if (typeof initBackgroundAudio === "function") initBackgroundAudio();

            const hasSwiper = document.querySelector("#xswiper");
            if (hasSwiper && typeof initXSwiper === "function") initXSwiper("#xswiper");

            const hasXFolioGrid = document.querySelector("#xfolio-grid");
            if (hasXFolioGrid && typeof initXFolio === "function") initXFolio();

            const hasContactForm = document.querySelector("#contact-form");
            if (hasContactForm && typeof initContactForm === "function") initContactForm();

            // hero wait (capped)
            if (hasSwiper) {
                const pickHeroImg = () =>
                    document.querySelector(
                        "#xswiper .xswiper__slide:not([data-clone]) .xswiper__image"
                    );

                let heroImg = pickHeroImg();
                if (!heroImg) {
                    await new Promise((r) => requestAnimationFrame(r));
                    heroImg = pickHeroImg();
                }

                if (heroImg && !heroImg.complete) {
                    const heroReady = (async () => {
                        try {
                            if (typeof heroImg.decode === "function") await heroImg.decode();
                            else {
                                await new Promise((resolve) => {
                                    heroImg.addEventListener("load", resolve, { once: true });
                                    heroImg.addEventListener("error", resolve, { once: true });
                                });
                            }
                        } catch (_) { }
                    })();

                    await waitWithTimeout(heroReady, 900);
                }
            }

            // font wait (capped)
            if (document.fonts?.ready) await waitWithTimeout(document.fonts.ready, 700);

            body.classList.add("is-ready");
            body.classList.remove("is-booting");
            body.classList.remove("show-loader");
            window.SiteLoader?.stop?.({ delay: 0 });
        })();

        // ✅ true fail-open cap
        const FAIL_OPEN_MS = 1800;
        Promise.race([boot, new Promise((r) => setTimeout(r, FAIL_OPEN_MS))]).finally(() => {
            body.classList.add("is-ready");
            body.classList.remove("is-booting");
            body.classList.remove("show-loader");
            window.SiteLoader?.forceHide?.();
        });
    });
}

/* -------- LOADER -------- */
function initSiteLoader() {
    const body = document.body;
    const loader = document.getElementById("site-loader");
    if (!loader) return;

    const reduceMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const params = new URLSearchParams(window.location.search);
    const hold =
        params.get("holdLoader") === "1" ||
        localStorage.getItem("HOLD_LOADER") === "1";

    let activeCount = 0;
    let hideTimer = null;

    const show = () => {
        clearTimeout(hideTimer);

        body.classList.add("show-loader");

        loader.setAttribute("aria-hidden", "false");
        loader.classList.remove("is-hidden");
        requestAnimationFrame(() => loader.classList.add("is-visible"));
    };

    const hide = () => {
        loader.classList.remove("is-visible");
        loader.classList.add("is-hidden");
        loader.setAttribute("aria-hidden", "true");

        body.classList.remove("show-loader");

        // fail-open: boot should never be sticky
        body.classList.remove("is-booting");
    };

    window.SiteLoader = {
        start() {
            activeCount += 1;
            show();
        },

        async stop({ delay = 250, until = null } = {}) {
            if (until && typeof until.then === "function") {
                try {
                    await until;
                } catch (_) {
                    /* ignore */
                }
            }

            activeCount = Math.max(0, activeCount - 1);

            if (activeCount === 0) {
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hide, delay);
            }
        },

        forceHide() {
            activeCount = 0;
            hide();
        },
    };

    const SiteLoader = window.SiteLoader;

    // Animated loader text (your existing logic, kept)
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

    // If hold is enabled (debug), allow click to stop
    if (hold) {
        loader.addEventListener("click", () => SiteLoader.stop({ delay: 0 }));
    }

    // BFCache restore safety
    window.addEventListener("pageshow", () => {
        activeCount = 0;
        hide();
    });

    // Hard fail-open: never allow loader to trap users for long
    const MAX_LOADER_MS = 2500;
    window.setTimeout(() => {
        SiteLoader.forceHide();
    }, MAX_LOADER_MS);
}

/* -------- NAV (drawer + smooth scroll + scroll spy) -------- */
function initNav() {
    const toggle = document.querySelector(".nav__toggle");
    const menu = document.getElementById("nav-menu");
    if (!menu) return;

    const links = Array.from(menu.querySelectorAll("a[href^='#']"));

    const underline = document.createElement("span");
    underline.className = "nav__underline";
    menu.appendChild(underline);

    let backdrop = document.querySelector(".nav__backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.className = "nav__backdrop";
        document.body.appendChild(backdrop);
    }

    if (toggle) {
        if (!toggle.getAttribute("aria-controls"))
            toggle.setAttribute("aria-controls", "nav-menu");
        if (!toggle.getAttribute("aria-expanded"))
            toggle.setAttribute("aria-expanded", "false");
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

    let headerOffsetCached = 80;

    function updateHeaderOffset() {
        const headerEl = document.getElementById("header");
        headerOffsetCached = headerEl ? headerEl.clientHeight : 80;
    }

    updateHeaderOffset();
    window.addEventListener("resize", updateHeaderOffset, { passive: true });
    window.visualViewport?.addEventListener("resize", updateHeaderOffset, { passive: true });

    function getHeaderOffset() {
        return headerOffsetCached;
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

        const active = menu.querySelector("a.active");
        if (active) {
            requestAnimationFrame(() => moveUnderline(active));
        }
    });


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

    let io = null;

    function setupScrollSpy() {
        if (!sectionMap.length) return;

        const headerOffset = getHeaderOffset();

        if ("IntersectionObserver" in window) {
            const visible = new Map();

            io = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        const id = "#" + entry.target.id;
                        if (!entry.isIntersecting) {
                            visible.delete(id);
                            continue;
                        }
                        visible.set(id, entry.intersectionRatio);
                    }

                    if (!visible.size) return;

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
                    rootMargin: `-${headerOffset}px 0px -40% 0px`,
                    threshold: [0.15, 0.25, 0.35, 0.5, 0.65, 0.8],
                }
            );

            sectionMap.forEach(({ section }) => {
                if (section && section.id) io.observe(section);
            });

            return;
        }

        const onScrollFallback = () => {
            const header = getHeaderOffset();
            const line = header + 8;

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

            const mediaSpeedVar = parseFloat(computed.getPropertyValue("--parallax-media-speed"));
            const contentSpeedVar = parseFloat(computed.getPropertyValue("--parallax-content-speed"));

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
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

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

/* -------- BACKGROUND AUDIO -------- */
export function initBackgroundAudio() {
    const audio = document.getElementById("bg-audio");
    const fab = document.getElementById("audio-fab");
    const modal = document.getElementById("audio-consent");
    const allowBtn = document.getElementById("audio-allow");
    const denyBtn = document.getElementById("audio-deny");

    if (!audio || !fab || !modal || !allowBtn || !denyBtn) return;

    // ✅ IMPORTANT: prevent initial MP3 download
    // Expect either:
    // 1) <audio id="bg-audio" preload="none" data-src="/assets/audio/aerocism-aud.mp3"></audio>
    // OR if src exists, we still force preload none.
    audio.preload = "none";

    const getAudioSrc = () => audio.getAttribute("data-src") || audio.currentSrc || audio.src || "";
    const ensureAudioSrc = () => {
        const src = getAudioSrc();
        if (!src) return false;
        if (!audio.getAttribute("src")) audio.setAttribute("src", src);
        return true;
    };

    // ---- Persistence ----
    const PREF_KEY = "AEROCISM_AUDIO_PREF_V1";
    const SESSION_PROMPT_KEY = "AEROCISM_AUDIO_PROMPTED_V1";
    const DENY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const now = () => Date.now();

    const safeJSONParse = (raw) => {
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    };

    const getPref = () => {
        try {
            const raw = localStorage.getItem(PREF_KEY);
            if (!raw) return null;
            const obj = safeJSONParse(raw);
            if (!obj || !obj.val) return null;

            if (obj.val === "deny" && obj.ts && now() - obj.ts > DENY_TTL_MS) return null;

            return obj.val;
        } catch (_) {
            return null;
        }
    };

    const setPref = (val) => {
        try {
            localStorage.setItem(PREF_KEY, JSON.stringify({ val, ts: now() }));
        } catch (_) { }
    };

    const hasPromptedThisSession = () => {
        try {
            return sessionStorage.getItem(SESSION_PROMPT_KEY) === "1";
        } catch (_) {
            return false;
        }
    };

    const markPromptedThisSession = () => {
        try {
            sessionStorage.setItem(SESSION_PROMPT_KEY, "1");
        } catch (_) { }
    };

    // ---- UI helpers ----
    // ✅ UPDATED: use your icon font CLASSES (no ligature text)
    const setFabUI = (isPlaying) => {
        fab.setAttribute("aria-label", isPlaying ? "Pause audio" : "Play audio");

        const PLAY_CLASS = "aerocism-ico-play-1";
        const PAUSE_CLASS = "aerocism-ico-pause-2";

        const iconEl = fab.querySelector(".x-icon span");
        if (iconEl) {
            iconEl.classList.remove(PLAY_CLASS, PAUSE_CLASS);
            iconEl.classList.add(isPlaying ? PAUSE_CLASS : PLAY_CLASS);
            // in case any old ligature text exists
            iconEl.textContent = "";
        }

        fab.classList.toggle("is-playing", isPlaying);
    };

    const play = async () => {
        try {
            // ✅ only now we attach src (so no initial download)
            if (!ensureAudioSrc()) return false;

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

    // ---- Modal accessibility (focus trap + inert background + restore focus) ----
    let lastFocusedEl = null;
    let trapHandler = null;

    function getFocusable(container) {
        return Array.from(
            container.querySelectorAll(
                'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
        ).filter((el) => el instanceof HTMLElement && !el.hasAttribute("disabled"));
    }

    function setBackgroundInert(isInert) {
        const mainEl = document.querySelector("main");
        const headerEl = document.getElementById("header");
        const footerEl = document.querySelector("footer");
        [mainEl, headerEl, footerEl].forEach((n) => {
            if (!n) return;
            if (isInert) {
                n.setAttribute("aria-hidden", "true");
                if ("inert" in n) n.inert = true;
            } else {
                n.removeAttribute("aria-hidden");
                if ("inert" in n) n.inert = false;
            }
        });
    }

    function openModal() {
        if (modal.classList.contains("is-open")) return;

        lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("audio-consent-open");
        document.body.style.overflow = "hidden";
        setBackgroundInert(true);

        const panel = modal.querySelector(".modal__panel");
        const focusables = panel ? getFocusable(panel) : [];
        const first = focusables[0] || panel;
        const last = focusables[focusables.length - 1] || panel;

        trapHandler = (e) => {
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

        if (panel instanceof HTMLElement) {
            panel.setAttribute("tabindex", "-1");
            panel.focus();
            panel.addEventListener("keydown", trapHandler);
        }
    }

    function closeModal({ restoreFocus = true } = {}) {
        if (!modal.classList.contains("is-open")) return;

        const panel = modal.querySelector(".modal__panel");
        if (panel && trapHandler) panel.removeEventListener("keydown", trapHandler);
        trapHandler = null;

        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("audio-consent-open");
        document.body.style.overflow = "";
        setBackgroundInert(false);

        if (restoreFocus && lastFocusedEl) lastFocusedEl.focus();
    }

    // Overlay click closes
    modal.addEventListener("click", (e) => {
        const overlay = modal.querySelector(".modal__overlay");
        if (e.target === overlay) closeModal();
    });

    // Escape closes
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("is-open")) {
            e.preventDefault();
            closeModal();
        }
    });

    // Prevent clicks inside panel from bubbling to overlay
    const panel = modal.querySelector(".modal__panel");
    if (panel) panel.addEventListener("click", (e) => e.stopPropagation());

    // ---- FAB behavior ----
    fab.addEventListener("click", async () => {
        if (audio.paused) {
            const ok = await play();
            if (!ok) openModal();
        } else {
            pause();
        }
    });

    allowBtn.addEventListener("click", async () => {
        setPref("allow");
        closeModal();
        await play();
    });

    denyBtn.addEventListener("click", () => {
        setPref("deny");
        closeModal();
        pause();
    });

    audio.addEventListener("play", () => setFabUI(true));
    audio.addEventListener("pause", () => setFabUI(false));

    // Initial state
    setFabUI(false);
    closeModal({ restoreFocus: false });

    // ---- Session-first prompt (polite) ----
    const pref = getPref();

    const canPrompt = () => {
        if (hasPromptedThisSession()) return false;
        if (pref === "deny") return false;
        return true;
    };

    const scheduleFirstPrompt = () => {
        if (!canPrompt()) return;

        let cancelled = false;

        const cancel = () => {
            cancelled = true;
            cleanup();
        };
        const cleanup = () => {
            window.removeEventListener("scroll", cancel, { passive: true });
            window.removeEventListener("pointerdown", cancel);
            window.removeEventListener("keydown", cancel);
            window.removeEventListener("touchstart", cancel, { passive: true });
        };

        window.addEventListener("scroll", cancel, { passive: true });
        window.addEventListener("pointerdown", cancel);
        window.addEventListener("keydown", cancel);
        window.addEventListener("touchstart", cancel, { passive: true });

        const waitForBoot = () =>
            new Promise((resolve) => {
                if (!document.body.classList.contains("is-booting")) return resolve();
                const obs = new MutationObserver(() => {
                    if (!document.body.classList.contains("is-booting")) {
                        obs.disconnect();
                        resolve();
                    }
                });
                obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
            });

        (async () => {
            await waitForBoot();
            await new Promise((r) => setTimeout(r, 600));
            if (cancelled) return;

            markPromptedThisSession();

            if (pref === "allow") return;

            openModal();
            cleanup();
        })();
    };

    scheduleFirstPrompt();

    // ✅ UPDATED: genres wrapper should also be class-based (no ligature text)
    const GENRES_CLASS = "aerocism-ico-genres-1";

    let genreWrap = fab.querySelector(".x-icon.audio-fab__genres");

    if (!genreWrap) {
        genreWrap = document.createElement("span");
        genreWrap.className = "x-icon audio-fab__genres";
        genreWrap.setAttribute("aria-hidden", "true");

        const inner = document.createElement("span");
        inner.setAttribute("aria-hidden", "true");
        inner.className = GENRES_CLASS;
        inner.textContent = "";

        genreWrap.appendChild(inner);
        fab.appendChild(genreWrap);
    } else {
        let inner = genreWrap.querySelector("span");
        if (!inner) {
            inner = document.createElement("span");
            inner.setAttribute("aria-hidden", "true");
            genreWrap.appendChild(inner);
        }
        inner.className = GENRES_CLASS;
        inner.textContent = "";
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

    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }

    form.querySelectorAll(".form__error[data-error-for]").forEach((el) => {
        if (!el.id) el.id = `${el.getAttribute("data-error-for")}-error`;
    });

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
            const hit = e.target.closest("[data-modal-close]");
            if (hit) closeModal();
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

        const inputId = id === "captcha" ? "captcha-answer" : id;
        const input = document.getElementById(inputId);

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
