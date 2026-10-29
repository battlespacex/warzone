"use strict";
(self["webpackChunkwarzone_frontend"] = self["webpackChunkwarzone_frontend"] || []).push([["dev_assets_js_warzone-google-basemap_js"],{

/***/ "./dev/assets/js/warzone-google-basemap.js":
/*!*************************************************!*\
  !*** ./dev/assets/js/warzone-google-basemap.js ***!
  \*************************************************/
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   createGoogleImageryProvider: function() { return /* binding */ createGoogleImageryProvider; }
/* harmony export */ });
/* harmony import */ var cesium__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! cesium */ "./node_modules/@cesium/engine/Source/Scene/Google2DImageryProvider.js");


async function createGoogleImageryProvider(apiKey = "") {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("missing_google_api_key");
    return cesium__WEBPACK_IMPORTED_MODULE_0__["default"].fromUrl({
        key,
        mapType: "satellite",
        language: "en",
        region: "US",
    });
}




/***/ })

}]);