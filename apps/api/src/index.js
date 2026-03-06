import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import { attachWs } from "./ws.js";
import { eventsRouter } from "./routes.events.js";
const app = express();
const PORT = Number(process.env.PORT || 8080);
app.disable("x-powered-by");
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || ["https://battlespacex.com"],
        methods: ["GET", "POST"]
    })
);
app.get("/health", (req, res) => res.json({ ok: true }));
const server = http.createServer(app);
const { broadcast } = attachWs(server);
app.use("/events", eventsRouter({ broadcast }));
server.listen(PORT, () => {
    console.log(`Warzone API listening on :${PORT}`);
});
