import express from "express";
import { access } from "fs/promises";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { REPORT_VERSION, buildReportSlug, ensureOperationalReport, getPreviousUtcDateKey, toPublicReport } from "../../shared/reporting-service.js";
import { buildS3PublicUrl, getLocalReportFilePath } from "../../shared/reporting-s3.js";

const SUPPORT_TYPES = Object.freeze({
    one_time: {
        mode: "payment",
        priceEnv: "STRATOPS_ONE_TIME_PRICE_ID",
    },
    monthly: {
        mode: "subscription",
        priceEnv: "STRATOPS_MONTHLY_PRICE_ID",
    },
});

function normalizeSupportType(value = "") {
    const key = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SUPPORT_TYPES, key) ? key : "";
}

function isPlaceholderValue(value = "") {
    return /^PASTE_/i.test(String(value || "").trim());
}

function getStripeClient() {
    const key = String(process.env.STRATOPS_STRIPE_SECRET_KEY || "").trim();
    if (!key || isPlaceholderValue(key)) return null;
    return new Stripe(key, { apiVersion: "2024-06-20" });
}

function getStratopsDomain() {
    return String(process.env.STRATOPS_DOMAIN || "https://stratops.battlespacex.com")
        .replace(/\/+$/, "");
}

const PUBLIC_REPORT_ORIGINS = new Set([
    "https://stratops.battlespacex.com",
    "https://stratops-staging.battlespacex.com",
]);
const REPORT_STATUS_CACHE_TTL_MS = 30 * 1000;
const reportStatusCache = new Map();

function isLocalNetworkHost(hostname = "") {
    const host = String(hostname || "").trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "::1" || host === "[::1]") return true;
    if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function getRequestPublicOrigin(req) {
    const origin = String(req.get("origin") || "").trim();
    if (origin) {
        try {
            return new URL(origin).origin;
        } catch {
            return "";
        }
    }
    const referer = String(req.get("referer") || "").trim();
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch {
            return "";
        }
    }
    return "";
}

function getReportsPublicBase(req) {
    const requestOrigin = getRequestPublicOrigin(req);
    if (PUBLIC_REPORT_ORIGINS.has(requestOrigin)) return requestOrigin;
    const configured = String(
        process.env.STRATOPS_REPORTS_PUBLIC_URL ||
        process.env.REPORTS_PUBLIC_URL ||
        ""
    ).trim().replace(/\/+$/, "");
    if (configured) return configured;
    return getStratopsDomain();
}

function getPublicReportAssetUrl(req, report = {}) {
    const storageKey = String(report.pdf_storage_key || "").trim();
    const publicBase = getReportsPublicBase(req);
    if (storageKey && publicBase) {
        return buildS3PublicUrl({ aws: { cloudFrontUrl: publicBase } }, storageKey);
    }

    const pdfUrl = String(report.pdf_url || "").trim();
    if (!/^https?:\/\//i.test(pdfUrl)) return "";
    try {
        const url = new URL(pdfUrl);
        if (url.hostname.toLowerCase() === "api.battlespacex.com" && url.pathname.startsWith("/reports/")) {
            return `${publicBase}${url.pathname}${url.search}`;
        }
    } catch {
        return "";
    }
    return isBadPublicReportUrl(pdfUrl) ? "" : pdfUrl;
}

function toPublicApiReport(req, report = {}) {
    const publicReport = toPublicReport(report);
    const reportUrl = getPublicReportAssetUrl(req, report) || publicReport.public_url;
    return {
        ...publicReport,
        public_url: reportUrl,
        download_url: reportUrl,
    };
}

function isBadPublicReportUrl(value = "") {
    try {
        const url = new URL(String(value || "").trim());
        return (
            isLocalNetworkHost(url.hostname) ||
            (url.hostname.toLowerCase() === "api.battlespacex.com" && url.pathname.startsWith("/reports/"))
        );
    } catch {
        return true;
    }
}

function getReportRedirectUrl(req, report = {}) {
    const publicUrl = getPublicReportAssetUrl(req, report);
    if (publicUrl) return publicUrl;

    const pdfUrl = String(report.pdf_url || "").trim();
    if (/^https?:\/\//i.test(pdfUrl) && !isBadPublicReportUrl(pdfUrl)) return pdfUrl;

    const storageKey = String(report.pdf_storage_key || "").trim();
    if (!storageKey) return "";
    const config = readReportingConfig();
    if (!config.aws.bucket) return "";
    return buildS3PublicUrl(config, storageKey);
}

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeReportType(value = "") {
    const type = String(value || "daily").trim().toLowerCase();
    return type === "weekly" ? "weekly" : "daily";
}

function normalizeReportScope(body = {}, query = {}) {
    const scopeType = String(body.scope_type || body.scopeType || query.scope_type || query.scopeType || "global").trim().toLowerCase();
    const scopeValue = String(body.scope_value || body.scopeValue || query.scope_value || query.scopeValue || "").trim();
    const label = String(body.scope_label || body.scopeLabel || query.scope_label || query.scopeLabel || scopeValue || "").trim();
    const bbox = Array.isArray(body.bbox)
        ? body.bbox.map(Number)
        : String(query.bbox || "")
            .split(",")
            .map(Number)
            .filter(Number.isFinite);
    return {
        type: ["region", "country", "aoi"].includes(scopeType) ? scopeType : "global",
        value: scopeValue,
        label,
        bbox: bbox.length === 4 ? bbox : null,
    };
}

function getReportScopeKey(scope = {}) {
    const type = String(scope.type || "global").trim().toLowerCase();
    if (type === "global") return "global";
    const value = String(scope.value || scope.label || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${type}:${value || "all"}`;
}

function getCachedReportStatus(cacheKey) {
    const cached = reportStatusCache.get(cacheKey);
    if (!cached || Date.now() > cached.expiresAt) {
        reportStatusCache.delete(cacheKey);
        return null;
    }
    return cached.value;
}

function setCachedReportStatus(cacheKey, value) {
    reportStatusCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + REPORT_STATUS_CACHE_TTL_MS,
    });
}

function normalizeSupportEmail(value = "") {
    return String(value || "").trim().toLowerCase();
}

function isValidSupportEmail(value = "") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeSupportEmail(value));
}

function getActiveSupportSubscription(subscriptions = []) {
    return [...subscriptions]
        .filter((subscription) => subscription?.status === "active" || subscription?.status === "trialing")
        .sort((left, right) => Number(right?.created || 0) - Number(left?.created || 0))[0] || null;
}

async function findSupportPortalCustomer(stripe, email) {
    const normalizedEmail = normalizeSupportEmail(email);
    const customerList = await stripe.customers.list({ email: normalizedEmail, limit: 25 });
    const customers = [...(customerList?.data || [])]
        .filter((customer) => normalizeSupportEmail(customer?.email) === normalizedEmail)
        .sort((left, right) => Number(right?.created || 0) - Number(left?.created || 0));
    if (!customers.length) {
        return { code: "missing_customer" };
    }

    for (const customer of customers) {
        const subscriptionList = await stripe.subscriptions.list({
            customer: customer.id,
            status: "all",
            limit: 25,
        });
        const subscription = getActiveSupportSubscription(subscriptionList?.data || []);
        if (subscription) {
            return { customer, subscription };
        }
    }

    return { code: "missing_subscription" };
}

export function stratopsRouter() {
    const router = express.Router();

    router.get("/reports", async (req, res) => {
        try {
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), 1, 50)
                : 12;
            const reportType = String(req.query.type || "").trim().toLowerCase();
            let builder = getSupabase()
                .from("operational_reports")
                .select("id, report_key, report_type, scope_type, scope_value, scope_label, period_start, period_end, status, generated_summary, report_version, download_token, pdf_url, pdf_storage_key, expires_at, created_at, updated_at")
                .eq("status", "available")
                .gt("expires_at", new Date().toISOString())
                .order("period_start", { ascending: false })
                .limit(limit);
            if (reportType === "daily" || reportType === "weekly") {
                builder = builder.eq("report_type", reportType);
            }
            const { data, error } = await builder;
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ reports: (data || []).map((report) => toPublicApiReport(req, report)) });
        } catch (error) {
            console.error("[stratops] report list failed:", error);
            res.status(500).json({ error: "Failed" });
        }
    });

    router.post("/reports/generate", express.json({ limit: "128kb" }), async (req, res) => {
        try {
            const config = readReportingConfig();
            if (!config.apiEnabled) {
                return res.status(503).json({ error: "Reporting is disabled." });
            }
            const reportType = normalizeReportType(req.body?.type || req.body?.report_type);
            const dateKey = String(req.body?.date || req.body?.snapshot_date || getPreviousUtcDateKey()).slice(0, 10);
            const scope = normalizeReportScope(req.body || {}, req.query || {});
            const report = await ensureOperationalReport({
                supabase: getSupabase(),
                config,
                reportType,
                dateKey,
                scope,
                force: req.body?.force === true,
            });
            res.json({ report: toPublicApiReport(req, report) });
        } catch (error) {
            console.error("[stratops] report generation failed:", error);
            const status = String(error?.message || "").includes("requires 7 daily snapshots") ? 409 : 500;
            res.status(status).json({ error: error?.message || "Report generation failed" });
        }
    });

    router.get("/reports/latest", async (req, res) => {
        try {
            const reportType = normalizeReportType(req.query.type);
            const scope = normalizeReportScope({}, req.query || {});
            const scopeKey = getReportScopeKey(scope);
            const cacheKey = `${reportType}:${scopeKey}`;
            const cached = getCachedReportStatus(cacheKey);
            if (cached) return res.json(cached);

            const supabase = getSupabase();
            const commonColumns = "id, report_key, report_type, scope_type, scope_value, scope_label, period_start, period_end, status, generated_summary, report_version, download_token, pdf_url, pdf_storage_key, expires_at, created_at, updated_at";
            const now = new Date().toISOString();
            const available = await supabase
                .from("operational_reports")
                .select(commonColumns)
                .eq("report_type", reportType)
                .eq("scope_key", scopeKey)
                .eq("report_version", REPORT_VERSION)
                .eq("status", "available")
                .gt("expires_at", now)
                .order("period_start", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (available.error) {
                return res.status(500).json({ error: "Failed" });
            }

            if (available.data) {
                const payload = {
                    status: "available",
                    report: toPublicApiReport(req, available.data),
                    message: "Latest cached operational briefings is ready.",
                };
                setCachedReportStatus(cacheKey, payload);
                return res.json(payload);
            }

            const pending = await supabase
                .from("operational_reports")
                .select("id, report_key, report_type, scope_type, scope_value, scope_label, period_start, period_end, status, generated_summary, report_version, expires_at, created_at, updated_at")
                .eq("report_type", reportType)
                .eq("scope_key", scopeKey)
                .in("status", ["generating", "failed"])
                .order("updated_at", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (pending.error) {
                return res.status(500).json({ error: "Failed" });
            }

            const status = pending.data?.status === "failed"
                ? "unavailable"
                : (pending.data ? "preparing" : "missing");
            const payload = {
                status,
                report: pending.data ? toPublicApiReport(req, pending.data) : null,
                message: status === "preparing"
                    ? "The latest operational briefings is being prepared."
                    : "No cached operational briefings is available yet.",
            };
            setCachedReportStatus(cacheKey, payload);
            res.json(payload);
        } catch (error) {
            console.error("[stratops] latest report lookup failed:", error);
            res.status(500).json({ error: "Failed" });
        }
    });

    router.get("/reports/:id/download", async (req, res) => {
        try {
            const id = String(req.params.id || "").trim();
            const token = String(req.query.token || "").trim();
            if (!id || !token) return res.status(403).json({ error: "Forbidden" });
            const { data, error } = await getSupabase()
                .from("operational_reports")
                .select("id, status, pdf_url, pdf_storage_key, download_token, expires_at")
                .eq("id", id)
                .eq("download_token", token)
                .maybeSingle();
            const redirectUrl = data ? getReportRedirectUrl(req, data) : "";
            if (error || !data || data.status !== "available" || !redirectUrl) {
                return res.status(404).json({ error: "Report unavailable" });
            }
            if (data.expires_at && Date.parse(data.expires_at) <= Date.now()) {
                return res.status(410).json({ error: "Report expired" });
            }
            res.redirect(302, redirectUrl);
        } catch (error) {
            console.error("[stratops] report download failed:", error);
            res.status(500).json({ error: "Failed" });
        }
    });

    router.get("/reports/file/*", async (req, res) => {
        try {
            const key = String(req.params[0] || "").trim();
            if (!key) {
                return res.status(404).json({ error: "Report unavailable" });
            }
            const filePath = getLocalReportFilePath(key);
            await access(filePath);
            res.set("Cache-Control", "private, max-age=300");
            res.type("application/pdf");
            res.sendFile(filePath);
        } catch (error) {
            res.status(404).json({ error: "Report unavailable" });
        }
    });

    router.get("/reports/slug/:slug", async (req, res) => {
        try {
            const slug = String(req.params.slug || "").trim().toLowerCase();
            if (!slug) return res.status(404).json({ error: "Report unavailable" });
            const wantsJson = req.accepts(["json", "html", "pdf"]) === "json";
            const { data, error } = await getSupabase()
                .from("operational_reports")
                .select("id, report_key, report_type, scope_type, scope_value, scope_label, period_start, period_end, status, generated_summary, report_version, download_token, pdf_url, pdf_storage_key, expires_at, created_at, updated_at")
                .eq("status", "available")
                .eq("report_version", REPORT_VERSION)
                .gt("expires_at", new Date().toISOString())
                .order("period_start", { ascending: false })
                .limit(100);
            if (error || !Array.isArray(data)) {
                return res.status(404).json({ error: "Report unavailable" });
            }
            const match = data.find((report) => buildReportSlug(report) === slug);
            const redirectUrl = match ? getReportRedirectUrl(req, match) : "";
            if (!redirectUrl) {
                return res.status(404).json({ error: "Report unavailable" });
            }
            if (wantsJson) {
                return res.json({ report: toPublicApiReport(req, match) });
            }
            res.redirect(302, redirectUrl);
        } catch (error) {
            console.error("[stratops] report slug download failed:", error);
            res.status(500).json({ error: "Failed" });
        }
    });

    router.post("/create-checkout-session", express.json({ limit: "64kb" }), async (req, res) => {
        const supportType = normalizeSupportType(req.body?.supportType);
        const config = SUPPORT_TYPES[supportType];
        if (!config) {
            res.status(400).json({ error: "Invalid support type." });
            return;
        }

        const stripe = getStripeClient();
        const priceId = String(process.env[config.priceEnv] || "").trim();
        const hasPriceId = Boolean(priceId && !isPlaceholderValue(priceId));
        if (!stripe || !hasPriceId) {
            res.status(501).json({
                error: "Stripe Checkout is not configured yet.",
                needsConfig: true,
                missing: {
                    stripeSecretKey: !stripe,
                    priceId: !hasPriceId,
                    priceEnv: config.priceEnv,
                },
            });
            return;
        }

        const domain = getStratopsDomain();
        try {
            const session = await stripe.checkout.sessions.create({
                mode: config.mode,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${domain}/?support=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${domain}/?support=cancel`,
                metadata: {
                    purpose: "stratops_support",
                    support_type: supportType,
                },
            });
            res.json({ url: session.url });
        } catch (error) {
            console.error("[stratops] support checkout failed:", error);
            res.status(500).json({ error: "Unable to open Stripe Checkout. Please try again." });
        }
    });

    router.post("/create-portal-session", express.json({ limit: "64kb" }), async (req, res) => {
        const email = normalizeSupportEmail(req.body?.email);
        if (!email) {
            res.status(400).json({ error: "Please enter your email address." });
            return;
        }
        if (!isValidSupportEmail(email)) {
            res.status(400).json({ error: "Please enter a valid email address." });
            return;
        }

        const stripe = getStripeClient();
        if (!stripe) {
            res.status(501).json({ error: "Stripe Billing Portal is not configured yet." });
            return;
        }

        try {
            const match = await findSupportPortalCustomer(stripe, email);
            if (match?.code === "missing_customer") {
                res.status(404).json({ error: "No subscription found for this email." });
                return;
            }
            if (match?.code === "missing_subscription" || !match?.customer) {
                res.status(404).json({ error: "No monthly subscription found for this email." });
                return;
            }

            const session = await stripe.billingPortal.sessions.create({
                customer: match.customer.id,
                return_url: getStratopsDomain(),
            });
            res.json({ url: session.url });
        } catch (error) {
            console.error("[stratops] support portal failed:", error);
            res.status(500).json({ error: "Unable to open the billing portal. Please try again." });
        }
    });

    return router;
}
