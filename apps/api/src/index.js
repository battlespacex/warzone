import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envFileName = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
const envPaths = [
    join(__dirname, "..", envFileName),
    join(__dirname, "..", "..", "worker", envFileName),
    join(__dirname, "..", "..", "..", envFileName),
];
for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    require("dotenv").config({
        path: envPath,
        override: false,
    });
}

import http from "http";
import express from "express";
import cors from "cors";
import { attachWs } from "./ws.js";
import { eventsRouter } from "./routes.events.js";
import { stratopsRouter } from "./routes.stratops.js";
import { satellitesRouter } from "./routes.satellites.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DEFAULT_CORS_ORIGINS = [
    "https://stratops.battlespacex.com",
    "https://stratops-staging.battlespacex.com",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
];

function getAllowedCorsOrigins() {
    const configured = String(process.env.CORS_ORIGIN || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin && origin !== "*");
    return [...new Set([...DEFAULT_CORS_ORIGINS, ...configured])];
}

const allowedCorsOrigins = getAllowedCorsOrigins();
const corsOptions = {
    origin(origin, callback) {
        if (!origin || allowedCorsOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 204,
};

app.disable("x-powered-by");
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.get("/health", (req, res) => res.json({ ok: true }));
const server = http.createServer(app);
const { broadcast } = attachWs(server);
app.use("/events", eventsRouter({ broadcast }));
app.use("/stratops", stratopsRouter());
app.use("/satellites", satellitesRouter());
server.listen(PORT, () => {
    console.log(`Warzone API listening on :${PORT}`);
});
