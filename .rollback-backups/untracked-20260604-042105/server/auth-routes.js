const crypto = require("crypto");
const express = require("express");

const COOKIE_NAME = "stratops_auth";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getSessionSecret() {
    return (
        process.env.STRATOPS_AUTH_SESSION_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET ||
        process.env.STRIPE_SECRET_KEY ||
        "stratops-dev-session-secret"
    );
}

function base64url(input) {
    return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
    return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function parseCookies(header = "") {
    return String(header || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const index = part.indexOf("=");
            if (index <= 0) return acc;
            acc[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
            return acc;
        }, {});
}

function isEmail(value = "") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function findEmailCandidate(value, depth = 0) {
    if (!value || depth > 5) return "";
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
    const keys = ["email", "emailAddress", "email_address", "mail", "userEmail", "user_email", "username", "login", "name"];
    for (const key of keys) {
        const found = findEmailCandidate(value[key], depth + 1);
        if (found) return found;
    }
    for (const item of Object.values(value)) {
        const found = findEmailCandidate(item, depth + 1);
        if (found) return found;
    }
    return "";
}

function normalizeUser(input = {}) {
    const user = input.user && typeof input.user === "object" ? input.user : input;
    const email = findEmailCandidate(user) || findEmailCandidate(input);
    const id = String(user.id || user.userId || user.user_id || user.sub || input.user_id || input.userId || email || "").trim();
    return {
        id,
        email,
        username: String(user.username || user.name || input.username || input.name || email || "").trim(),
    };
}

function encodeSession(user = {}) {
    const payload = base64url(JSON.stringify({
        user,
        iat: Date.now(),
        exp: Date.now() + SESSION_MAX_AGE_MS,
    }));
    return `${payload}.${signPayload(payload)}`;
}

function decodeSession(token = "") {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;
    const expected = signPayload(payload);
    const safeSignature = Buffer.from(signature);
    const safeExpected = Buffer.from(expected);
    if (safeSignature.length !== safeExpected.length || !crypto.timingSafeEqual(safeSignature, safeExpected)) {
        return null;
    }
    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!decoded?.user || Number(decoded.exp || 0) < Date.now()) return null;
        return decoded;
    } catch {
        return null;
    }
}

function getCookieOptions(req) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
    const secure = req.secure || forwardedProto === "https";
    return [
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
        secure ? "Secure" : "",
    ].filter(Boolean).join("; ");
}

function mountStratopsAuthRoutes(app) {
    app.use("/stratops-auth", express.json({ limit: "64kb" }));
    app.use("/stratops-auth", express.urlencoded({ extended: false, limit: "64kb" }));

    app.get("/stratops-auth/validate", (req, res) => {
        const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
        const session = decodeSession(token);
        if (!session?.user) {
            res.json({ isAuthenticated: false, user: null });
            return;
        }
        res.set("Cache-Control", "no-store, max-age=0");
        res.json({ isAuthenticated: true, ...session.user, user: session.user });
    });

    app.post("/stratops-auth/session", (req, res) => {
        const user = normalizeUser(req.body || {});
        if (!user.email) {
            res.status(400).json({ success: false, error: "A verified email is required for the StratOps session." });
            return;
        }
        const token = encodeSession(user);
        res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; ${getCookieOptions(req)}`);
        res.set("Cache-Control", "no-store, max-age=0");
        res.json({ success: true, isAuthenticated: true, user, ...user });
    });

    app.post("/stratops-auth/logout", (req, res) => {
        res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
        res.json({ success: true });
    });
}

module.exports = {
    mountStratopsAuthRoutes,
};
