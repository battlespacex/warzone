import * as Cesium from "cesium";

function assetUrl(baseUrl, relative) {
    return new URL(String(relative).replace(/^\/+/, ""), `${String(baseUrl).replace(/\/+$/, "")}/`)
        .toString().replace(/%7B/gi, "{").replace(/%7D/gi, "}");
}

async function fetchWithTimeout(url, type, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
        if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes(type)) {
            throw new Error(`asset_response_${response.status}`);
        }
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function createSelfHostedImageryProviders(baseUrl) {
    if (!baseUrl) throw new Error("missing_map_base_url");
    const manifestUrl = assetUrl(baseUrl, "manifest.json");
    const manifest = await (await fetchWithTimeout(manifestUrl, "application/json")).json();
    if (manifest.format !== "xyz-jpeg" || !manifest.global?.template || !manifest.pilot?.template ||
        !manifest.sampleTile || !manifest.pilot.rectangle) {
        throw new Error("invalid_map_manifest");
    }
    await fetchWithTimeout(assetUrl(baseUrl, manifest.sampleTile), "image/");
    const tilingScheme = new Cesium.WebMercatorTilingScheme();
    const global = new Cesium.UrlTemplateImageryProvider({
        url: assetUrl(baseUrl, manifest.global.template),
        tilingScheme,
        maximumLevel: manifest.global.maximumLevel,
        credit: new Cesium.Credit("Natural Earth (public domain)", true),
    });
    const bounds = manifest.pilot.rectangle;
    const pilot = new Cesium.UrlTemplateImageryProvider({
        url: assetUrl(baseUrl, manifest.pilot.template),
        tilingScheme,
        minimumLevel: manifest.pilot.minimumLevel,
        maximumLevel: manifest.pilot.maximumLevel,
        rectangle: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
    });
    return { global, pilot, manifestUrl };
}

async function createSelfHostedTerrainProvider(baseUrl) {
    if (!baseUrl) throw new Error("missing_terrain_base_url");
    const provider = await Cesium.CesiumTerrainProvider.fromUrl(`${String(baseUrl).replace(/\/+$/, "")}/`, {
        requestVertexNormals: false,
        requestWaterMask: false,
    });
    provider.__warzoneProviderKind = "selfhosted";
    return provider;
}

export { createSelfHostedImageryProviders, createSelfHostedTerrainProvider };
