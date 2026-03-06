import { WebSocketServer } from "ws";
export function attachWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws" });
    const clients = new Set();
    wss.on("connection", (ws) => {
        clients.add(ws);
        ws.on("close", () => clients.delete(ws));
        ws.send(JSON.stringify({ type: "hello", ts: Date.now() }));
    });
    function broadcast(msg) {
        const payload = JSON.stringify(msg);
        for (const ws of clients) {
            if (ws.readyState === ws.OPEN) ws.send(payload);
        }
    }
    return { broadcast };
}
