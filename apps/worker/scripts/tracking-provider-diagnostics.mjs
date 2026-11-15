import { loadWorkerEnv } from "../src/env.js";
import { createAircraftProviders } from "../src/tracking/aircraft/registry.js";
import { createNavalProviders } from "../src/tracking/naval/registry.js";
import { providerPipelineSnapshot, runConfiguredProviders } from "../src/tracking/provider-health.js";

// Configuration/read-only report by default. Never persists observations or
// starts AIS sockets. Only existing public aircraft adapters can be probed here.
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--probe-public-air")) throw new Error("Usage: node apps/worker/scripts/tracking-provider-diagnostics.mjs [--probe-public-air]");
loadWorkerEnv();
const air = createAircraftProviders(), naval = createNavalProviders();
const details = {};
if (args.includes("--probe-public-air")) {
    const allowed = air.filter(provider => ["adsb_lol", "airplanes_live", "adsb_one"].includes(provider.id));
    const results = await runConfiguredProviders("adsb", allowed, { logger: { log() {}, warn() {} } });
    for (const { provider, observations, diagnostics } of results) details[provider.id] = { ...diagnostics, normalized: observations.length };
}
console.log(JSON.stringify({ observed_at: new Date().toISOString(), mode: args.length ? "single-public-air-probe" : "configuration-only; live delivery unverified",
    aircraft: providerPipelineSnapshot("adsb", air, details), naval: providerPipelineSnapshot("ais", naval),
    note: "Enabled is not operational. No naval connection, paid enrichment, database write or environment modification." }, null, 2));
for (const provider of naval) provider.shutdown?.();
