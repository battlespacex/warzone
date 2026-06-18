const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const { mountBillingRoutes } = require("./server/billing-routes");

dotenv.config({
    path: process.env.NODE_ENV === "production"
        ? path.join(__dirname, ".env.production")
        : path.join(__dirname, ".env.local"),
});

const app = express();
const PORT = process.env.PORT || 4173;
const ROOT = path.join(__dirname, "production");
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

app.get("/api/*", async (req, res) => {
    try {
        const upstreamPath = req.originalUrl.replace(/^\/api/, "") || "/";
        const upstream = new URL(upstreamPath, API_UPSTREAM_URL);
        const response = await fetch(upstream, {
            headers: {
                Accept: "application/json",
                "User-Agent": "stratops-warzone/1.0",
                "X-Forwarded-Host": req.get("host") || "",
                "X-Forwarded-Proto": req.protocol || "http",
                "X-Forwarded-Prefix": "/api",
            },
        });
        const payload = await response.text();
        res.status(response.status);
        res.set("Cache-Control", "no-store, max-age=0");
        res.type(response.headers.get("content-type") || "application/json").send(payload);
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

app.use(express.static(ROOT));

function sendPage(res, name, status = 200) {
    return res.status(status).sendFile(path.join(ROOT, "pages", `${name}.html`));
}

app.get(`${BASE}/`, (req, res) => sendPage(res, "index"));
app.get(`${BASE}/404`, (req, res) => sendPage(res, "404", 404));
app.use((req, res) => sendPage(res, "404", 404));

app.listen(PORT, () => {
    console.log(`Warzone server running at http://localhost:${PORT}${BASE}/`);
});
