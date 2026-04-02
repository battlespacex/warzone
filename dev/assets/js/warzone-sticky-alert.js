// File Path: /assets/js/warzone-sticky-alert.js

// ── Session-level dismiss set ─────────────────────────────────────────────────
// Tracks alert_keys dismissed by the user this session.
// Cleared on page reload — real alerts will show again on next visit.
const __dismissedAlertKeys = new Set();

export function showStickyAlert(alert) {
    // Siren alerts are handled by wz-siren-stack banners
    const category = String(alert.category || "").toLowerCase();
    if (category === "siren" || category === "alert") return;

    // Don't re-show an alert the user already dismissed this session
    if (alert.alert_key && __dismissedAlertKeys.has(alert.alert_key)) return;

    const root = document.getElementById("warzone-alert");
    const titleEl = document.getElementById("warzone-alert-title");
    const metaEl = document.getElementById("warzone-alert-meta");
    if (!root || !titleEl || !metaEl) return;

    root.classList.remove("is-red", "is-orange");
    root.classList.add("is-active", "is-red");

    // Prefix title with a context label so users know what this is
    const rawTitle = alert.title || "Air raid sirens active";
    titleEl.textContent = rawTitle;
    metaEl.textContent = alert.region || alert.summary || "Active warning";

    root.dataset.alertKey = alert.alert_key || "";
    root.dataset.sticky = "true";

    // Bind dismiss on every show (handles re-shown alerts after re-fetch)
    bindStickyDismiss(root);
}

function bindStickyDismiss(root) {
    const btn = document.getElementById("warzone-alert-dismiss")
        || root.querySelector(".warzone-alert__close");
    if (!btn || btn.dataset.dismissBound === "true") return;
    btn.dataset.dismissBound = "true";
    btn.addEventListener("click", () => {
        const key = root.dataset.alertKey;
        if (key) __dismissedAlertKeys.add(key);
        root.classList.remove("is-active", "is-red", "is-orange");
        root.dataset.sticky = "";
        root.dataset.alertKey = "";
    });
}

export function hideStickyAlert(alertKey) {
    const root = document.getElementById("warzone-alert");
    if (!root) return;
    if (alertKey && root.dataset.alertKey && root.dataset.alertKey !== alertKey) return;
    root.classList.remove("is-active", "is-red", "is-orange");
    root.dataset.alertKey = "";
    root.dataset.sticky = "";
}