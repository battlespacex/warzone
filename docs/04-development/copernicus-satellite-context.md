# Copernicus Satellite Context

This integration attaches cached Copernicus previews to eligible high-value StratOps events. It is disabled unless `COPERNICUS_ENABLED=true`.

## Required Setup

1. Apply `docs/04-development/supabase-copernicus-satellite.sql` in Supabase.
2. Ensure the worker/server environment has:
   - `COPERNICUS_ENABLED=true`
   - `COPERNICUS_CLIENT_ID`
   - `COPERNICUS_CLIENT_SECRET`
   - `AWS_REGION`
   - `AWS_S3_BUCKET`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `CLOUDFRONT_URL` or `AWS_CLOUDFRONT_URL` recommended

Optional quota controls use the defaults from the prompt: daily event limit `75`, request ceiling `20` per minute, 72 hour lookback, 512 by 512 previews, 7.5 km radius, and 30 percent max cloud cover.

## Behavior

The worker only evaluates High or Critical events with valid coordinates, recent event times, and visible satellite-relevant categories/text. It searches Sentinel-2 L2A first, then Sentinel-1 GRD if enabled. Images are uploaded to S3 under `satellite-events/YYYY/MM/DD/<event-id>/<cache-key>.png`.

The frontend receives only sanitized metadata and a CloudFront/S3 image URL through the API. Copernicus credentials, OAuth tokens, AWS credentials, cache keys, storage keys, and raw provider payloads are never returned to the browser.

## Troubleshooting

- `401`: check Copernicus client ID/secret and token URL.
- `403`: check account permissions, quota, or S3 IAM permissions.
- `429`: the worker persists `rate_limited_until` and pauses additional jobs.
- No imagery: the event may be ineligible, too old, too cloudy, or have no suitable recent observation.

Live Copernicus API tests are intentionally not run by default. Use mocked tests for normal development to protect free quota.
