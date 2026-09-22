# Copernicus Satellite Context

This integration attaches cached Copernicus previews to eligible high-value StratOps events. It is disabled unless `COPERNICUS_ENABLED=true`.

## Required Setup

1. Apply `docs/04-development/supabase-copernicus-satellite.sql` in Supabase.
2. Ensure the worker/server environment has:
   - `COPERNICUS_ENABLED=true`
   - `COPERNICUS_CLIENT_ID`
   - `COPERNICUS_CLIENT_SECRET`

Optional quota controls default to `COPERNICUS_DAILY_EVENT_LIMIT=30` for first-time source quicklooks, `COPERNICUS_DAILY_CATALOG_REQUEST_LIMIT=120` for catalog search attempts, and `COPERNICUS_MAX_REQUESTS_PER_MINUTE=20`. A reused quicklook increments `cache_hits` but does not consume the first-time quicklook quota. The catalog limit still applies because each event needs a product search. The worker runs one Copernicus cycle at a time; the local configuration uses one event per 60-second cycle. Observation expiry remains 72 hours, and no-result events wait 12 hours before a new search.

## Behavior

The worker only evaluates High or Critical events with valid coordinates, recent event times, and visible satellite-relevant categories/text. Critical and High strike events are searched first. It searches Sentinel-2 L2A first, then Sentinel-1 GRD if enabled. The current worker attaches validated, Copernicus-hosted QUICKLOOK assets and reuses an available quicklook for the same product across events. It does not call the Sentinel Hub Process API or upload new preview images to S3.

The frontend receives only sanitized metadata and a validated Copernicus QUICKLOOK URL through the API. Copernicus credentials, OAuth tokens, cache keys, storage keys, and raw provider payloads are never returned to the browser.

## Troubleshooting

- `401`: check Copernicus client ID/secret and token URL.
- `403`: check account permissions, quota, or S3 IAM permissions.
- `429`: the worker persists `rate_limited_until` and pauses additional jobs.
- No imagery: the event may be ineligible, too old, too cloudy, or have no suitable recent observation.

Live Copernicus API tests are intentionally not run by default. Use mocked tests for normal development to protect free quota.
