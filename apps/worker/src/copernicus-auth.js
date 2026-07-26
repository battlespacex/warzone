import nodeFetch from "node-fetch";
import { sanitizeForLog } from "./copernicus-utils.js";

function getFetch() {
  return globalThis.__copernicusFetchOverride || nodeFetch;
}

let cachedToken = null;
let tokenRefreshPromise = null;
let permanentAuthFailure = false;

function isTokenUsable(token = cachedToken) {
  if (!token?.accessToken || !token?.expiresAt) return false;
  return Date.now() < token.expiresAt - 60 * 1000;
}

function clearCopernicusToken() {
  cachedToken = null;
  permanentAuthFailure = false;
}

async function fetchCopernicusAccessToken(config, { force = false, logger = console } = {}) {
  if (!force && isTokenUsable()) return cachedToken.accessToken;
  if (permanentAuthFailure && !force) {
    throw new Error("Copernicus authentication disabled after permanent failure");
  }
  if (tokenRefreshPromise) return tokenRefreshPromise;

  tokenRefreshPromise = (async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    let response;
    try {
      response = await getFetch()(config.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body,
      });
    } catch (error) {
      throw new Error(`Copernicus token request failed: ${sanitizeForLog(error?.message || error)}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 400 || response.status === 401) {
        permanentAuthFailure = true;
      }
      logger.warn?.(`[copernicus] auth failed status=${response.status} body=${sanitizeForLog(text.slice(0, 180))}`);
      throw new Error(`Copernicus authentication failed (${response.status})`);
    }

    const json = await response.json();
    const accessToken = String(json.access_token || "");
    const expiresIn = Number(json.expires_in || 0);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Copernicus token response missing access token or expiry");
    }

    cachedToken = {
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
    return cachedToken.accessToken;
  })().finally(() => {
    tokenRefreshPromise = null;
  });

  return tokenRefreshPromise;
}

export {
  clearCopernicusToken,
  fetchCopernicusAccessToken,
  isTokenUsable,
};
