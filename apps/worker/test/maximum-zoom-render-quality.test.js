import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const globe = fs.readFileSync(path.join(root, "dev/assets/js/warzone-globe.js"), "utf8");
const css = fs.readFileSync(path.join(root, "dev/assets/css/root.css"), "utf8");

test("maximum zoom sharpens the existing imagery without adding road overlays", () => {
    assert.doesNotMatch(globe, /World_Transportation\/MapServer/);
    assert.doesNotMatch(globe, /__imageryCloseRoads|__imageryCloseLabels/);
    assert.match(globe, /cameraHeight <= maximumZoomQualityHeight/);
    assert.match(globe, /!isCameraMoving/);
    assert.match(globe, /nextResolution = Math\.max\(nextResolution, maximumZoomResolutionScale\)/);
    assert.match(globe, /nextSse = Math\.min\(nextSse, maximumZoomSse\)/);
    assert.match(globe, /updateMaximumZoomImagerySampling\(viewer, maximumZoomQualityActive\)/);
    assert.match(css, /--warzone-max-zoom-quality-height:\s*25000/);
    assert.match(css, /--warzone-max-zoom-resolution-scale:\s*1\.75/);
    assert.match(css, /--warzone-max-zoom-screen-space-error:\s*0\.55/);
    assert.match(css, /--warzone-max-zoom-imagery-anisotropy:\s*16/);
});
