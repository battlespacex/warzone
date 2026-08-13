import { onRegionChange } from "./warzone-region-selector.js";
const PRE_ENTRY_SHOWCASE_TRANSITION_MS = 240;

export function initPreEntryShowcase({ onEnter } = {}) {
    const template = document.getElementById("tpl-wz-pre-entry-showcase");
    if (!template?.content || typeof onEnter !== "function") {
        onEnter?.();
        return null;
    }

    document.getElementById("wz-pre-entry-showcase")?.remove();

    const fragment = template.content.cloneNode(true);
    const overlay = fragment.querySelector("#wz-pre-entry-showcase");
    const enterButton = fragment.querySelector("#wz-pre-entry-enter");
    const fullscreenButton = fragment.querySelector("#wz-pre-entry-fullscreen");
    const mount = document.querySelector("#warzone-app")
        || document.getElementById("warzone-gate-layer")
        || document.getElementById("warzone-app")
        || document.body;

    if (!overlay || !enterButton || !mount) {
        onEnter();
        return null;
    }

    let entered = false;
    const finish = () => {
        overlay.remove();
        document.body.classList.remove("wz-pre-entry-active");
        document.body.classList.add("wz-pre-entry-complete");
        onEnter();
    };

    const handleEnter = () => {
        if (entered) return;
        entered = true;
        enterButton.disabled = true;
        enterButton.setAttribute("aria-disabled", "true");
        overlay.classList.add("is-leaving");
        overlay.setAttribute("aria-hidden", "true");
        window.setTimeout(finish, PRE_ENTRY_SHOWCASE_TRANSITION_MS);
    };

    const syncFullscreenButton = () => {
        if (!fullscreenButton) return;

        const active = !!document.fullscreenElement;

        fullscreenButton.classList.toggle("is-active", active);
        fullscreenButton.setAttribute("aria-pressed", String(active));
        fullscreenButton.setAttribute(
            "title",
            active ? "Exit fullscreen" : "Enter fullscreen"
        );
    };

    const hideEntryFullscreenButton = () => {
        if (!fullscreenButton?.isConnected) return;

        fullscreenButton.classList.remove("is-visible");
        fullscreenButton.classList.add("is-leaving");

        document.removeEventListener(
            "fullscreenchange",
            syncFullscreenButton
        );

        window.setTimeout(() => {
            fullscreenButton.remove();
        }, 360);
    };

    onRegionChange((payload = {}) => {
        if (String(payload.source || "") !== "manual") return;

        hideEntryFullscreenButton();
    });
    fullscreenButton?.addEventListener("click", async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen?.();
            } else {
                await document.exitFullscreen?.();
            }
        } catch (error) {
            console.warn("Entry fullscreen request failed:", error);
        }

        syncFullscreenButton();
    });

    document.addEventListener("fullscreenchange", syncFullscreenButton);
    enterButton.addEventListener("click", handleEnter);
    overlay.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        if (event.target && event.target !== enterButton) return;
        event.preventDefault();
        handleEnter();
    });

    document.body.classList.add("wz-pre-entry-active");
    document.body.classList.remove("wz-pre-entry-complete");
    mount.prepend(fragment);
    requestAnimationFrame(() => {
        overlay.classList.add("is-visible");
        fullscreenButton?.classList.add("is-visible");

        enterButton.focus({ preventScroll: true });
    });

    return overlay;
}
