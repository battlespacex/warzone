// assets/js/smooth-home-anchors.js
export function initSmoothHomeAnchors({
    homePaths = ["/warzone/", "/warzone/index.html"],
    behavior = "smooth"
} = {}) {
    const isHome = () => homePaths.includes(window.location.pathname);

    document.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="/warzone/#"]');
        if (!a) return;
        if (!isHome()) return;

        const url = new URL(a.href, window.location.origin);
        const id = url.hash.slice(1);
        if (!id) return;

        const el = document.getElementById(id);
        if (!el) return;

        e.preventDefault();
        el.scrollIntoView({ behavior, block: "start" });
    });
}