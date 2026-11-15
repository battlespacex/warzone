# Airplanes.live backend integration, 2026-11-15

The existing adapter was extended; no browser poller, API route, rendering technology, model mapping, GNSS code, camera control or production environment file was changed. Other providers and the staged identification/raster work remain in place. No deployment, AWS change, commit or push occurred.

## Implemented

`apps/worker/src/tracking/aircraft/providers/airplanes-live.js` now supports military discovery, single-point regional discovery, ICAO24 normal/live/last lookups, registration, callsign and octal squawk lookup using the requested `/v2/...` paths. It preserves readsb telemetry, strict complete ICAO24, provider attribution and source observation time through cached responses. Point/lookup results do not get blanket military hints. The military endpoint supplies supported provider evidence, never verified ownership. Last-position lookup is marked historical and is not automatically polled/persisted as live discovery.

Requests use one provider-wide in-flight slot and start interval, identical-request sharing, a 128-entry response cache, timeouts, daily budget, redirect rejection and sanitized errors. Default local policy: 180-second interval/cache and 480 calls per UTC day per process. These are conservative application settings, **not a verified statement of the account's entitlement**. Authorization failures block network attempts for 24 hours; 429 honors Retry-After and exponential backoff. There are no immediate retry loops. The existing provider-health runner continues isolating failures and preserving other providers' observations.

`apps/worker/src/tracking/aircraft/registry.js` wires configuration and disables only this adapter on invalid access configuration. `apps/worker/src/adsb-worker.js` passes optional backend `region` context through the existing provider dispatcher. Registry enrichment, qualification and canonical cross-provider merging remain in the existing worker pipeline; no duplicate ingestion pipeline was added.

Regional discovery accepts `{lat, lon, radius}` in nautical miles, or the existing `{bounds:{minLat,maxLat,minLon,maxLon}}` shape. The adapter uses a conservative enclosing radius and rejects requests exceeding its local 250 NM cap or crossing the dateline. It does not silently tile a large theatre into numerous requests. A backend caller can run `runAdsbWorker({ region: ... })`; normal scheduled ingestion still uses `/v2/mil`. The selected browser region is not automatically sent to the worker in the current architecture. No new browser/server subscription contract was invented. Automatic per-viewer geographic ingestion remains unconnected; the normal frontend continues selecting regional contacts from global canonical data.

## Documentation/access limits

The [published documentation](https://airplanes.live/api-docs/) lists aircraft lookups plus countries, airports and feeder status. Direct documentation retrieval returned HTTP 403 here. A **single** direct `https://api.airplanes.live/v2/mil` request also returned HTTP 403 with a provider message requiring project contact at `contact@airplanes.live`. No authentication workaround, alternate identity or repeated blocked requests was attempted. **No aircraft endpoint returned successfully in live verification.** The earlier 403 is therefore still an access issue; implementation does not confer authorization.

Country/airport/feed paths, query schemas and authentication headers could not be verified from the blocked page. They are deliberately not guessed. The adapter's `reference(path, query)` supports only GET paths and declared query names supplied in an authoritative OpenAPI export. Credentials require an explicit header-apiKey security scheme from that export; no speculative `Authorization` or `X-API-Key` header is installed. These are contract-driven capabilities, not live-verified country/airport/feed integrations. A published export and authorized access are still required to complete/verify those specific bindings. API documentation licensing is not itself permission to commercially redistribute flight observations.

## Activation after access is confirmed

No environment file was edited. In the existing worker's approved environment, use:

```text
AIRPLANES_LIVE_ENABLED=true
AIRPLANES_LIVE_BASE_URL=https://api.airplanes.live
AIRPLANES_LIVE_MINIMUM_INTERVAL_MS=180000
AIRPLANES_LIVE_CACHE_TTL_MS=180000
AIRPLANES_LIVE_TIMEOUT_MS=15000
AIRPLANES_LIVE_DAILY_BUDGET=480
```

If the provider supplies an authorized key and its authoritative OpenAPI export, configure backend-only `AIRPLANES_LIVE_OPENAPI_FILE` and `AIRPLANES_LIVE_API_KEY`. Without the matching published header scheme, configuration is rejected and this provider is disabled. Do not expose those values in frontend configuration. Review account/IP-wide quota across all processes; these budgets and caches are process-local. A higher-frequency authorized plan must use appropriate interval and daily-budget values. Slow public discovery does not guarantee continuous freshness; other existing feeds remain independent.

Ship the changed worker source with the existing shared identity modules and bundled 9,854-record registry/manifest, then restart only the actual existing worker through the authorized release process. **The prior integration archive predates these adapter changes and must not be treated as the updated worker release.** No API or frontend restart is required for these backend changes. In a controlled authorized test, request military discovery once, inspect status/counters and source timestamps, then enable normal scheduling. Do not probe every route after an initial 403. Configure a single bounded geographic request through the backend caller only where the provider permits it; large-region coordination requires a separately reviewed request plan.

## Verification

`apps/worker/test/tracking-airplanes-live.test.js` adds six fixture-based tests for the eight aircraft paths, timestamps/strict IDs, cache/dedup/global budget, 403/429, regional discovery and registry enrichment through the real worker, cross-provider deduplication, contract-only reference/authentication behavior and invalid-configuration isolation. Fixtures follow the readsb aircraft envelope used by the existing adapter; reference/auth examples are explicitly test-only contracts, not claimed production endpoints.

The aircraft/provider regression group passed **101 tests**. The full worker run has **666 tests: 614 passed, 52 failed**, matching the existing failing-name baseline. The production build passed in **141,633 ms**, redirected to isolated output. Local gates verified **392 Cesium assets, 24 JS/CSS assets and 64 GLBs**. The six new tests also passed independently after the final bounds validation change. Live authorized success, actual geographical coverage, reference/feed schemas and browser visual acceptance remain unverified. Evidence is under `.generated/airplanes-live-20261115/`. Existing unrelated `production/` output changes observed during the task were left intact.
