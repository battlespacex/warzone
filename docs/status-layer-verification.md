# Status, layer admission and Intel Wire correction (2026-10-28)

Working copy: `C:\DX\warzone-recovery`. No deployment or database writes performed.

## Root causes and changes

- Tracker priority ran on a tracker OFF-to-ON transition only. Individual setters, bulk/section operations and delayed dependency approvals could subsequently re-enable incompatible layers. Admission now rejects those individual requests before mutation; bulk transitions normalize the entire state before persistence/notifications. Existing base-layer exceptions and Airspace-with-Air compatibility remain intact. Both trackers remain compatible. Existing confirmation and premium checks remain.
- GNSS `upsertEntities` referenced `layerEnabled`, a local of its caller. Data-source attachment now runs in `renderGnssInterferenceLayer` on every visibility transition, including unchanged-data reactivation. Entity construction, grounding and picking remain unchanged.
- Intel Wire reset its loaded count on every data-signature change. Only explicit filter changes now reset pagination. Keyed cards remain mounted, inserted articles extend the loaded boundary, duplicate IDs are suppressed, removed/corrected records reconcile, and the visible reading anchor is restored. A disappearing country option no longer resets the selected filter. Initial/load-more increments are 12.
- The worker's `status_feed_items` table was not consumed by either status widget; widgets read only event/alert-derived records. Official aviation sources were disabled, generic vulnerability advisories were correctly excluded from operational-disruption filtering, and the status worker admitted publications up to 180 days old. A bounded public status endpoint now exposes sanitized status records. Existing refresh/polling hooks are reused, with one in-flight status request and a 15-minute frontend feed TTL; OFF does not add status-feed polling. Existing operational event statuses expire after 24 hours (airspace) or seven days (cyber). Unknown severity no longer becomes normal in the writer.

## Free sources and limits

| Source | Contract, access and coverage | Refresh/fallback |
| --- | --- | --- |
| FAA NAS Status | Public US government XML; no key or fee. US airport restrictions/delays, **not** worldwide NOTAM coverage or a statement that an entire country's airspace is closed. Original reason, exceptions and start/reopen strings retained. | Primary `https://nasstatus.faa.gov/api/airport-status-information`; fallback `https://www.fly.faa.gov/flyfaa/xmlAirportStatus.jsp`. 15-minute worker cache; snapshot must be within six hours; public records become stale after one hour without retrieval. |
| CISA KEV | Public CC0 database, no key or fee. Vulnerabilities with known exploitation, **not** a live incident feed; no incident country supplied. Source `dateAdded` remains the publication timestamp. | Primary `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`; fallback is CISA's own `cisagov/kev-data` raw mirror. Six-hour worker cache; recent catalog additions only. |

Official references:

- [FAA XML/user guide](https://nasstatus.faa.gov/static/media/NASStatusUserGuide.cccc6d48.pdf)
- [FAA site policy](https://www.faa.gov/privacy). NAS XML is a publicly documented US government data service; no feed-specific license fee or authentication is specified in its user guide. No separate numeric download quota was found.
- [CISA official mirror and update schedule](https://github.com/cisagov/kev-data)
- [KEV CC0 license](https://github.com/cisagov/kev-data/blob/develop/LICENSE)

Neither publisher was found to publish a numeric quota for these specific download endpoints. Conservative application cache intervals are local policies, not claimed provider quotas. Requests time out after 15 seconds; each eligible primary/fallback endpoint is attempted once per cycle. Existing shared source-health exponential cooldowns and `Retry-After` handling bound subsequent retries. Cached last-good records retain their original fetch/publication timestamps; failure/backoff reuse is labeled stale. Cache is bounded by configured sources and kept in worker memory; persisted status rows provide last-known data across worker restarts. Successful empty responses do not imply normal conditions. The existing worker loop remains 15 minutes by default.

NVD was evaluated as an additional vulnerability source, but adds no reliable geographic incident attribution and duplicates the selected vulnerability use case. CERT-EU publishes dedicated public RSS; its content reuse terms would need a separate review before ingestion. NCSC's public RSS was reachable but mixes guidance/blogs and is not a regional incident feed. EASA publishes official conflict-zone bulletins, but no automated feed adapter or reuse contract was verified here. Those sources were not enabled. Existing OONI and specialist RSS ingestion remains, subject to operational filtering; no new commercial provider, subscription or dependency was added.

## Verification and remaining manual checks

Read-only live requests returned HTTP 200 from both FAA endpoints, CISA and its official mirror. Executing the implemented adapters produced three current FAA airport-status records and 32 recent KEV records in the check performed on October 28. Counts change with upstream feeds. No Supabase insert or production ingestion was executed.

85 focused worker/frontend regression tests and 10 API tests passed. Syntax and diff checks passed. Tests cover primary failure/fallback, malformed/stale/empty data, rate limiting, recovery, public URL sanitization, unattributed vulnerabilities, source timestamps, tracker admission, GNSS real Cesium data-source ON/OFF, and isolated Chrome Intel pagination/card/scroll behavior. A final expanded Intel test also passed with the actual filter-control helper, concurrent Load More/refresh, and disappearance of the selected country; its refresh measured 2.3 ms with retained cards and zero reading-anchor displacement. This is an isolated source-function fixture, not an authenticated full-application measurement. Production Webpack compilation succeeded in 129.714 seconds. Full authenticated application interactions and deployed worker/API/database persistence still require verification after the normal release process.

Existing `status_feed_items` schema is documented in `docs/04-development/supabase-status-feed-items.sql`; no schema migration is required if that table already exists. The worker requires its existing server-side Supabase configuration and `STATUS_FEED_ENABLED` (defaults true). New official sources need no API credentials. Deploying only the frontend cannot activate the new backend endpoint/adapters: worker, API and frontend changes must be released together through the existing process. Missing table/API availability is reported as unavailable, not healthy/normal.

## Changed code and functions

- `dev/assets/js/warzone-layers.js`: `isTrackerBlockedLayer`, `setLayer`, `toggleLayer`, `requestLayerToggle`, `buildAllEnabledState`, `activateDerivedLayerWithDependencies`, `setAllLayers`, `setSectionLayers`, `notifyChange`, `syncLayerItemState`, `renderLayerRow`, `bindLayerItem`.
- `dev/assets/js/warzone-gnss.js`: `upsertEntities`, `renderGnssInterferenceLayer`.
- `dev/assets/js/essential.js`: `refreshStatusEvents`/`refreshStatusEventsOnce`, `renderStatusFeedRows`, status render/scope helpers, `syncIntelWireFilterControls`, `renderFeed`, existing layer-change and polling hooks, Intel initial count.
- `dev/assets/js/supabase.js`: `api.getStatusFeedItems`.
- `apps/api/src/routes.events.js`: `/events/status-feed` route.
- `apps/shared/status-signal-policy.js`: `toPublicStatusSignal`.
- `apps/worker/src/official-status-adapters.js`: `parseFaaStatus`, `parseKevStatus`.
- `apps/worker/src/status-sources.js`: two official source definitions with fallback URLs/cache policy.
- `apps/worker/src/status-fetcher.js`: existing HTTP helpers and `fetchSingleStatusSource` use shared health/backoff, source cache and approved fallback endpoints.
- `apps/worker/src/status-filter.js`: `enrichStatusItem` recognizes explicitly structured official advisories without classifying them as attacks.
- `apps/worker/src/status-feed-runner.js`: freshness defaults/validation.
- `apps/worker/src/status-supabase-writer.js`: unknown severity preservation.
- Tests under `apps/worker/test`: `tracker-priority-mode.test.js`, `layer-admission-bulk.test.js`, `gnss-render-lifecycle.test.js`, `intel-wire-refresh.test.js`, `status-feed-reliability.test.js`; API test: `apps/api/test/status-feed-route.test.js`.

Production output is regenerated by the required build; generated files are not independently edited.
