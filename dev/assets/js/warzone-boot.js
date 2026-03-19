// assets/js/warzone-boot.js
// Site loader, modal handling, and Mac-style dock widget system.

const bar = document.getElementById("site-loader-bar");
let pct = 0;
const iv = setInterval(() => {
    pct = Math.min(pct + (pct < 70 ? 8 : pct < 90 ? 2 : 0.4), 98);
    if (bar) bar.style.width = pct + "%";
}, 120);

function markUiReady(delay = 0) {
    window.setTimeout(() => {
        document.body.classList.add("is-ui-ready");
    }, delay);
}

window.SiteLoader = {
    start() {
        const loader = document.getElementById("site-loader");
        if (loader) {
            loader.hidden = false;
            loader.classList.remove("is-gone");
        }
        document.body.classList.add("show-loader");
        document.body.classList.remove("is-ui-ready");
    },
    stop() {
        clearInterval(iv);
        if (bar) bar.style.width = "100%";
        setTimeout(() => {
            const loader = document.getElementById("site-loader");
            if (loader) loader.classList.add("is-gone");
            document.body.classList.remove("show-loader");
            markUiReady(80);
        }, 380);
    },
    forceHide() {
        clearInterval(iv);
        const loader = document.getElementById("site-loader");
        if (loader) loader.classList.add("is-gone");
        document.body.classList.remove("show-loader");
        markUiReady(0);
    },
};

document.addEventListener("DOMContentLoaded", () => {
    const INTRO_ACCEPT_KEY = "wz_intro_accepted";
    const WZ_WIDGET_KEY = "wz_widget_visibility";
    const POPUP_BREAKPOINT = 980;

    if (!document.body.classList.contains("show-loader")) {
        requestAnimationFrame(() => {
            document.body.classList.add("is-ui-ready");
        });
    }

    function isMobileLayout() {
        return window.innerWidth <= POPUP_BREAKPOINT;
    }

    function bindTabs(selector, panelSelector, attrName, panelAttrName) {
        document.querySelectorAll(selector).forEach((btn) => {
            btn.addEventListener("click", () => {
                const target = btn.dataset[attrName];
                document.querySelectorAll(selector).forEach((node) => {
                    node.classList.toggle("is-active", node === btn);
                });
                document.querySelectorAll(panelSelector).forEach((panel) => {
                    panel.classList.toggle("is-active", panel.dataset[panelAttrName] === target);
                });
            });
        });
    }

    bindTabs(".top-tab[data-view]", ".warzone-view", "view", "viewPanel");
    bindTabs("[data-military-view]", "[data-military-panel]", "militaryView", "militaryPanel");

    document.querySelectorAll("[data-map-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-map-mode]").forEach((node) => {
                node.classList.toggle("is-active", node === btn);
            });
            window.__warzoneViewer?.__warzone?.setMapMode?.(btn.dataset.mapMode);
        });
    });

    document.querySelectorAll(".period-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".period-tab").forEach((node) => {
                node.classList.toggle("is-active", node === btn);
            });
        });
    });

    const alertEl = document.getElementById("warzone-alert");
    alertEl?.querySelector(".warzone-alert__close")?.addEventListener("click", () => {
        alertEl.classList.remove("is-active", "is-red", "is-orange");
    });

    function openModal(modal) {
        if (modal) modal.hidden = false;
    }

    function closeModal(modal) {
        if (modal) modal.hidden = true;
    }

    const aboutModal = document.getElementById("wz-about-modal");
    const introModal = document.getElementById("wz-intro-modal");

    document.getElementById("dock-about")?.addEventListener("click", () => openModal(aboutModal));
    document.getElementById("wz-about-close")?.addEventListener("click", () => closeModal(aboutModal));
    aboutModal?.querySelector(".wz-modal__backdrop")?.addEventListener("click", () => closeModal(aboutModal));

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (aboutModal && !aboutModal.hidden) closeModal(aboutModal);
        if (introModal && !introModal.hidden) closeModal(introModal);
    });

    document.querySelectorAll(".wz-modal__tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;
            const box = tab.closest(".wz-modal__box");
            if (!box) return;
            box.querySelectorAll(".wz-modal__tab").forEach((node) => node.classList.remove("is-active"));
            box.querySelectorAll(".wz-modal__pane").forEach((pane) => pane.classList.remove("is-active"));
            tab.classList.add("is-active");
            box.querySelector(`.wz-modal__pane[data-pane="${target}"]`)?.classList.add("is-active");
        });
    });

    const introAccepted = (() => {
        try {
            return localStorage.getItem(INTRO_ACCEPT_KEY) === "1";
        } catch {
            return false;
        }
    })();

    if (!introAccepted && introModal) {
        openModal(introModal);
    }

    document.getElementById("wz-intro-accept")?.addEventListener("click", () => {
        try {
            localStorage.setItem(INTRO_ACCEPT_KEY, "1");
        } catch { }
        closeModal(introModal);
        window.__warzoneShowRegionModal?.();
    });

    const btnFullscreen = document.getElementById("dock-fullscreen");
    if (btnFullscreen) {
        btnFullscreen.addEventListener("click", () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
        });
        document.addEventListener("fullscreenchange", () => {
            btnFullscreen.classList.toggle("is-active", !!document.fullscreenElement);
        });
    }

    function getBackdrop() {
        return document.getElementById("wz-widget-backdrop");
    }


    function updateBackdrop() {
        if (!isMobileLayout()) return;
        const backdrop = getBackdrop();
        if (!backdrop) return;
        const anyVisible = Array.from(document.querySelectorAll(".warzone-widget[data-widget-id]"))
            .some((widget) => !widget.classList.contains("wz-is-hidden"));
        backdrop.hidden = !anyVisible;
    }

    function isWidgetVisible(widget) {
        return !widget.classList.contains("wz-is-hidden");
    }

    function showWidget(widget) {
        const content = widget.querySelector(".panel-content");
        if (content) {
            content.style.height = "";
            content.style.opacity = "";
            content.hidden = false;
        }

        if (isMobileLayout()) {
            document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((node) => {
                if (node !== widget) node.classList.add("wz-is-hidden");
            });
        }

        widget.classList.remove("wz-is-hidden");
        updateBackdrop();
    }

    function hideWidget(widget) {
        widget.classList.add("wz-is-hidden");
        updateBackdrop();
    }

    function saveWidgetState() {
        const state = {};
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
            state[widget.dataset.widgetId] = isWidgetVisible(widget);
        });
        try {
            localStorage.setItem(WZ_WIDGET_KEY, JSON.stringify(state));
        } catch { }
    }

    function loadWidgetState() {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(WZ_WIDGET_KEY) || "{}");
        } catch { }

        const forceHiddenMobile = isMobileLayout();
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
            const id = widget.dataset.widgetId;
            const visible = forceHiddenMobile ? false : (id in saved ? saved[id] : true);
            widget.classList.toggle("wz-is-hidden", !visible);
        });
    }

    function syncSeparator() {
        const sep = document.querySelector(".wz-dock__sep");
        if (!sep) return;
        const anyVisible = Array.from(document.querySelectorAll(".wz-dock__btn[data-dock-widget]"))
            .some((btn) => !btn.classList.contains("wz-dock--gone"));
        sep.classList.toggle("wz-dock--gone", !anyVisible);
    }

    function syncDock() {
        document.querySelectorAll(".wz-dock__btn[data-dock-widget]").forEach((btn) => {
            const id = btn.dataset.dockWidget;
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${id}"]`);
            if (!widget) return;

            const shouldBeGone = isWidgetVisible(widget);
            if (shouldBeGone && !btn.classList.contains("wz-dock--gone")) {
                btn.classList.add("wz-dock--gone");
                btn.setAttribute("aria-hidden", "true");
            } else if (!shouldBeGone && btn.classList.contains("wz-dock--gone")) {
                btn.setAttribute("aria-hidden", "false");
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        btn.classList.remove("wz-dock--gone");
                    });
                });
            } else if (!shouldBeGone) {
                btn.setAttribute("aria-hidden", "false");
            }
        });

        syncSeparator();
    }

    getBackdrop()?.addEventListener("click", () => {
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => hideWidget(widget));
        saveWidgetState();
        syncDock();
    });

    document.documentElement.classList.add("wz-no-transitions");
    loadWidgetState();
    syncDock();
    updateBackdrop();
    requestAnimationFrame(() => {
        document.documentElement.classList.remove("wz-no-transitions");
        document.body.classList.remove("wz-no-transitions");
    });



    document.querySelectorAll("[data-widget-close]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const widget = btn.closest(".warzone-widget");
            if (!widget) return;
            hideWidget(widget);
            saveWidgetState();
            syncDock();
        });
    });

    document.querySelectorAll(".wz-dock__btn[data-dock-widget]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${btn.dataset.dockWidget}"]`);
            if (!widget) return;
            if (isWidgetVisible(widget)) {
                hideWidget(widget);
            } else {
                showWidget(widget);
            }
            saveWidgetState();
            syncDock();
        });
    });

    document.querySelectorAll("[data-panel-collapse]").forEach((btn) => {
        const panel = btn.closest(".warzone-panel--floating");
        if (!panel) return;

        const content = panel.querySelector(".panel-content");
        if (!content) return;

        btn.addEventListener("click", () => {
            const willCollapse = !panel.classList.contains("is-collapsed");

            if (willCollapse) {
                btn.setAttribute("aria-expanded", "false");

                const startHeight = content.scrollHeight;
                content.style.height = `${startHeight}px`;
                content.style.opacity = "1";

                content.offsetHeight; // force reflow

                panel.classList.add("is-collapsed");
                content.style.height = "0px";
                content.style.opacity = "0";
            } else {
                btn.setAttribute("aria-expanded", "true");

                panel.classList.remove("is-collapsed");

                content.style.height = "0px";
                content.style.opacity = "0";

                content.offsetHeight; // force reflow

                const endHeight = content.scrollHeight;
                content.style.height = `${endHeight}px`;
                content.style.opacity = "1";
            }
        });

        content.addEventListener("transitionend", (e) => {
            if (e.propertyName !== "height") return;

            if (panel.classList.contains("is-collapsed")) {
                content.style.height = "0px";
            } else {
                content.style.height = "auto";
            }
        });
    });

    window.addEventListener("resize", () => {
        loadWidgetState();
        syncDock();
        updateBackdrop();
    }, { passive: true });
});
