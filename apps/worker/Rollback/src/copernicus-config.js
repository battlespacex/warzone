function readBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function readNumberEnv(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function trimTrailingSlash(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeCopernicusCatalogUrl(value) {
  const url = trimTrailingSlash(value || "https://sh.dataspace.copernicus.eu/catalog/v1");
  if (!url) return "https://sh.dataspace.copernicus.eu/catalog/v1";
  if (/\/catalog\/v1$/i.test(url)) return url;
  if (/\/api\/v1\/catalog$/i.test(url)) return url.replace(/\/api\/v1\/catalog$/i, "/catalog/v1");
  return `${url}/catalog/v1`;
}

function normalizeCopernicusProcessUrl(value) {
  const url = trimTrailingSlash(value || "https://sh.dataspace.copernicus.eu/api/v1/process");
  if (!url) return "https://sh.dataspace.copernicus.eu/api/v1/process";
  if (/\/api\/v1\/process$/i.test(url)) return url;
  return `${url}/api/v1/process`;
}

function hasAwsRoleCredentialSource(env = process.env) {
  return Boolean(
    String(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || "").trim() ||
    String(env.AWS_CONTAINER_CREDENTIALS_FULL_URI || "").trim() ||
    String(env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI || "").trim() ||
    String(env.AWS_ECS_CONTAINER_CREDENTIALS_FULL_URI || "").trim() ||
    String(env.AWS_EXECUTION_ENV || "").trim() ||
    String(env.ECS_CONTAINER_METADATA_URI || "").trim() ||
    String(env.ECS_CONTAINER_METADATA_URI_V4 || "").trim() ||
    String(env.COPERNICUS_AWS_USE_IAM_ROLE || "").trim().toLowerCase() === "true"
  );
}

function readCopernicusConfig(env = process.env) {
  const dailyEventLimit = Math.floor(readNumberEnv(env.COPERNICUS_DAILY_EVENT_LIMIT, 75, { min: 1, max: 500 }));
  const maxRequestsPerMinute = Math.floor(readNumberEnv(env.COPERNICUS_MAX_REQUESTS_PER_MINUTE, 20, { min: 1, max: 60 }));
  const previewWidth = Math.floor(readNumberEnv(env.COPERNICUS_PREVIEW_WIDTH, 512, { min: 128, max: 1024 }));
  const previewHeight = Math.floor(readNumberEnv(env.COPERNICUS_PREVIEW_HEIGHT, 512, { min: 128, max: 1024 }));

  return {
    enabled: readBooleanEnv(env.COPERNICUS_ENABLED, false),
    clientId: String(env.COPERNICUS_CLIENT_ID || "").trim(),
    clientSecret: String(env.COPERNICUS_CLIENT_SECRET || "").trim(),
    tokenUrl: trimTrailingSlash(env.COPERNICUS_TOKEN_URL || "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"),
    catalogUrl: normalizeCopernicusCatalogUrl(env.COPERNICUS_CATALOG_URL),
    processUrl: normalizeCopernicusProcessUrl(env.COPERNICUS_PROCESS_URL),
    dailyEventLimit,
    maxRequestsPerMinute,
    eventRefreshHours: readNumberEnv(env.COPERNICUS_EVENT_REFRESH_HOURS, 12, { min: 1, max: 72 }),
    searchLookbackHours: readNumberEnv(env.COPERNICUS_SEARCH_LOOKBACK_HOURS, 72, { min: 1, max: 72 }),
    previewWidth,
    previewHeight,
    searchRadiusKm: readNumberEnv(env.COPERNICUS_SEARCH_RADIUS_KM, 7.5, { min: 0.5, max: 30 }),
    maxCloudCover: readNumberEnv(env.COPERNICUS_MAX_CLOUD_COVER, 30, { min: 0, max: 100 }),
    s3Prefix: String(env.COPERNICUS_S3_PREFIX || "satellite-events").trim().replace(/^\/+|\/+$/g, "") || "satellite-events",
    sentinel1Fallback: readBooleanEnv(env.COPERNICUS_SENTINEL1_FALLBACK, true),
    batchSize: Math.floor(readNumberEnv(env.COPERNICUS_BATCH_SIZE, 8, { min: 1, max: 25 })),
    maxRetries: Math.floor(readNumberEnv(env.COPERNICUS_MAX_RETRIES, 3, { min: 1, max: 8 })),
    maxImageBytes: Math.floor(readNumberEnv(env.COPERNICUS_MAX_IMAGE_BYTES, 5 * 1024 * 1024, { min: 64 * 1024, max: 12 * 1024 * 1024 })),
    workerIntervalMs: Math.floor(readNumberEnv(env.COPERNICUS_INTERVAL_MS, 10 * 60 * 1000, { min: 60 * 1000, max: 60 * 60 * 1000 })),
    aws: {
      region: String(env.AWS_REGION || env.AWS_DEFAULT_REGION || env.S3_REGION || "us-east-1").trim(),
      bucket: String(env.AWS_S3_BUCKET || env.S3_BUCKET || env.COPERNICUS_S3_BUCKET || "").trim(),
      accessKeyId: String(env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || "").trim(),
      secretAccessKey: String(env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || "").trim(),
      sessionToken: String(env.AWS_SESSION_TOKEN || env.S3_SESSION_TOKEN || "").trim(),
      roleCredentialSourceAvailable: hasAwsRoleCredentialSource(env),
      cloudFrontUrl: trimTrailingSlash(env.CLOUDFRONT_URL || env.AWS_CLOUDFRONT_URL || env.CLOUDFRONT_DOMAIN || ""),
    },
  };
}

function getCopernicusConfigStatus(config = readCopernicusConfig()) {
  const missing = [];
  if (!config.clientId) missing.push("COPERNICUS_CLIENT_ID");
  if (!config.clientSecret) missing.push("COPERNICUS_CLIENT_SECRET");
  if (!config.aws.bucket) missing.push("AWS_S3_BUCKET");
  const hasStaticAwsCredentials = Boolean(config.aws.accessKeyId && config.aws.secretAccessKey);
  if (!hasStaticAwsCredentials && !config.aws.roleCredentialSourceAvailable) {
    missing.push("AWS_ACCESS_KEY_ID or IAM role credentials");
  }
  return {
    enabled: config.enabled,
    ready: config.enabled && missing.length === 0,
    missing,
  };
}

export {
  getCopernicusConfigStatus,
  readBooleanEnv,
  readCopernicusConfig,
  readNumberEnv,
};
