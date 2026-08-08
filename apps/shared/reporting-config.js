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

function normalizeCaptureFormat(value = "") {
  return String(value || "jpeg").trim().toLowerCase() === "png" ? "png" : "jpeg";
}

function readReportingConfig(env = process.env) {
  const enabled = readBooleanEnv(env.REPORTING_ENABLED, true);
  const apiEnabled = readBooleanEnv(env.REPORTING_API_ENABLED, enabled);
  const scheduleEnabled = readBooleanEnv(env.REPORTING_SCHEDULE_ENABLED, enabled);
  const snapshotEnabled = readBooleanEnv(env.REPORTING_SNAPSHOT_ENABLED, scheduleEnabled);
  const dailyEnabled = readBooleanEnv(env.REPORTING_DAILY_ENABLED, true);
  const weeklyEnabled = readBooleanEnv(env.REPORTING_WEEKLY_ENABLED, false);
  const captureEnabled = readBooleanEnv(env.REPORTING_CAPTURE_ENABLED, false);
  return {
    enabled,
    apiEnabled,
    scheduleEnabled,
    snapshotEnabled,
    dailyEnabled,
    weeklyEnabled,
    dailyCron: String(env.REPORTING_DAILY_CRON || "18 0 * * *").trim(),
    weeklyCron: String(env.REPORTING_WEEKLY_CRON || "42 0 * * 1").trim(),
    snapshotCron: String(env.REPORTING_SNAPSHOT_CRON || "12 0 * * *").trim(),
    retentionDays: normalizeRetentionDays(env.REPORTING_SNAPSHOT_RETENTION_DAYS),
    pdfExpiryHours: readNumberEnv(env.REPORTING_PDF_EXPIRY_HOURS, 72, { min: 1, max: 24 * 30 }),
    s3Prefix: String(env.REPORTING_S3_PREFIX || "reports").trim().replace(/^\/+|\/+$/g, "") || "reports",
    capture: {
      enabled: captureEnabled,
      baseUrl: trimTrailingSlash(env.REPORTING_CAPTURE_BASE_URL || "http://127.0.0.1:4173"),
      width: Math.round(readNumberEnv(env.REPORTING_CAPTURE_WIDTH, 1600, { min: 800, max: 3840 })),
      height: Math.round(readNumberEnv(env.REPORTING_CAPTURE_HEIGHT, 900, { min: 450, max: 2160 })),
      format: normalizeCaptureFormat(env.REPORTING_CAPTURE_FORMAT),
      quality: Math.round(readNumberEnv(env.REPORTING_CAPTURE_QUALITY, 88, { min: 50, max: 100 })),
      timeoutMs: Math.round(readNumberEnv(env.REPORTING_CAPTURE_TIMEOUT_MS, 45000, { min: 10000, max: 180000 })),
      retentionHours: readNumberEnv(env.REPORTING_CAPTURE_RETENTION_HOURS, 24, { min: 1, max: 24 * 30 }),
      maxImages: Math.round(readNumberEnv(env.REPORTING_CAPTURE_MAX_IMAGES, 8, { min: 1, max: 24 })),
      retries: Math.round(readNumberEnv(env.REPORTING_CAPTURE_RETRIES, 2, { min: 0, max: 4 })),
      token: String(env.REPORTING_CAPTURE_TOKEN || "").trim(),
      browserExecutablePath: String(env.REPORTING_CAPTURE_BROWSER_EXECUTABLE_PATH || "").trim(),
    },
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
  const reportStorageRequired = config.apiEnabled || config.scheduleEnabled;
  if (reportStorageRequired) {
    if (!config.aws.bucket) missing.push("AWS_S3_BUCKET");
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      missing.push("AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or IAM role support");
    }
  }
  if (config.capture?.enabled) {
    if (!config.capture.baseUrl) missing.push("REPORTING_CAPTURE_BASE_URL");
    if (!config.capture.token) missing.push("REPORTING_CAPTURE_TOKEN");
  }
  return {
    enabled: config.enabled,
    apiEnabled: config.apiEnabled,
    scheduleEnabled: config.scheduleEnabled,
    snapshotEnabled: config.snapshotEnabled,
    snapshotReady: config.snapshotEnabled,
    reportStorageReady: reportStorageRequired && missing.length === 0,
    dailyEnabled: config.dailyEnabled,
    weeklyEnabled: config.weeklyEnabled,
    captureEnabled: config.capture?.enabled === true,
    ready: config.snapshotEnabled || (reportStorageRequired && missing.length === 0),
    missing,
  };
}

export {
  getReportingConfigStatus,
  readBooleanEnv,
  readNumberEnv,
  readReportingConfig,
};
