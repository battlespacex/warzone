import express from "express";
import Stripe from "stripe";

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
