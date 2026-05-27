// File Path: /assets/js/warzone-boot.js
let __siteLoaderHideTimer = 0;
let __siteLoaderHardStopTimer = 0;
const SITE_LOADER_HARD_MAX_MS = 12000;
function clearSiteLoaderTimers() {
    clearTimeout(__siteLoaderHideTimer);
    clearTimeout(__siteLoaderHardStopTimer);
}
function scheduleSiteLoaderHardStop() {
    clearTimeout(__siteLoaderHardStopTimer);
    __siteLoaderHardStopTimer = window.setTimeout(() => {
        const keepVisible = window.__wzKeepSiteLoaderVisible === true;
        const keepUntil = Number(window.__wzKeepSiteLoaderVisibleUntil || 0);
        if (keepVisible && keepUntil > Date.now()) {
            scheduleSiteLoaderHardStop();
            return;
        }
        window.SiteLoader?.forceHide?.();
    }, SITE_LOADER_HARD_MAX_MS);
}
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
        clearSiteLoaderTimers();
        loader.classList.remove("is-gone");
        document.body.classList.add("show-loader");
        // Safety fallback so loader cannot remain visible forever.
        scheduleSiteLoaderHardStop();
    },
    stop() {
        const loader = document.getElementById("site-loader");
        if (!loader) return;
        const keepVisible = window.__wzKeepSiteLoaderVisible === true;
        const keepUntil = Number(window.__wzKeepSiteLoaderVisibleUntil || 0);
        if (keepVisible && keepUntil > Date.now()) {
            scheduleSiteLoaderHardStop();
            return;
        }
        clearSiteLoaderTimers();
        __siteLoaderHideTimer = window.setTimeout(() => {
            document.body.classList.remove("show-loader");
            loader.classList.add("is-gone");
        }, 300);
    },
    forceHide() {
        const loader = document.getElementById("site-loader");
        if (!loader) return;
        clearSiteLoaderTimers();
        document.body.classList.remove("show-loader");
        loader.classList.add("is-gone");
    },
};
document.addEventListener("DOMContentLoaded", () => {
    const WZ_WIDGET_KEY = "wz_widget_visibility";
    const WZ_LAYER_KEY = "wz_layer_state";
    const WZ_WIDGET_LAYOUT_VERSION_KEY = "wz_widget_layout_version";
    const WZ_WIDGET_LAYOUT_VERSION = "2026-04-airspace-default-open";
    const UI_ONLY_WIDGET_IDS = new Set();
    const DEFAULT_WIDGET_VISIBILITY = {
        counter: true,
        layers: true,
        escalation: false,
        aircraft: false,
        naval: false,
        feed: false,
        airspace: true,
        cyber: false,
    };
    function isMobileLayout() {
        return window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
    }
    function getSavedLayerState() {
        try {
            return JSON.parse(localStorage.getItem(WZ_LAYER_KEY) || "{}");
        } catch {
            return {};
        }
    }
    function isUiOnlyWidgetLayerEnabled(widgetId = "") {
        if (!UI_ONLY_WIDGET_IDS.has(widgetId)) return true;
        const layerState = getSavedLayerState();
        return layerState[widgetId] !== false;
    }
    function bindTabs(selector, panelSelector, attrName, panelAttrName) {
        const tabs = [...document.querySelectorAll(selector)];
        const panels = [...document.querySelectorAll(panelSelector)];
        const applyState = (activeBtn) => {
            const target = String(activeBtn?.dataset?.[attrName] || "");
            tabs.forEach((tab) => {
                const active = tab === activeBtn;
                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
                tab.setAttribute("aria-pressed", String(active));
                if (tab.getAttribute("role") === "tab") {
                    tab.tabIndex = active ? 0 : -1;
                }
            });
            panels.forEach((panel) => {
                const active = panel.dataset[panelAttrName] === target;
                panel.classList.toggle("is-active", active);
                panel.hidden = !active;
                panel.setAttribute("aria-hidden", String(!active));
            });
        };
        const initial = tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0] || null;
        if (initial) applyState(initial);
        tabs.forEach((btn) => {
            btn.addEventListener("click", () => {
                applyState(btn);
            });
        });
    }
    bindTabs(".top-tab[data-view]", ".warzone-view", "view", "viewPanel");
    bindTabs("[data-military-view]", "[data-military-panel]", "militaryView", "militaryPanel");
    document.querySelectorAll("[data-map-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-map-mode]").forEach((node) => {
                const active = node === btn;
                node.classList.toggle("is-active", active);
                node.setAttribute("aria-pressed", String(active));
            });
            window.__warzoneViewer?.__warzone?.setMapMode?.(btn.dataset.mapMode);
        });
    });
    document.querySelectorAll("[data-map-mode]").forEach((node) => {
        node.setAttribute("aria-pressed", String(node.classList.contains("is-active")));
    });
    document.querySelectorAll(".period-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".period-tab").forEach((node) => {
                const active = node === btn;
                node.classList.toggle("is-active", active);
                node.setAttribute("aria-pressed", String(active));
            });
        });
    });
    document.querySelectorAll(".period-tab").forEach((node) => {
        node.setAttribute("aria-pressed", String(node.classList.contains("is-active")));
    });
    function isAboutModal(modal) {
        return modal?.id === "wz-about-modal";
    }
    const MODAL_HEIGHT_ANIM_MS = 820;
    const modalBoxHeightFrames = new WeakMap();
    const modalBoxHeightCommitFrames = new WeakMap();
    const modalBoxLastHeights = new WeakMap();
    const modalBoxHeightLocks = new WeakMap();
    const modalBoxHeightFinishers = new WeakMap();
    function clearModalBoxHeightTimer(box, preserveCurrentHeight = false) {
        const cleanup = modalBoxHeightFinishers.get(box);
        if (cleanup) {
            cleanup();
            modalBoxHeightFinishers.delete(box);
        }
        const activeFrame = modalBoxHeightFrames.get(box);
        if (activeFrame) {
            cancelAnimationFrame(activeFrame);
            modalBoxHeightFrames.delete(box);
        }
        const commitFrame = modalBoxHeightCommitFrames.get(box);
        if (commitFrame) {
            cancelAnimationFrame(commitFrame);
            modalBoxHeightCommitFrames.delete(box);
        }
        if (preserveCurrentHeight && box) {
            const liveHeight = Math.ceil(box.getBoundingClientRect().height || 0);
            if (liveHeight > 0) {
                box.style.height = `${liveHeight}px`;
                modalBoxLastHeights.set(box, liveHeight);
                box.offsetHeight;
            }
        }
        box?.classList.remove("is-height-animating");
    }
    function readModalBoxTargetHeight(box) {
        const inner = box?.querySelector(".wz-modal-inner");
        if (!inner) return 0;
        const body = Array.from(inner.children).find((node) => node.classList?.contains("wz-modal-body"));
        let contentHeight = Math.max(
            Math.ceil(inner.scrollHeight || 0),
            Math.ceil(inner.getBoundingClientRect().height || 0),
        );
        if (body) {
            const header = Array.from(inner.children).find((node) => node.tagName === "HEADER");
            const footer = Array.from(inner.children).find((node) => node.tagName === "FOOTER");
            const activeView = Array.from(body.querySelectorAll(".wz-content.is-active"))
                .find((node) => !node.classList.contains("is-leaving"));
            const headerHeight = Math.ceil(header?.getBoundingClientRect().height || 0);
            const footerHeight = Math.ceil(footer?.getBoundingClientRect().height || 0);
            const bodyHeight = activeView
                ? Math.max(
                    Math.ceil(activeView.scrollHeight || 0),
                    Math.ceil(activeView.getBoundingClientRect().height || 0),
                )
                : Math.max(
                    Math.ceil(body.scrollHeight || 0),
                    Math.ceil(body.getBoundingClientRect().height || 0),
                );
            contentHeight = Math.max(contentHeight, headerHeight + bodyHeight + footerHeight);
        }
        const computedMaxHeight = parseFloat(window.getComputedStyle(box).maxHeight || "");
        const maxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : Number.POSITIVE_INFINITY;
        return Math.min(contentHeight, maxHeight);
    }
    function primeModalBoxHeight(box) {
        if (!box) return;
        clearModalBoxHeightTimer(box);
        modalBoxHeightLocks.delete(box);
        box.style.height = "";
        const target = readModalBoxTargetHeight(box);
        if (target > 0) {
            modalBoxLastHeights.set(box, target);
        }
    }
    function lockModalBoxHeight(box) {
        if (!box) return;
        clearModalBoxHeightTimer(box, true);
        const currentHeight = Math.ceil(box.getBoundingClientRect().height || 0);
        if (currentHeight <= 0) return;
        box.style.height = `${currentHeight}px`;
        modalBoxHeightLocks.set(box, true);
        modalBoxLastHeights.set(box, currentHeight);
        box.offsetHeight;
    }
    function animateModalBoxHeight(box) {
        const modal = box?.closest(".wz-modal");
        if (!box || !modal || modal.hidden) return;
        const previousHeight = Math.max(
            Math.ceil(box.getBoundingClientRect().height || 0),
            modalBoxLastHeights.get(box) || 0,
        );
        const targetHeight = readModalBoxTargetHeight(box);
        if (!Number.isFinite(targetHeight) || targetHeight <= 0) return;
        if (Math.abs(previousHeight - targetHeight) < 2) {
            clearModalBoxHeightTimer(box);
            modalBoxHeightLocks.delete(box);
            modalBoxLastHeights.set(box, targetHeight);
            box.style.height = "";
            return;
        }
        clearModalBoxHeightTimer(box, true);
        modalBoxHeightLocks.delete(box);
        box.classList.add("is-height-animating");
        box.style.height = `${previousHeight}px`;
        box.offsetHeight;
        const commitFrame = requestAnimationFrame(() => {
            modalBoxHeightCommitFrames.delete(box);
            box.style.height = `${targetHeight}px`;
        });
        modalBoxHeightCommitFrames.set(box, commitFrame);
        const finalizeAnimation = () => {
            if (modalBoxHeightFinishers.get(box) !== cleanup) return;
            modalBoxHeightFinishers.delete(box);
            modalBoxHeightCommitFrames.delete(box);
            box.removeEventListener("transitionend", onTransitionEnd);
            clearTimeout(fallbackTimer);
            box.style.height = "";
            box.classList.remove("is-height-animating");
            modalBoxLastHeights.set(box, readModalBoxTargetHeight(box));
        };
        const onTransitionEnd = (event) => {
            if (event.target !== box || event.propertyName !== "height") return;
            finalizeAnimation();
        };
        const fallbackTimer = window.setTimeout(() => {
            finalizeAnimation();
        }, MODAL_HEIGHT_ANIM_MS + 80);
        const cleanup = () => {
            box.removeEventListener("transitionend", onTransitionEnd);
            clearTimeout(fallbackTimer);
        };
        modalBoxHeightFinishers.set(box, cleanup);
        box.addEventListener("transitionend", onTransitionEnd);
        modalBoxLastHeights.set(box, targetHeight);
    }
    function scheduleModalBoxHeight(box, force = false) {
        if (!box) return;
        if (!force && modalBoxHeightLocks.get(box)) return;
        const activeFrame = modalBoxHeightFrames.get(box);
        if (activeFrame) {
            cancelAnimationFrame(activeFrame);
            modalBoxHeightFrames.delete(box);
        }
        const frame = requestAnimationFrame(() => {
            modalBoxHeightFrames.delete(box);
            animateModalBoxHeight(box);
        });
        modalBoxHeightFrames.set(box, frame);
    }
    window.__warzoneLockModalBoxHeight = lockModalBoxHeight;
    window.__warzoneScheduleModalBoxHeight = (box) => scheduleModalBoxHeight(box, true);
    const sharedModalQueue = [];
    let sharedModalActive = null;
    let sharedModalClosing = false;
    let sharedModalFlushTimer = 0;
    function getVisibleModal(ignoreModal = null) {
        return Array.from(document.querySelectorAll(".wz-modal.is-visible:not([hidden])"))
            .find((item) => item !== ignoreModal) || null;
    }
    function openModalNow(modal, callback) {
        if (!modal) return;
        sharedModalActive = modal;
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        if (modal.id === "wz-about-modal") {
            document.body.classList.add("is-about-open");
        }
        requestAnimationFrame(() => {
            modal.classList.add("is-visible");
            modal.querySelectorAll(".wz-modal-box").forEach(primeModalBoxHeight);
            const firstFocusable = modal.querySelector(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            firstFocusable?.focus?.();
            if (typeof callback === "function") callback();
        });
    }
    function flushSharedModalQueue() {
        if (sharedModalClosing || getVisibleModal()) return;
        const next = sharedModalQueue.shift();
        if (!next) {
            sharedModalActive = null;
            return;
        }
        openModalNow(next.modal, next.callback);
    }
    function scheduleSharedModalQueueFlush() {
        if (sharedModalFlushTimer) return;
        sharedModalFlushTimer = window.setTimeout(() => {
            sharedModalFlushTimer = 0;
            flushSharedModalQueue();
        }, 240);
    }
    function openModal(modal, callback) {
        if (!modal) return;
        const alreadyQueued = sharedModalQueue.some((entry) => entry.modal === modal);
        if (alreadyQueued) return;
        const visibleModal = getVisibleModal(modal);
        if (visibleModal || (sharedModalActive && sharedModalActive !== modal && !sharedModalActive.hidden) || sharedModalClosing) {
            sharedModalQueue.push({ modal, callback });
            return;
        }
        if (sharedModalActive === modal && !modal.hidden) {
            if (typeof callback === "function") callback();
            return;
        }
        openModalNow(modal, callback);
    }
    function closeModal(modal, callback) {
        if (!modal) return;
        modal.classList.remove("is-visible");
        sharedModalClosing = true;
        if (isAboutModal(modal)) {
            document.body.classList.remove("is-about-open");
        }
        window.setTimeout(() => {
            modal.querySelectorAll(".wz-modal-box").forEach((box) => {
                clearModalBoxHeightTimer(box);
                box.style.height = "";
                primeModalBoxHeight(box);
            });
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
            if (typeof callback === "function") callback();
            if (sharedModalActive === modal) {
                sharedModalActive = null;
            }
            sharedModalClosing = false;
            scheduleSharedModalQueueFlush();
        }, 220);
    }
    window.__warzoneOpenSharedModal = openModal;
    window.__warzoneCloseSharedModal = closeModal;
    const aboutModal = document.getElementById("wz-about-modal");
    let aboutModalTrigger = null;
    const introModal = document.getElementById("wz-intro-modal");
    const uiShell = document.getElementById("warzone-ui-shell");
    if (aboutModal) {
        aboutModal.hidden = true;
        aboutModal.setAttribute("aria-hidden", "true");
        aboutModal.classList.remove("is-visible");
        document.body.classList.remove("is-about-open");
    }
    if (uiShell) {
        uiShell.hidden = true;
        uiShell.classList.remove("is-ui-visible");
    }
    document.querySelectorAll(".wz-modal-box").forEach((box) => {
        primeModalBoxHeight(box);
        const inner = box.querySelector(".wz-modal-inner");
        if (!inner) return;
        const observer = new MutationObserver(() => {
            scheduleModalBoxHeight(box);
        });
        observer.observe(inner, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "style", "hidden", "aria-hidden"],
        });
    });
    document.querySelectorAll(".wz-modal").forEach((modal) => {
        const observer = new MutationObserver(scheduleSharedModalQueueFlush);
        observer.observe(modal, {
            attributes: true,
            attributeFilter: ["class", "hidden", "aria-hidden"],
        });
    });
    function clearStaleLoaderState() {
        if (document.visibilityState === "hidden") return;
        const keepVisible = window.__wzKeepSiteLoaderVisible === true;
        const keepUntil = Number(window.__wzKeepSiteLoaderVisibleUntil || 0);
        if (keepVisible && keepUntil > Date.now()) return;
        if (keepVisible) {
            // Recovery keep-flag expired or became stale: clear it and hide loader.
            window.__wzKeepSiteLoaderVisible = false;
            window.__wzKeepSiteLoaderVisibleUntil = 0;
        }
        window.SiteLoader?.forceHide?.();
    }
    document.addEventListener("visibilitychange", clearStaleLoaderState, { passive: true });
    window.addEventListener("pageshow", clearStaleLoaderState, { passive: true });
    window.addEventListener("focus", clearStaleLoaderState, { passive: true });
    document.getElementById("dock-about")?.addEventListener("click", (event) => {
        aboutModalTrigger = event.currentTarget;
        openModal(aboutModal);
    });
    document.getElementById("wz-about-close")?.addEventListener("click", () => {
        closeModal(aboutModal, () => {
            aboutModalTrigger?.focus?.();
            aboutModalTrigger = null;
        });
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (aboutModal && !aboutModal.hidden) {
            closeModal(aboutModal, () => {
                aboutModalTrigger?.focus?.();
                aboutModalTrigger = null;
            });
        }
    });
    const ABOUT_TAB_FADE_MS = 220;
    const aboutPaneAnimations = new WeakMap();
    const aboutPaneFrames = new WeakMap();
    function clearAboutPaneAnimation(pane) {
        if (!pane) return;
        const activeAnimation = aboutPaneAnimations.get(pane);
        if (activeAnimation) {
            activeAnimation.cancel();
            aboutPaneAnimations.delete(pane);
        }
        const activeFrame = aboutPaneFrames.get(pane);
        if (activeFrame) {
            cancelAnimationFrame(activeFrame);
            aboutPaneFrames.delete(pane);
        }
        pane.style.opacity = "";
        pane.style.transform = "";
    }
    function fadeInAboutPane(pane) {
        if (!pane) return;
        clearAboutPaneAnimation(pane);
        pane.classList.add("is-active");
        pane.classList.remove("is-leaving");
        pane.setAttribute("aria-hidden", "false");
        pane.style.opacity = "0";
        pane.style.transform = "translateY(6px)";
        const frame = requestAnimationFrame(() => {
            aboutPaneFrames.delete(pane);
            const animation = pane.animate(
                [
                    { opacity: 0, transform: "translateY(6px)" },
                    { opacity: 1, transform: "translateY(0)" },
                ],
                { duration: ABOUT_TAB_FADE_MS, easing: "ease", fill: "both" },
            );
            aboutPaneAnimations.set(pane, animation);
            animation.onfinish = animation.oncancel = () => {
                if (aboutPaneAnimations.get(pane) === animation) {
                    aboutPaneAnimations.delete(pane);
                }
                pane.style.opacity = "";
                pane.style.transform = "";
            };
        });
        aboutPaneFrames.set(pane, frame);
    }
    function fadeOutAboutPane(pane) {
        if (!pane) return;
        clearAboutPaneAnimation(pane);
        pane.classList.remove("is-active");
        pane.classList.add("is-leaving");
        pane.setAttribute("aria-hidden", "true");
        pane.style.opacity = "1";
        pane.style.transform = "translateY(0)";
        const animation = pane.animate(
            [
                { opacity: 1, transform: "translateY(0)" },
                { opacity: 0, transform: "translateY(6px)" },
            ],
            { duration: ABOUT_TAB_FADE_MS, easing: "ease", fill: "both" },
        );
        aboutPaneAnimations.set(pane, animation);
        animation.onfinish = animation.oncancel = () => {
            if (aboutPaneAnimations.get(pane) === animation) {
                aboutPaneAnimations.delete(pane);
            }
            pane.classList.remove("is-leaving");
            pane.style.opacity = "";
            pane.style.transform = "";
        };
    }
    function activateAboutTab(nextTab, { animate = true } = {}) {
        if (!nextTab) return;
        const box = nextTab.closest(".wz-modal-box");
        if (!box) return;
        const target = String(nextTab.dataset.tab || "");
        if (!target) return;
        const tabs = [...box.querySelectorAll(".wz-modal__tab")];
        const allPanes = [...box.querySelectorAll(".wz-content")];
        const panes = [...box.querySelectorAll(".wz-content[data-pane]")];
        const currentTab = tabs.find((tab) => tab.classList.contains("is-active")) || null;
        const currentPane = allPanes.find((pane) => pane.classList.contains("is-active")) || null;
        const nextPane = box.querySelector(`.wz-content[data-pane="${target}"]`);
        if (!nextPane) return;
        if (currentTab === nextTab && currentPane === nextPane) return;
        lockModalBoxHeight(box);
        tabs.forEach((tab) => {
            const active = tab === nextTab;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panes.forEach((pane) => {
            if (pane !== currentPane && pane !== nextPane) {
                clearAboutPaneAnimation(pane);
                pane.classList.remove("is-active", "is-leaving");
                pane.setAttribute("aria-hidden", "true");
            }
        });
        if (!animate) {
            if (currentPane && currentPane !== nextPane) {
                clearAboutPaneAnimation(currentPane);
                currentPane.classList.remove("is-active", "is-leaving");
                currentPane.setAttribute("aria-hidden", "true");
            }
            clearAboutPaneAnimation(nextPane);
            nextPane.classList.add("is-active");
            nextPane.classList.remove("is-leaving");
            nextPane.setAttribute("aria-hidden", "false");
            scheduleModalBoxHeight(box, true);
            return;
        }
        fadeInAboutPane(nextPane);
        if (currentPane && currentPane !== nextPane) {
            fadeOutAboutPane(currentPane);
        }
        nextTab.dispatchEvent(new CustomEvent("wz:modal-tab-activated", { bubbles: true, detail: { tab: target } }));
        scheduleModalBoxHeight(box, true);
    }
    document.querySelectorAll("#wz-about-modal, #wz-intro-modal").forEach((modal) => {
        const modalTabs = [...modal.querySelectorAll(".wz-modal__tab")];
        if (!modalTabs.length) return;
        modalTabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                activateAboutTab(tab, { animate: true });
            });
            tab.addEventListener("keydown", (event) => {
                const key = event.key;
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
                event.preventDefault();
                const currentIndex = modalTabs.indexOf(tab);
                if (currentIndex < 0) return;
                let nextIndex = currentIndex;
                if (key === "ArrowRight") nextIndex = (currentIndex + 1) % modalTabs.length;
                if (key === "ArrowLeft") nextIndex = (currentIndex - 1 + modalTabs.length) % modalTabs.length;
                if (key === "Home") nextIndex = 0;
                if (key === "End") nextIndex = modalTabs.length - 1;
                const nextTab = modalTabs[nextIndex];
                activateAboutTab(nextTab, { animate: true });
                nextTab?.focus();
            });
        });
        const initiallyActive = modalTabs.find((tab) => tab.classList.contains("is-active")) || modalTabs[0];
        activateAboutTab(initiallyActive, { animate: false });
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
    const mobileDockMenu = document.getElementById("wz-mobile-dock-menu");
    const mobileDockMenuOpen = document.getElementById("wz-mobile-dock-menu-open");
    const mobileDockMenuClose = document.getElementById("wz-mobile-dock-menu-close");
    const mobileDockBackdrop = document.getElementById("wz-mobile-dock-backdrop");
    function setMobileDockMenuOpen(open = false) {
        const isOpen = Boolean(open) && isMobileLayout();
        mobileDockMenu?.classList.toggle("is-open", isOpen);
        mobileDockBackdrop?.classList.toggle("is-open", isOpen);
        mobileDockMenu?.setAttribute("aria-hidden", String(!isOpen));
        mobileDockBackdrop?.setAttribute("aria-hidden", String(!isOpen));
        mobileDockMenuOpen?.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) {
            mobileDockMenuClose?.focus();
            return;
        }
        if (!isOpen && mobileDockMenu?.contains(document.activeElement)) {
            mobileDockMenuOpen?.focus();
        }
    }
    mobileDockMenuOpen?.addEventListener("click", () => setMobileDockMenuOpen(true));
    mobileDockMenuClose?.addEventListener("click", () => setMobileDockMenuOpen(false));
    mobileDockBackdrop?.addEventListener("click", () => setMobileDockMenuOpen(false));
    window.addEventListener("resize", () => {
        if (!isMobileLayout()) setMobileDockMenuOpen(false);
    }, { passive: true });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && mobileDockMenu?.classList.contains("is-open")) {
            setMobileDockMenuOpen(false);
        }
    });
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
            icon.classList.remove("stratops-ico-close-1");
            icon.classList.add("stratops-ico-top-1");
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
    function setWidgetHeaderControlsDisabled(widget, disabled = false) {
        widget?.querySelectorAll("[data-panel-collapse], [data-widget-close]").forEach((btn) => {
            btn.disabled = Boolean(disabled);
            btn.setAttribute("aria-disabled", String(Boolean(disabled)));
            if (disabled) {
                if (!btn.dataset.wzOriginalTitle) {
                    btn.dataset.wzOriginalTitle = btn.getAttribute("title") || "";
                }
                btn.setAttribute("title", "Unlock focused aircraft before changing this widget");
                return;
            }
            const originalTitle = btn.dataset.wzOriginalTitle;
            if (originalTitle !== undefined) {
                if (originalTitle) btn.setAttribute("title", originalTitle);
                else btn.removeAttribute("title");
                delete btn.dataset.wzOriginalTitle;
            }
        });
    }
    function setAircraftTrackerFocusLocked(enabled = false) {
        const widget = document.querySelector('.warzone-widget[data-widget-id="aircraft"]');
        if (!widget) return;
        const locked = Boolean(enabled);
        widget.classList.toggle("is-focus-locked", locked);
        if (locked) {
            showWidget(widget);
        }
        setWidgetHeaderControlsDisabled(widget, locked);
        syncWidgetChrome();
    }
    function hideWidget(widget) {
        if (widget?.dataset?.widgetId === "aircraft" && widget.classList.contains("is-focus-locked")) return;
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
        let savedVersion = "";
        try {
            saved = JSON.parse(localStorage.getItem(WZ_WIDGET_KEY) || "{}");
            savedVersion = String(localStorage.getItem(WZ_WIDGET_LAYOUT_VERSION_KEY) || "");
        } catch { }
        const shouldMigrateLayout = savedVersion !== WZ_WIDGET_LAYOUT_VERSION;
        const effectiveState = { ...DEFAULT_WIDGET_VISIBILITY, ...(saved || {}) };
        if (shouldMigrateLayout) {
            // Keep existing widget preferences, but migrate Airspace to open-by-default once.
            effectiveState.airspace = true;
            try {
                localStorage.setItem(WZ_WIDGET_KEY, JSON.stringify(effectiveState));
                localStorage.setItem(WZ_WIDGET_LAYOUT_VERSION_KEY, WZ_WIDGET_LAYOUT_VERSION);
            } catch { }
        }
        const forceHiddenMobile = isMobileLayout();
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
            const id = widget.dataset.widgetId;
            let visible = forceHiddenMobile ? false : (id in effectiveState ? effectiveState[id] : true);
            if (!isUiOnlyWidgetLayerEnabled(id)) {
                visible = false;
            }
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
    function syncDockProxies() {
        document.querySelectorAll("[data-dock-proxy]").forEach((btn) => {
            const widgetId = String(btn.dataset.dockProxy || "");
            if (!widgetId || widgetId === "about") return;
            const enabled = isUiOnlyWidgetLayerEnabled(widgetId);
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${widgetId}"]`);
            btn.hidden = !enabled || !widget;
            btn.classList.toggle("is-active", Boolean(enabled && widget && isWidgetVisible(widget)));
        });
    }
    function syncDock() {
        document.querySelectorAll(".wz-dock__btn[data-dock-widget]").forEach((btn) => {
            const id = btn.dataset.dockWidget;
            if (!isUiOnlyWidgetLayerEnabled(id)) {
                btn.classList.add("wz-dock--gone");
                btn.setAttribute("aria-hidden", "true");
                return;
            }
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
        syncDockProxies();
    }
    function syncWidgetChrome() {
        syncDock();
        updateBackdrop();
    }
    function bindUiInteractionIsolation() {
        const selectors = [
            ".warzone-panel--floating",
            ".wz-modal-box",
            ".wz-dock",
            ".wz-mobile-dock-menu",
            ".warzone-alert",
            "#wz-event-popup",
            "#wz-siren-stack",
            ".wz-donate-modal",
        ];
        const stopBubble = (e) => {
            e.stopPropagation();
        };
        selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => {
                if (!node || node.dataset.wzInteractionIsolated === "true") return;
                node.dataset.wzInteractionIsolated = "true";
                node.addEventListener("wheel", stopBubble, { passive: true });
                node.addEventListener("touchstart", stopBubble, { passive: true });
                node.addEventListener("touchmove", stopBubble, { passive: true });
                node.addEventListener("pointerdown", stopBubble);
                node.addEventListener("dblclick", stopBubble);
            });
        });
    }
    window.__syncWarzoneDock = syncWidgetChrome;
    getBackdrop()?.addEventListener("click", () => {
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => hideWidget(widget));
        saveWidgetState();
        syncWidgetChrome();
    });
    document.documentElement.classList.add("wz-no-transitions");
    loadWidgetState();
    syncWidgetChrome();
    const widgetObserver = new MutationObserver(() => {
        saveWidgetState();
        syncWidgetChrome();
    });
    document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
        widgetObserver.observe(widget, {
            attributes: true,
            attributeFilter: ["class"],
        });
    });
    requestAnimationFrame(() => {
        document.documentElement.classList.remove("wz-no-transitions");
        document.body.classList.remove("wz-no-transitions");
    });
    bindUiInteractionIsolation();
    document.querySelectorAll("[data-widget-close]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
            const widget = btn.closest(".warzone-widget");
            if (!widget) return;
            hideWidget(widget);
            saveWidgetState();
            syncWidgetChrome();
        });
    });
    document.querySelectorAll(".wz-dock__btn[data-dock-widget]").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (!isUiOnlyWidgetLayerEnabled(btn.dataset.dockWidget || "")) return;
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${btn.dataset.dockWidget}"]`);
            if (!widget) return;
            if (widget.dataset.widgetId === "aircraft" && widget.classList.contains("is-focus-locked")) {
                showWidget(widget);
                syncWidgetChrome();
                return;
            }
            if (isWidgetVisible(widget)) {
                hideWidget(widget);
            } else {
                showWidget(widget);
            }
            saveWidgetState();
            syncWidgetChrome();
        });
    });
    document.querySelectorAll("[data-dock-proxy]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = String(btn.dataset.dockProxy || "");
            const target = action === "about"
                ? document.getElementById("dock-about")
                : document.querySelector(`.wz-dock__desktop-actions .wz-dock__btn[data-dock-widget="${action}"]`);
            target?.click();
            if (btn.closest(".wz-mobile-dock-menu")) {
                setMobileDockMenuOpen(false);
            }
        });
    });
    document.querySelectorAll("[data-mobile-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = String(btn.dataset.mobileAction || "");
            setMobileDockMenuOpen(false);
            if (action === "region") {
                document.getElementById("wz-region-nav-mobile")?.click();
            } else if (action === "login") {
                window.__openLoginModal?.();
            } else if (action === "support") {
                window.__openSupportModal?.();
            }
        });
    });
    document.querySelectorAll("[data-panel-collapse]").forEach((btn) => {
        const panel = btn.closest(".warzone-panel--floating");
        if (!panel) return;
        const content = panel.querySelector(".panel-content");
        if (!content) return;
        btn.addEventListener("click", () => {
            if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
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
    document.addEventListener("wz:aircraft-focus-lock-changed", (event) => {
        setAircraftTrackerFocusLocked(Boolean(event?.detail?.enabled));
    });
    window.addEventListener("resize", () => {
        loadWidgetState();
        syncWidgetChrome();
    }, { passive: true });
});
