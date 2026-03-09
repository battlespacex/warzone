// assets/js/warzone-sticky-alert.js
export function showStickyAlert(alert) {
    const root = document.getElementById("warzone-alert");
    const titleEl = document.getElementById("warzone-alert-title");
    const metaEl = document.getElementById("warzone-alert-meta");

    if (!root || !titleEl || !metaEl) return;

    root.classList.remove("is-red", "is-orange");
    root.classList.add("is-active", "is-red");

    titleEl.textContent = alert.title || "Air raid sirens active";
    metaEl.textContent = alert.region || alert.summary || "Active warning";

    root.dataset.alertKey = alert.alert_key || "";
    root.dataset.sticky = "true";
}

export function hideStickyAlert(alertKey) {
    const root = document.getElementById("warzone-alert");
    if (!root) return;
    if (alertKey && root.dataset.alertKey && root.dataset.alertKey !== alertKey) return;

    root.classList.remove("is-active", "is-red", "is-orange");
    root.dataset.alertKey = "";
    root.dataset.sticky = "";
}