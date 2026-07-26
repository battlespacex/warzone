import test from "node:test";
import assert from "node:assert/strict";
import { clearCopernicusToken, fetchCopernicusAccessToken } from "../src/copernicus-auth.js";

test("deduplicates simultaneous Copernicus token refreshes and caches token", async () => {
  clearCopernicusToken();
  const originalFetch = globalThis.__copernicusFetchOverride;
  let callCount = 0;
  globalThis.__copernicusFetchOverride = async () => {
    callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      ok: true,
      status: 200,
      async json() {
        return { access_token: "token-1", expires_in: 3600 };
      },
    };
  };

  try {
    const config = {
      tokenUrl: "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
      clientId: "client",
      clientSecret: "secret",
    };
    const [a, b, c] = await Promise.all([
      fetchCopernicusAccessToken(config),
      fetchCopernicusAccessToken(config),
      fetchCopernicusAccessToken(config),
    ]);
    assert.equal(a, "token-1");
    assert.equal(b, "token-1");
    assert.equal(c, "token-1");
    assert.equal(callCount, 1);
    assert.equal(await fetchCopernicusAccessToken(config), "token-1");
    assert.equal(callCount, 1);
  } finally {
    globalThis.__copernicusFetchOverride = originalFetch;
    clearCopernicusToken();
  }
});
