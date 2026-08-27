# Naval data sources

All naval providers run in the worker. Credentials and source-specific payloads are never exposed to the browser. Observations pass through the existing naval normalizer, military qualification, multi-source merge, and Supabase persistence path.

## Active live feeds

| Provider | Role | Coverage | Configuration | Terms |
| --- | --- | --- | --- | --- |
| AISStream | Existing primary live feed | Configured global bounding boxes | `AISSTREAM_ENABLED`, `AISSTREAM_API_KEY` | Provider terms apply |
| Fintraffic / Digitraffic | Credential-free complementary live feed | Finnish coastal waters | Enabled by default with `FINTRAFFIC_ENABLED`; MQTT settings use the `FINTRAFFIC_*` variables in `.env.example` | CC BY 4.0. Preserve: `Source: Fintraffic / digitraffic.fi, license CC 4.0 BY` |

Fintraffic documentation: <https://www.digitraffic.fi/en/marine-traffic/>  
Fintraffic terms: <https://www.digitraffic.fi/en/terms-of-service/>

## Enrichment

VesselAPI remains an opt-in identity enrichment provider. It does not produce an independent live position stream. It requires `VESSELAPI_API_KEY`, is quota guarded, cached, and disabled by default.

## Optional adapters

| Provider | Default | Requirements | Notes |
| --- | --- | --- | --- |
| OpenAIS | Disabled | A user-operated OpenAIS/pg_featureserv deployment and `OPENAIS_BASE_URL` | OpenAIS is deployable software, not a hosted public global feed. |
| MarinePlan OpenShipData | Disabled | Issued `MARINEPLAN_API_KEY` and `MARINEPLAN_AREA` | Uses the documented `/location/2/locations.json` endpoint. Source speed is converted from km/h to knots. |
| AISHub | Disabled | Membership username and compliance with its sharing terms | Existing adapter unchanged. |
| Spire | Disabled | Customer token and product endpoint | Existing adapter unchanged. |
| MarineTraffic | Disabled | Customer key and product endpoint | Existing adapter unchanged. |
| VesselFinder | Disabled | Customer API key | Existing adapter unchanged. |

OpenAIS: <https://open-ais.org/docs/API/>  
MarinePlan OpenShipData: <https://marineplan.com/openshipdata-online-api-description/>  
VesselAPI: <https://vesselapi.com/api-reference>

## Not integrated

Cruising Earth is a consumer-facing interactive tracker. No documented external data API or licensed machine feed was identified, so the worker does not scrape or embed it.

Reference: <https://www.cruisingearth.com/military-ship-tracker/>
