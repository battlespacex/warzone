// assets/scripts/index.js
import { initGlobal, initContactForm, initBackgroundAudio } from "./essential.js";
import { initXSwiper } from "./xswiper.js";
import { initXFolio } from "./xfolio.js";
import "../style.css";

document.addEventListener("DOMContentLoaded", async () => {
    const body = document.body;

    // Boot mode (informational only; CSS should not hide entire layout)
    body.classList.add("is-booting");

    // Show loader overlay while booting (opt-in via CSS)
    window.SiteLoader?.start?.();

    initGlobal();
    initBackgroundAudio();


    const hasSwiper = document.querySelector("#xswiper");
    if (hasSwiper) initXSwiper("#xswiper");

    const hasXFolioGrid = document.querySelector("#xfolio-grid");
    if (hasXFolioGrid) initXFolio();

    const hasContactForm = document.querySelector("#contact-form");
    if (hasContactForm) initContactForm();

    // ---- Safe waiting helpers (timeouts prevent hangs) ----
    const waitWithTimeout = (promise, ms) => {
        let t;
        const timeout = new Promise((resolve) => {
            t = setTimeout(resolve, ms);
        });
        return Promise.race([promise.catch(() => { }), timeout]).finally(() => clearTimeout(t));
    };

    // Wait for hero image (only if swiper exists), but don't hang
    if (hasSwiper) {
        const pickHeroImg = () =>
            document.querySelector("#xswiper .xswiper__slide:not([data-clone]) .xswiper__image");

        let heroImg = pickHeroImg();
        if (!heroImg) {
            await new Promise((r) => requestAnimationFrame(r));
            heroImg = pickHeroImg();
        }

        if (heroImg && !heroImg.complete) {
            const heroReady = (async () => {
                try {
                    if (typeof heroImg.decode === "function") {
                        await heroImg.decode();
                    } else {
                        await new Promise((resolve) => {
                            heroImg.addEventListener("load", resolve, { once: true });
                            heroImg.addEventListener("error", resolve, { once: true });
                        });
                    }
                } catch (_) { }
            })();

            // ✅ cap hero wait
            await waitWithTimeout(heroReady, 900);
        }
    }

    // Optional font wait, capped
    if (document.fonts?.ready) {
        await waitWithTimeout(document.fonts.ready, 700);
    }

    // ✅ Hard cap total boot (fail-open)
    // If anything above stalls, we still reveal quickly.
    const FAIL_OPEN_MS = 1800;
    await waitWithTimeout(Promise.resolve(), FAIL_OPEN_MS);

    // Mobile bottom tray: trigger slide-in on load
    document.body.classList.add("is-ready");

    // Reveal site + stop loader
    body.classList.remove("is-booting");
    body.classList.remove("show-loader");
    window.SiteLoader?.stop?.({ delay: 0 });
});
