import { readFileSync, writeFileSync } from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9227/json/list")).json();
const target = targets.find((item) => item.type === "page" &&
    (item.url.includes("127.0.0.1:4173") || item.url.includes("127.0.0.1:8081")));
if (!target) throw new Error("Isolated local browser page unavailable");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
});
let id = 0;
function command(method, params = {}) {
    return new Promise((resolve, reject) => {
        const next = ++id;
        const handler = (event) => {
            const message = JSON.parse(event.data);
            if (message.id !== next) return;
            ws.removeEventListener("message", handler);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id: next, method, params }));
    });
}
try {
    if (process.argv[2] === "navigate") {
        console.log(JSON.stringify(await command("Page.navigate", { url: process.argv[3] })));
    } else if (process.argv[2] === "screenshot") {
        const output = process.argv[3];
        const image = await command("Page.captureScreenshot", { format: "png" });
        writeFileSync(output, Buffer.from(image.data, "base64"));
        console.log(output);
    } else {
        const expression = process.argv[2] === "stdin" ? readFileSync(0, "utf8") : process.argv[2] || "document.title";
        const result = await command("Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: true,
        });
        console.log(JSON.stringify(result.result?.value ?? result.exceptionDetails?.text ?? result.result?.description));
    }
} finally {
    ws.close();
}
