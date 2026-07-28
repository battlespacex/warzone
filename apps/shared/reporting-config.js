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

function readJsonEnv(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function normalizeRetentionDays(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "unlimited") return null;
  const parsed = Number.parseInt(normalized, 10);
  if ([7, 30, 90, 365].includes(parsed)) return parsed;
  return 90;
}

function readReportingConfig(env = process.env) {
  return {
    enabled: readBooleanEnv(env.REPORTING_ENABLED, true),
    dailyCron: String(env.REPORTING_DAILY_CRON || "18 0 * * *").trim(),
    weeklyCron: String(env.REPORTING_WEEKLY_CRON || "42 0 * * 1").trim(),
    retentionDays: normalizeRetentionDays(env.REPORTING_SNAPSHOT_RETENTION_DAYS),
    pdfExpiryHours: readNumberEnv(env.REPORTING_PDF_EXPIRY_HOURS, 72, { min: 1, max: 24 * 30 }),
    s3Prefix: String(env.REPORTING_S3_PREFIX || "reports").trim().replace(/^\/+|\/+$/g, "") || "reports",
    scheduledRegions: String(env.REPORTING_REGIONS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    scheduledCountries: String(env.REPORTING_COUNTRIES || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    scheduledAois: Array.isArray(readJsonEnv(env.REPORTING_AOIS_JSON, []))
      ? readJsonEnv(env.REPORTING_AOIS_JSON, [])
      : [],
    aws: {
      region: String(env.AWS_REGION || env.AWS_DEFAULT_REGION || env.S3_REGION || "us-east-1").trim(),
      bucket: String(env.AWS_S3_BUCKET || env.S3_BUCKET || "").trim(),
      accessKeyId: String(env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || "").trim(),
      secretAccessKey: String(env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || "").trim(),
      sessionToken: String(env.AWS_SESSION_TOKEN || env.S3_SESSION_TOKEN || "").trim(),
      cloudFrontUrl: trimTrailingSlash(env.CLOUDFRONT_URL || env.AWS_CLOUDFRONT_URL || env.CLOUDFRONT_DOMAIN || ""),
    },
  };
}

function getReportingConfigStatus(config = readReportingConfig()) {
  const missing = [];
  if (!config.aws.bucket) missing.push("AWS_S3_BUCKET");
  if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
    missing.push("AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or IAM role support");
  }
  return {
    enabled: config.enabled,
    ready: config.enabled && missing.length === 0,
    missing,
  };
}

export {
  getReportingConfigStatus,
  readBooleanEnv,
  readNumberEnv,
  readReportingConfig,
};
