const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const PLAN_CONFIG = Object.freeze({
    basic: {
        label: "Basic",
        priceEnv: "STRIPE_BASIC_PRICE_ID",
    },
    advanced: {
        label: "Advanced",
        priceEnv: "STRIPE_ADVANCED_PRICE_ID",
    },
    expert: {
        label: "Expert",
        priceEnv: "STRIPE_EXPERT_PRICE_ID",
    },
});

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);
const SUPPORT_PRICE_ENV = "STRIPE_SUPPORT_PRICE_ID";
const STRATOPS_SUPPORT_TYPES = Object.freeze({
    one_time: {
        mode: "payment",
        priceEnv: "STRATOPS_ONE_TIME_PRICE_ID",
    },
    monthly: {
        mode: "subscription",
        priceEnv: "STRATOPS_MONTHLY_PRICE_ID",
    },
});
let supabaseAdminClient = null;

function normalizePlan(plan = "") {
    const value = String(plan || "").toLowerCase();
    return PLAN_CONFIG[value] ? value : "advanced";
}

function normalizeEmail(email = "") {
    return String(email || "").trim().toLowerCase();
}

function getStripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key, { apiVersion: "2024-06-20" });
}

function isPlaceholderValue(value = "") {
    return /^PASTE_/i.test(String(value || "").trim());
}

function getStratopsStripeClient() {
    const key = String(process.env.STRATOPS_STRIPE_SECRET_KEY || "").trim();
    if (!key || isPlaceholderValue(key)) return null;
    return new Stripe(key, { apiVersion: "2024-06-20" });
}

function normalizeSupportType(value = "") {
    const key = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(STRATOPS_SUPPORT_TYPES, key) ? key : "";
}

function getStratopsDomain() {
    return String(process.env.STRATOPS_DOMAIN || "https://stratops.battlespacex.com")
        .replace(/\/+$/, "");
}

function getSubscriptionTableName() {
    return process.env.STRATOPS_SUBSCRIPTIONS_TABLE || "stratops_subscriptions";
}

function getSupabaseAdminClient() {
    const url = process.env.SUPABASE_URL || process.env.STRATOPS_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STRATOPS_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return null;
    if (!supabaseAdminClient) {
        supabaseAdminClient = createClient(url, serviceKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }
    return supabaseAdminClient;
}

function getPublicBaseUrl(req) {
    const configured = String(process.env.STRATOPS_PUBLIC_URL || "").replace(/\/+$/, "");
    if (configured) return configured;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    return `${protocol}://${host}`;
}

function getStorePath() {
    return process.env.STRATOPS_BILLING_STORE_PATH
        || path.join(process.cwd(), "data", "stratops-subscriptions.json");
}

async function readStore() {
    const storePath = getStorePath();
    try {
        const raw = await fs.readFile(storePath, "utf8");
        const parsed = JSON.parse(raw);
        return {
            subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        };
    } catch {
        return { subscriptions: [] };
    }
}

async function writeStore(store) {
    const storePath = getStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function subscriptionKey(record = {}) {
    const email = normalizeEmail(record.email);
    if (email) return `email:${email}`;
    if (record.user_id) return `user:${String(record.user_id)}`;
    if (record.stripe_customer_id) return `customer:${String(record.stripe_customer_id)}`;
    return "";
}

async function upsertSubscription(record = {}) {
    const now = new Date().toISOString();
    const normalized = {
        user_id: record.user_id ? String(record.user_id) : "",
        email: normalizeEmail(record.email),
        plan: normalizePlan(record.plan),
        status: String(record.status || "active"),
        stripe_customer_id: record.stripe_customer_id ? String(record.stripe_customer_id) : "",
        stripe_subscription_id: record.stripe_subscription_id ? String(record.stripe_subscription_id) : "",
        current_period_end: record.current_period_end || null,
        updated_at: now,
    };
    const key = subscriptionKey(normalized);
    if (!key) return normalized;
    const supabase = getSupabaseAdminClient();
    if (supabase) {
        const { error } = await supabase
            .from(getSubscriptionTableName())
            .upsert(normalized, { onConflict: normalized.email ? "email" : "stripe_subscription_id" });
        if (!error) return normalized;
        console.error("[billing] Supabase subscription upsert failed, falling back to local store:", error.message);
    }
    const store = await readStore();
    const existingIndex = store.subscriptions.findIndex((item) => {
        const itemEmail = normalizeEmail(item.email);
        return (
            (normalized.email && itemEmail === normalized.email)
            || (normalized.user_id && String(item.user_id || "") === normalized.user_id)
            || (normalized.stripe_subscription_id && String(item.stripe_subscription_id || "") === normalized.stripe_subscription_id)
            || (normalized.stripe_customer_id && String(item.stripe_customer_id || "") === normalized.stripe_customer_id)
        );
    });
    if (existingIndex >= 0) {
        store.subscriptions[existingIndex] = {
            ...store.subscriptions[existingIndex],
            ...normalized,
            created_at: store.subscriptions[existingIndex].created_at || now,
        };
    } else {
        store.subscriptions.push({
            ...normalized,
            created_at: now,
        });
    }
    await writeStore(store);
    return normalized;
}

async function findSubscription({ email = "", userId = "" } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedUserId = String(userId || "");
    const supabase = getSupabaseAdminClient();
    if (supabase && (normalizedEmail || normalizedUserId)) {
        let query = supabase
            .from(getSubscriptionTableName())
            .select("*")
            .limit(1);
        if (normalizedEmail) {
            query = query.eq("email", normalizedEmail);
        } else {
            query = query.eq("user_id", normalizedUserId);
        }
        const { data, error } = await query.maybeSingle();
        if (!error && data) {
            const status = String(data.status || "");
            return {
                ...data,
                plan: ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? normalizePlan(data.plan) : "free",
            };
        }
        if (error) {
            console.error("[billing] Supabase subscription lookup failed, falling back to local store:", error.message);
        }
    }
    const store = await readStore();
    const record = store.subscriptions.find((item) => {
        return (
            (normalizedEmail && normalizeEmail(item.email) === normalizedEmail)
            || (normalizedUserId && String(item.user_id || "") === normalizedUserId)
        );
    });
    if (!record) return null;
    const status = String(record.status || "");
    return {
        ...record,
        plan: ACTIVE_SUBSCRIPTION_STATUSES.has(status) ? normalizePlan(record.plan) : "free",
    };
}

function getPlanPriceId(plan) {
    const normalized = normalizePlan(plan);
    return process.env[PLAN_CONFIG[normalized].priceEnv] || "";
}

function getPlanFromPriceId(priceId = "") {
    const price = String(priceId || "");
    const entry = Object.entries(PLAN_CONFIG).find(([, config]) => process.env[config.priceEnv] === price);
    return entry ? entry[0] : "advanced";
}

function getSupportCheckoutUrl() {
    return String(process.env.STRIPE_SUPPORT_URL || process.env.STRIPE_SUPPORT_PAYMENT_LINK || "").trim();
}

function getSupportPriceId() {
    return String(process.env[SUPPORT_PRICE_ENV] || "").trim();
}

function getSupportMode() {
    return String(process.env.STRIPE_SUPPORT_MODE || "payment").toLowerCase() === "subscription"
        ? "subscription"
        : "payment";
}

function getUserFromPayload(payload = {}) {
    const user = payload.user || {};
    return {
        userId: String(user.id || user.userId || user.user_id || user.sub || payload.user_id || ""),
        email: normalizeEmail(user.email || payload.email || ""),
        username: String(user.username || user.name || ""),
    };
}

function buildPublicSubscription(record) {
    if (!record) {
        return {
            plan: "free",
            status: "none",
            subscription: null,
        };
    }
    return {
        plan: record.plan || "free",
        status: record.status || "none",
        subscription: {
            plan: record.plan || "free",
            status: record.status || "none",
            current_period_end: record.current_period_end || null,
            updated_at: record.updated_at || null,
        },
    };
}

async function subscriptionRecordFromStripeSubscription(stripe, subscription, fallback = {}) {
    const priceId = subscription?.items?.data?.[0]?.price?.id || "";
    let email = normalizeEmail(subscription?.metadata?.stratops_email || fallback.email);
    if (!email && subscription?.customer) {
        try {
            const customer = await stripe.customers.retrieve(subscription.customer);
            email = normalizeEmail(customer?.email);
        } catch {
            email = "";
        }
    }
    const periodEnd = subscription?.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;
    return {
        user_id: subscription?.metadata?.stratops_user_id || fallback.user_id || "",
        email,
        plan: subscription?.metadata?.plan || getPlanFromPriceId(priceId),
        status: subscription?.status || fallback.status || "active",
        stripe_customer_id: subscription?.customer || fallback.stripe_customer_id || "",
        stripe_subscription_id: subscription?.id || fallback.stripe_subscription_id || "",
        current_period_end: periodEnd,
    };
}

function mountBillingRoutes(app) {
    app.post("/api/stratops/create-checkout-session", express.json({ limit: "64kb" }), async (req, res) => {
        const supportType = normalizeSupportType(req.body?.supportType);
        const config = STRATOPS_SUPPORT_TYPES[supportType];
        if (!config) {
            res.status(400).json({ error: "Invalid support type." });
            return;
        }

        const stripe = getStratopsStripeClient();
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
            console.error("[billing] StratOps support checkout failed:", error);
            res.status(500).json({ error: "Unable to open Stripe Checkout. Please try again." });
        }
    });

    async function createSupportSession(req, res) {
        const configuredUrl = getSupportCheckoutUrl();
        if (configuredUrl) {
            res.json({ url: configuredUrl });
            return;
        }

        const stripe = getStripeClient();
        const priceId = getSupportPriceId();
        if (!stripe || !priceId) {
            res.status(501).json({
                error: "Stripe support checkout is not configured yet.",
                needsConfig: true,
                missing: {
                    stripeSecretKey: !stripe,
                    supportPriceId: !priceId,
                    priceEnv: SUPPORT_PRICE_ENV,
                },
            });
            return;
        }

        const publicBase = getPublicBaseUrl(req);
        const user = getUserFromPayload(req.body || {});
        try {
            const sessionOptions = {
                mode: getSupportMode(),
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${publicBase}/?support=success`,
                cancel_url: `${publicBase}/?support=cancelled`,
                metadata: {
                    purpose: "stratops_support",
                    stratops_user_id: user.userId || "",
                    stratops_email: user.email || "",
                    stratops_username: user.username || "",
                },
            };
            if (user.email) {
                sessionOptions.customer_email = user.email;
                sessionOptions.client_reference_id = user.userId || user.email;
            }
            const session = await stripe.checkout.sessions.create(sessionOptions);
            res.json({ url: session.url, sessionId: session.id });
        } catch (error) {
            console.error("[billing] support checkout failed:", error);
            res.status(500).json({ error: "Unable to start Stripe support checkout." });
        }
    }

    app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
        const stripe = getStripeClient();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !webhookSecret) {
            res.status(501).json({ error: "Stripe webhook is not configured." });
            return;
        }

        let event;
        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                req.headers["stripe-signature"],
                webhookSecret,
            );
        } catch (error) {
            res.status(400).json({ error: `Webhook signature verification failed: ${error.message}` });
            return;
        }

        try {
            if (event.type === "checkout.session.completed") {
                const session = event.data.object;
                let subscription = null;
                if (session.subscription) {
                    subscription = await stripe.subscriptions.retrieve(session.subscription);
                }
                await upsertSubscription({
                    user_id: session.metadata?.stratops_user_id || "",
                    email: session.metadata?.stratops_email || session.customer_details?.email || session.customer_email || "",
                    plan: session.metadata?.plan || "advanced",
                    status: subscription?.status || "active",
                    stripe_customer_id: session.customer || "",
                    stripe_subscription_id: session.subscription || "",
                    current_period_end: subscription?.current_period_end
                        ? new Date(subscription.current_period_end * 1000).toISOString()
                        : null,
                });
            }

            if (
                event.type === "customer.subscription.created"
                || event.type === "customer.subscription.updated"
                || event.type === "customer.subscription.deleted"
            ) {
                const subscription = event.data.object;
                const record = await subscriptionRecordFromStripeSubscription(stripe, subscription);
                await upsertSubscription(record);
            }

            res.json({ received: true });
        } catch (error) {
            console.error("[billing] webhook failed:", error);
            res.status(500).json({ error: "Webhook handling failed." });
        }
    });

    app.use("/billing", express.json({ limit: "64kb" }));

    app.get("/billing/support", async (req, res) => {
        const jsonRes = {
            status(code) {
                res.status(code);
                return this;
            },
            json(payload) {
                if (payload?.url) {
                    res.redirect(303, payload.url);
                    return;
                }
                res.type("text/plain").send(payload?.error || "Stripe support checkout is not configured yet.");
            },
        };
        await createSupportSession(req, jsonRes);
    });

    app.post("/billing/create-support-session", createSupportSession);

    app.post("/billing/create-checkout-session", async (req, res) => {
        const stripe = getStripeClient();
        const plan = normalizePlan(req.body?.plan);
        const priceId = getPlanPriceId(plan);
        const user = getUserFromPayload(req.body || {});
        if (!stripe || !priceId) {
            res.status(501).json({
                error: "Stripe checkout is not configured yet.",
                needsConfig: true,
                missing: {
                    stripeSecretKey: !stripe,
                    priceId: !priceId,
                    priceEnv: PLAN_CONFIG[plan].priceEnv,
                },
            });
            return;
        }
        if (!user.email) {
            res.status(401).json({ error: "Sign in before choosing a plan." });
            return;
        }

        const publicBase = getPublicBaseUrl(req);
        try {
            const sessionOptions = {
                mode: "subscription",
                client_reference_id: user.userId || user.email,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${publicBase}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${publicBase}/?billing=cancelled`,
                metadata: {
                    plan,
                    stratops_user_id: user.userId,
                    stratops_email: user.email,
                    stratops_username: user.username,
                },
                subscription_data: {
                    metadata: {
                        plan,
                        stratops_user_id: user.userId,
                        stratops_email: user.email,
                        stratops_username: user.username,
                    },
                },
            };
            if (user.email) {
                sessionOptions.customer_email = user.email;
            }
            const session = await stripe.checkout.sessions.create(sessionOptions);
            res.json({ url: session.url, sessionId: session.id, plan });
        } catch (error) {
            console.error("[billing] checkout failed:", error);
            res.status(500).json({ error: "Unable to start Stripe checkout." });
        }
    });

    app.get("/billing/me", async (req, res) => {
        const email = normalizeEmail(req.query.email);
        const userId = String(req.query.user_id || "");
        if (!email && !userId) {
            res.json(buildPublicSubscription(null));
            return;
        }
        const record = await findSubscription({ email, userId });
        res.json(buildPublicSubscription(record));
    });

    app.get("/billing/checkout-session", async (req, res) => {
        const stripe = getStripeClient();
        const sessionId = String(req.query.session_id || "").trim();
        if (!stripe) {
            res.status(501).json({ error: "Stripe is not configured." });
            return;
        }
        if (!sessionId || !sessionId.startsWith("cs_")) {
            res.status(400).json({ error: "Missing checkout session id." });
            return;
        }
        try {
            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ["subscription"],
            });
            const isComplete = session.status === "complete";
            const isPaid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
            if (!isComplete && !isPaid) {
                res.status(409).json({ error: "Checkout session is not complete yet." });
                return;
            }
            const subscription = session.subscription && typeof session.subscription === "object"
                ? session.subscription
                : null;
            const record = await upsertSubscription({
                user_id: session.metadata?.stratops_user_id || session.client_reference_id || "",
                email: session.metadata?.stratops_email || session.customer_details?.email || session.customer_email || "",
                plan: session.metadata?.plan || "advanced",
                status: subscription?.status || "active",
                stripe_customer_id: session.customer || "",
                stripe_subscription_id: subscription?.id || session.subscription || "",
                current_period_end: subscription?.current_period_end
                    ? new Date(subscription.current_period_end * 1000).toISOString()
                    : null,
            });
            res.json(buildPublicSubscription(record));
        } catch (error) {
            console.error("[billing] checkout session lookup failed:", error);
            res.status(500).json({ error: "Unable to verify checkout session." });
        }
    });
}

module.exports = {
    mountBillingRoutes,
    normalizePlan,
};
