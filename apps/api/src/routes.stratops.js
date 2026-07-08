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

    return router;
}
