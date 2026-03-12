// assets/js/warzone-boot.js
// Site loader, view tabs, and Mac-style dock widget system.

// #region =========== Site Loader ===========

const bar = document.getElementById("site-loader-bar");
let pct = 0;
const iv = setInterval(() => {
    pct = Math.min(pct + (pct < 70 ? 8 : pct < 90 ? 2 : 0.4), 98);
    if (bar) bar.style.width = pct + "%";
}, 120);

window.SiteLoader = {
    start() {
        const loader = document.getElementById("site-loader");
        if (loader) { loader.hidden = false; loader.classList.remove("is-gone"); }
        document.body.classList.add("show-loader");
    },
    stop() {
        clearInterval(iv);
        if (bar) bar.style.width = "100%";
        setTimeout(() => {
            const loader = document.getElementById("site-loader");
            if (loader) loader.classList.add("is-gone");
            document.body.classList.remove("show-loader");
        }, 380);
    },
    forceHide() {
        clearInterval(iv);
        const loader = document.getElementById("site-loader");
        if (loader) loader.classList.add("is-gone");
        document.body.classList.remove("show-loader");
    },
};

// #endregion

// #region =========== DOM Ready ===========

document.addEventListener("DOMContentLoaded", () => {

    // ── View tabs ────────────────────────────────────────────────────────────
    document.querySelectorAll(".top-tab[data-view]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".top-tab").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            const view = btn.dataset.view;
            document.querySelectorAll(".warzone-view").forEach(el => {
                el.classList.toggle("is-active", el.dataset.viewPanel === view);
            });
        });
    });

    // ── Military sub-tabs ────────────────────────────────────────────────────
    document.querySelectorAll("[data-military-view]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-military-view]").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            const v = btn.dataset.militaryView;
            document.querySelectorAll("[data-military-panel]").forEach(el => {
                el.classList.toggle("is-active", el.dataset.militaryPanel === v);
            });
        });
    });

    // ── Map mode chips ───────────────────────────────────────────────────────
    document.querySelectorAll("[data-map-mode]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-map-mode]").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
            window.__warzoneViewer?.__warzone?.setMapMode(btn.dataset.mapMode);
        });
    });

    // ── Period tabs ──────────────────────────────────────────────────────────
    document.querySelectorAll(".period-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".period-tab").forEach(b => b.classList.remove("is-active"));
            btn.classList.add("is-active");
        });
    });

    // ── Legacy alert close ───────────────────────────────────────────────────
    const alertEl = document.getElementById("warzone-alert");
    alertEl?.querySelector(".warzone-alert__close")?.addEventListener("click", () => {
        alertEl.classList.remove("is-active", "is-red", "is-orange");
    });

    // ── Dock — Fullscreen ────────────────────────────────────────────────────
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
            // Update icon: swap between enter / exit symbols
            const iconEl = btnFullscreen.querySelector(".wz-dock__icon");
            if (iconEl) iconEl.textContent = document.fullscreenElement ? "⛶" : "⛶";
        });
    }

    // ── Dock — About modal ───────────────────────────────────────────────────
    const aboutModal = document.getElementById("wz-about-modal");
    document.getElementById("dock-about")?.addEventListener("click", () => {
        if (aboutModal) aboutModal.hidden = false;
    });
    document.getElementById("wz-about-close")?.addEventListener("click", () => {
        if (aboutModal) aboutModal.hidden = true;
    });
    aboutModal?.querySelector(".wz-modal__backdrop")?.addEventListener("click", () => {
        aboutModal.hidden = true;
    });
    // Keyboard: close on Escape
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && aboutModal && !aboutModal.hidden) aboutModal.hidden = true;
    });
    // About modal tab switching
    document.querySelectorAll(".wz-modal__tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;
            const box = tab.closest(".wz-modal__box");
            box.querySelectorAll(".wz-modal__tab").forEach(t => t.classList.remove("is-active"));
            box.querySelectorAll(".wz-modal__pane").forEach(p => p.classList.remove("is-active"));
            tab.classList.add("is-active");
            box.querySelector(`.wz-modal__pane[data-pane="${target}"]`)?.classList.add("is-active");
        });
    });

    // #endregion

    // #region =========== Widget Dock System ===========
    //
    // Fade approach: CSS class `.wz-is-hidden` on `.warzone-panel--floating`
    // drives opacity/visibility/transform transitions (defined in warzone-panels.css).
    // We NEVER use the `hidden` attribute on widgets — that kills CSS transitions.
    // Dock icons use CSS class `.wz-dock--gone` (also in warzone-panels.css).
    //
    // ─────────────────────────────────────────────────────────────────────────

    const WZ_WIDGET_KEY = "wz_widget_visibility";

    // ── Mobile / tablet popup backdrop ────────────────────────────────────────
    const POPUP_BREAKPOINT = 980; // px — matches CSS tablet breakpoint

    function isMobileLayout() {
        return window.innerWidth <= POPUP_BREAKPOINT;
    }

    function getBackdrop() {
        return document.getElementById("wz-widget-backdrop");
    }

    function updateBackdrop() {
        if (!isMobileLayout()) return;
        const backdrop = getBackdrop();
        if (!backdrop) return;
        const anyVisible = Array.from(
            document.querySelectorAll(".warzone-widget[data-widget-id]")
        ).some(w => !w.classList.contains("wz-is-hidden"));
        if (anyVisible) {
            backdrop.hidden = false;
        } else {
            backdrop.hidden = true;
        }
    }

    // Clicking backdrop closes all open widgets
    document.getElementById("wz-widget-backdrop")?.addEventListener("click", () => {
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach(w => {
            if (!w.classList.contains("wz-is-hidden")) {
                hideWidget(w);
            }
        });
        saveWidgetState();
        syncDock();
    });

    /** Returns true if widget is currently visible */
    function isWidgetVisible(widget) {
        return !widget.classList.contains("wz-is-hidden");
    }

    /** Show a widget — CSS transition handles the fade-in */
    function showWidget(widget) {
        // Clear any inline styles left by old JS-height collapse code
        const content = widget.querySelector(".panel-content");
        if (content) {
            content.style.height = "";
            content.style.opacity = "";
            content.hidden = false;
        }
        // On mobile/tablet: close other widgets first (one at a time)
        if (isMobileLayout()) {
            document.querySelectorAll(".warzone-widget[data-widget-id]").forEach(w => {
                if (w !== widget && !w.classList.contains("wz-is-hidden")) {
                    w.classList.add("wz-is-hidden");
                }
            });
        }
        widget.classList.remove("wz-is-hidden");
        updateBackdrop();
    }

    /** Hide a widget — CSS transition handles the fade-out */
    function hideWidget(widget) {
        widget.classList.add("wz-is-hidden");
        updateBackdrop();
    }

    /** Persist widget visibility to localStorage */
    function saveWidgetState() {
        const state = {};
        document.querySelectorAll(".warzone-widget[data-widget-id]").forEach(w => {
            state[w.dataset.widgetId] = isWidgetVisible(w);
        });
        try { localStorage.setItem(WZ_WIDGET_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    }

    /** Restore widget visibility from localStorage */
    function loadWidgetState() {
        try {
            const saved = JSON.parse(localStorage.getItem(WZ_WIDGET_KEY) || "{}");
            document.querySelectorAll(".warzone-widget[data-widget-id]").forEach(w => {
                const id = w.dataset.widgetId;
                // Default: all visible unless explicitly saved as hidden
                const visible = id in saved ? saved[id] : true;
                if (!visible) {
                    // Set hidden without animation on boot
                    w.classList.add("wz-is-hidden");
                }
            });
        } catch { /* ignore */ }
    }

    /**
     * syncDock()
     * ─────────────────────────────────────────────────────────────────────────
     * Widget VISIBLE  → dock icon collapses (width→0, opacity→0) via CSS.
     * Widget HIDDEN   → dock icon expands back (width→normal, opacity→1) via CSS.
     *
     * No display:none needed — .wz-dock--gone uses width:0 + overflow:hidden
     * so the space fully collapses. The dock bar smoothly contracts/expands
     * because its width is determined by its children.
     *   Hiding : add .wz-dock--gone
     *   Showing: rAF → remove .wz-dock--gone (spring transition back in)
     */
    function syncDock() {
        const widgetBtns = document.querySelectorAll(".wz-dock__btn[data-dock-widget]");

        widgetBtns.forEach(btn => {
            const id = btn.dataset.dockWidget;
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${id}"]`);
            if (!widget) return;

            const shouldBeGone = isWidgetVisible(widget); // widget open → icon gone

            if (shouldBeGone && !btn.classList.contains("wz-dock--gone")) {
                // ── HIDE: CSS collapses width + fades opacity ──────────────
                btn.classList.add("wz-dock--gone");
                btn.setAttribute("aria-hidden", "true");

            } else if (!shouldBeGone && btn.classList.contains("wz-dock--gone")) {
                // ── SHOW: rAF ensures browser sees the class removal as a transition ──
                btn.setAttribute("aria-hidden", "false");
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        btn.classList.remove("wz-dock--gone");
                    });
                });

            } else if (!shouldBeGone && !btn.classList.contains("wz-dock--gone")) {
                btn.setAttribute("aria-hidden", "false");
            }
        });

        syncSeparator();
    }

    // Separator collapses when no widget buttons are visible
    function syncSeparator() {
        const sep = document.querySelector(".wz-dock__sep");
        if (!sep) return;
        const anyVisible = Array.from(
            document.querySelectorAll(".wz-dock__btn[data-dock-widget]")
        ).some(btn => !btn.classList.contains("wz-dock--gone"));
        if (anyVisible) {
            sep.classList.remove("wz-dock--gone");
        } else {
            sep.classList.add("wz-dock--gone");
        }
    }

    // ── Boot: restore state, then sync dock ─────────────────────────────────
    // Suppress all transitions during initial paint (avoid flash of animation)
    document.documentElement.classList.add("wz-no-transitions");
    loadWidgetState();
    syncDock();
    updateBackdrop();
    // One frame later — re-enable transitions
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.documentElement.classList.remove("wz-no-transitions");
        });
    });

    // ── Widget X (close) buttons inside each widget panel ───────────────────
    document.querySelectorAll("[data-widget-close]").forEach(btn => {
        btn.addEventListener("click", () => {
            const widget = btn.closest(".warzone-widget");
            if (!widget) return;
            hideWidget(widget);
            saveWidgetState();
            syncDock();
        });
    });

    // ── Dock widget launcher buttons — toggle widget open/closed ────────────
    document.querySelectorAll(".wz-dock__btn[data-dock-widget]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.dockWidget;
            const widget = document.querySelector(`.warzone-widget[data-widget-id="${id}"]`);
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

    // ── Collapse buttons inside panels (−/+) ────────────────────────────────
    document.querySelectorAll("[data-panel-collapse]").forEach(btn => {
        btn.addEventListener("click", () => {
            const panel = btn.closest(".warzone-panel--floating");
            if (!panel) return;
            const collapsed = panel.classList.toggle("is-collapsed");
            btn.setAttribute("aria-expanded", String(!collapsed));
            btn.textContent = collapsed ? "+" : "−";
        });
    });

    // #endregion

}); // end DOMContentLoaded