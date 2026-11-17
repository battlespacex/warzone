"use strict";

async function hasLocalPortal() {
    let response;
    try {
        response = await fetch("http://localhost:4173/", { signal: AbortSignal.timeout(10000) });
    } catch (error) {
        if (error.cause?.code === "ECONNREFUSED") return false;
        throw new Error("Cannot verify the app on localhost:4173. Wait for an existing app startup or check the port before retrying.");
    }
    if (response.status === 200 && (await response.text()).includes("wz-intro-modal")) return true;
    throw new Error("Port 4173 is occupied by an unrecognized server; it will not be replaced.");
}

async function startSites({ noOpen = false, port = 4174, probe = hasLocalPortal,
    webpack = require("webpack"), DevServer = require("webpack-dev-server"),
    appConfig = () => require("../webpack.config.js")({}, { mode: "development" }),
    marketingConfig = () => require("../webpack.marketing.config.cjs")({}, { mode: "development" }) } = {}) {
    const owned = [];
    let stopping;
    function stop() {
        if (!stopping) stopping = (async () => {
            for (const { server, compiler } of owned.slice().reverse()) {
                try { await server.stop(); } catch { /* Also close compilers after a partial startup. */ }
                await new Promise(resolve => compiler.close(resolve));
            }
        })();
        return stopping;
    }
    async function start(config, options) {
        // Separate compilers/middleware keep the two root HTML files and /assets trees isolated.
        const compiler = webpack({ ...config, mode: "development" });
        let server;
        try { server = new DevServer({ ...config.devServer, ...options, setupExitSignals: false }, compiler); }
        catch (error) { await new Promise(resolve => compiler.close(resolve)); throw error; }
        owned.push({ server, compiler });
        await server.start();
    }
    try {
        const reusedApp = await probe();
        if (reusedApp) console.info("[dev-site] Reusing existing local StratOps app on 4173.");
        else await start(appConfig(), { open: false });
        await start(marketingConfig(), { port, ...(noOpen ? { open: false } : {}) });
        console.info(`[dev-site] Website: http://localhost:${port}/ | App: http://localhost:4173/ (wait for initial compilation)`);
        return { stop, reusedApp };
    } catch (error) {
        await stop();
        throw error;
    }
}

async function run(_projectRoot, args) {
    let noOpen = false, port = 4174;
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--no-open") noOpen = true;
        else if (args[index] === "--port") {
            port = Number(args[++index]);
            if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173) throw new Error("Choose a public dev port from 1024–65535 other than 4173.");
        } else throw new Error(`Unsupported combined-dev argument: ${args[index]}. Use dev:app or dev:marketing for other webpack options.`);
    }
    const sites = await startSites({ noOpen, port });
    const shutdown = () => { sites.stop().then(() => process.exit(0), () => process.exit(1)); };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return sites;
}

module.exports = { hasLocalPortal, startSites, run };
