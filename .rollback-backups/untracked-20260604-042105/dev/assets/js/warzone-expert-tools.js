import { LAYER_DEFS, isLayerEnabled, refreshLayerAccessUi, setLayer } from "./warzone-layers.js";
import { getActiveLens, getActiveRegion, selectRegion, setActiveLens } from "./warzone-region-selector.js";

const SAVED_VIEWS_KEY = "stratops:expert:saved-views";
const ALERT_RULES_KEY = "stratops:expert:alert-rules";
const WIDGET_STATE_KEY = "wz_widget_visibility";
const MAX_VISIBLE_EVENTS = 120;

let __viewer = null;
let __bound = false;
let __events = [];
let __alertMatches = [];

const SEVERITY_RANK = Object.freeze({
    low: 1,
    medium: 2,
    moderate: 2,
    high: 3,
    critical: 4,
});

function hasExpertAccess() {
    return window.__stratopsBilling?.hasAccess?.("savedViews") !== false;
}

function requireExpertAccess() {
    if (hasExpertAccess()) return true;
    window.__stratopsBilling?.openUpgradeForFeature?.("savedViews");
    return false;
}

function openSharedModal(modal) {
    if (!modal) return;
    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(modal);
        return;
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
}

function closeSharedModal(modal) {
    if (!modal) return;
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal);
        return;
    }
    modal.classList.remove("is-visible");
    window.setTimeout(() => {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
    }, 220);
}

function readJson(key, fallback) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "");
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Local Expert tools are optional; storage failure should not break the app.
    }
}

function formatDateTime(value = Date.now()) {
    try {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date(value));
    } catch {
        return String(value || "");
    }
}

function getCameraSnapshot() {
    const camera = __viewer?.camera;
    const CesiumRef = window.Cesium;
    if (!camera || !CesiumRef) return null;
    const carto = CesiumRef.Cartographic.fromCartesian(camera.positionWC || camera.position);
    if (!carto) return null;
    return {
        lon: CesiumRef.Math.toDegrees(carto.longitude),
        lat: CesiumRef.Math.toDegrees(carto.latitude),
        height: carto.height,
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll,
    };
}

function getLayerSnapshot() {
    return LAYER_DEFS.reduce((state, layer) => {
        state[layer.id] = !!isLayerEnabled(layer.id);
        return state;
    }, {});
}

function getWidgetSnapshot() {
    const state = {};
    document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
        state[widget.dataset.widgetId] = !widget.classList.contains("wz-is-hidden");
    });
    return state;
}

function getCurrentContext() {
    const region = getActiveRegion?.();
    const camera = getCameraSnapshot();
    return {
        regionId: region?.id || "global",
        regionLabel: region?.label || region?.name || "Global",
        lens: getActiveLens?.() || "live",
        camera,
        layers: getLayerSnapshot(),
        widgets: getWidgetSnapshot(),
    };
}

function readSavedViews() {
    return Array.isArray(readJson(SAVED_VIEWS_KEY, [])) ? readJson(SAVED_VIEWS_KEY, []) : [];
}

function saveSavedViews(views) {
    writeJson(SAVED_VIEWS_KEY, Array.isArray(views) ? views : []);
}

function readAlertRules() {
    return Array.isArray(readJson(ALERT_RULES_KEY, [])) ? readJson(ALERT_RULES_KEY, []) : [];
}

function saveAlertRules(rules) {
    writeJson(ALERT_RULES_KEY, Array.isArray(rules) ? rules : []);
}

function setStatus(id, message = "", tone = "") {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.dataset.tone = tone || "";
}

function activateTab(tabName = "views") {
    const modal = document.getElementById("wz-expert-tools-modal");
    if (!modal) return;
    modal.querySelectorAll("[data-expert-tab]").forEach((button) => {
        const active = button.dataset.expertTab === tabName;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
    });
    modal.querySelectorAll("[data-expert-pane]").forEach((pane) => {
        const active = pane.dataset.expertPane === tabName;
        pane.classList.toggle("is-active", active);
        pane.setAttribute("aria-hidden", String(!active));
    });
    window.__warzoneScheduleModalBoxHeight?.(modal.querySelector(".wz-modal-box"));
}

function openExpertTools(tabName = "views") {
    if (!requireExpertAccess()) return;
    renderExpertTools();
    activateTab(tabName);
    openSharedModal(document.getElementById("wz-expert-tools-modal"));
}

function closeMobileMenuIfNeeded(button) {
    if (!button?.closest?.(".wz-mobile-dock-menu")) return;
    document.getElementById("wz-mobile-dock-menu-close")?.click();
}

function saveCurrentView() {
    if (!requireExpertAccess()) return;
    const nameInput = document.getElementById("wz-saved-view-name");
    const name = String(nameInput?.value || "").trim() || `View ${formatDateTime(Date.now())}`;
    const context = getCurrentContext();
    if (!context.camera) {
        setStatus("wz-saved-view-status", "Camera is not ready yet. Try again in a moment.", "error");
        return;
    }
    const views = readSavedViews();
    views.unshift({
        id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdAt: Date.now(),
        ...context,
    });
    saveSavedViews(views.slice(0, 18));
    if (nameInput) nameInput.value = "";
    setStatus("wz-saved-view-status", "View saved locally on this browser.", "success");
    renderSavedViews();
}

function downloadExpertBackup() {
    if (!requireExpertAccess()) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = {
        type: "stratops-expert-local-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        savedViews: readSavedViews(),
        alertRules: readAlertRules(),
    };
    downloadText(
        `stratops-expert-local-backup-${stamp}.json`,
        JSON.stringify(payload, null, 2),
        "application/json"
    );
    setStatus("wz-saved-view-status", "Local backup downloaded to this computer.", "success");
}

function applyWidgetSnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== "object") return;
    document.querySelectorAll(".warzone-widget[data-widget-id]").forEach((widget) => {
        const id = widget.dataset.widgetId;
        if (!(id in snapshot)) return;
        widget.classList.toggle("wz-is-hidden", !snapshot[id]);
    });
    writeJson(WIDGET_STATE_KEY, snapshot);
    window.__syncWarzoneDock?.();
}

function loadSavedView(viewId = "") {
    if (!requireExpertAccess()) return;
    const view = readSavedViews().find((item) => item.id === viewId);
    if (!view) return;
    if (view.lens) setActiveLens?.(view.lens);
    if (view.regionId) {
        selectRegion?.(__viewer, view.regionId, {
            source: "saved-view",
            allowAnyRegion: true,
        });
    }
    Object.entries(view.layers || {}).forEach(([layerId, enabled]) => {
        setLayer(layerId, !!enabled);
    });
    refreshLayerAccessUi?.();
    applyWidgetSnapshot(view.widgets);
    if (view.camera && window.Cesium && __viewer?.camera) {
        window.setTimeout(() => {
            __viewer.camera.flyTo({
                destination: window.Cesium.Cartesian3.fromDegrees(
                    Number(view.camera.lon),
                    Number(view.camera.lat),
                    Number(view.camera.height)
                ),
                orientation: {
                    heading: Number(view.camera.heading) || 0,
                    pitch: Number(view.camera.pitch) || -0.9,
                    roll: Number(view.camera.roll) || 0,
                },
                duration: 1.15,
            });
        }, 320);
    }
    setStatus("wz-saved-view-status", `Loaded "${view.name}".`, "success");
}

function deleteSavedView(viewId = "") {
    const view = readSavedViews().find((item) => item.id === viewId);
    saveSavedViews(readSavedViews().filter((item) => item.id !== viewId));
    setStatus("wz-saved-view-status", view ? `Deleted "${view.name}".` : "", "success");
    renderSavedViews();
}

function renderSavedViews() {
    const container = document.getElementById("wz-saved-views-list");
    if (!container) return;
    const views = readSavedViews();
    if (!views.length) {
        container.innerHTML = `<p class="wz-expert-empty">No saved views yet.</p>`;
        return;
    }
    container.innerHTML = views.map((view) => `
        <article class="wz-expert-row" data-view-id="${view.id}">
            <span>
                <strong>${escapeHtml(view.name)}</strong>
                <small>${escapeHtml(view.regionLabel || "Global")} - ${escapeHtml(view.lens || "live")} - ${escapeHtml(formatDateTime(view.createdAt))}</small>
            </span>
            <span class="wz-expert-row__actions">
                <button type="button" class="btn-secondary white" data-load-view="${view.id}">Load</button>
                <button type="button" class="btn-secondary white" data-delete-view="${view.id}">Delete</button>
            </span>
        </article>
    `).join("");
}

function getSeverityRank(value = "") {
    return SEVERITY_RANK[String(value || "").toLowerCase()] || 0;
}

function eventText(event = {}) {
    return [
        event.title,
        event.summary,
        event.category,
        event.subcategory,
        event.source_name,
        event.location_label,
        event.region,
        event.country,
        event.weapon_type,
    ].filter(Boolean).join(" ").toLowerCase();
}

function eventMatchesRule(event = {}, rule = {}) {
    const keyword = String(rule.keyword || "").trim().toLowerCase();
    const category = String(rule.category || "").trim().toLowerCase();
    const minSeverity = String(rule.minSeverity || "").trim().toLowerCase();
    if (keyword && !eventText(event).includes(keyword)) return false;
    if (category && category !== "any" && String(event.category || "").toLowerCase() !== category) return false;
    if (minSeverity && minSeverity !== "any" && getSeverityRank(event.severity) < getSeverityRank(minSeverity)) return false;
    return true;
}

function evaluateAlertRules(events = __events) {
    const rules = readAlertRules();
    __alertMatches = [];
    if (!rules.length) {
        renderAlertMatches();
        return;
    }
    rules.forEach((rule) => {
        events.slice(0, MAX_VISIBLE_EVENTS).forEach((event) => {
            if (!eventMatchesRule(event, rule)) return;
            __alertMatches.push({ rule, event });
        });
    });
    renderAlertMatches();
}

function addAlertRule() {
    if (!requireExpertAccess()) return;
    const keyword = String(document.getElementById("wz-alert-keyword")?.value || "").trim();
    const category = String(document.getElementById("wz-alert-category")?.value || "any").trim();
    const minSeverity = String(document.getElementById("wz-alert-severity")?.value || "any").trim();
    if (!keyword && category === "any" && minSeverity === "any") {
        setStatus("wz-alert-rule-status", "Add a keyword, category, or severity before saving.", "error");
        return;
    }
    const name = keyword || `${category} ${minSeverity}`.trim() || "Alert rule";
    const rules = readAlertRules();
    rules.unshift({
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        keyword,
        category,
        minSeverity,
        createdAt: Date.now(),
    });
    saveAlertRules(rules.slice(0, 24));
    ["wz-alert-keyword"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });
    setStatus("wz-alert-rule-status", "Alert rule saved locally.", "success");
    renderAlertRules();
    evaluateAlertRules();
}

function deleteAlertRule(ruleId = "") {
    saveAlertRules(readAlertRules().filter((rule) => rule.id !== ruleId));
    setStatus("wz-alert-rule-status", "Alert rule deleted.", "success");
    renderAlertRules();
    evaluateAlertRules();
}

function renderAlertRules() {
    const container = document.getElementById("wz-alert-rules-list");
    if (!container) return;
    const rules = readAlertRules();
    if (!rules.length) {
        container.innerHTML = `<p class="wz-expert-empty">No local alert rules yet.</p>`;
        return;
    }
    container.innerHTML = rules.map((rule) => `
        <article class="wz-expert-row" data-rule-id="${rule.id}">
            <span>
                <strong>${escapeHtml(rule.name)}</strong>
                <small>${escapeHtml([
                    rule.keyword ? `keyword: ${rule.keyword}` : "",
                    rule.category && rule.category !== "any" ? `category: ${rule.category}` : "",
                    rule.minSeverity && rule.minSeverity !== "any" ? `severity: ${rule.minSeverity}+` : "",
                ].filter(Boolean).join(" - ") || "Any visible event")}</small>
            </span>
            <button type="button" class="btn-secondary white" data-delete-rule="${rule.id}">Delete</button>
        </article>
    `).join("");
}

function renderAlertMatches() {
    const container = document.getElementById("wz-alert-matches-list");
    if (!container) return;
    if (!__alertMatches.length) {
        container.innerHTML = `<p class="wz-expert-empty">No matching visible events right now.</p>`;
        return;
    }
    container.innerHTML = __alertMatches.slice(0, 40).map(({ rule, event }) => `
        <article class="wz-expert-match">
            <strong>${escapeHtml(rule.name)}</strong>
            <span>${escapeHtml(event.title || "Untitled event")}</span>
            <small>${escapeHtml([event.category, event.severity, event.location_label || event.region].filter(Boolean).join(" - "))}</small>
        </article>
    `).join("");
}

function formatBriefingMarkdown() {
    const context = getCurrentContext();
    const activeLayers = Object.entries(context.layers || {})
        .filter(([, enabled]) => enabled)
        .map(([id]) => LAYER_DEFS.find((layer) => layer.id === id)?.label || id);
    const topEvents = __events.slice(0, 20);
    const alertLines = __alertMatches.slice(0, 10)
        .map(({ rule, event }) => `- ${rule.name}: ${event.title || "Untitled event"}`);
    const eventLines = topEvents.map((event, index) => {
        const parts = [event.category, event.severity, event.location_label || event.region].filter(Boolean).join(" | ");
        return `${index + 1}. ${event.title || "Untitled event"}${parts ? ` (${parts})` : ""}`;
    });
    const camera = context.camera;
    return [
        "# StratOps Briefing Snapshot",
        "",
        `Generated: ${new Date().toISOString()}`,
        `Region: ${context.regionLabel}`,
        `Lens: ${context.lens}`,
        camera ? `Camera: ${camera.lat.toFixed(4)}, ${camera.lon.toFixed(4)} @ ${Math.round(camera.height).toLocaleString()} m` : "Camera: unavailable",
        "",
        "## Active Layers",
        activeLayers.length ? activeLayers.map((name) => `- ${name}`).join("\n") : "- None",
        "",
        "## Local Alert Matches",
        alertLines.length ? alertLines.join("\n") : "- None",
        "",
        "## Visible Event Snapshot",
        eventLines.length ? eventLines.join("\n") : "- No visible events",
        "",
        "## Notes",
        "- OSINT-informed monitoring snapshot. Verify independently before operational, financial, legal, or safety decisions.",
    ].join("\n");
}

async function copyBriefing() {
    if (!requireExpertAccess()) return;
    const text = formatBriefingMarkdown();
    try {
        await navigator.clipboard.writeText(text);
        setStatus("wz-briefing-status", "Briefing copied to clipboard.", "success");
    } catch {
        setStatus("wz-briefing-status", "Clipboard is unavailable in this browser. Use Download Briefing instead.", "error");
    }
}

function downloadText(filename, text, type = "text/markdown") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function downloadBriefing() {
    if (!requireExpertAccess()) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(`stratops-briefing-${stamp}.md`, formatBriefingMarkdown());
    setStatus("wz-briefing-status", "Briefing file downloaded.", "success");
}

function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderExpertTools() {
    syncExpertToolButtons();
    renderSavedViews();
    renderAlertRules();
    evaluateAlertRules();
}

function syncExpertToolButtons() {
    const locked = !hasExpertAccess();
    document.querySelectorAll("[data-expert-tools-open]").forEach((button) => {
        button.classList.toggle("is-plan-locked", locked);
        button.setAttribute("aria-disabled", locked ? "true" : "false");
        button.title = locked ? "Upgrade to StratOps Expert to use Expert tools" : "Open Expert tools";
    });
}

function bindExpertTools() {
    if (__bound) return;
    __bound = true;

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const openButton = target.closest("[data-expert-tools-open]");
        if (openButton) {
            event.preventDefault();
            closeMobileMenuIfNeeded(openButton);
            openExpertTools(openButton.dataset.expertToolsOpen || "views");
            return;
        }

        const tab = target.closest("[data-expert-tab]");
        if (tab) {
            event.preventDefault();
            activateTab(tab.dataset.expertTab || "views");
            return;
        }

        if (target.closest("[data-expert-tools-close]")) {
            event.preventDefault();
            closeSharedModal(document.getElementById("wz-expert-tools-modal"));
            return;
        }

        const loadView = target.closest("[data-load-view]");
        if (loadView) {
            event.preventDefault();
            loadSavedView(loadView.dataset.loadView);
            return;
        }

        const deleteView = target.closest("[data-delete-view]");
        if (deleteView) {
            event.preventDefault();
            deleteSavedView(deleteView.dataset.deleteView);
            return;
        }

        const deleteRule = target.closest("[data-delete-rule]");
        if (deleteRule) {
            event.preventDefault();
            deleteAlertRule(deleteRule.dataset.deleteRule);
            return;
        }

        if (target.id === "wz-expert-tools-modal") {
            closeSharedModal(target);
        }
    }, true);

    document.getElementById("wz-saved-view-save")?.addEventListener("click", saveCurrentView);
    document.getElementById("wz-expert-backup-download")?.addEventListener("click", downloadExpertBackup);
    document.getElementById("wz-alert-rule-add")?.addEventListener("click", addAlertRule);
    document.getElementById("wz-briefing-copy")?.addEventListener("click", copyBriefing);
    document.getElementById("wz-briefing-download")?.addEventListener("click", downloadBriefing);

    document.addEventListener("wz:events-rendered", (event) => {
        const nextEvents = Array.isArray(event.detail?.events) ? event.detail.events : [];
        __events = nextEvents;
        evaluateAlertRules(nextEvents);
    });

    document.addEventListener("wz:billing-tier-changed", renderExpertTools);
}

export function initStratopsExpertTools(viewer) {
    __viewer = viewer || window.__warzoneViewer || null;
    __events = Array.isArray(window.__stratopsLastVisibleEvents) ? window.__stratopsLastVisibleEvents : [];
    bindExpertTools();
    renderExpertTools();
}
