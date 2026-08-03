import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { readCopernicusConfig, getCopernicusConfigStatus } from "./copernicus-config.js";
import { runCopernicusSatelliteSync } from "./copernicus-runner.js";
import { supabase } from "./supabase.js";

const config = readCopernicusConfig();
const status = getCopernicusConfigStatus(config);

console.log("[copernicus:once] config", {
  enabled: status.enabled,
  ready: status.ready,
  missing: status.missing,
  catalogUrl: config.catalogUrl,
  processUrl: config.processUrl,
  bucket: config.aws.bucket,
  prefix: config.s3Prefix,
  cloudFrontConfigured: Boolean(config.aws.cloudFrontUrl),
});

if (!status.ready) {
  process.exitCode = 1;
} else {
  try {
    const result = await runCopernicusSatelliteSync({ supabase, config, logger: console });
    console.log("[copernicus:once] result", JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error("[copernicus:once] failed", error?.message || error);
    process.exitCode = 1;
  }
}
