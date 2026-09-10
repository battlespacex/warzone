# Source images, reports, and focused assets: local verification

## Status

Implemented locally; API responses, automated tests, and production build checked.
Final browser verification of the updated 3D captures and interactive asset motion is blocked.
No deployment, commit, push, report publication, database migration, or S3 upload was performed for this task.

## Root causes and exact implementation changes

| File | Functions changed | Cause and behavior change |
| --- | --- | --- |
| `apps/api/src/intel-source-sanitizer.js` | `buildPublicIntelWireMedia` | Image and video-poster URLs were rewritten to StratOps media proxy endpoints. Return the sanitized original image URLs instead. Video streams retain existing delivery behavior. Event popups share this serializer. |
| `apps/shared/satellite-source-preview.js` (new) | `isSatelliteSourcePreviewUrl`, `resolveSatelliteSourcePreview` | Resolve an exact Copernicus product name to its public QUICKLOOK asset, accepting only the official HTTPS asset endpoint. Bounded cache and shared pending requests avoid duplicate lookups. No bucket fallback or client credentials in image URLs. |
| `apps/api/src/satellite-context.js` | `toPublicSatelliteContext`, `attachSatelliteContextToEvents` | Existing observation rows pointed at stored bucket previews. Resolve their product to a source-hosted image when serving events, without rewriting those database rows. Label previews accurately as reduced-resolution full-scene quicklooks. |
| `apps/worker/src/copernicus-config.js` | `getCopernicusConfigStatus` | New source-hosted previews do not need AWS storage credentials. Existing catalog credentials remain server-side. |
| `apps/worker/src/copernicus-runner.js` | `processOneEvent` | New observations resolve/store the source URL, instead of generating and uploading a Process API crop. Only source-hosted cached URLs are reused. Legacy cleanup behavior is retained. |
| `apps/shared/reporting-service.js` | `fetchSatellitePreviewForEvents`, `ensureDailyReport` | Satellite query selected nonexistent `resolution_meters`, silently losing previews. Remove that column and resolve source imagery. Manual daily generation now invokes the existing worker pipeline instead of the disabled legacy publisher. |
| `apps/shared/reporting-html.js` | `buildReportRenderModel`, `imageCaption` | Current report renderer ignored `satellite_summary`. Include its validated source image with acquisition/context disclaimer in the imagery section. |
| `apps/shared/reporting-capture.js` | `buildReportAssetFocusPreset` | Naval report focus now requests CTR, like HVA report focus. |
| `apps/worker/src/reporting-capture-service.js` | `generateSnapshotCaptures` | Separate API capture-payload availability/configuration could produce 404s. Fulfill the isolated capture page's payload request from the exact snapshot already loaded by the worker. |
| `apps/worker/src/reporting-pipeline-service.js` | `runDailyReportPipeline` | Capture exceptions were swallowed, permitting text-only publication. Required capture failures now stop publication; upload-only reuse checks capture readiness and PDF image failures. Local-only/skip-upload capture configuration cannot upload screenshots. |
| `apps/worker/src/reporting-pdf-service.js` | `generateSnapshotPdf` | Refuse to print/publish a PDF when readiness reports broken images. |
| `dev/assets/js/report-capture.js` | `renderSelectedAsset`, `modelWasPicked`, `applyAssetFocus`, `prepareCapture` | A picked label could count as a visible aircraft; interactive model scale caps could defeat report minimum pixel size. Require a picked Cesium model, use report-only sizing, and recheck final-frame visibility. Add naval CTR adapter. |
| `dev/assets/js/warzone-live-airforce.js` | `applyLiveTrackModel`, `applyLiveTrackModelSizing`, `getTrackResolvedHeading`, `getTrackAttitude`, `getFocusedRoutePositions`, `getTrackTrailPositions`, `commitTrackTrailPosition`, `animateTrackTo` | Prefer transmitted course over bearings from jittering fixes, avoid double heading smoothing, clone trail fixes, retain earth-fixed history, and omit a future telemetry endpoint while interpolating toward it. Preserve report-only sizing during visual refresh. Existing shared wall-clock motion loop retained. |
| `dev/assets/js/warzone-globe.js` | `ensureContourGridPrimitive`, `setContourFocusPosition` | Naval focus used the shared large two-ring grid. Naval rings now use one-third/two-thirds/full radius and 1.05x prior stroke widths. Rebuild the grid when switching asset profile. Aircraft rings unchanged. |
| `dev/assets/css/root.css` | `--warzone-live-naval-contour-grid-radius` | New default 15000 meters; runtime clamps outer radius to 10–15 km. Defaults produce rings at 5, 10, and 15 km. Broader terrain contour radius remains unchanged. |

This task did not add timers, viewer initialization, subscriptions, or new interactive camera listeners.
Pre-existing source-audit, AIS reconnect, satellite focus, camera-follow, max-zoom, and scene-pick changes remain in the dirty worktree; they are not attributed to this patch.

## Tests and generated artifacts

Changed tests:

- `apps/api/test/intel-source-sanitizer.test.js`: original publisher URL assertions.
- `apps/api/test/satellite-context.test.js`: source-hosted observation URLs.
- `apps/api/test/satellite-source-preview.test.js` (new): URL restrictions, exact product resolution, shared request, no bucket fallback.
- `apps/worker/test/focused-asset-geometry.test.js` (new): actual function bodies under lightweight mocks; three naval radii/strokes, telemetry heading including zero, stable trail history.
- `apps/worker/test/reporting-html.test.js`: source preview in render model AND rendered `<img>`, truthful caption, bucket rejection.
- `apps/worker/test/reporting-pipeline.test.js`: existing upload test fixture supplied its canonical date/scope fields.

Checks actually run:

- Changed JavaScript syntax checks: passed.
- `git diff --check`: passed; existing LF/CRLF warnings remain.
- Complete API suite using `node --experimental-test-isolation=none --test`: 39 passed.
- Targeted reporting/geometry suite with `--test-skip-pattern=HTML`: 68 passed. This pattern excluded HTML-titled tests, including browser PDF integration; it was not a full worker-suite pass.
- Subsequent selected reporting suite after satellite HTML changes: 36 passed.
- Final unfiltered `reporting-html.test.js` and `focused-asset-geometry.test.js`: 13 passed, including actual source `<img>` rendering and filesystem HTML output.
- `npm run build`: passed, webpack 5.108.4, final build 307022 ms.
- Final emitted frontend assets include `bundle.715a0024.js`, `reportCapture.bce5b88e.js`, and `style.ff2dd86f.css`. Checked final capture guard, report sizing marker, and naval radius in output.

Build regenerated hashed JS/CSS and HTML references under `production/`; deploy nothing from this work automatically.
The application's local-only HVA fixture also updated the two tracked JPGs and manifest under `.generated/reports/daily/global/2026-08-26/`, and generated local HTML/JSON/PDF there. These are test artifacts, not a published operational report.

## Runtime evidence

- Local API restarted to load server patches; `/health` returned 200.
- `/events/intel-feed`: 120 items, 228 image thumb/full references, zero StratOps proxy references in the sampled response; 30 original publisher/CDN hosts. One publisher image GET returned 200 with `image/jpeg`.
- `/events?window_hours=168&limit=1000`: 520 events, 26 primary images at final check, original publisher/Copernicus hosts. Five events had source-hosted satellite context.
- A resolved Copernicus quicklook GET returned 200 with 123009 bytes. Server content type was `application/octet-stream`; browser decoding is not independently verified.
- The original local-only native HVA fixture generated a 17-page, 3513117-byte PDF with zero failed image loads and two capture files. Visual inspection showed an insufficiently visible aircraft despite a READY result, leading to the final model-pick/sizing guards. Therefore that preliminary PDF is NOT accepted as final successful visual QA.
- Final native capture reruns could not launch Chromium: `spawn EPERM`. Elevated execution was rejected because the approval service reached its usage limit. No alternative process was used to bypass the restriction.
- In-app browser bootstrap also failed with `missing field sandboxPolicy`.

## Limits and remaining activation

- The running ingestion worker was not restarted: it still has its previous imported code. Restart it through the normal local service workflow to activate the new Copernicus/report behavior. The frontend and its current browser session were not restarted.
- Local `REPORTING_SCHEDULE_ENABLED=false` was deliberately retained. Local configuration accesses the shared database; automatically enabling recurring publication would risk a second scheduler. Use one appropriately configured reporting host.
- Manual daily generation now depends on the existing worker pipeline modules being packaged with the API and on its capture/storage configuration. New production publication was not attempted. Weekly legacy behavior is unchanged.
- Previously published text-only reports were not regenerated or deleted. A fresh/forced generation is needed to exercise the corrected path.
- External publisher images and satellite previews use source URLs. Generated StratOps 3D screenshots are necessarily app-created report artifacts; their existing report storage remains. Logos, icons, GLB models, and other native application assets were not moved off-site.
- Direct source images depend on publisher availability/hotlink policies. There is intentionally no automatic StratOps bucket fallback. Copernicus quicklooks cover the source scene and are reduced resolution, unlike the old event-centered generated crop; they must not be described as live or independent event confirmation. Source reference: https://documentation.dataspace.copernicus.eu/APIs/OData.html (Products/Assets quicklooks).
- Final image embedding/rendering in Chromium, final HVA/naval 3D captures, and live aircraft heading/trail appearance remain unverified. Strict model picking may expose additional visibility failures and must be tested before rollout.
- Entry/authentication transitions, viewer/satellite initialization counts, loader behavior, and all nearby layer interactions were not browser-tested. Their lifecycle code was not intentionally changed by this task; this is not a claim of full regression verification.

Next verification requires permission to launch the existing native report-capture Chromium workflow outside the sandbox. Then inspect the new PDF and HVA/naval images, followed by interactive aircraft/naval QA once the in-app browser is usable.
