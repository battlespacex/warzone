export async function initLocalDevPanelOnly() {
    const isLocalDev =
        import.meta.env?.DEV === true ||
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";

    if (!isLocalDev) return;

    if (!document.getElementById("wz-dev-panel")) {
        const response = await fetch("/partials/dev-panel.html", { cache: "no-store" });
        if (!response.ok) {
            console.warn("Local dev panel HTML not found at /partials/dev-panel.html");
            return;
        }

        const html = await response.text();
        const mount = document.querySelector(".warzone-ui-layer") || document.body;
        mount.insertAdjacentHTML("beforeend", html);
    }

    const module = await import("./warzone-dev-panel.js");
    module.initDevPanel?.();
}