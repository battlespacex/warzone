# StratOps Orbital Assets

Last updated: 2026-07-28

## What The Layer Does

Orbital Assets displays public orbital estimates for publicly tracked military-associated and dual-use satellites. It is an analytical visualization layer, not a live sensor feed.

The default globe view uses lightweight symbols. Hover shows a compact public orbital information card. Click/focus shows selected-satellite context: model fallback, recent/predicted orbit path, sub-satellite ground track, nadir line, and a theoretical line-of-sight footprint.

## Data Source

Primary orbital source:

```text
https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=JSON
```

Required SATCAT metadata source:

```text
https://celestrak.org/pub/satcat.csv
```

The API uses CelesTrak public GP elements in OMM-compatible JSON form. The frontend uses `satellite.js` `json2satrec()` and propagation helpers rather than converting records back into legacy TLE strings.

## Why Positions Are Estimates

CelesTrak GP elements are public orbital elements. StratOps propagates those elements to estimate current and future positions. The layer must use language such as public orbital estimate, predicted position, publicly tracked, military-associated, dual-use, and mission unconfirmed.

Do not describe this layer as confirmed live military detection, sensor coverage, surveillance coverage, radar coverage, or strike range.

## Cache Interval

Endpoint:

```text
GET /api/satellites/military
```

Server behavior:

- Refreshes CelesTrak no more frequently than once every two hours.
- Stores the last successful payload in memory and in `apps/api/.cache/strategic-satellites-military.json`.
- Serves the last valid cache when CelesTrak is temporarily unavailable.
- Marks payloads stale after 24 hours.
- Uses request timeout, response-size limits, non-200 backoff, and one concise warning per repeated failure.

`apps/api/.cache/` is gitignored.

## Classification Limitations

Classification is intentionally conservative.

The API can return:

- Known military-associated
- Likely military-associated
- Dual-use
- Public navigation
- Earth observation
- Communications
- Early warning
- Reconnaissance
- Signals intelligence
- Radar imaging
- Technology demonstration
- Mission unconfirmed

Name/operator inference is isolated in:

```text
apps/api/src/strategic-satellites.js
```

Verified public overrides belong in:

```text
apps/api/src/config/strategic-satellite-catalog.json
```

Do not populate the curated catalog with fabricated data.

Example override schema:

```json
{
  "noradId": "12345",
  "displayName": null,
  "country": null,
  "operator": null,
  "mission": null,
  "association": "military-associated",
  "confidence": "confirmed-public",
  "sourceNote": null
}
```

## Main Files

- `apps/api/src/routes.satellites.js`
- `apps/api/src/strategic-satellites.js`
- `apps/api/src/config/strategic-satellite-catalog.json`
- `dev/assets/js/warzone-mil-sats.js`
- `dev/assets/js/warzone-layers.js`
- `dev/assets/js/stratops-feature-config.js`
- `dev/assets/js/index.js`
- `dev/assets/js/essential.js`
- `dev/assets/css/root.css`
- `dev/assets/css/warzone-components.css`

## Feature Flags

Primary flags:

```text
mapLayers.orbitalAssets
tracking.strategicSatellites
system.milSatOrbit
```

Independent satellite observation flag:

```text
mapLayers.satelliteObservations
```

Disable the entire orbital layer by setting one of these to false:

```js
window.STRATOPS_FEATURES = {
  mapLayers: { orbitalAssets: false },
  tracking: { strategicSatellites: false },
  system: { milSatOrbit: false }
};
```

## Performance Controls

Runtime controls live under:

```js
window.__stratopsConfig.strategicSatellites
```

Important fields:

- `enabled`
- `apiPath`
- `maximumVisibleSatellites`
- `sampleIntervalSeconds`
- `pastOrbitMinutes`
- `futureOrbitMinutes`
- `positionRefreshIntervalMs`
- `focusedModelCount`
- `showOrbitPath`
- `showGroundTrack`
- `showNadirLine`
- `showTheoreticalFootprint`
- `showLabels`
- `minimumClassificationConfidence`

Default maximum visible count:

```text
maximumVisibleSatellites: 160
```

The layer does not fetch, propagate, create Cesium entities, register Cesium handlers, or start timers while the `orbital-assets` layer is disabled.

## Disable Focus Context Pieces

Disable selected-satellite extras through runtime config:

```js
window.__stratopsConfig.strategicSatellites = {
  showOrbitPath: false,
  showGroundTrack: false,
  showNadirLine: false,
  showTheoreticalFootprint: false
};
```

## Local Testing

Syntax checks:

```powershell
node --check apps\api\src\strategic-satellites.js
node --check apps\api\src\routes.satellites.js
node --check apps\api\src\index.js
node --check dev\assets\js\warzone-mil-sats.js
node --check dev\assets\js\essential.js
node --check dev\assets\js\warzone-layers.js
node --check dev\assets\js\stratops-feature-config.js
node --check dev\assets\js\warzone-live-naval.js
```

Backend data smoke test:

```powershell
node -e "import('./apps/api/src/strategic-satellites.js').then(async m => { const p = await m.getMilitarySatellitePayload({ forceRefresh: true }); console.log(p.sourceStatus, p.count, p.sourceEpoch); })"
```

Frontend build:

```powershell
npm run build
```

Manual staging checks:

- Anonymous user sees Orbital Assets locked as premium.
- Enabling Orbital Assets after sign-in calls `/api/satellites/military`.
- Disabling Orbital Assets removes symbols, focus graphics, timers, and Cesium handlers.
- Hover card says public orbital estimate and CelesTrak public GP elements.
- Focus card says position is propagated from public orbital elements and is not a direct sensor detection.
- Satellite Observations remain independently controllable.

## Staging Deployment Requirements

- Deploy the rebuilt staging frontend assets.
- Deploy or restart the staging API service so `/satellites/military` is mounted.
- Ensure the API process can write to `apps/api/.cache/` or set `STRATOPS_SATELLITE_CACHE_PATH` to a writable persistent cache file.
- No new secret or API key is required for CelesTrak.
- Do not deploy to production until staging validation is complete.
