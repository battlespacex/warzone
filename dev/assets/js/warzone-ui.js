// File Path: /assets/js/warzone-ui.js
import { initTheaterPanel } from "./warzone-theater-panel.js";
export function bindWarzoneUi() {
    bindTopViews();
    bindAlertDismiss();
    bindMapModeButtons();
    bindMobileSettingsPanel();
    initTheaterPanel();
}
function bindTopViews() {
    const tabs = document.querySelectorAll(".top-tab");
    const panels = document.querySelectorAll(".warzone-view");
    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.view;
            tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
            panels.forEach((p) =>
                p.classList.toggle("is-active", p.dataset.viewPanel === target)
            );
        });
    });
}
function bindAlertDismiss() {
    const closeBtn = document.querySelector(".warzone-alert__close");
    const alert = document.getElementById("warzone-alert");
    if (!closeBtn || !alert) return;
    closeBtn.addEventListener("click", () => {
        const isSticky = alert.dataset.sticky === "true";
        if (isSticky) return;
        alert.classList.remove("is-active");
    });
}
function bindMapModeButtons() {
    const buttons = document.querySelectorAll("[data-map-mode]");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mapMode;
            buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
            window.__warzoneViewer?.__warzone?.setMapMode?.(mode);
        });
    });
}
function isMobileSettingsMode() {
    return window.matchMedia("(max-width: 1024px) and (orientation: portrait), (max-width: 768px)").matches;
}
function bindMobileSettingsPanel() {
    const trigger = document.getElementById("warzone-mobile-settings-trigger");
    const panel = document.getElementById("warzone-mobile-settings-panel");
    const closeBtn = document.getElementById("warzone-mobile-settings-close");
    const applyBtn = document.getElementById("warzone-mobile-settings-apply");
    const desktopLens = document.getElementById("wz-lens-nav");
    const desktopRegion = document.getElementById("wz-region-nav");
    const mobileLens = document.getElementById("wz-lens-nav-mobile");
    const mobileRegion = document.getElementById("wz-region-nav-mobile");
    if (!trigger || !panel || !closeBtn || !applyBtn || !desktopLens || !desktopRegion || !mobileLens || !mobileRegion) {
        return;
    }
    function syncMobileOptions() {
        mobileLens.innerHTML = desktopLens.innerHTML;
        mobileRegion.innerHTML = desktopRegion.innerHTML;
        mobileLens.value = desktopLens.value;
        mobileRegion.value = desktopRegion.value;
    }
    function openPanel() {
        if (!isMobileSettingsMode()) return;
        syncMobileOptions();
        panel.hidden = false;
        panel.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
    }
    function closePanel() {
        panel.classList.remove("is-open");
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
    }
    function applySettings() {
        if (desktopLens.value !== mobileLens.value) {
            desktopLens.value = mobileLens.value;
            desktopLens.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const syncRegionAndClose = () => {
            if (desktopRegion.value !== mobileRegion.value) {
                desktopRegion.value = mobileRegion.value;
                desktopRegion.dispatchEvent(new Event("change", { bubbles: true }));
            }
            closePanel();
        };
        requestAnimationFrame(syncRegionAndClose);
    }
    trigger.addEventListener("click", () => {
        if (panel.hidden) openPanel();
        else closePanel();
    });
    closeBtn.addEventListener("click", closePanel);
    applyBtn.addEventListener("click", applySettings);
    mobileLens.addEventListener("change", () => {
        desktopLens.value = mobileLens.value;
        desktopLens.dispatchEvent(new Event("change", { bubbles: true }));
        requestAnimationFrame(() => {
            mobileRegion.innerHTML = desktopRegion.innerHTML;
            mobileRegion.value = desktopRegion.value;
        });
    });
    desktopLens.addEventListener("change", () => {
        if (panel.classList.contains("is-open")) syncMobileOptions();
    });
    desktopRegion.addEventListener("change", () => {
        if (panel.classList.contains("is-open")) syncMobileOptions();
    });
    window.addEventListener("resize", () => {
        if (!isMobileSettingsMode()) closePanel();
    }, { passive: true });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && panel.classList.contains("is-open")) {
            closePanel();
        }
    });
}
