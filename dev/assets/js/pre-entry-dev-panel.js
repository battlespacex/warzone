import { isStratOpsFeatureEnabled } from "./stratops-feature-config.js";

export async function initLocalDevPanelOnly() {
    if (!isStratOpsFeatureEnabled("system.devPanel")) return null;

    const hostname = String(window.location.hostname || "").toLowerCase();
    const isLocalDev =
        import.meta.env?.DEV === true ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "" ||
        hostname.includes("staging");

    if (!isLocalDev) return null;

    if (!document.getElementById("wz-dev-panel")) {
        const partialPaths = String(window.location.pathname || "").startsWith("/warzone")
            ? ["/warzone/partials/dev-panel.html", "/partials/dev-panel.html"]
            : ["/partials/dev-panel.html", "/warzone/partials/dev-panel.html"];
        let html = "";
        for (const partialPath of partialPaths) {
            try {
                const response = await fetch(partialPath, { cache: "no-store" });
                if (!response.ok) continue;
                html = await response.text();
                if (html) break;
            } catch {
                // Try the alternate staging/base-path location.
            }
        }
        if (!html) {
            console.warn("Local dev panel HTML was not found at the supported partial paths");
            return null;
        }

        document.body.insertAdjacentHTML("beforeend", html);
    }

    const module = await import("./warzone-dev-panel.js");
    module.initDevPanel?.();
    return document.getElementById("wz-dev-panel");
}
