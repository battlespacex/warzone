# Source audit: 9 September 2026

## Result and operational blocker

The configured upstream ADS-B.lol, OpenSky, AISStream and Fintraffic feeds returned live data. The deployed API responded, but its aircraft data and the connected production database were stale. At the 23:56 UTC follow-up, the newest aircraft update was **09:17:03 UTC** and the newest naval update was **09:17:14 UTC**. None of the latest 1,000 aircraft rows or all 881 naval rows had an observation within 45 minutes. Intel ingestion last fetched at 09:09 UTC.

This establishes a shared ingestion/persistence gap, not its exact infrastructure cause. The worker host/process and its logs must be checked. Starting another worker against the same database was deliberately avoided because the deployed worker's state is unknown. No ingestion jobs, database updates, deployment or restart were performed during the audit.

Seven verified RSS definitions were enabled in this checkout. They require the running worker to load the updated files. The deployed database source registry still listed France24 and Arab News as disabled during the read-only follow-up.

## Tracking providers

| Provider | Live probe result | Configuration action |
| --- | --- | --- |
| ADS-B.lol | 231 observations; 166 fresh valid military positions | Already enabled |
| OpenSky | Authenticated; 9,324 observations, 9,203 fresh positions, six direct military hints; remaining states need existing military qualification | Already enabled |
| Airplanes.live | HTTP 403 from the configured endpoint | Retained existing setting; worker backoff handles failures |
| ADS-B One | HTTP 403 from the configured endpoint | Retained existing setting; worker backoff handles failures |
| ADS-B Exchange | No API key configured | Remains disabled |
| Plane Alert database | 9,854 military identity records fetched | Already enabled; identity enrichment only |
| SkyLink | A candidate lookup returned identity data; response reported zero upstream quota remaining | Already enabled; its quota guard can suspend further lookups |
| AISStream | 15-second probe: 1,844 valid fresh positions; 60-second probe: 4,898 candidate observations | Already enabled |
| Fintraffic | 15-second probe: 332 fresh positions; 60-second probe: 413 candidates | Already enabled; Finnish coastal coverage |
| VesselAPI | Candidate identity lookup succeeded; quota remaining 60 | Already enabled; identity enrichment only |
| OpenAIS | User-operated endpoint missing | Remains disabled |
| MarinePlan | API key and area missing | Remains disabled |
| AISHub | Membership username missing | Remains disabled |
| Spire AIS | Customer token and product endpoint missing | Remains disabled |
| MarineTraffic | Customer key and product endpoint missing | Remains disabled |
| VesselFinder | Customer API key missing | Remains disabled |

The 60-second naval check used `runAisWorker()` with all four persistence operations replaced by no-ops. It processed **5,311 raw observations**, **5,306 valid positions**, and **16 military-qualified canonical tracks**: 15 AISStream and one Fintraffic. It produced **zero duplicate track keys** and rejected civilian/non-operational candidates through the existing filter. Nothing from that sample was inserted into the database.

Local and production tracking credential values matched where both were present. The local file omits several settings that use registry defaults. No credentials were printed or changed. The two identity probes used the existing quota/cache stores and consumed at most one lookup each.

## Re-enabled sources

| Registry | Source | Evidence |
| --- | --- | --- |
| sources.json | France24 International | Valid RSS, 23 recent articles |
| sources.json | Arab News | Valid RSS, 50 recent articles |
| conflict-sources.js | Indian Defence Research Wing | Valid RSS, 30 recent articles |
| conflict-sources.js | France 24 English | Valid RSS, 23 recent articles |
| conflict-sources.js | Defense One | Valid RSS, 21 recent articles |
| conflict-sources.js | Middle East Monitor | Official article RSS, 50 recent articles |
| conflict-sources.js | Al-Monitor | Valid RSS, 20 recent articles |

Existing filtering thresholds were retained. Reachable RSS is not a promise that every item qualifies for the operational map. The old disabled reasons were replaced with dated verification notes. France 24 appears in two independent ingestion registries; this is seven definitions for six publications.

## Remaining source checks

The inventory covered **224 source definitions**: 93 primary feeds, 119 conflict-registry entries and 12 status entries. One `_comment` object in `sources.json` is not a source. Of 172 RSS definitions, 147 returned nonempty RSS, two were empty, ten returned HTML, eight failed with an HTTP error, and five failed on DNS, TLS, parsing or timeout. Repeated URLs were fetched once. These are definition counts, not unique publishers. Some nonempty feeds are stale.

- CISA KEV: 1,703 records. NASA FIRMS: 380 thermal records. USGS: 36 events. UCDP: 100 records from its configured historical dataset. These record counts do not imply current military events.
- Cloudflare Radar returned an outage record. Copernicus authenticated and returned a recent catalog feature. This checks catalog access, not image generation, S3 upload or report captures.
- GDELT returned records for three queries; six others returned 429. Existing running jobs may share the same rate limit. Disabled duplicate GDELT definitions were not enabled.
- OONI incidents returned 67 records; the separate network-observation request timed out. IODA's configured API root did not return usable JSON records.
- Five Reddit feeds and the Oref siren endpoint returned 403. ACLED authentication failed on DNS resolution. The configured seed endpoint refused the connection.
- X lacks its bearer token. Manual siren/airspace feeds lack URLs. Aviation Edge lacks its configured NOTAM URL; the NOTAM worker lacks SkyLink RapidAPI or FAA credentials.
- The existing Telegram session was authorized. Twenty-two of 33 distinct configured channels returned a message, one returned no messages, and ten attempts encountered flood limiting. Several successful channels had old posts. Flood-limited channels are unverified, not proven dead. No messages were sent or marked read.
- The existing Middle East Eye live parser returned 15 relevant items. The Intel Slava public-preview parser returned 18 items, one relevant.
- ReliefWeb reports returned 403. GDACS returned 348 RSS items but its conflict-registry entry is a disabled API candidate without an integrated adapter. NewsAPI/Event Registry and status stubs are not usable merely by flipping their flags; configured adapter/credential requirements remain unmet.
- Enabled feeds needing attention include Janes (404), EurAsian Times/Defense Advancement (403), Homeland Security News Wire (TLS failure), Radio Free Europe (parse failure), ReliefWeb disasters (406), and Air Force news (timeout). Some feeds, including Jerusalem Post, Oryx, CSIS and DSCA, returned old or undated items. Navy.mil returned no items in this sample. Existing enabled flags were not disabled based on a single probe.

The seven tested deployed GET routes returned JSON successfully: health, aircraft, events, Intel Wire, airspace status, alerts and military satellites. The satellite route returned 24 satellites. HTTP success does not establish data freshness, database write access, authentication-flow correctness or map visibility.

## Evidence and verification

Sanitized per-source results are saved under `.generated/source-audit/2026-09-09-production-*.json`: `providers`, `feeds`, `services`, `telegram`, `naval`, and `followup`. The first service pass used an incorrect diagnostic column for `source_registry`; the follow-up corrected it to `source_name` and confirmed 93 rows, 85 enabled. The first pass also classified some non-RSS entries generically; specific follow-up adapter results supersede those classifications.

`apps/worker/src/source-audit-once.js` is an opt-in audit command, not part of worker startup. It issues read requests, prints sanitized summaries, and writes local reports. The `providers` mode uses existing enrichment quota/cache stores; the `naval` mode disables database persistence explicitly. Future Telegram/GDELT runs stop further requests after rate limiting.

Existing source/health/normalization/merge tests: **61 passed**. JavaScript syntax checks passed. `npm run build` passed (webpack 5.108.4, 259620 ms), producing the same frontend asset hashes as before this source-only change. UI/onboarding flows were not exercised because these changes concern worker source configuration.

Changed implementation: only source definitions in `sources.json` and `conflict-sources.js`; no production worker function was changed. The existing France 24 test was updated to reflect the verified enabled state. The audit command and this report were added for reproducibility.
