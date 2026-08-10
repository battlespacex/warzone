const express = require("express");
const fs = require("fs");
const path = require("path");

const DEFAULT_HISTORY_LIMIT = 7;
const MAX_HISTORY_LIMIT = 31;
const ALLOWED_REPORT_EXTENSIONS = new Set([
    ".html",
    ".pdf",
    ".json",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
]);
const CONTENT_TYPES = Object.freeze({
    ".html": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
});

function clampHistoryLimit(value, fallback = DEFAULT_HISTORY_LIMIT) {
    const parsed = Number.parseInt(value, 10);
    return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number.isFinite(parsed) ? parsed : fallback));
}

function slugifyScopeValue(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function getScopeSegments(scopeType = "global", scopeValue = "") {
    const type = String(scopeType || "global").trim().toLowerCase();
    if (type === "global") return { type, value: null, label: "Global", segments: ["global"] };
    if (!["region", "country", "aoi"].includes(type)) return null;
    const value = slugifyScopeValue(scopeValue);
    if (!value) return null;
    return { type, value, label: String(scopeValue || value).trim(), segments: [type, value] };
}

function isPathInsideRoot(root, target) {
    const relativePath = path.relative(path.resolve(root), path.resolve(target));
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveGeneratedReportArtifact(root, requestPath = "") {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(String(requestPath || ""));
    } catch {
        return null;
    }
    if (!decodedPath || decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
    const segments = decodedPath.split("/").filter(Boolean);
    if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
    if (segments.some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))) return null;
    const extension = path.extname(segments.at(-1)).toLowerCase();
    if (!ALLOWED_REPORT_EXTENSIONS.has(extension)) return null;
    const target = path.resolve(root, ...segments);
    return isPathInsideRoot(root, target) ? target : null;
}

function buildRequestOrigin(req) {
    const host = String(req.get("host") || "").trim();
    return host ? `${req.protocol || "http"}://${host}` : "";
}

function buildArtifactUrl(req, segments, filename) {
    const pathname = `${req.baseUrl || "/generated-reports"}/${[...segments, filename]
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`.replace(/\/{2,}/g, "/");
    const origin = buildRequestOrigin(req);
    return origin ? new URL(pathname, origin).href : pathname;
}

function buildReportPdfFilename(target = "") {
    const dateKey = path.basename(path.dirname(target));
    const suffix = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : "latest";
    return `StratOps-Operational-Intelligence-Briefing-${suffix}.pdf`;
}

function setPdfResponseHeaders(res, target, disposition = "inline") {
    res.set("Content-Type", CONTENT_TYPES[".pdf"]);
    res.set("Content-Disposition", `${disposition}; filename="${buildReportPdfFilename(target)}"`);
    res.set("X-Content-Type-Options", "nosniff");
    if (disposition === "inline") {
        res.set("Content-Security-Policy", "frame-ancestors 'self'");
        res.set("X-Frame-Options", "SAMEORIGIN");
        res.set("Cross-Origin-Resource-Policy", "same-origin");
    }
}

async function sendGeneratedReportArtifact(req, res, generatedRoot, requestPath, disposition = "") {
    const target = resolveGeneratedReportArtifact(generatedRoot, requestPath);
    if (!target || !(await isFile(target))) {
        res.status(404).type("text/plain").send("Generated report artifact not found.");
        return;
    }
    const extension = path.extname(target).toLowerCase();
    res.set("Cache-Control", "no-store, max-age=0");
    res.set("X-Content-Type-Options", "nosniff");
    if (extension === ".pdf" && disposition) {
        setPdfResponseHeaders(res, target, disposition);
    } else {
        res.type(CONTENT_TYPES[extension] || "application/octet-stream");
    }
    res.sendFile(target);
}

function formatReportLabel(dateKey) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: "UTC",
    }).format(date);
}

async function readJsonFile(filePath) {
    try {
        return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch {
        return {};
    }
}

async function isFile(filePath) {
    try {
        return (await fs.promises.stat(filePath)).isFile();
    } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
    }
}

async function listLocalGeneratedReports({ root, scope, limit, req }) {
    const scopeDirectory = path.resolve(root, "daily", ...scope.segments);
    if (!isPathInsideRoot(root, scopeDirectory)) return [];
    let entries;
    try {
        entries = await fs.promises.readdir(scopeDirectory, { withFileTypes: true });
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }

    const reports = [];
    const dateKeys = entries
        .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left));

    for (const dateKey of dateKeys) {
        if (reports.length >= limit) break;
        const segments = ["daily", ...scope.segments, dateKey];
        const directory = path.resolve(root, ...segments);
        const htmlPath = path.resolve(directory, "report.html");
        if (!isPathInsideRoot(root, htmlPath) || !(await isFile(htmlPath))) continue;
        const pdfPath = path.resolve(directory, "report.pdf");
        const pdfAvailable = await isFile(pdfPath);
        const model = await readJsonFile(path.resolve(directory, "report.json"));
        const htmlStat = await fs.promises.stat(htmlPath);
        const reportId = String(model.report_id || `local:daily:${scope.type}:${scope.value || "global"}:${dateKey}`);
        const htmlUrl = buildArtifactUrl(req, segments, "report.html");
        const previewUrl = pdfAvailable ? buildArtifactUrl(req, ["preview", ...segments], "report.pdf") : "";
        const downloadUrl = pdfAvailable ? buildArtifactUrl(req, ["download", ...segments], "report.pdf") : "";
        reports.push({
            id: reportId,
            report_type: "daily",
            report_date: dateKey,
            scope_type: scope.type,
            scope_value: scope.value,
            scope_label: String(model.scope?.label || scope.label || "Global"),
            period_start: String(model.window?.start || `${dateKey}T00:00:00.000Z`),
            period_end: String(model.window?.end || `${dateKey}T23:59:59.999Z`),
            status: pdfAvailable ? "available" : "preview_only",
            display_label: formatReportLabel(dateKey),
            is_latest: reports.length === 0,
            generated_at: htmlStat.mtime.toISOString(),
            updated_at: htmlStat.mtime.toISOString(),
            expires_at: null,
            html_available: true,
            html_url: htmlUrl,
            pdf_available: pdfAvailable,
            preview_url: previewUrl,
            public_url: downloadUrl,
            download_url: downloadUrl,
            local_preview: true,
        });
    }
    return reports;
}

function createGeneratedReportPreviewRouter({
    root,
    historyLimit = process.env.REPORTING_PUBLIC_HISTORY_DAYS || DEFAULT_HISTORY_LIMIT,
} = {}) {
    const generatedRoot = path.resolve(root || path.join(process.cwd(), ".generated", "reports"));
    const router = express.Router();

    router.get("/history", async (req, res) => {
        const reportType = String(req.query.type || "daily").trim().toLowerCase();
        const limit = clampHistoryLimit(req.query.limit, clampHistoryLimit(historyLimit));
        const scope = getScopeSegments(req.query.scope_type, req.query.scope_value);
        res.set("Cache-Control", "no-store, max-age=0");
        if (reportType !== "daily") {
            res.json({ reports: [], history_limit: limit, source: "local" });
            return;
        }
        if (!scope) {
            res.status(400).json({ error: "Invalid local report scope" });
            return;
        }
        try {
            const reports = await listLocalGeneratedReports({ root: generatedRoot, scope, limit, req });
            res.json({ reports, history_limit: limit, source: "local" });
        } catch (error) {
            console.error("[reports:local-preview] history lookup failed:", error);
            res.status(500).json({ error: "Local report history unavailable" });
        }
    });

    router.get("/preview/*", async (req, res, next) => {
        try {
            await sendGeneratedReportArtifact(req, res, generatedRoot, req.params[0], "inline");
        } catch (error) {
            next(error);
        }
    });

    router.get("/download/*", async (req, res, next) => {
        try {
            await sendGeneratedReportArtifact(req, res, generatedRoot, req.params[0], "attachment");
        } catch (error) {
            next(error);
        }
    });

    router.use(async (req, res) => {
        if (!["GET", "HEAD"].includes(req.method)) {
            res.status(405).type("text/plain").send("Method not allowed.");
            return;
        }
        const target = resolveGeneratedReportArtifact(generatedRoot, req.path);
        if (!target || !(await isFile(target))) {
            res.status(404).type("text/plain").send("Generated report artifact not found.");
            return;
        }
        const extension = path.extname(target).toLowerCase();
        res.set("Cache-Control", "no-store, max-age=0");
        res.set("X-Content-Type-Options", "nosniff");
        res.type(CONTENT_TYPES[extension] || "application/octet-stream");
        res.sendFile(target);
    });

    return router;
}

module.exports = {
    CONTENT_TYPES,
    buildReportPdfFilename,
    clampHistoryLimit,
    createGeneratedReportPreviewRouter,
    getScopeSegments,
    isPathInsideRoot,
    listLocalGeneratedReports,
    resolveGeneratedReportArtifact,
    setPdfResponseHeaders,
};
