// File Path: /assets/js/warzone-sticky-alert.js

// ── Session-level dismiss set ─────────────────────────────────────────────────
// Tracks alert_keys dismissed by the user this session.
// Cleared on page reload — real alerts will show again on next visit.
const __dismissedAlertKeys = new Set();

function disableStickyAlertRoot() {
    const root = document.getElementById("warzone-alert");
    if (!root) return null;
    root.classList.remove("is-active", "is-red", "is-orange");
    root.dataset.alertKey = "";
    root.dataset.sticky = "";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.style.display = "none";
    return root;
}

export function showStickyAlert(alert) {
    void alert;
    disableStickyAlertRoot();
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
    const root = disableStickyAlertRoot();
    if (!root) return;
    if (alertKey && root.dataset.alertKey && root.dataset.alertKey !== alertKey) return;
}
