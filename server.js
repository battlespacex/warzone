const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const { mountBillingRoutes } = require("./server/billing-routes");
const { createGeneratedReportPreviewRouter } = require("./server/generated-report-preview");

dotenv.config({
    path: process.env.NODE_ENV === "production"
        ? path.join(__dirname, ".env.production")
        : path.join(__dirname, ".env.local"),
});

const app = express();
const PORT = process.env.PORT || 4173;
const ROOT = path.join(__dirname, "production");
const GENERATED_REPORT_ROOT = path.join(__dirname, ".generated", "reports");
const BASE = "/warzone";
const AIRCRAFT_FEED_URL = process.env.AIRCRAFT_FEED_URL || "https://api.airplanes.live/v2/mil";
const API_UPSTREAM_URL = process.env.API_UPSTREAM_URL || (
    process.env.NODE_ENV === "production"
        ? "https://api.battlespacex.com"
        : "http://localhost:8080"
);
let cachedAircraftFeedPayload = "";
let cachedAircraftFeedStatus = 0;
let cachedAircraftFeedAt = 0;
let aircraftFeedInFlight = null;
const AIRCRAFT_FEED_CACHE_TTL_MS = 2500;

app.disable("x-powered-by");
mountBillingRoutes(app);

async function handleAircraftFeedProxy(_req, res) {
    const now = Date.now();
    if (
        cachedAircraftFeedPayload &&
        cachedAircraftFeedStatus === 200 &&
        (now - cachedAircraftFeedAt) < AIRCRAFT_FEED_CACHE_TTL_MS
    ) {
        res.set("Cache-Control", "no-store, max-age=0");
        res.type("application/json").send(cachedAircraftFeedPayload);
        return;
    }

    if (!aircraftFeedInFlight) {
        aircraftFeedInFlight = fetch(AIRCRAFT_FEED_URL, {
            headers: {
                Accept: "application/json",
                "User-Agent": "stratops-warzone-local/1.0",
                "Cache-Control": "no-store",
            },
        })
            .then(async (response) => {
                const payload = await response.text();
                cachedAircraftFeedStatus = Number(response.status || 0);
                if (response.ok && payload) {
                    cachedAircraftFeedPayload = payload;
                    cachedAircraftFeedAt = Date.now();
                }
                return { ok: response.ok, status: response.status, payload };
            })
            .finally(() => {
                aircraftFeedInFlight = null;
            });
    }

    try {
        const result = await aircraftFeedInFlight;
        if (result?.ok && result.payload) {
            res.set("Cache-Control", "no-store, max-age=0");
            res.type("application/json").send(result.payload);
            return;
        }
        if (cachedAircraftFeedPayload && cachedAircraftFeedStatus === 200) {
            res.set("Cache-Control", "no-store, max-age=0");
            res.type("application/json").send(cachedAircraftFeedPayload);
            return;
        }
        res.status(result?.status || 502).json({ error: "Aircraft feed unavailable" });
    } catch {
        if (cachedAircraftFeedPayload && cachedAircraftFeedStatus === 200) {
            res.set("Cache-Control", "no-store, max-age=0");
            res.type("application/json").send(cachedAircraftFeedPayload);
            return;
        }
        res.status(502).json({ error: "Aircraft feed unavailable" });
    }
}

app.get("/__warzone/aircraft-feed/mil", handleAircraftFeedProxy);
app.get(`${BASE}/aircraft-feed/mil`, handleAircraftFeedProxy);

app.get("/__warzone/terrain/terrarium/:z/:x/:y.png", async (req, res) => {
    const z = Math.max(0, Math.min(15, Number.parseInt(req.params.z, 10)));
    const x = Math.max(0, Number.parseInt(req.params.x, 10));
    const y = Math.max(0, Number.parseInt(req.params.y, 10));
    if (![z, x, y].every(Number.isFinite)) {
        res.status(400).json({ error: "Invalid terrain tile" });
        return;
    }
    try {
        const upstream = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
        const response = await fetch(upstream, {
            headers: {
                Accept: "image/png,image/*;q=0.8",
                "User-Agent": "stratops-warzone-terrain/1.0",
            },
        });
        if (!response.ok) {
            res.status(response.status).json({ error: "Terrain tile unavailable" });
            return;
        }
        const arrayBuffer = await response.arrayBuffer();
        res.set("Cache-Control", "public, max-age=86400, immutable");
        res.type("image/png").send(Buffer.from(arrayBuffer));
    } catch {
        res.status(502).json({ error: "Terrain tile proxy unavailable" });
    }
});

app.use("/api", express.json({ limit: "1mb" }));
app.all("/api/*", async (req, res) => {
    try {
        const upstreamPath = req.originalUrl.replace(/^\/api/, "") || "/";
        const upstream = new URL(upstreamPath, API_UPSTREAM_URL);
        const headers = {
            Accept: req.get("accept") || "application/json",
            "User-Agent": "stratops-warzone/1.0",
            "X-Forwarded-Host": req.get("host") || "",
            "X-Forwarded-Proto": req.protocol || "http",
            "X-Forwarded-Prefix": "/api",
        };
        const range = req.get("range");
        if (range) headers.Range = range;
        if (upstream.pathname.startsWith("/stratops/reports/internal/capture/")) {
            const captureAuthorization = req.get("authorization");
            if (captureAuthorization) headers.Authorization = captureAuthorization;
        }
        const init = {
            method: req.method,
            headers: {
                ...headers,
            },
        };
        if (!["GET", "HEAD"].includes(req.method)) {
            if (req.is("application/json")) {
                init.headers["Content-Type"] = "application/json";
                init.body = JSON.stringify(req.body || {});
            } else if (typeof req.body === "string") {
                init.body = req.body;
            }
        }
        const response = await fetch(upstream, init);
        const responseType = response.headers.get("content-type") || "application/json";
        const isPdf = /\bapplication\/pdf\b/i.test(responseType);
        const payload = isPdf
            ? Buffer.from(await response.arrayBuffer())
            : await response.text();
        res.status(response.status);
        res.set("Cache-Control", "no-store, max-age=0");
        res.set("Content-Type", responseType);
        if (isPdf) {
            [
                "content-disposition",
                "content-range",
                "accept-ranges",
                "content-security-policy",
                "x-frame-options",
                "cross-origin-resource-policy",
                "x-content-type-options",
            ].forEach((header) => {
                const value = response.headers.get(header);
                if (value) res.set(header, value);
            });
        }
        if (req.method === "HEAD") return res.end();
        res.send(payload);
    } catch {
        res.status(502).json({ error: "API unavailable" });
    }
});

app.get("/events/intel-feed/media/*", async (req, res) => {
    try {
        const upstream = new URL(req.originalUrl, API_UPSTREAM_URL);
        const response = await fetch(upstream, {
            headers: {
                Accept: req.get("accept") || "image/*,*/*;q=0.5",
                "User-Agent": "stratops-warzone-media/1.0",
            },
        });
        res.status(response.status);
        res.set("Cache-Control", response.headers.get("cache-control") || "public, max-age=900");
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        res.type(contentType);
        if (!response.body) {
            res.end();
            return;
        }
        const arrayBuffer = await response.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));
    } catch {
        res.status(502).json({ error: "Media proxy unavailable" });
    }
});

function buildSupportReturnUrl(status = "cancel", req) {
    const params = new URLSearchParams();
    params.set("support", status === "success" ? "success" : "cancel");
    const sessionId = String(req.query?.session_id || "").trim();
    if (status === "success" && sessionId) {
        params.set("session_id", sessionId);
    }
    return `${BASE}/?${params.toString()}`;
}

app.get(["/success", "/success/"], (req, res) => {
    res.redirect(302, buildSupportReturnUrl("success", req));
});

app.get(["/unsuccess", "/unsuccess/"], (req, res) => {
    res.redirect(302, buildSupportReturnUrl("cancel", req));
});

if (process.env.NODE_ENV !== "production") {
    app.use("/generated-reports", createGeneratedReportPreviewRouter({ root: GENERATED_REPORT_ROOT }));
    app.use(`${BASE}/generated-reports`, createGeneratedReportPreviewRouter({ root: GENERATED_REPORT_ROOT }));
}
app.use(express.static(ROOT));

function sendPage(res, name, status = 200) {
    return res.status(status).sendFile(path.join(ROOT, "pages", `${name}.html`));
}

app.get(`${BASE}/`, (req, res) => sendPage(res, "index"));
app.get(["/report-capture", `${BASE}/report-capture`], (_req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    return sendPage(res, "report-capture");
});
app.get("/reports/:slug", (req, res) => sendPage(res, "report"));
app.get(`${BASE}/reports/:slug`, (req, res) => sendPage(res, "report"));
app.get(`${BASE}/404`, (req, res) => sendPage(res, "404", 404));
app.use((req, res) => sendPage(res, "404", 404));

app.listen(PORT, () => {
    console.log(`Warzone server running at http://localhost:${PORT}${BASE}/`);
});
