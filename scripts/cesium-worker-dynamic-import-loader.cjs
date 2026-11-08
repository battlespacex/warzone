// Keep Cesium's runtime geometry-module imports as native worker imports.
module.exports = function preserveCesiumGeometryImports(source) {
    const imports = source.match(/\bimport\(/g) || [];
    if (imports.length !== 55) {
        throw new Error(`Unexpected Cesium createGeometry import count: ${imports.length}`);
    }
    return source.replace(/\bimport\(/g, 'import(/* webpackIgnore: true */ ');
};
