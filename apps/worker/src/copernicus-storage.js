import crypto from "crypto";
import nodeFetch from "node-fetch";

function getFetch() {
  return globalThis.__copernicusFetchOverride || nodeFetch;
}

const ECS_CREDENTIALS_HOST = "http://169.254.170.2";
const EC2_METADATA_HOST = "http://169.254.169.254";
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

async function fetchEcsRoleCredentials(config) {
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
    headers: {
      "x-aws-ec2-metadata-token-ttl-seconds": "21600",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`IMDSv2 token request failed (${response.status}) ${text.slice(0, 160)}`);
  }
  return response.text();
}

async function fetchEc2RoleCredentials(config) {
  if (String(process.env.AWS_EC2_METADATA_DISABLED || "").trim().toLowerCase() === "true") return null;
  const metadataToken = await fetchEc2MetadataToken();
  const metadataHeaders = { "x-aws-ec2-metadata-token": metadataToken };
  const roleNameResponse = await getFetch()(`${EC2_METADATA_HOST}/latest/meta-data/iam/security-credentials/`, {
    headers: metadataHeaders,
  });
  if (!roleNameResponse.ok) {
    const text = await roleNameResponse.text().catch(() => "");
    throw new Error(`EC2 role name request failed (${roleNameResponse.status}) ${text.slice(0, 160)}`);
  }
  const roleName = String(await roleNameResponse.text()).trim();
  if (!roleName) throw new Error("EC2 role name response was empty");
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
    const ecsCreds = await fetchEcsRoleCredentials(config).catch(() => null);
    if (areAwsCredentialsUsable(ecsCreds)) {
      cachedAwsCredentials = ecsCreds;
      return cachedAwsCredentials;
    }

    const ec2Creds = await fetchEc2RoleCredentials(config).catch((error) => {
      throw new Error(`IAM role credential resolution failed: ${error?.message || error}`);
    });
    if (!areAwsCredentialsUsable(ec2Creds)) {
      throw new Error("IAM role credential resolution returned unusable credentials");
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
  return `https://s3.${config.aws.region}.amazonaws.com/${encodeURIComponent(config.aws.bucket)}/${encodeS3Key(key)}`;
}

async function s3Request(config, { method, key, body = Buffer.alloc(0), contentType = "application/octet-stream" }) {
  const credentials = await resolveAwsCredentials(config);
  const region = config.aws.region;
  const bucket = config.aws.bucket;
  const service = "s3";
  const host = `s3.${region}.amazonaws.com`;
  const encodedKey = encodeS3Key(key);
  const canonicalPath = `/${encodeURIComponent(bucket)}/${encodedKey}`;
  const url = `https://${host}${canonicalPath}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }
  if (method !== "DELETE" && method !== "HEAD") {
    headers["content-type"] = contentType;
    headers["content-length"] = String(Buffer.byteLength(body));
  }

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest = [
    method,
    canonicalPath,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, region, service);
  const signature = hmac(signingKey, stringToSign, "hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await getFetch()(url, {
    method,
    headers,
    body: method === "DELETE" || method === "HEAD" ? undefined : body,
  });

  return response;
}

async function uploadSatellitePreviewToS3(config, { key, body, contentType }) {
  const response = await s3Request(config, {
    method: "PUT",
    key,
    body,
    contentType,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`S3 upload failed (${response.status}) ${text.slice(0, 120)}`);
  }
  return {
    storageKey: key,
    imageUrl: buildS3PublicUrl(config, key),
    etag: String(response.headers.get("etag") || "").replace(/^"|"$/g, "") || null,
  };
}

async function deleteSatellitePreviewFromS3(config, key) {
  if (!key) return { ok: true, skipped: true };
  const response = await s3Request(config, { method: "DELETE", key });
  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: `S3 delete failed (${response.status}) ${text.slice(0, 120)}` };
  }
  return { ok: true };
}

export {
  areAwsCredentialsUsable,
  buildS3PublicUrl,
  deleteSatellitePreviewFromS3,
  resolveAwsCredentials,
  uploadSatellitePreviewToS3,
};
