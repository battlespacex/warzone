// File Path: /assets/js/warzone-boot.js
let __siteLoaderHideTimer = 0;
window.__warzoneEnterApp = function () {
    const uiShell = document.getElementById("warzone-ui-shell");
    if (!uiShell) return;
    uiShell.hidden = false;
    requestAnimationFrame(() => {
        uiShell.classList.add("is-ui-visible");
    });
    document.body.classList.add("is-app-active");
};
window.SiteLoader = {
    start() {
        const loader = document.getElementById("site-loader");
        if (!loader) return;
        clearTimeout(__siteLoaderHideTimer);
        loader.classList.remove("is-gone");
        document.body.classList.add("show-loader");
    },
    stop() {
        const loader = document.getElementById("site-loader");
        if (!loader) return;
        clearTimeout(__siteLoaderHideTimer);
        __siteLoaderHideTimer = window.setTimeout(() => {
            document.body.classList.remove("show-loader");
            loader.classList.add("is-gone");
        }, 300);
    },
    forceHide() {
        const loader = document.getElementById("site-loader");
        if (!loader) return;
        clearTimeout(__siteLoaderHideTimer);
        document.body.classList.remove("show-loader");
        loader.classList.add("is-gone");
    },
};
document.addEventListener("DOMContentLoaded", () => {
    const WZ_WIDGET_KEY = "wz_widget_visibility";
    function isMobileLayout() {
        return window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
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
    function isAboutModal(modal) {
        return modal?.id === "wz-about-modal";
    }
    function openModal(modal) {
        if (!modal) return;
        modal.hidden = false;
        if (modal.id === "wz-about-modal") {
            document.body.classList.add("is-about-open");
        }
        requestAnimationFrame(() => {
            modal.classList.add("is-visible");
        });
    }
    function closeModal(modal, callback) {
        if (!modal) return;
        modal.classList.remove("is-visible");
        if (isAboutModal(modal)) {
            document.body.classList.remove("is-about-open");
        }
        window.setTimeout(() => {
            modal.hidden = true;
            if (typeof callback === "function") callback();
        }, 220);
    }
    const aboutModal = document.getElementById("wz-about-modal");
    const introModal = document.getElementById("wz-intro-modal");
    const uiShell = document.getElementById("warzone-ui-shell");
    if (uiShell) {
        uiShell.hidden = true;
        uiShell.classList.remove("is-ui-visible");
    }
    function clearStaleLoaderState() {
        if (document.visibilityState === "hidden") return;
        window.SiteLoader?.forceHide?.();
    }
    document.addEventListener("visibilitychange", clearStaleLoaderState, { passive: true });
    window.addEventListener("pageshow", clearStaleLoaderState, { passive: true });
    window.addEventListener("focus", clearStaleLoaderState, { passive: true });
    document.getElementById("dock-about")?.addEventListener("click", () => openModal(aboutModal));
    document.getElementById("wz-about-close")?.addEventListener("click", () => closeModal(aboutModal));
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (aboutModal && !aboutModal.hidden) closeModal(aboutModal);
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
        const collapseBtn = widget.querySelector("[data-panel-collapse]");
        const icon = collapseBtn?.querySelector("span");
        widget.classList.remove("is-collapsed");
        if (collapseBtn) collapseBtn.setAttribute("aria-expanded", "true");
        if (icon) {
            icon.classList.remove("bx-web-ico-close-1-2");
            icon.classList.add("bx-web-ico-top-1-0");
        }
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
                content.offsetHeight;
                panel.classList.add("is-collapsed");
                content.style.height = "0px";
                content.style.opacity = "0";
            } else {
                btn.setAttribute("aria-expanded", "true");
                panel.classList.remove("is-collapsed");
                content.style.height = "0px";
                content.style.opacity = "0";
                content.offsetHeight;
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
