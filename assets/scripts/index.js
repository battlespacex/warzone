// assets/scripts/index.js
import { initGlobal, initContactForm, initBackgroundAudio } from "./essential.js";
import { initXSwiper } from "./xswiper.js";
import { initXFolio } from "./xfolio.js";
import "../style.css";

document.addEventListener("DOMContentLoaded", async () => {
    // Boot mode: keeps loader visible + hides layout until hero is ready
    document.body.classList.add("is-booting");

    initGlobal();
    initBackgroundAudio();

    initXSwiper("#xswiper");
    initXFolio();
    initContactForm();

    const pickHeroImg = () =>
        document.querySelector("#xswiper .xswiper__slide:not([data-clone]) .xswiper__image");

    // Wait at least a frame so XSwiper has time to mount slides
    let heroImg = pickHeroImg();
    if (!heroImg) {
        await new Promise((r) => requestAnimationFrame(r));
        heroImg = pickHeroImg();
    }

    // Try to decode hero image to avoid micro-flicker on first paint
    try {
        if (heroImg) {
            if (!heroImg.complete) {
                if (typeof heroImg.decode === "function") {
                    await heroImg.decode();
                } else {
                    await new Promise((resolve) => {
                        heroImg.addEventListener("load", resolve, { once: true });
                        heroImg.addEventListener("error", resolve, { once: true });
                    });
                }
            }
        }
    } catch (_) { }

    // Optional: wait for fonts to reduce text pop
    try {
        if (document.fonts?.ready) await document.fonts.ready;
    } catch (_) { }

    // Reveal the site and stop loader NOW
    document.body.classList.remove("is-booting");
    window.SiteLoader?.stop({ delay: 0 });
});
