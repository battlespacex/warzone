"use strict";
(self["webpackChunkwarzone_frontend"] = self["webpackChunkwarzone_frontend"] || []).push([["dev_assets_js_warzone-selfhosted-basemap_js"],{

/***/ "./dev/assets/js/warzone-selfhosted-basemap.js":
/*!*****************************************************!*\
  !*** ./dev/assets/js/warzone-selfhosted-basemap.js ***!
  \*****************************************************/
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createSelfHostedImageryProviders: function() { return /* binding */ createSelfHostedImageryProviders; },
/* harmony export */   createSelfHostedTerrainProvider: function() { return /* binding */ createSelfHostedTerrainProvider; }
/* harmony export */ });
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/CesiumTerrainProvider.js");
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/Credit.js");
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/Rectangle.js");
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Core/WebMercatorTilingScheme.js");
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Scene/UrlTemplateImageryProvider.js");


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
    const tilingScheme = new cesium__WEBPACK_IMPORTED_MODULE_3__["default"]();
    const creditText = String(manifest.attribution || "Open map data contributors").trim();
    const tileSize = Number(manifest.tileSize) === 512 ? 512 : 256;
    const global = new cesium__WEBPACK_IMPORTED_MODULE_4__["default"]({
        url: assetUrl(baseUrl, manifest.global.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        maximumLevel: manifest.global.maximumLevel,
        credit: new cesium__WEBPACK_IMPORTED_MODULE_1__["default"](creditText, true),
    });
    const bounds = manifest.pilot.rectangle;
    const pilot = new cesium__WEBPACK_IMPORTED_MODULE_4__["default"]({
        url: assetUrl(baseUrl, manifest.pilot.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        minimumLevel: manifest.pilot.minimumLevel,
        maximumLevel: manifest.pilot.maximumLevel,
        rectangle: cesium__WEBPACK_IMPORTED_MODULE_2__["default"].fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        credit: new cesium__WEBPACK_IMPORTED_MODULE_1__["default"](creditText, true),
    });
    const closeBounds = manifest.close?.rectangle;
    const close = closeBounds ? new cesium__WEBPACK_IMPORTED_MODULE_4__["default"]({
        url: assetUrl(baseUrl, manifest.close.template),
        tilingScheme,
        tileWidth: tileSize,
        tileHeight: tileSize,
        minimumLevel: manifest.close.minimumLevel,
        maximumLevel: manifest.close.maximumLevel,
        rectangle: cesium__WEBPACK_IMPORTED_MODULE_2__["default"].fromDegrees(closeBounds.west, closeBounds.south, closeBounds.east, closeBounds.north),
        credit: new cesium__WEBPACK_IMPORTED_MODULE_1__["default"](creditText, true),
    }) : null;
    const details = Array.isArray(manifest.detail) ? manifest.detail.map((area) => {
        const detailBounds = area?.rectangle;
        if (!detailBounds || !area.template) throw new Error("invalid_map_detail_manifest");
        return new cesium__WEBPACK_IMPORTED_MODULE_4__["default"]({
            url: assetUrl(baseUrl, area.template),
            tilingScheme,
            tileWidth: tileSize,
            tileHeight: tileSize,
            minimumLevel: area.minimumLevel,
            maximumLevel: area.maximumLevel,
            rectangle: cesium__WEBPACK_IMPORTED_MODULE_2__["default"].fromDegrees(detailBounds.west, detailBounds.south, detailBounds.east, detailBounds.north),
            credit: new cesium__WEBPACK_IMPORTED_MODULE_1__["default"](creditText, true),
        });
    }) : [];
    return { global, pilot, close, details, providers: [global, pilot, close, ...details].filter(Boolean), manifest, manifestUrl };
}

async function createSelfHostedTerrainProvider(baseUrl) {
    if (!baseUrl) throw new Error("missing_terrain_base_url");
    const provider = await cesium__WEBPACK_IMPORTED_MODULE_0__["default"].fromUrl(`${String(baseUrl).replace(/\/+$/, "")}/`, {
        requestVertexNormals: false,
        requestWaterMask: false,
    });
    provider.__warzoneProviderKind = "selfhosted";
    return provider;
}




/***/ })

}]);