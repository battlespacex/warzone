# Aircraft focus details, naval AIS and provider licensing audit

Investigated on local `main` at `13f98b3a`, 2026-11-09. Continued after the interrupted session. Earlier Cesium delivery changes and subsequent local CSS, naval-card, focus-label and `Alternative` edits were preserved. No commit, push, deployment, credential change, subscription purchase or database write was performed for this investigation.

## Findings

**Gulf zero count: missing regional input is confirmed in the sampled pipeline; the upstream reason is still unknown.** The database queried with the local worker's configuration contained 1,852 global naval tracks with current updates, but zero tracks within latitude 22–32 / longitude 47–60. The local files may refer to a shared database; these results do not establish which deployed process wrote those rows.

The existing local AISStream credential worked. A 15-second global sample confirmed the subscription and compression and received 934 frames, 933 AIS messages, 555 normalized positions, and no positions in those Gulf bounds. A separate 15-second Gulf-only subscription was accepted but received no AIS data messages. A local Fintraffic sample received 666 messages and 357 normalized vessel positions, with zero malformed/invalid positions and no Gulf contacts. Fintraffic's service covers Finnish waterways, so it is not a Gulf coverage fallback. These short samples do not prove a regional outage or determine why contacts were present days earlier. Evidence files are under `.generated/aircraft-naval-20261109/`.

The tracker is intentionally military-qualified. Ordinary civilian vessels are excluded unless existing qualification rules establish a military contact. Those rules were not relaxed. No simulated vessels were inserted. No evidence justified replacing a provider or changing credentials.

Historical recording was disabled in the checked local worker configuration (`NAVAL_PRIVATE_HISTORY_ENABLED` was not true). Public AIS signals are bounded to 24 hours; private historical/archived access remains server-side and premium-gated. Old contacts cannot be restored by relabelling them live or enabling a public history fallback. The absence of public old contacts is not evidence that the current renderer is deleting valid live positions.

## Aircraft changes

- Existing compact cards keep their keyed DOM, title/type, focus action and compact telemetry presentation. Focusing expands the selected card's technical section; Collapse/Expand changes only its details. Another selection collapses the old card. Local edits that hide blocked focus actions and customize card styling were retained.
- Technical fields come from existing ADS-B records: callsign, valid six-character ICAO address, registration, model/type code, reported operator, barometric/geometric altitudes, speed, ground track, true/magnetic headings, vertical-rate references, source, position observation time, receipt/update times and contact state. Missing values remain `N/A`/`Unavailable`; reported zero is valid. Unknown operators are not invented from nationality or aircraft type.
- Ground track is labelled `TRK`; true and magnetic headings have separate labels. A legacy renderer direction without a known reference is not presented as a measured heading. The existing movement direction field is unchanged.
- Worker readsb/OpenSky normalization retains the additional fields. Worker event/track JSON metadata carries the telemetry; the browser's direct ADSB.lol adapter retains it as well. This adds no enrichment request or per-user polling.
- Missing direct-feed barometric altitude no longer becomes a fabricated zero. History-row normalization preserves null telemetry values. Display logic prefers the recorded measurement over renderer/interpolation defaults.
- Source observation time and receipt time are distinct. The technical state marks source observations older than the existing 90-second aircraft stale threshold as stale even if a record was just received.
- The existing model-anchored focus panel uses shared telemetry formatting and its existing camera/screen anchor; no new floating widget was introduced. The current locally edited map label remains compact, showing speed/altitude with the existing map-mode and Unlock controls. Full map-label Details/Close controls from the original request were removed in intervening local edits and have not been restored over those edits. This is a remaining scope decision; the expanded tracker-card details are implemented.

The expanded map-label UI, anchoring at different viewport sizes and actual tracking/collapse interactions still need browser verification. Source/Node tests do not establish the visual result.

## AIS flow and filtering

1. The singleton worker creates providers from `tracking/naval/registry.js`; `naval-live-poller.js` runs bounded, non-overlapping cycles, normally every five seconds.
2. AISStream maintains one server-side WSS session with compression, bounding boxes and accepted message filters. Static identity and position reports are joined by MMSI. Fintraffic maintains an MQTT-over-WSS subscription and joins location/metadata records. Provider caches retain observations between reads.
3. `runConfiguredProviders` isolates failures and applies existing backoff. `mergeNavalObservations` deduplicates reliable MMSI/IMO identities and chooses plausible fresh positions rather than averaging them. `qualifyMilitaryVessel` retains existing military/civilian/non-operational rules.
4. `runAisWorker` upserts events, tracks and existing history contracts. Empty provider results do not issue a blanket deletion of old persisted contacts. The private history writer runs only when configured. This task did not start the worker or invoke persistence against the database.
5. The API delivers public signals through the existing event/map routes, bounded by public AIS age rules. Private `/events/naval/history` and `/events/naval/history/:assetKey/positions` require session/plan authorization. The browser consumes event/API/realtime changes and maintains its own naval registry and Cesium rendering.
6. Contact states use the unchanged source-time thresholds: Live through 15 minutes, Delayed through one hour, Last known through 24 hours, Historical through seven days, Archived thereafter. Recent includes the first three. All, Historical and Archived can require the protected history data source. Counts are computed after region, search, type and selected-state filtering.

A WebSocket opening alone is not proof of valid AIS receipt. Likewise a healthy global feed does not establish Gulf coverage. Existing reconnection/backoff and cache-retention behavior was tested; no arbitrary retries or synthetic contacts were added.

### Development-only diagnostics

The view exposes provider enablement/connection state, subscription/compression, message and valid-position counts, cached contacts, last AIS-message time, last provider error and reconnect attempts where the provider supports them. Client data separately shows region contacts, search/type/state exclusions and live/delayed/last-known/historical/archived counts, plus current renderer diagnostics. A successful socket open does not set the last-message timestamp.

The frontend module is imported only by the development entry. The worker endpoint `/diagnostics/ais` requires `NODE_ENV != production`, `STRATOPS_DEV_DIAGNOSTICS=true`, and a loopback peer. Production requests receive 404. Returned fields are explicitly selected; no API keys, provider configuration, raw observations or database credentials are returned. The view makes one local request on opening/manual Refresh and starts no provider connection or polling timer.

To use it with an already approved local worker setup:

```powershell
# Set before starting your normal local worker; starting that worker still performs its normal ingestion writes.
$env:STRATOPS_DEV_DIAGNOSTICS = 'true'
# Start the worker through your existing workflow, then the development frontend.
# If its health port isn't 3000, set this before starting the frontend:
$env:STRATOPS_AIS_DIAGNOSTICS_URL = 'http://127.0.0.1:YOUR_WORKER_PORT/diagnostics/ais'
```

In the localhost browser's developer console:

```js
window.__showWarzoneNavalDiagnostics()
```

Do not set the diagnostic flag on production or proxy this route publicly. The checked worker port was 3000; no live local worker diagnostic endpoint was restarted or enabled during this task.

## Provider inventory and licensing

These are the **checked configuration files**, not a remote production configuration dump. Unless noted, live production provider connectivity is unverified. Public endpoints were probed from this execution environment, which may have different IP/WAF routing than EC2. An API key's presence does not establish a paid subscription or commercial permission.

| Provider / endpoint in code | Role and checked configuration | Local evidence | Commercial use / license and restrictions |
| --- | --- | --- | --- |
| ADSB.lol `https://api.adsb.lol/v2/mil` | Enabled worker provider and browser's existing public military feed; enabled in both checked worker files | HTTP 200, 459 aircraft in the sample | [Official API license](https://www.adsb.lol/docs/open-data/api): ODbL 1.0. Commercial use is possible under its terms, with attribution and applicable database share-alike/access obligations. Contact for production coordination is requested by its API documentation; free access is not a proprietary redistribution grant. |
| Airplanes.live `https://api.airplanes.live/v2/mil` | Enabled additional worker source in both checked files | HTTP 403 from this execution environment; cause not identified | [Official API guide](https://airplanes.live/api-guide/) was inaccessible (403); [official About page](https://airplanes.live/about/) is not a commercial data license. Written clarification of paid-SaaS display, retention and redistribution is needed before relying on it. No claimed commercial license verified. |
| ADS-B One `https://api.adsb.one/v2/mil` | Enabled additional worker source in both checked files | HTTP 403 in the sample | [Official FAQ](https://adsb.one/faq) documents API availability, not a sufficiently explicit paid-SaaS data grant in the material checked. Obtain permission/terms covering your use. No assumption that public access permits resale. |
| OpenSky `https://opensky-network.org/api/states/all`, OAuth token endpoint | Enabled additional worker source, credentials present; configured interval 15 minutes | No live authenticated call made; token-expiry/401 retry tested with fixtures | [Official terms](https://opensky-network.org/about/terms-of-use) require a written license for commercial entities and operational REST API integration. Sharing/redistribution and identifiers have additional restrictions; a free account or functioning OAuth token is insufficient. |
| ADS-B Exchange configured `/v2/mil` through its adapter | Local enable flag true but no local key was found; production file disables it and has an empty key; effectively unavailable in those files | Not probed with credentials | [Official commercial-use policy](https://support.adsbexchange.com/hc/en-us/articles/37363886073613-I-m-building-a-project-for-my-company-but-we-aren-t-making-money-off-of-it-can-I-get-a-free-API-key): commercial entity projects require a commercial API license, including internal use. Obtain contract-specific display/caching/redistribution rights before enabling. |
| Plane Alert DB `https://raw.githubusercontent.com/sdr-enthusiasts/plane-alert-db/main/plane-alert-mil.csv` | Enabled by default for static identity enrichment; explicit production-file enablement. Not a live-position provider | No new download needed for this task; enrichment path reviewed/tested | [Official license](https://github.com/sdr-enthusiasts/plane-alert-db/blob/main/LICENSE): ODbL 1.0 database, DBCL for individual contents. Preserve required notices and satisfy applicable derivative-database terms. Not a grant to use unrelated aircraft photos. |
| SkyLink `https://data.skylinkapi.com/v3.1/aircraft/icao24/{hex}` | Enabled, key present; budgeted static identity enrichment/cache, not a default replacement live feed | No quota-consuming enrichment request made | [Official terms](https://skylinkapi.com/terms/): paid-plan commercial end-user display and reasonable performance caching are permitted; Free Trial is non-commercial. Raw-feed resale/replicating databases are restricted; multi-tenant resale needs a separate agreement. Confirm that StratOps's actual subscription and use qualify, including third-party attribution and restrictions on tracking identifiable individuals. |
| AISStream `wss://stream.aisstream.io/v0/stream` | Enabled primary global AIS stream, existing key present; both checked files | Global WSS/subscription/compression and valid messages verified; Gulf-only sample accepted but empty | [Official documentation](https://aisstream.io/documentation) describes free streaming, connection limits, backend-only use, compression and no durable replay/SLA. No explicit paid-SaaS/redistribution license was established from the official material checked. Obtain written confirmation of display, persistent storage and history rights. Do not equate a free key with commercial permission. |
| Fintraffic/Digitraffic `wss://meri.digitraffic.fi:443/mqtt` | Enabled independent AIS source; Finnish coverage | Connected; 357 normalized positions, no invalid/malformed records in sample | [Official terms](https://www.digitraffic.fi/en/terms-of-service/): CC BY 4.0 permits commercial reuse with attribution, license link, change indications and preserved notices/disclaimers. [Marine coverage](https://www.digitraffic.fi/en/marine-traffic/). No separate paid contract is required merely for compliant reuse. |
| VesselAPI `https://api.vesselapi.com/v1/vessel/{mmsi}` | Enabled budgeted enrichment, key present; configured five-hour minimum interval and 150/month budget. Not an area-wide Gulf discovery fallback | No quota-consuming lookup made | [Official terms](https://vesselapi.com/terms-and-conditions), section 5: internal-use license; sharing requires consent, with restrictions on mirroring, similar services and public raw-data display. Obtain express SaaS/customer-display and retention consent; a paid tier alone does not establish that consent. A section announced for 2026-12-07 was not treated as already effective on the investigation date. |

Registered but disabled/unconfigured naval adapters were also traced: AISHub (`data.aishub.net/ws.php`, username required), Kystverket (`kystdatahuset.kystverket.no/ws/api/ais/realtime/geojson`), BarentsWatch (`live.ais.barentswatch.no/v1/latest/combined`, OAuth), OpenAIS (deployment-specific OGC collection URL), MarinePlan (`ais.marineplan.com/location/2/locations.json`), Spire (contract-specific URL/token), MarineTraffic (contract-specific URL/key), and VesselFinder (`api.vesselfinder.com/vessels`, key). They were not silently enabled as Gulf substitutes. Their contract/data-source-specific commercial rights were not established. ADSB.fi is registered but disabled and separately license-gated by `ADSB_FI_LICENSE_APPROVED`; [its official site](https://adsb.fi/) saying open access is not sufficient evidence of this application's commercial license.

All worker providers are priority-ordered and merged when enabled/eligible; they are not simply contacted only after the preceding source fails. Identity enrichers have separate caches, cadence and request budgets. Connection state/quota availability can make an enabled entry inactive at runtime.

### What StratOps needs before monetization

1. Verify an OpenSky written commercial/operational agreement, or obtain it if absent. Do not assume a configured client ID establishes one.
2. Obtain VesselAPI's explicit consent for the actual customer-facing display/history use before exposing its data; its general subscription license is internal-use.
3. Verify a paid commercial SkyLink plan and whether your intended SaaS constitutes restricted multi-tenant resale. Respect its source attribution and use restrictions.
4. Get explicit commercial/display/storage terms for AISStream, Airplanes.live and ADS-B One where the checked public material does not establish permission. No provider was disabled or contacted automatically.
5. Implement/audit attribution and applicable share-alike/database-access obligations for ADSB.lol and Plane Alert DB, and Fintraffic CC BY notices. [ODbL text](https://opendatacommons.org/licenses/odbl/1-0/) distinguishes produced works, collective databases and derivative databases; it does not automatically require publishing all StratOps application source. The actual merged database/use must be reviewed.
6. A commercial ADS-B Exchange agreement is relevant only if you enable/use that source. Disabled providers do not by themselves create a requirement to purchase every subscription. No paid coverage purchase is justified solely by the Gulf zero count without first confirming coverage and rights.

This audit identifies published provider terms and unresolved contract questions; it does not establish that existing private agreements are absent or provide a legal clearance for launch.

## Files changed for this task

| File | Changed functions / purpose |
| --- | --- |
| `dev/assets/js/warzone-aircraft-telemetry.js` (new) | `getAircraftTelemetry`, `renderAircraftTelemetry`, numeric helper: shared factual formatting, missing values and stale observation labelling |
| `dev/assets/js/essential.js` | `normalizeAircraftHistoryRow`, `updateAircraftWidgetCard`, existing selection/click handlers and `requestNavalWidgetRender`: selected technical details, collapse state, null preservation and dev filter counts |
| `dev/assets/js/warzone-live-airforce.js` | `ensureLiveTrackOverlayRoot`, `syncLiveTrackFocusOverlay`: existing anchored compact panel consumes shared reported data and viewport clamping; preserves intervening compact-layout edits |
| `dev/assets/js/warzone-air-ingestion.js` | `normalizeAirplanesLiveRecord`: retain actual raw telemetry and observation age, preserve null altitude |
| `apps/worker/src/tracking/aircraft/providers/readsb.js` | `normalizeReadsbAircraft`: retain track/true/magnetic heading, geometric altitude and referenced rates |
| `apps/worker/src/tracking/aircraft/providers/opensky.js` | OpenSky normalization: keep ground track as its own field |
| `apps/worker/src/adsb-worker.js` | `toLegacyAircraft`, `buildAdsbEvent`, `buildAdsbTrack`: carry factual telemetry in JSON metadata without adding requests/schema changes |
| `apps/worker/src/tracking/naval/providers/aisstream.js` | Diagnostic counters/timestamps/error redaction and `getDiagnostics`; stream selection/qualification and cache behavior unchanged |
| `apps/worker/src/tracking/naval/providers/fintraffic.js` | Read-only `getDiagnostics`; MQTT and cache behavior unchanged |
| `apps/worker/src/naval-diagnostics.js` (new), `apps/worker/src/index.js` | Guarded local diagnostic serialization/endpoint, existing worker health server retained |
| `dev/assets/js/warzone-naval-diagnostics.js` (new), `warzone-development-entry.js` | Manually refreshed development-only diagnostic dialog |
| `webpack.config.js` | Development-only loopback proxy for the diagnostic endpoint; earlier Cesium/API-base changes preserved |
| `apps/worker/test/aircraft-technical-details.test.js` (new) | Actual formatter/card/diagnostic tests with isolated fixtures |
| `apps/worker/test/tracker-widget-stability.test.js` | Load the new actual formatter dependency into its existing isolated browser fixture |
| This report | Findings, evidence, license sources and outstanding checks |

CSS, `warzone-live-naval.js`, `Alternative/` and rollback-copy edits visible on resumption were not authored or overwritten by this continuation. The current naval card's expansion behavior is an intervening local change. GNSS, radar, AOI, orbital intelligence and real/decorative satellite logic were not modified for this task. Earlier delivery work in package/build/deploy/API-base files remains in the working tree.

## Validation and remaining checks

- Targeted Node tests: **25 passed**, covering the new formatter/keyed-card state, end-to-end worker metadata through mocked persistence, AIS diagnostics, existing AIS normalization/backoff, naval age states, Fintraffic and aircraft label allocation. These are not browser visual passes.
- Broader provider/worker/focus/history/resource regression set: **84 passed**.
- Model-selection test file: 2 passed / 2 failed because its isolated context omits `normalizeAircraftRenderMode`. Running the same test against the `HEAD` aircraft source reproduced those two failures; model resolution was not changed to mask them.
- Widget stability file: scheduler test passed; browser test could not launch Chrome (`spawn EPERM`). No successful browser validation of appearance, anchoring, focus/unfocus, map-mode or CSS behavior is claimed.
- Production build **passed** (`npm run build -- --config .generated/aircraft-naval-20261109/webpack.config.cjs`, 108,623 ms). **17 JavaScript syntax checks passed**, and **392 Cesium assets verified**. Production output was isolated rather than overwriting checked-in production artifacts. Logs are under `.generated/aircraft-naval-20261109/`.
- Git whitespace checks identify three pre-existing-on-resumption trailing-space lines in the locally edited `warzone-live-airforce.js`; those local formatting edits were not cleaned up as unrelated work.
- API health at `https://api.battlespacex.com/health` returned HTTP 200 during the original read-only sample. That verifies API availability, not production AIS ingestion, private history/RLS, provider connectivity from EC2 or the rendered Gulf count. Local HTTP ports 8080 and 3001 refused connections in that sample.

Next steps: run the actual local browser flow with the worker/frontend running; check selected-card expansion, Collapse without Unlock, switching selection, zero/missing telemetry, map label anchoring, current local CSS and naval filter counts. Use the dev view to correlate provider message time with region/state exclusions. Ask AISStream about coverage for the exact Gulf bounds/time and compare longer continuous existing-worker samples; do not infer all vessels are absent from a short quiet window. Confirm the deployed worker's environment, provider health and database independently. Check historical endpoints with authorized premium accounts and verify SQL/RLS/migrations before claiming historical recovery. No public fallback or automatic history enablement was introduced.
