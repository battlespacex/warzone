const BILLING_TIER_KEY = "stratops:billing-tier";
const BILLING_ENABLED_KEY = "stratops:billing-enabled";
const DEFAULT_CHECKOUT_URL = "";
const PAID_TIERS = new Set(["basic", "advanced", "expert", "paid"]);
const PLAN_RANK = Object.freeze({
    free: 0,
    basic: 1,
    advanced: 2,
    expert: 3,
});
const FEATURE_ACCESS = Object.freeze({
    liveMap: { tier: "basic", label: "Live map access" },
    trackerPreview: { tier: "free", label: "Tracker preview" },
    fullAircraftTracker: { tier: "advanced", label: "Full aircraft tracker" },
    fullNavalTracker: { tier: "advanced", label: "Full naval tracker" },
    focusMode: { tier: "advanced", label: "Asset focus mode" },
    regionTools: { tier: "advanced", label: "Region tools" },
    premiumWidgets: { tier: "advanced", label: "Premium widgets" },
    premiumLayers: { tier: "advanced", label: "Premium operational overlays" },
    focusedAssetTrails: { tier: "advanced", label: "Focused asset trails" },
    savedViews: { tier: "expert", label: "Saved views" },
    alertTools: { tier: "expert", label: "Alert tools" },
    briefingWorkflow: { tier: "expert", label: "Report export" },
    priorityBeta: { tier: "expert", label: "Priority beta access" },
    teamUpgrade: { tier: "expert", label: "Client/team upgrade path" },
});
const CHECKOUT_IN_PROGRESS_KEY = "stratops:checkout-in-progress";
const CHECKOUT_IN_PROGRESS_FALLBACK_KEY = "stratops:checkout-in-progress-fallback";
let pricingEventsBound = false;
let pendingCheckoutPlan = "";

function normalizeTier(tier = "free") {
    const value = String(tier || "").toLowerCase();
    if (value === "paid") return "advanced";
    return PAID_TIERS.has(value) ? value : "free";
}

function getBillingConfig() {
    const cfg = window.__stratopsConfig?.billing || {};
    let enabled = cfg.enabled === true;
    const allowLocalBillingOverride = cfg.allowLocalBillingOverride === true;
    try {
        if (allowLocalBillingOverride && localStorage.getItem(BILLING_ENABLED_KEY) === "1") enabled = true;
    } catch {
        // Storage is optional; billing still works with in-memory defaults.
    }
    return {
        enabled,
        checkoutUrl: String(cfg.checkoutUrl || window.__STRATOPS_CHECKOUT_URL || DEFAULT_CHECKOUT_URL),
        checkoutUrls: cfg.checkoutUrls || {},
    };
}

function readStoredTier() {
    try {
        return normalizeTier(localStorage.getItem(BILLING_TIER_KEY));
    } catch {
        return "free";
    }
}

function writeStoredTier(tier = "free") {
    try {
        localStorage.setItem(BILLING_TIER_KEY, normalizeTier(tier));
    } catch {
        // Ignore private-mode/localStorage failures.
    }
}

function isPlaceholderCheckoutUrl(url = "") {
    return !url || /REPLACE_WITH|YOUR_STRIPE/i.test(url);
}

function setCheckoutStatus(message = "") {
    const status = document.getElementById("wz-pricing-checkout-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
}

function setCurrentPlanText(tier = readStoredTier(), status = "") {
    const plan = document.getElementById("wz-pricing-current-plan");
    if (!plan) return;
    const normalized = normalizeTier(tier);
    const label = normalized === "free"
        ? "Current plan: Free preview"
        : `Current plan: ${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    plan.textContent = status && status !== "none" ? `${label} (${status})` : label;
}

function getPlanRank(tier = readStoredTier()) {
    return PLAN_RANK[normalizeTier(tier)] ?? PLAN_RANK.free;
}

function getRequiredTier(featureOrTier = "basic") {
    const key = String(featureOrTier || "").trim();
    const directTier = key.toLowerCase();
    if (key && Object.prototype.hasOwnProperty.call(PLAN_RANK, directTier)) return directTier;
    return FEATURE_ACCESS[key]?.tier || "basic";
}

function getFeatureLabel(featureOrTier = "") {
    const key = String(featureOrTier || "").trim();
    return FEATURE_ACCESS[key]?.label || key || "This feature";
}

function formatTierLabel(tier = "basic") {
    const normalized = normalizeTier(tier);
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function hasPlanAccess(featureOrTier = "basic") {
    const cfg = getBillingConfig();
    if (!cfg.enabled) return true;
    return true;
}

function openUpgradeForFeature(featureOrTier = "advanced") {
    if (!getBillingConfig().enabled) return;
    const requiredTier = getRequiredTier(featureOrTier);
    const label = getFeatureLabel(featureOrTier);
    openPricingModal();
    setCheckoutStatus(`${label} requires the StratOps ${formatTierLabel(requiredTier)} plan.`);
}

function isEmail(value = "") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function findEmailCandidate(value, depth = 0) {
    if (!value || depth > 4) return "";
    if (typeof value === "string") {
        const trimmed = value.trim();
        return isEmail(trimmed) ? trimmed : "";
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findEmailCandidate(item, depth + 1);
            if (found) return found;
        }
        return "";
    }
    if (typeof value !== "object") return "";

    const directKeys = [
        "email",
        "emailAddress",
        "email_address",
        "mail",
        "userEmail",
        "user_email",
        "username",
        "name",
        "login",
    ];
    for (const key of directKeys) {
        const found = findEmailCandidate(value[key], depth + 1);
        if (found) return found;
    }
    for (const item of Object.values(value)) {
        const found = findEmailCandidate(item, depth + 1);
        if (found) return found;
    }
    return "";
}

function setLoginModalBillingError(message = "") {
    const error = document.getElementById("auth-error");
    if (!error) return;
    error.textContent = message;
    error.hidden = !message;
}

function getCurrentAuthUser() {
    const user = window.__stratopsAuthState?.user || null;
    if (!window.__stratopsAuthState?.isAuthenticated || !user) return null;
    const email = findEmailCandidate(user);
    const id = user.id || user.userId || user.user_id || user.sub || user.customerId || user.customer_id || email || "";
    return {
        id,
        email,
        username: user.username || user.name || "",
    };
}

function buildBillingUserQuery(user) {
    const params = new URLSearchParams();
    if (user?.email) params.set("email", user.email);
    if (user?.id) params.set("user_id", user.id);
    return params.toString();
}

function openSharedModal(modal) {
    if (!modal) return;
    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(modal);
        return;
    }
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-visible"));
}

function closeSharedModal(modal) {
    if (!modal) return;
    if (typeof window.__warzoneCloseSharedModal === "function") {
        window.__warzoneCloseSharedModal(modal);
        return;
    }
    modal.classList.remove("is-visible");
    setTimeout(() => {
        modal.hidden = true;
    }, 220);
}

function applyBillingState(tier = readStoredTier()) {
    const cfg = getBillingConfig();
    const normalizedTier = normalizeTier(tier);
    const isPaidTier = normalizedTier !== "free";
    document.body.classList.toggle("is-billing-enabled", cfg.enabled);
    document.body.classList.toggle("is-free-tier", !isPaidTier);
    document.body.classList.toggle("is-paid-tier", isPaidTier);
    document.body.classList.toggle("is-basic-tier", normalizedTier === "basic");
    document.body.classList.toggle("is-advanced-tier", normalizedTier === "advanced");
    document.body.classList.toggle("is-expert-tier", normalizedTier === "expert");
    document.body.dataset.billingTier = normalizedTier;
    document.dispatchEvent(new CustomEvent("wz:billing-tier-changed", {
        detail: {
            tier: normalizedTier,
            enabled: cfg.enabled,
        },
    }));
    setCurrentPlanText(normalizedTier);
    return normalizedTier;
}

function setBillingTier(tier = "free") {
    const normalizedTier = normalizeTier(tier);
    writeStoredTier(normalizedTier);
    return applyBillingState(normalizedTier);
}

function openPricingModal() {
    const modal = document.getElementById("wz-pricing-modal");
    setPricingTab("plans");
    setCheckoutStatus("");
    openSharedModal(modal);
}

function closePricingModal() {
    closeSharedModal(document.getElementById("wz-pricing-modal"));
}

function forceCloseModal(modal) {
    if (!modal) return;
    modal.classList.remove("is-visible");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
}

function markIntroAcceptedForBillingReturn() {
    window.__stratopsSuppressIntro = true;
    try {
        localStorage.setItem("wz_intro_accepted", "1");
    } catch {
        // Intro acceptance persistence is optional.
    }
    const introModal = document.getElementById("wz-intro-modal");
    if (!introModal) return;
    introModal.classList.remove("is-visible");
    introModal.hidden = true;
    introModal.setAttribute("aria-hidden", "true");
}

function showIntroAfterCheckoutInterruption() {
    window.__stratopsSuppressIntro = false;
    window.SiteLoader?.forceHide?.();

    const pricingModal = document.getElementById("wz-pricing-modal");
    const introModal = document.getElementById("wz-intro-modal");
    const regionModal = document.getElementById("wz-region-modal");

    forceCloseModal(pricingModal);
    forceCloseModal(regionModal);
    setCheckoutStatus("");

    if (!introModal) {
        window.__warzoneEnterApp?.();
        return;
    }

    introModal.hidden = false;
    introModal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
        introModal.classList.add("is-visible");
    });
}

function setPricingTab(tab = "plans") {
    const selected = tab === "compare" ? "compare" : "plans";
    document.querySelectorAll("[data-pricing-tab]").forEach((button) => {
        const isActive = button.dataset.pricingTab === selected;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
    });
    document.querySelectorAll("[data-pricing-pane]").forEach((pane) => {
        const isActive = pane.dataset.pricingPane === selected;
        pane.classList.toggle("is-active", isActive);
        pane.hidden = !isActive;
        pane.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
}

async function refreshBillingFromServer() {
    const user = getCurrentAuthUser();
    if (!user?.email && !user?.id) {
        const tier = applyBillingState("free");
        setCurrentPlanText(tier);
        return tier;
    }

    try {
        const query = buildBillingUserQuery(user);
        const response = await fetch(`/billing/me?${query}`, {
            credentials: "include",
            cache: "no-store",
            headers: {
                Accept: "application/json",
            },
        });
        if (!response.ok) throw new Error("Billing status request failed.");
        const data = await response.json();
        const tier = setBillingTier(data?.plan || "free");
        setCurrentPlanText(tier, data?.status || "");
        return tier;
    } catch (error) {
        console.warn("[billing] Unable to refresh billing status:", error);
        const tier = applyBillingState(readStoredTier());
        setCurrentPlanText(tier);
        return tier;
    }
}

async function finalizeCheckoutReturn(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    try {
        const response = await fetch(`/billing/checkout-session?session_id=${encodeURIComponent(id)}`, {
            credentials: "include",
            cache: "no-store",
            headers: {
                Accept: "application/json",
            },
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Checkout session lookup failed.");
        const tier = setBillingTier(data?.plan || "free");
        setCurrentPlanText(tier, data?.status || "active");
        document.dispatchEvent(new CustomEvent("wz:billing-checkout-finalized", {
            detail: data || {},
        }));
        return data;
    } catch (error) {
        console.warn("[billing] Unable to finalize checkout return:", error);
        return null;
    }
}

async function startCheckout(plan = "advanced") {
    const normalizedPlan = normalizeTier(plan);
    const user = getCurrentAuthUser();
    if (!user?.email) {
        pendingCheckoutPlan = normalizedPlan;
        setCheckoutStatus("Sign in first, then choose a StratOps plan.");
        closePricingModal();
        window.setTimeout(() => {
            window.__openLoginModal?.();
            setLoginModalBillingError("Enter your BattlespaceX email and password once so StratOps can attach this purchase to the correct account.");
        }, 260);
        return;
    }

    setCheckoutStatus("Opening secure Stripe checkout...");
    try {
        const response = await fetch("/billing/create-checkout-session", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                plan: normalizedPlan,
                user,
            }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            if (data?.needsConfig) {
                setCheckoutStatus(`Stripe is not fully configured yet. Missing ${data.missing?.priceEnv || "Stripe settings"}.`);
                return;
            }
            setCheckoutStatus(data?.error || "Unable to start checkout.");
            return;
        }
        if (data?.url && !isPlaceholderCheckoutUrl(data.url)) {
            closePricingModal();
            try {
                const marker = JSON.stringify({
                    plan: normalizedPlan,
                    startedAt: Date.now(),
                });
                sessionStorage.setItem(CHECKOUT_IN_PROGRESS_KEY, marker);
                localStorage.setItem(CHECKOUT_IN_PROGRESS_FALLBACK_KEY, marker);
            } catch {
                // Ignore private-mode/storage failures.
            }
            window.location.assign(data.url);
            return;
        }
        setCheckoutStatus("Stripe did not return a checkout URL.");
    } catch (error) {
        console.error("[billing] checkout failed:", error);
        setCheckoutStatus("Unable to reach the billing server. Please try again.");
    }
}

function bindPricingEvents() {
    if (pricingEventsBound) return;
    pricingEventsBound = true;

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const checkoutButton = target.closest("[data-billing-checkout]");
        if (checkoutButton) {
            event.preventDefault();
            if (!getBillingConfig().enabled) return;
            startCheckout(checkoutButton.dataset.billingPlan || "advanced");
            return;
        }

        const pricingTabButton = target.closest("[data-pricing-tab]");
        if (pricingTabButton) {
            event.preventDefault();
            setPricingTab(pricingTabButton.dataset.pricingTab || "plans");
            return;
        }

        const devTierButton = target.closest("[data-billing-dev-tier]");
        if (devTierButton) {
            event.preventDefault();
            setBillingTier(devTierButton.dataset.billingDevTier);
            closePricingModal();
            return;
        }

        const closeButton = target.closest("[data-billing-close-pricing]");
        if (closeButton) {
            event.preventDefault();
            closePricingModal();
            return;
        }

        const openButton = target.closest("[data-billing-open-pricing]");
        if (openButton) {
            event.preventDefault();
            if (!getBillingConfig().enabled) return;
            openPricingModal();
            return;
        }

        if (target.id === "wz-pricing-modal") {
            closePricingModal();
        }
    }, true);
}

function installBillingApi() {
    window.__stratopsBilling = {
        openPricing: openPricingModal,
        closePricing: closePricingModal,
        checkout: startCheckout,
        getTier: () => readStoredTier(),
        isPaid: () => readStoredTier() !== "free",
        refresh: refreshBillingFromServer,
        setTier: setBillingTier,
        isEnabled: () => getBillingConfig().enabled,
        hasAccess: hasPlanAccess,
        getRequiredTier,
        getFeatureLabel,
        openUpgradeForFeature,
    };
}

function clearCheckoutInProgress() {
    try {
        sessionStorage.removeItem(CHECKOUT_IN_PROGRESS_KEY);
        localStorage.removeItem(CHECKOUT_IN_PROGRESS_FALLBACK_KEY);
    } catch {
        // Ignore private-mode/storage failures.
    }
}

function hasCheckoutInProgress() {
    try {
        const marker = sessionStorage.getItem(CHECKOUT_IN_PROGRESS_KEY)
            || localStorage.getItem(CHECKOUT_IN_PROGRESS_FALLBACK_KEY);
        const parsed = JSON.parse(marker || "null");
        return Boolean(parsed?.startedAt && Date.now() - Number(parsed.startedAt) < 30 * 60 * 1000);
    } catch {
        return false;
    }
}

function handleCheckoutBrowserReturn() {
    const url = new URL(window.location.href);
    if (url.searchParams.has("billing")) return;
    if (!hasCheckoutInProgress()) return;
    clearCheckoutInProgress();
    pendingCheckoutPlan = "";
    showIntroAfterCheckoutInterruption();
}

export function initStratopsBilling() {
    installBillingApi();
    bindPricingEvents();
    const tier = applyBillingState(readStoredTier());
    const url = new URL(window.location.href);
    if (!getBillingConfig().enabled) {
        clearCheckoutInProgress();
        if (url.searchParams.has("billing") || url.searchParams.has("session_id")) {
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
        }
        return tier;
    }
    if (url.searchParams.get("billing") === "success") {
        clearCheckoutInProgress();
        markIntroAcceptedForBillingReturn();
        openPricingModal();
        setCheckoutStatus("Payment received. Activating your StratOps plan...");
        void finalizeCheckoutReturn(url.searchParams.get("session_id")).then((data) => {
            if (data?.plan) {
                setCheckoutStatus(`Payment received. Your ${data.plan} plan is active.`);
                return;
            }
            void refreshBillingFromServer();
            setCheckoutStatus("Payment received. Refreshing your StratOps plan...");
        });
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    } else if (url.searchParams.get("billing") === "cancelled") {
        clearCheckoutInProgress();
        pendingCheckoutPlan = "";
        showIntroAfterCheckoutInterruption();
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
    window.addEventListener("pageshow", handleCheckoutBrowserReturn, { passive: true });
    handleCheckoutBrowserReturn();
    document.addEventListener("wz:auth-success", () => {
        void refreshBillingFromServer();
        if (!pendingCheckoutPlan) return;
        const plan = pendingCheckoutPlan;
        pendingCheckoutPlan = "";
        window.setTimeout(() => {
            void startCheckout(plan);
        }, 120);
    });
    if (window.__stratopsAuthState?.isAuthenticated) {
        void refreshBillingFromServer();
    }
    return tier;
}

installBillingApi();
