import * as Cesium from "cesium";

async function createGoogleImageryProvider(apiKey = "") {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("missing_google_api_key");
    return Cesium.Google2DImageryProvider.fromUrl({
        key,
        mapType: "satellite",
        language: "en",
        region: "US",
    });
}

export { createGoogleImageryProvider };
