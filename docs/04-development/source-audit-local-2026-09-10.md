# Local source and API verification — 2026-09-10 UTC

Checked around 01:00–01:05 UTC (September 9 evening in Toronto). This supplements `source-audit-2026-09-09.md`; it does not replace the earlier all-source inventory. Counts are time-specific samples, not permanent totals.

## Outcome and local startup issue

The existing worker and frontend were running, but the local API on port 8080 was not. The development proxy tries localhost:8080, localhost:3000, an optional configured upstream, then the hosted API. Consequently, a successful frontend `/api/health` response did not establish that a local API was running.

Started the missing API with `NODE_ENV=development`, `PORT=8080`, and `node src/index.js` from `apps/api`. No second worker was started; no existing service was restarted. Final listening processes: API 25260 on 8080, worker 29000 on 3000, frontend 24416 on 4173. Direct `localhost:8080/health`, the frontend page, and frontend API requests now return HTTP 200.

The local environment uses the configured remote Supabase database, not an isolated local database. Database checks were read-only. Provider probes did not persist observations or change provider flags. Existing worker ingestion continued running.

## Tracking verification

| Local-config provider probe | Result |
| --- | --- |
| ADS-B.lol | 290 observations; 214 fresh positions |
| OpenSky | 8,342 observations; 8,230 fresh positions; these include civilian aircraft before military qualification |
| AISStream | 1,702 fresh positions |
| Fintraffic | 324 fresh positions |
| Airplanes.live | HTTP 403 |
| ADS-B One | HTTP 403 |
| ADS-B Exchange | Missing configuration/key; remains disabled |
| OpenAIS | Missing base URL; remains disabled |
| MarinePlan, AISHub, Spire, MarineTraffic, VesselFinder | Missing credentials/configuration; remain disabled |

Disabled tracking providers were instantiated with enable flags forced only in the diagnostic process. No unusable provider was enabled in configuration. Paid identity-enrichment lookups were not repeated in this local pass; see the prior audit for Plane Alert, SkyLink and VesselAPI results/quotas.

The local aircraft API returned 1,000 retained tracks. The later sample contained 348 observations within 45 minutes; provenance in `metadata.sources` was `adsb_lol` and `opensky`. Its newest update advanced from 01:00:06 to 01:02:53 UTC during verification. There were zero duplicate track keys in the 1,000-row database sample.

Important existing labeling issue: `buildAdsbEvent()` and `buildAdsbTrack()` in `apps/worker/src/adsb-worker.js` use the literal source label `ADS-B One / Military`. That label does **not** prove ADS-B One is receiving data. Actual provider provenance is in metadata. This verification pass did not change the label.

The naval database sample contained 883 retained tracks, 124 with observations within 45 minutes, and zero duplicate track keys. Fresh sources included AISStream, Fintraffic, and merged multi-source AIS.

The local events API returned 484 naval map-event rows; a later sample had 127 observations within 45 minutes and a newest observation at 01:03:02 UTC. There were zero duplicate event keys and zero repeated MMSIs. The frontend `/api/events` endpoint also returned 484 naval rows. These are API-delivered map candidates, not proof of visibility in a particular region or of rendered Cesium entity counts.

## Local routes and media

All of these direct local GET checks returned HTTP 200:

- `/health`: healthy JSON.
- `/events/aircraft`: 1,000 retained tracks.
- `/events?window_hours=168&limit=1000`: 519 total events, including 484 naval events.
- `/events/intel-feed`: 120 items.
- `/events/airspace-status`: zero rows; success does not mean live airspace coverage.
- `/events/alerts`: 1,000 rows; freshness was not independently established.
- `/events/gnss-interference`: zero cells; not proof of live GNSS coverage.
- `/satellites/military`: 24 satellite records.
- `/stratops/reports`: zero currently listed reports under the default scope/type.

The local WebSocket connected at `/ws` and received `hello`. The event response included 25 primary images and five events marked satellite-available. Two sampled event-image HEAD requests returned HTTP 200 with `image/jpeg`. This does not verify satellite imagery bytes, report captures, or visual rendering.

The database held 24 report rows: nine available, one failed, fourteen expired. The latest row's period started August 26, 2026. The public report list also filters retention, version, scope/type and artifact availability. No report was generated or uploaded during this verification, and an empty list alone does not isolate which filter excluded each row.

## Re-enabled feed ingestion

The worker source registry now has 93 rows, 87 enabled (previous audit: 85). France24 and Arab News are both enabled. IDRW, Middle East Monitor, and Al-Monitor have new conflict-feed ingestion timestamps around 00:59–01:00 UTC.

`france24-en` still had an older August 10 row; `defense-one-all` had no stored conflict-feed row in the check. Their upstream RSS responses were verified in the earlier audit, but fresh persisted conflict items from those two source IDs are not confirmed. Relevance filtering and duplicate-article handling can legitimately prevent a new row; no speculative filtering change was made.

## Tests, failures and limits

`node --test --test-reporter=spec test/*.test.js` in `apps/api`: **36 passed, zero failed**.

The same command in `apps/worker`: **284 tests, 275 passed, nine failed**:

1. `dev-visual-inspection.test.js`: entry-tuner source assertion mismatch.
2. `event-marker-visual-quality.test.js`: expected perspective-squash CSS declaration absent/mismatched.
3. `hotspot-anchoring.test.js`: `getComputedStyle` undefined in the test environment.
4. `intelligence-normalizer.test.js`: explicit-coordinate acceptance assertion.
5. `intelligence-normalizer.test.js`: generic event display-fallback assertion.
6. `radar-sweeper.test.js`: radar/hotspot stacking assertion.
7. `report-html-viewer.test.js`: thumbnail CSS source assertion mismatch.
8. `reporting-pipeline.test.js`: fixture lacks a canonical report date.
9. `tracking-vesselapi-provider.test.js:160`: recreated-provider interval-block assertion returned undefined instead of true.

The VesselAPI test uses a fixed August clock while state saving normalizes against the real current month; this warrants a dedicated clock-consistency check before attributing it to live request cadence. No quota logic was modified in a verification-only pass. Other failures likewise remain open, not automatically dismissed as stale tests.

Syntax checks passed for the source-audit command, conflict registry, AISStream provider, globe, live-aircraft and military-satellite JavaScript. `git diff --check` passed, with existing LF/CRLF warnings. The source-change build in the immediately preceding audit passed (`npm run build`, webpack 5.108.4, 259620 ms); no application code changed in this local verification pass, so that build was not repeated.

In-app browser bootstrap was attempted but failed with `codex/sandbox-state-meta: missing field sandboxPolicy`. Therefore viewer/satellite initialization counts, map visibility, camera anchoring, region-popup behavior, maximum-zoom appearance, authentication, onboarding transitions, and report-image rendering remain visually unverified.

## Changes in this continuation

Only this documentation file was added. No application function, source configuration, styling, or production deployment was changed. The local API was started and left running. Earlier source changes and unrelated dirty-worktree changes were preserved.
