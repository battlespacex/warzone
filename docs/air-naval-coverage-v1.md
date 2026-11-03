# StratOps additional aircraft and naval coverage (V1)

This branch adds three provider adapters to the **existing** multi-source trackers. Nothing is activated on production by a code merge alone. Live response validation, quota checks, and relevant licensing review must precede enabling.

## New adapters

| Provider | Domain | Geography / dataset | Default | Requirements | Poll floor |
| --- | --- | --- | --- | --- | --- |
| Kystverket | AIS | Norway public realtime GeoJSON, geographic and vessel-class limits | OFF | Verify public endpoint, output shape, API capacity and attribution | 15 minutes |
| BarentsWatch | AIS | Norway/Svalbard/Jan Mayen open AIS positions | OFF | BarentsWatch AIS developer client ID and secret | 10 minutes |
| ADSB.fi | ADS-B | Military-tagged aircraft from a separate receiver network | OFF | **Non-commercial use only**; explicit documented license approval | 5 minutes |

**Do not enable ADSB.fi in commercial or public BattlespaceX deployments without appropriate written permission or a suitable separate license.** Provider documentation: https://github.com/adsbfi/opendata

Kystverket: https://kystdatahuset.kystverket.no/ws/swagger/index.html

BarentsWatch: https://developer.barentswatch.no/docs/AIS/live-ais-api/

Existing naval sources already include AISStream and Finland's Fintraffic; existing aircraft sources already include adsb.lol, airplanes.live, adsb.one, OpenSky, ADS-B Exchange and enrichment databases. Those adapters were not replaced.

## Configuration

Set only after checking actual provider response and license terms:

```text
KYSTVERKET_ENABLED=false
# KYSTVERKET_BASE_URL=https://kystdatahuset.kystverket.no/ws/api/ais/realtime/geojson
# KYSTVERKET_MINIMUM_INTERVAL_MS=900000

BARENTSWATCH_ENABLED=false
# BARENTSWATCH_CLIENT_ID=<from BarentsWatch AIS developer client>
# BARENTSWATCH_CLIENT_SECRET=<private>
# BARENTSWATCH_MINIMUM_INTERVAL_MS=600000

ADSB_FI_ENABLED=false
ADSB_FI_LICENSE_APPROVED=false
# ADSB_FI_BASE_URL=https://opendata.adsb.fi/api/v2/mil
```

Keys must remain on the server and never be committed. No new paid services, migrations, frontend polling or Supabase schema changes are introduced.

## Deployment checklist (not yet executed)

1. Run `npm test --prefix apps/worker` against the branch and inspect every failing test.
2. Verify provider output against documented production contracts; Kystverket GeoJSON field names are not yet confirmed live.
3. Confirm license/redistribution conditions and safe request volume on your hosted service.
4. Configure one provider at a time in a non-production environment.
5. Verify the existing provider-health backoff, stale data rejection, duplicate MMSI / ICAO merge and conservative military qualification.
6. Confirm live map and database correctness for region switching, source attribution and provider outages.
7. Monitor EC2 CPU, network egress, Supabase writes and provider quotas before any production activation.

## Known limits

- AIS only reports transponder-equipped vessels. Not all naval warships broadcast AIS, and a vessel's military status cannot be inferred simply because it appears on a public AIS service.
- ADS-B coverage is incomplete and varies by geographic receiver network and military transponder policy.
- Open data licenses are not interchangeable. Public web access does not authorize unlimited commercial reuse.
- Norway feeds partly overlap; the existing MMSI merge should keep a single current vessel per identity rather than count them as two independent targets.
- No tracking update for a vessel or aircraft should be presented as proof of continuous movement through gaps.
