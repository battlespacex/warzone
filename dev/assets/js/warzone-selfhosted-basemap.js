import * as Cesium from "cesium";

function assetUrl(baseUrl, relative) {
    const absoluteBaseUrl = new URL(`${String(baseUrl).replace(/\/+$/, "")}/`, window.location.origin);
    return new URL(String(relative).replace(/^\/+/, ""), absoluteBaseUrl)
        .toString().replace(/%7B/gi, "{").replace(/%7D/gi, "}");
}

async function fetchWithTimeout(url, type, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
        if (!response.ok) {
            throw new Error(`asset_response_${response.status}`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() || "missing";
        if (!contentType.includes(type)) throw new Error(`asset_content_type_${contentType.split(";")[0]}`);
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function createSelfHostedImageryProviders(baseUrl) {
    if (!baseUrl) throw new Error("missing_map_base_url");
    const manifestUrl = assetUrl(baseUrl, "manifest.json");
    const manifest = await (await fetchWithTimeout(manifestUrl, "application/json")).json();
    if (!["xyz-jpeg", "xyz-webp", "xyz-png"].includes(manifest.format) || !manifest.global?.template || !manifest.pilot?.template ||
        !manifest.sampleTile || !manifest.pilot.rectangle) {
        throw new Error("invalid_map_manifest");
    }
    await fetchWithTimeout(assetUrl(baseUrl, manifest.sampleTile), "image/");
    const tilingScheme = new Cesium.WebMercatorTilingScheme();
    const creditText = String(manifest.attribution || "Open map data contributors").trim();
    const tileSize = Number(manifest.tileSize) === 512 ? 512 : 256;
    const global = new Cesium.UrlTemplateImageryProvider({
        url: assetUrl(baseUrl, manifest.global.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        maximumLevel: manifest.global.maximumLevel,
        credit: new Cesium.Credit(creditText, true),
    });
    const bounds = manifest.pilot.rectangle;
    const pilot = new Cesium.UrlTemplateImageryProvider({
        url: assetUrl(baseUrl, manifest.pilot.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        minimumLevel: manifest.pilot.minimumLevel,
        maximumLevel: manifest.pilot.maximumLevel,
        rectangle: Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        credit: new Cesium.Credit(creditText, true),
    });
    const closeBounds = manifest.close?.rectangle;
    const close = closeBounds ? new Cesium.UrlTemplateImageryProvider({
        url: assetUrl(baseUrl, manifest.close.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        minimumLevel: manifest.close.minimumLevel,
        maximumLevel: manifest.close.maximumLevel,
        rectangle: Cesium.Rectangle.fromDegrees(closeBounds.west, closeBounds.south, closeBounds.east, closeBounds.north),
        credit: new Cesium.Credit(creditText, true),
    }) : null;
    const details = Array.isArray(manifest.detail) ? manifest.detail.map((area) => {
        const detailBounds = area?.rectangle;
        if (!detailBounds || !area.template) throw new Error("invalid_map_detail_manifest");
        return new Cesium.UrlTemplateImageryProvider({
            url: assetUrl(baseUrl, area.template),
            tilingScheme,
            tileWidth: tileSize,
            tileHeight: tileSize,
            minimumLevel: area.minimumLevel,
            maximumLevel: area.maximumLevel,
            rectangle: Cesium.Rectangle.fromDegrees(detailBounds.west, detailBounds.south, detailBounds.east, detailBounds.north),
            credit: new Cesium.Credit(creditText, true),
        });
    }) : [];
    return { global, pilot, close, details, providers: [global, pilot, close, ...details].filter(Boolean), manifest, manifestUrl };
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
