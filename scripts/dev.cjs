"use strict";

// Log before loading Webpack's network-backed dependency tree.
process.env.STRATOPS_DEV_LAUNCH_STARTED_AT = String(Date.now());
console.info("[dev-timing] launcher-start");
const path = require("node:path");
const { configureDevelopmentEnvironment } = require("./dev-environment.cjs");
const projectRoot = path.resolve(__dirname, "..");
const environment = configureDevelopmentEnvironment(projectRoot);
process.env.STRATOPS_DEV_TIMING = "1";
console.info("[dev-env] filesystem=" + environment.filesystem + " detected=" + environment.detected +
    " watch=" + (environment.network ? "source polling " + environment.pollMs + "ms" : "native events") +
    " cache=" + environment.cacheDirectory);

// Optional Node 22+ bytecode cache. No dependency install or machine setup.
const nodeModule = require("node:module");
if (typeof nodeModule.enableCompileCache === "function") {
    const result = nodeModule.enableCompileCache(path.join(environment.cacheDirectory, "node"));
    console.info("[dev-timing] node-compile-cache-status=" + result.status);
}
console.info("[dev-timing] environment-ready=" + (Date.now() - Number(process.env.STRATOPS_DEV_LAUNCH_STARTED_AT)) + "ms; loading webpack-cli");

// Run the installed CLI in this process: normal Ctrl+C/exit handling and extra
// npm run dev -- ... arguments, without a shell wrapper or duplicate Node server.
const cli = require.resolve("webpack-cli/bin/cli.js", { paths: [projectRoot] });
process.chdir(projectRoot);
process.argv = [process.execPath, cli, "serve", "--mode", "development", ...process.argv.slice(2)];
require(cli);
