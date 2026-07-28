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

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DEFAULT_CORS_ORIGINS = ["https://stratops.battlespacex.com"];

function getAllowedCorsOrigins() {
    const configured = String(process.env.CORS_ORIGIN || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    return configured.length ? configured : DEFAULT_CORS_ORIGINS;
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
    allowedHeaders: ["Content-Type", "Accept"],
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
server.listen(PORT, () => {
    console.log(`Warzone API listening on :${PORT}`);
});
