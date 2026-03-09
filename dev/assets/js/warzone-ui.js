// assets/js/warzone-ui.js
export function bindWarzoneUi() {
    bindTopViews();
    bindMilitaryViews();
    bindAlertDismiss();
    bindMapModeButtons();
}

function bindTopViews() {
    const tabs = document.querySelectorAll(".top-tab");
    const panels = document.querySelectorAll(".warzone-view");

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.view;

            tabs.forEach((t) =>
                t.classList.toggle("is-active", t === tab)
            );

            panels.forEach((p) =>
                p.classList.toggle(
                    "is-active",
                    p.dataset.viewPanel === target
                )
            );
        });
    });
}

function bindMilitaryViews() {
    const tabs = document.querySelectorAll("[data-military-view]");
    const panels = document.querySelectorAll("[data-military-panel]");

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.militaryView;

            tabs.forEach((t) =>
                t.classList.toggle("is-active", t === tab)
            );

            panels.forEach((p) =>
                p.classList.toggle(
                    "is-active",
                    p.dataset.militaryPanel === target
                )
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

            buttons.forEach((b) =>
                b.classList.toggle("is-active", b === btn)
            );

            window.__warzoneViewer?.__warzone?.setMapMode?.(mode);
        });
    });
}