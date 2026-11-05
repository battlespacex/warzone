import { isLocalDeveloperFeatureEnabled } from "./stratops-feature-config.js";

export async function initLocalDevPanelOnly() {
    if (!isLocalDeveloperFeatureEnabled() || !window.__warzoneViewer ||
        document.body.classList.contains("wz-pre-entry-active")) return null;

    if (!document.getElementById("wz-dev-panel")) {
        const partialPaths = ["/partials/dev-panel.html"];
        let html = "";
        for (const partialPath of partialPaths) {
            try {
                const response = await fetch(partialPath, { cache: "no-store" });
                if (!response.ok) continue;
                html = await response.text();
                if (html) break;
            } catch {
                // Keep the panel disabled if its local partial is unavailable.
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
