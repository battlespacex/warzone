import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join, normalize, resolve } from "path";
import { fileURLToPath } from "url";

const ECS_CREDENTIALS_HOST = "http://169.254.170.2";
const EC2_METADATA_HOST = "http://169.254.169.254";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOCAL_REPORT_ROOT = resolve(__dirname, "..", "..", ".generated", "reports");
let cachedAwsCredentials = null;
let awsCredentialPromise = null;

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function encodeS3Key(key = "") {
  return String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getFetch() {
  return globalThis.fetch;
}

function isLocalReportFallbackEnabled() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function normalizeCredentialExpiry(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function areAwsCredentialsUsable(credentials = cachedAwsCredentials) {
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) return false;
  if (!credentials.expiresAt) return true;
  return Date.now() < credentials.expiresAt - 60 * 1000;
}

async function fetchJson(url, options = {}) {
  const response = await getFetch()(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`request to ${url} failed (${response.status}) ${text.slice(0, 160)}`);
  }
  return response.json();
}

async function fetchEcsRoleCredentials() {
  const relativeUri = String(
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_ECS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    ""
  ).trim();
  const fullUri = String(
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
    process.env.AWS_ECS_CONTAINER_CREDENTIALS_FULL_URI ||
    ""
  ).trim();
  const authToken = String(process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN || "").trim();
  const url = fullUri || (relativeUri ? `${ECS_CREDENTIALS_HOST}${relativeUri}` : "");
  if (!url) return null;
  const json = await fetchJson(url, {
    headers: authToken ? { authorization: authToken } : undefined,
  });
  return {
    accessKeyId: String(json.AccessKeyId || "").trim(),
    secretAccessKey: String(json.SecretAccessKey || "").trim(),
    sessionToken: String(json.Token || "").trim(),
    expiresAt: normalizeCredentialExpiry(json.Expiration),
    source: "ecs_role",
  };
}

async function fetchEc2MetadataToken() {
  const response = await getFetch()(`${EC2_METADATA_HOST}/latest/api/token`, {
    method: "PUT",
    headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" },
  });
  if (!response.ok) return "";
  return response.text();
}

async function fetchEc2RoleCredentials() {
  if (String(process.env.AWS_EC2_METADATA_DISABLED || "").trim().toLowerCase() === "true") return null;
  const metadataToken = await fetchEc2MetadataToken();
  if (!metadataToken) return null;
  const metadataHeaders = { "x-aws-ec2-metadata-token": metadataToken };
  const roleNameResponse = await getFetch()(`${EC2_METADATA_HOST}/latest/meta-data/iam/security-credentials/`, {
    headers: metadataHeaders,
  });
  if (!roleNameResponse.ok) return null;
  const roleName = String(await roleNameResponse.text()).trim();
  if (!roleName) return null;
  const json = await fetchJson(`${EC2_METADATA_HOST}/latest/meta-data/iam/security-credentials/${roleName}`, {
    headers: metadataHeaders,
  });
  return {
    accessKeyId: String(json.AccessKeyId || "").trim(),
    secretAccessKey: String(json.SecretAccessKey || "").trim(),
    sessionToken: String(json.Token || "").trim(),
    expiresAt: normalizeCredentialExpiry(json.Expiration),
    source: "ec2_role",
  };
}

async function resolveAwsCredentials(config) {
  if (config.aws.accessKeyId && config.aws.secretAccessKey) {
    return {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
      sessionToken: config.aws.sessionToken || "",
      expiresAt: 0,
      source: "static_env",
    };
  }
  if (areAwsCredentialsUsable()) return cachedAwsCredentials;
  if (awsCredentialPromise) return awsCredentialPromise;

  awsCredentialPromise = (async () => {
    const ecsCreds = await fetchEcsRoleCredentials().catch(() => null);
    if (areAwsCredentialsUsable(ecsCreds)) {
      cachedAwsCredentials = ecsCreds;
      return cachedAwsCredentials;
    }
    const ec2Creds = await fetchEc2RoleCredentials().catch(() => null);
    if (!areAwsCredentialsUsable(ec2Creds)) {
      throw new Error("AWS credentials unavailable for report storage");
    }
    cachedAwsCredentials = ec2Creds;
    return cachedAwsCredentials;
  })().finally(() => {
    awsCredentialPromise = null;
  });

  return awsCredentialPromise;
}

function buildS3PublicUrl(config, key) {
  const cloudFrontUrl = String(config.aws.cloudFrontUrl || "").replace(/\/+$/, "");
  if (cloudFrontUrl) return `${cloudFrontUrl}/${encodeS3Key(key)}`;
  const region = String(config.aws.region || "").trim();
  const host = !region || region === "us-east-1"
    ? "s3.amazonaws.com"
    : `s3.${region}.amazonaws.com`;
  return `https://${host}/${encodeURIComponent(config.aws.bucket)}/${encodeS3Key(key)}`;
}

function buildLocalReportUrl(key) {
  return `/stratops/reports/file/${encodeS3Key(key)}`;
}

function getLocalReportFilePath(key) {
  const safeKey = String(key || "")
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .filter(Boolean)
    .join("/");
  const target = resolve(LOCAL_REPORT_ROOT, safeKey);
  const normalizedRoot = normalize(`${LOCAL_REPORT_ROOT}\\`);
  const normalizedTarget = normalize(target);
  if (!normalizedTarget.startsWith(normalizedRoot) && normalizedTarget !== normalize(LOCAL_REPORT_ROOT)) {
    throw new Error("Invalid local report path");
  }
  return target;
}

async function writeLocalReportObject(key, body) {
  const filePath = getLocalReportFilePath(key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
  return {
    storageKey: key,
    url: buildLocalReportUrl(key),
    etag: sha256(body),
    localPath: filePath,
  };
}

function buildS3PutRequest(region, bucket, key, body, contentType, credentials) {
  const normalizedRegion = String(region || "").trim();
  const service = "s3";
  const host = !normalizedRegion || normalizedRegion === "us-east-1"
    ? "s3.amazonaws.com"
    : `s3.${normalizedRegion}.amazonaws.com`;
  const encodedKey = encodeS3Key(key);
  const canonicalPath = `/${encodeURIComponent(bucket)}/${encodedKey}`;
  const url = `https://${host}${canonicalPath}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    host,
    "content-type": contentType,
    "content-length": String(Buffer.byteLength(body)),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest = ["PUT", canonicalPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${normalizedRegion || "us-east-1"}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, normalizedRegion || "us-east-1", service);
  const signature = hmac(signingKey, stringToSign, "hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

async function putSignedS3Object(region, bucket, key, body, contentType, credentials) {
  const request = buildS3PutRequest(region, bucket, key, body, contentType, credentials);
  return getFetch()(request.url, { method: "PUT", headers: request.headers, body });
}

async function s3PutObject(config, { key, body, contentType = "application/octet-stream" }) {
  try {
    const credentials = await resolveAwsCredentials(config);
    let region = String(config.aws.region || "").trim() || "us-east-1";
    const bucket = config.aws.bucket;
    let response = await putSignedS3Object(region, bucket, key, body, contentType, credentials);
    if (response.status === 301 || response.status === 307) {
      const hintedRegion = String(response.headers.get("x-amz-bucket-region") || "").trim();
      const responseText = await response.text().catch(() => "");
      if (hintedRegion && hintedRegion !== region) {
        region = hintedRegion;
        response = await putSignedS3Object(region, bucket, key, body, contentType, credentials);
        if (response.ok) {
          return {
            storageKey: key,
            url: buildS3PublicUrl({ ...config, aws: { ...config.aws, region } }, key),
            etag: String(response.headers.get("etag") || "").replace(/^"|"$/g, "") || null,
          };
        }
      } else {
        throw new Error(`S3 report upload failed (${response.status}) ${responseText.slice(0, 160)}`);
      }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`S3 report upload failed (${response.status}) ${text.slice(0, 160)}`);
    }
    return {
      storageKey: key,
      url: buildS3PublicUrl(config, key),
      etag: String(response.headers.get("etag") || "").replace(/^"|"$/g, "") || null,
    };
  } catch (error) {
    if (isLocalReportFallbackEnabled()) {
      return writeLocalReportObject(key, body);
    }
    throw error;
  }
}

export {
  areAwsCredentialsUsable,
  buildS3PublicUrl,
  getLocalReportFilePath,
  s3PutObject,
};
