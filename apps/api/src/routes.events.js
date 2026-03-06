import express from "express";
import { query } from "./db.js";
export function eventsRouter({ broadcast }) {
    const router = express.Router();
    router.get("/", async (req, res) => {
        try {
            const limit = Math.min(Number(req.query.limit || 200), 500);
            const category = req.query.category && req.query.category !== "all" ?
                String(req.query.category) : null;
            const values = [];
            const where = [];
            if (category) {
                values.push(category);
                where.push(`category = $${values.length}`);
            }
            const sql = `
 SELECT id, category, title, summary, source_name, source_url,
occurred_at, lat, lon, location_label, confidence
 FROM events
${where.length ? `WHERE ${where.join(" AND ")}` : ""}
 ORDER BY occurred_at DESC
 LIMIT ${limit}
 `;
            const rows = (await query(sql, values)).rows;
            res.json({ events: rows });
        } catch (err) {
            res.status(500).json({ error: "Failed to fetch events" });
        }
    });
    router.post("/", express.json(), async (req, res) => {
        try {
            const adminKey = process.env.ADMIN_API_KEY || "";
            if (!adminKey || req.headers["x-admin-key"] !== adminKey) {
                return res.status(403).json({ error: "Forbidden" });
            }
            const e = req.body || {};
            if (!e.title || !e.occurred_at || typeof e.lat !== "number" || typeof
                e.lon !== "number") {
                return res.status(400).json({ error: "Missing required fields" });
            }
            const sql = `
             INSERT INTO events (category, title, summary, source_name, source_url,
            occurred_at, lat, lon, location_label, confidence, dedupe_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id, category, title, summary, source_name, source_url,
            occurred_at, lat, lon, location_label, confidence
             `;
            const vals = [
                e.category || "strike",
                e.title,
                e.summary || null,
                e.source_name || null,
                e.source_url || null,
                new Date(e.occurred_at),
                e.lat,

                e.lon,
                e.location_label || null,
                Number.isFinite(e.confidence) ? e.confidence : 50,
                e.dedupe_key || null
            ];
            const inserted = (await query(sql, vals)).rows[0];
            broadcast({ type: "event:new", event: inserted });
            res.json({ event: inserted });
        } catch (err) {
            if (String(err?.message || "").includes("dedupe_key")) {
                return res.status(409).json({ error: "Duplicate event" });
            }
            res.status(500).json({ error: "Failed to create event" });
        }
    });
    return router;
}
