import express from "express";
import { getMilitarySatellitePayload } from "./strategic-satellites.js";

export function satellitesRouter() {
    const router = express.Router();

    router.get("/military", async (req, res) => {
        const payload = await getMilitarySatellitePayload({ logger: console });
        const unavailable = payload.sourceStatus === "unavailable" && !payload.count;
        res.setHeader("Cache-Control", unavailable
            ? "no-store"
            : "public, max-age=300, stale-while-revalidate=3600");
        res.status(unavailable ? 503 : 200).json(payload);
    });

    return router;
}
