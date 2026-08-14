// File Path: /assets/js/warzone-sticky-alert.js

// ── Session-level dismiss set ─────────────────────────────────────────────────
// Tracks alert_keys dismissed by the user this session.
// Cleared on page reload — real alerts will show again on next visit.
const __dismissedAlertKeys = new Set();
let __stickyAlertHideTimer = 0;
let __devStickyAlertPreviewActive = false;
const STICKY_ALERT_AUTO_HIDE_MS = 9000;

function disableStickyAlertRoot() {
    const root = document.getElementById("warzone-alert");
    if (!root) return null;
    if (__stickyAlertHideTimer) {
        clearTimeout(__stickyAlertHideTimer);
        __stickyAlertHideTimer = 0;
    }
    root.classList.remove("is-active", "is-red", "is-orange");
    root.dataset.alertKey = "";
    root.dataset.sticky = "";
    root.dataset.devAlertPreview = "";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.style.display = "none";
    return root;
}

export function setStickyAlertDevPreviewActive(active = false) {
    const nextActive = active === true;
    if (__devStickyAlertPreviewActive === nextActive) return __devStickyAlertPreviewActive;
    __devStickyAlertPreviewActive = nextActive;
    disableStickyAlertRoot();
    return __devStickyAlertPreviewActive;
}

export function showStickyAlert(alert) {
    const root = document.getElementById("warzone-alert");
    if (!root || !alert) return;
    const isDevPreview = alert.devPreview === true;
    if (__devStickyAlertPreviewActive && !isDevPreview) return;
    if (isDevPreview && !__devStickyAlertPreviewActive) return;
    const key = String(alert.alert_key || alert.key || alert.id || alert.title || "global-alert").trim();
    if (!isDevPreview && key && __dismissedAlertKeys.has(key)) return;
    const title = String(alert.title || alert.headline || "Operational Alert").trim();
    const meta = String(alert.meta || alert.summary || alert.message || alert.detail || "A monitored operational alert is active.").trim();
    const level = String(alert.level || alert.severity || "orange").trim().toLowerCase();
    const titleEl = document.getElementById("warzone-alert-title");
    const metaEl = document.getElementById("warzone-alert-meta");
    if (titleEl) titleEl.textContent = title;
    if (metaEl) metaEl.textContent = meta;
    bindStickyDismiss(root);
    root.dataset.alertKey = key;
    root.dataset.alertVersion = isDevPreview
        ? String(alert.version || "dev-preview")
        : String(alert.version || alert.updated_at || Date.now());
    root.dataset.sticky = alert.sticky === true ? "true" : "";
    root.dataset.devAlertPreview = isDevPreview ? "1" : "";
    root.dataset.dismissed = "";
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    root.style.display = "";
    root.classList.toggle("is-red", level === "red" || level === "critical");
    root.classList.toggle("is-orange", !(level === "red" || level === "critical"));
    if (isDevPreview) root.classList.add("is-active");
    else requestAnimationFrame(() => root.classList.add("is-active"));
    if (__stickyAlertHideTimer) clearTimeout(__stickyAlertHideTimer);
    __stickyAlertHideTimer = isDevPreview
        ? 0
        : setTimeout(() => {
            hideStickyAlert(key);
        }, Number(alert.durationMs || STICKY_ALERT_AUTO_HIDE_MS));
}

function bindStickyDismiss(root) {
    const btn = document.getElementById("warzone-alert-dismiss")
        || root.querySelector(".warzone-alert__close");
    if (!btn || btn.dataset.dismissBound === "true") return;
    btn.dataset.dismissBound = "true";
    btn.addEventListener("click", () => {
        if (__devStickyAlertPreviewActive && root.dataset.devAlertPreview === "1") return;
        const key = root.dataset.alertKey;
        if (key) __dismissedAlertKeys.add(key);
        disableStickyAlertRoot();
    });
}

export function hideStickyAlert(alertKey) {
    const root = document.getElementById("warzone-alert");
    if (!root) return;
    if (__devStickyAlertPreviewActive && root.dataset.devAlertPreview === "1") return;
    if (alertKey && root.dataset.alertKey && root.dataset.alertKey !== alertKey) return;
    disableStickyAlertRoot();
}
