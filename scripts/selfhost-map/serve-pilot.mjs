import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.generated/selfhosted/output");
const port = Number(process.env.STRATOPS_PILOT_PORT || 4181);
const allowedOrigins = new Set((process.env.STRATOPS_PILOT_ALLOWED_ORIGINS ||
    "http://127.0.0.1:4180,http://localhost:4180,http://127.0.0.1:4173,http://localhost:4173")
    .split(",").map((value) => value.trim()).filter(Boolean));
const mime = { ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png", ".terrain": "application/octet-stream", ".json": "application/json" };

http.createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Timing-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Headers", "Accept, Range");
        response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    }
    if (request.method === "OPTIONS") {
        response.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403).end();
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
    }
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://localhost:${port}`).pathname);
    } catch {
        response.writeHead(400).end();
        return;
    }
    const file = path.resolve(root, `.${pathname}`);
    if (path.relative(root, file).startsWith("..")) {
        response.writeHead(403).end();
        return;
    }
    const type = mime[path.extname(file).toLowerCase()];
    if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", type === "application/json"
        ? "public, max-age=300"
        : "public, max-age=31536000, immutable");
    response.setHeader("Content-Length", fs.statSync(file).size);
    response.writeHead(200);
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
    console.log(`Local pilot tiles: http://127.0.0.1:${port}/map/tactical/v1/`);
});
