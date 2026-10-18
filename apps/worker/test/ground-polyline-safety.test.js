import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const globeSourceUrl = new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url);
const bordersUrl = new URL("../../../dev/assets/data/ne_110m_admin_0_countries.geojson", import.meta.url);

test("border normalization removes consecutive duplicate ground-polyline vertices", async () => {
  const source = await readFile(globeSourceUrl, "utf8");
  const section = source.slice(
    source.indexOf("function flattenRingToDegrees"),
    source.indexOf("function ringToCartesianPositions")
  );
  const context = vm.createContext({});
  vm.runInContext(section, context);

  assert.deepEqual(
    [...context.flattenRingToDegrees([[10, 20], [10, 20], [11, 21], [10, 20]])],
    [10, 20, 11, 21, 10, 20]
  );

  const geojson = JSON.parse(await readFile(bordersUrl, "utf8"));
  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    const rings = geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates.flat()
        : [];
    for (const ring of rings) {
      const coordinates = context.flattenRingToDegrees(ring);
      for (let index = 2; index < coordinates.length; index += 2) {
        assert.notDeepEqual(
          coordinates.slice(index - 2, index + 2),
          [coordinates[index], coordinates[index + 1], coordinates[index], coordinates[index + 1]],
          feature.properties?.ADMIN
        );
      }
    }
  }
});
