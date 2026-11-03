# GNSS Interference V3 local verification (Laptop B)

## Scope and source permissions

The previous widget read an unpopulated GNSS table/status fallback. The new API path reads GPSInterference.com server-side, caches a single daily globe-history snapshot, scopes by the selected region, and uses the previous database adapter only when the provider is unavailable. No new worker, table, subscription, or viewer was added. The GNSS layer remains OFF by default and tracker priority rules are unchanged.

GPSInterference.com supplies ADS-B-derived low-position-accuracy hexagons. Source cell IDs are deduplicated, and the source's colour category and aircraft counts are retained. Only one geographic source is integrated, so no cross-provider corroboration is claimed. Low accuracy is labelled observed degradation; it is not proof of deliberate jamming or a jammer location. Source attribution is GPSInterference.com / adsb.lol. Source docs: https://gpsinterference.com/docs

Stanford's published resources are CC BY-NC 4.0; commercial reuse requires separate permission: https://rfi.stanford.edu/resources . NAVWAR public pages provide regional context, but live observations require registered access and redistribution terms have not been verified: https://rfi.navwar.nl/about . Neither is ingested or counted as independent corroboration. Existing aircraft data does not provide a verified, consistently present NIC/NACp plus position-history detection signal without additional collection work; the fourth source is not activated. The requested three-source target therefore remains blocked by source rights/access and independent-evidence verification.

## Local evidence

- A read-only direct request to the public latest endpoint on 2026-11-02 returned 24,406 unique source cells; 809 polygons intersected the Middle East test bounds. Provider observation period was 2026-11-01. Counts vary by provider update.
- On that 4,938,502-character payload, local Node normalization plus regional selection took 84 ms and increased reported JS heap by 61.8 MiB. The heap delta is a process snapshot, not retained-heap or EC2 production usage. No GPU/Chrome measurements were made.
- Focused provider, Cesium fixture, and resource-lifecycle tests: 25 passed. Full API suite: 56 passed. Final production Webpack build: successful (76.6 s on the network-backed checkout). The Cesium fixture validates geometry-instance creation, picking IDs, and cancellation, not actual WebGL imagery or terrain rendering.
- The API fetches one provider snapshot per cache period (60 seconds for latest, one day for a historical date), shares in-flight requests, bounds response size and source cell count, and applies a five-minute failure cooldown. The frontend refresh interval remains ten minutes while enabled. OFF cancels frontend requests and queued geometry batches. The new path performs no Supabase writes.

## Browser verification still required

1. Run the local API and frontend together using the existing development commands. Enter StratOps, select Middle East & Gulf, and enable GNSS Jamming; verify region counts and terrain-grounded hexagons.
2. Click low, moderate, high and severe hexagons. Check the existing clipped detail widget, affected/observed counts, observation date, freshness and source limitations. Confirm the popup follows its selected cell while panning.
3. Change region, severity, date and Show hexagons; toggle the layer OFF/ON repeatedly. Verify no duplicate primitive collections or listeners, no duplicate provider requests, and no stale-region cells.
4. In Chrome Performance/Memory, record frame time, heap and GPU memory when drawing the largest region, rotating/zooming, and switching dates. Compare with all optional layers OFF.

No production deployment, database write, or backend restart was performed. The frontend and API changes must be released together after browser verification; deploying only the frontend leaves the old empty-data behavior.
