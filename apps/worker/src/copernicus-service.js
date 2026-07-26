import crypto from "crypto";
import nodeFetch from "node-fetch";
import { clearCopernicusToken, fetchCopernicusAccessToken } from "./copernicus-auth.js";
import {
  buildEventBbox,
  getEventTimeRelation,
  makeSatelliteCacheKey,
  normalizeCatalogFeature,
  rankCatalogFeatures,
  sanitizeForLog,
} from "./copernicus-utils.js";

const SENTINEL2_TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ["B04", "B03", "B02", "dataMask"], output: { bands: 4, sampleType: "AUTO" } };
}
function evaluatePixel(sample) {
  return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02, sample.dataMask];
}`;

const SENTINEL1_RADAR_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: ["VV", "VH", "dataMask"], output: { bands: 4, sampleType: "AUTO" } };
}
function evaluatePixel(sample) {
  var vv = Math.min(1, Math.max(0, sample.VV * 4));
  var vh = Math.min(1, Math.max(0, sample.VH * 8));
  return [vv, vv * 0.85 + vh * 0.15, vh, sample.dataMask];
}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFetch() {
  return globalThis.__copernicusFetchOverride || nodeFetch;
}

class CopernicusHttpError extends Error {
  constructor(message, { status, retryAfterMs = 0, permanent = false } = {}) {
    super(message);
    this.name = "CopernicusHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.permanent = permanent;
  }
}

class CopernicusRateLimiter {
  constructor(maxRequestsPerMinute = 20) {
    this.maxRequestsPerMinute = Math.max(1, Number(maxRequestsPerMinute) || 20);
    this.timestamps = [];
  }

  async waitTurn() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((entry) => now - entry < 60 * 1000);
    if (this.timestamps.length >= this.maxRequestsPerMinute) {
      const waitMs = Math.max(250, 60 * 1000 - (now - this.timestamps[0]));
      await sleep(waitMs);
    }
    this.timestamps.push(Date.now());
  }
}

const rateLimiters = new Map();

function getRateLimiter(config) {
  const key = String(config.maxRequestsPerMinute || 20);
  if (!rateLimiters.has(key)) {
    rateLimiters.set(key, new CopernicusRateLimiter(config.maxRequestsPerMinute));
  }
  return rateLimiters.get(key);
}

function parseRetryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

async function copernicusFetch(config, url, options = {}, { retry401 = true } = {}) {
  const limiter = getRateLimiter(config);
  await limiter.waitTurn();
  const token = await fetchCopernicusAccessToken(config);
  const response = await getFetch()(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
      authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 && retry401) {
    clearCopernicusToken();
    const retryToken = await fetchCopernicusAccessToken(config, { force: true });
    return getFetch()(url, {
      ...options,
      headers: {
        accept: "application/json",
        ...(options.headers || {}),
        authorization: `Bearer ${retryToken}`,
      },
    });
  }

  return response;
}

function buildCatalogSearchPayload({ collection, bbox, fromIso, toIso, maxCloudCover }) {
  const payload = {
    collections: [collection],
    bbox,
    datetime: `${fromIso}/${toIso}`,
    limit: 50,
  };
  if (collection === "sentinel-2-l2a") {
    payload.filter = `eo:cloud_cover <= ${Number(maxCloudCover)}`;
  }
  return payload;
}

async function searchCatalogCollection(config, params, collection) {
  const payload = buildCatalogSearchPayload({ ...params, collection });
  const response = await copernicusFetch(config, `${config.catalogUrl}/search`, {
    method: "POST",
    headers: {
      accept: "application/geo+json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 429) {
    throw new CopernicusHttpError("Copernicus catalog rate limited", {
      status: 429,
      retryAfterMs: parseRetryAfterMs(response),
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CopernicusHttpError(`Copernicus catalog failed (${response.status}) ${sanitizeForLog(text.slice(0, 160))}`, {
      status: response.status,
      permanent: response.status >= 400 && response.status < 500,
    });
  }
  const json = await response.json();
  return (Array.isArray(json.features) ? json.features : [])
    .map((feature) => normalizeCatalogFeature(feature, collection))
    .filter(Boolean);
}

async function findBestObservation(config, event) {
  const eventTime = new Date(event.occurred_at || event.created_at || Date.now());
  const bbox = buildEventBbox(event.lat, event.lon, config.searchRadiusKm);
  const fromIso = new Date(eventTime.getTime() - config.searchLookbackHours * 60 * 60 * 1000).toISOString();
  const toIso = new Date(Math.min(Date.now(), eventTime.getTime() + config.searchLookbackHours * 60 * 60 * 1000)).toISOString();
  const searchParams = { bbox, fromIso, toIso, maxCloudCover: config.maxCloudCover };

  const sentinel2 = await searchCatalogCollection(config, searchParams, "sentinel-2-l2a");
  const rankedS2 = rankCatalogFeatures(sentinel2, eventTime);
  if (rankedS2.length) {
    const selected = rankedS2[0];
    return {
      ...selected,
      bbox,
      observationType: "natural_color",
      eventTimeRelation: getEventTimeRelation(selected.acquisitionTime, eventTime),
      approximateResolution: "10 m",
      evalscript: SENTINEL2_TRUE_COLOR_EVALSCRIPT,
    };
  }

  if (!config.sentinel1Fallback) return null;

  const sentinel1 = await searchCatalogCollection(config, searchParams, "sentinel-1-grd");
  const rankedS1 = rankCatalogFeatures(sentinel1, eventTime, { preferPostEvent: true });
  if (!rankedS1.length) return null;
  const selected = rankedS1[0];
  return {
    ...selected,
    bbox,
    observationType: "sar_radar",
    eventTimeRelation: getEventTimeRelation(selected.acquisitionTime, eventTime),
    approximateResolution: "10 m",
    cloudCover: null,
    evalscript: SENTINEL1_RADAR_EVALSCRIPT,
  };
}

function buildProcessPayload(config, observation) {
  const isSar = observation.collection === "sentinel-1-grd";
  const fromMs = Date.parse(observation.acquisitionTime) - 90 * 60 * 1000;
  const toMs = Date.parse(observation.acquisitionTime) + 90 * 60 * 1000;
  return {
    input: {
      bounds: {
        bbox: observation.bbox,
        properties: {
          crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
        },
      },
      data: [
        {
          type: isSar ? "sentinel-1-grd" : "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: new Date(fromMs).toISOString(),
              to: new Date(toMs).toISOString(),
            },
            ...(isSar ? { acquisitionMode: "IW" } : { maxCloudCoverage: config.maxCloudCover }),
          },
        },
      ],
    },
    output: {
      width: config.previewWidth,
      height: config.previewHeight,
      responses: [
        {
          identifier: "default",
          format: {
            type: "image/png",
          },
        },
      ],
    },
    evalscript: observation.evalscript,
  };
}

async function processObservationPreview(config, observation) {
  const response = await copernicusFetch(config, config.processUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "image/png",
    },
    body: JSON.stringify(buildProcessPayload(config, observation)),
  });
  if (response.status === 429) {
    throw new CopernicusHttpError("Copernicus process rate limited", {
      status: 429,
      retryAfterMs: parseRetryAfterMs(response),
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CopernicusHttpError(`Copernicus process failed (${response.status}) ${sanitizeForLog(text.slice(0, 160))}`, {
      status: response.status,
      permanent: response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 429,
    });
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new CopernicusHttpError(`Copernicus process returned invalid content type: ${contentType || "unknown"}`, {
      status: response.status,
      permanent: false,
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Copernicus process returned empty image");
  if (buffer.length > config.maxImageBytes) {
    throw new Error(`Copernicus process image too large (${buffer.length} bytes)`);
  }
  return {
    body: buffer,
    mimeType: contentType.split(";")[0] || "image/png",
    byteSize: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function buildObservationCacheKey(config, observation) {
  return makeSatelliteCacheKey({
    collection: observation.collection,
    sourceItemId: observation.sourceItemId,
    acquisitionTime: observation.acquisitionTime,
    bbox: observation.bbox,
    width: config.previewWidth,
    height: config.previewHeight,
    visualizationVersion: observation.collection === "sentinel-1-grd" ? "sar-v1" : "true-color-v1",
  });
}

export {
  CopernicusHttpError,
  buildObservationCacheKey,
  findBestObservation,
  processObservationPreview,
};
