# Tracker dropdown investigation — Laptop B, 2026-10-29

Project: `C:\DX\warzone-recovery`. All application changes and verification were performed on Laptop B. No Laptop A checkout, authentication, entitlements, Git history or deployment was changed.

## Confirmed blocker

The full application Chrome CPU profile captured a **2,336 ms main-thread task** while processing a polling response containing 100 operational records:

```text
pollLatestEvents
  regionRows.forEach(handleIncomingEvent)
    renderAll(__eventsCache)                 // once for EVERY incoming record
      normalizeEvent -> resolveDisplayCoordinates -> scanTextForCountry
      resolveEventTheater
      applyScopeFilters / isMilitaryRelevant / isTrainerAircraftSignalEvent
    syncNewsTickerForCurrentMode
```

The native dropdown can appear unresponsive whenever that task occupies the main thread. Existing category-option synchronization was not the source of this task: the open dropdowns had zero option mutations. This establishes an application-wide blocker affecting interaction, but does **not** prove that every reported black native popup is caused by the same issue.

A follow-up profile also found repeated whole-document `querySelector` calls in `flashFeedCard` after event ingestion. Those lookups are now shared across the batch.

## Targeted correction

In `dev/assets/js/essential.js`:

- `pollLatestEvents` delivers records through `applyIncomingEventBatch`, preserving chronological order. The batch yields to animation frames after a four-millisecond processing budget. Request-generation, visibility and region checks cancel obsolete work.
- Each accepted record still follows `handleIncomingEvent` and its existing cache merge, naval upsert, layer eligibility, track, hotspot and siren paths. Live telemetry is not paused while a dropdown is open.
- Authoritative cache trimming runs once after a polling batch instead of twice per record.
- `requestIncomingEventUiRefresh` coalesces full UI normalization, theater calculations, ticker refresh and viewport scheduling into one refresh for the completed batch. Ordinary realtime messages also share one scheduled UI refresh.
- Flash targets are looked up once per UI refresh, retaining the existing first matching card and flash behavior.

No dropdown replacement, CSS change, category-rule change, model/rendering change, interpolation change or new polling timer was introduced. Native selects and the existing dynamic category reconciler remain intact.

## Actual browser observations

Installed Chrome was driven through normal onboarding, region selection, layer confirmation and widget opening at `http://localhost:4173/pages/index.html`, at 1920×1080. It was an isolated **headless Chrome session with screenshots**, not the user's existing interactive Chrome profile. Chrome reported GPU compositing/WebGL enabled and an NVIDIA GeForce RTX 5060 Laptop GPU among its devices.

- The live Middle East session supplied six aircraft and no naval contacts. Air/Naval pointerdown-to-next-frame measurements were 12.9/14.5 ms, with no long tasks in that short capture; the Air menu's labels painted correctly.
- A browser-only response fixture then supplied approximately 100 aircraft and 100 vessels through the real API-consumption, eligibility, registry, widget and Cesium paths. The Air widget reported 99 eligible contacts before category selection; naval diagnostics reported 100 vessel records and 100 Cesium entities. The fixture made no backend writes and changed no access controls.
- Both native menus were opened repeatedly, hovered, navigated with arrow keys and closed while feed updates continued. Screenshots of both showed populated option lists. Category changes produced filtered widget counts. Open-menu option mutations remained **zero**.
- The existing Chrome regression harness separately verifies dynamic categories appearing/disappearing, availability beyond pagination, open-picker stability, empty selected-category retention, keyboard selection, independent Air/Naval state and globe-filter predicates.

| Observed measure | Before | Final capture |
| --- | ---: | ---: |
| Largest main-thread task | 2,336 ms | 136 ms |
| Largest sampled frame gap | 2,334.3 ms | 150.2 ms |
| Air pointerdown → next page animation frame | 10.9–14.2 ms | 21.4–28.4 ms |
| Naval pointerdown → next page animation frame | 12.3–14.8 ms | 14.7–31.5 ms |
| Selection change handler → next frame | Not recorded | 10.2–46.2 ms |
| Option mutations during the interaction capture | 0 | 0 |
| Frame-gap p95 | 17.1 ms | 33.4 ms |

The before/after traces span different durations (9.46/23.37 seconds), with varying live background arrivals and vessel movement. These are observed maxima/ranges, **not** a controlled FPS benchmark or proof that native-popup screen paint completes within the pointer timing. The final capture still recorded 15 tasks over 50 ms. It does not establish uniformly smooth 60 FPS or complete elimination of interaction delay.

The multi-second polling/full-cache path no longer appears in the final hot stacks. Remaining sampled costs include `updateLiveTrackPredictionFrame`, `getCssNumber`/computed-style reads in movement updates, Cesium entity property-change propagation, scene rendering and garbage collection. Those protected rendering/movement systems were left unchanged. The first post-fix capture was taken alongside test activity; the final capture was repeated without the regression suite running.

Saved local evidence:

- `.generated/dropdown-100-before.cpuprofile` and `.generated/dropdown-100-before.json`
- `.generated/dropdown-100-final.cpuprofile` and `.generated/dropdown-100-final.json`
- `.generated/aircraft-100-final.png` and `.generated/naval-100-final.png`
- `.generated/dropdown-browser-gpu.json`

These are development artifacts, not application entry points or production assets.

## Verification

`apps/worker/test/incoming-event-batching.test.js` executes the actual batching/ingestion functions and verifies all records are processed, concurrent realtime delivery survives, obsolete batches stop after yielding, caches finalize, and one UI refresh replaces per-record full refreshes. The final serial regression run passed **89 tests**, including tracker stability, lifecycle, CTR cleanup, priority mode, realtime correctness, Focus responsiveness, Intel Wire and bootstrap checks. Syntax and diff checks passed. Production Webpack compilation succeeded in **191.017 seconds**. Generated build output was not deployed.

Changed source: `dev/assets/js/essential.js` (`pollLatestEvents`, `applyIncomingEventBatch`, `requestIncomingEventUiRefresh`, `handleIncomingEvent`, `flashFeedCard`). Added tests: `apps/worker/test/incoming-event-batching.test.js`. Added documentation: this file. Webpack build outputs are regenerated normally.

## Remaining verification in the user's interactive Chrome

The reported blank black native popup was not reproduced in the captured session. Complete resolution therefore remains unconfirmed.

On Laptop B, use the current development build and normal authenticated account:

1. Open Chrome DevTools → **Performance**. Enable screenshots, leave CPU/network throttling off, and undock DevTools to preserve the normal viewport.
2. Enable both trackers with approximately 100 eligible contacts each. Start recording for 20–30 seconds.
3. Repeatedly open both Type menus, hover available categories, use arrows/Enter, change categories and leave a menu open across a feed refresh. Capture the black state if it occurs.
4. Stop recording. Inspect the input event's queueing delay and the main-thread task spanning the freeze; compare against the saved CPU profiles. A polling burst should no longer contain one full `renderAll` per record.
5. If the popup is black while main-thread work is quiet, capture Chrome's GPU diagnostics (`chrome://gpu`) and a screenshot. That would require further investigation of the native-popup/compositor path; no custom dropdown or visual workaround has been introduced.

No source-map or Webpack middleware cost was identified in the captured multi-second call stack. That does not exclude other development-environment problems outside the captured interval.
