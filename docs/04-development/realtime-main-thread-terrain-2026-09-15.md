# Realtime main-thread blocking and Terrarium diagnosis

Implemented locally on September 15, 2026. No production deployment, API/worker restart, credential change, or database write was performed.

## A. Exact conn.onmessage source

The installed `@supabase/phoenix` 0.4.4 source assigns `this.conn.onmessage = event => this.onConnMessage(event)` in `Socket.transportConnect()` (`node_modules/@supabase/phoenix/assets/js/phoenix/socket.js`). `Socket.onConnMessage()` synchronously calls the decoder, routes to member channels, calls `Channel.trigger()`, and finally dispatches socket message callbacks. Supabase's `SocketAdapter` owns that Phoenix socket. `RealtimeChannel` applies its Postgres payload transform and filter bindings before calling the application's registered callback.

The live production page was checked: it references `/assets/js/bundle.a388a969.js`. That bundle returned 200 and contains Phoenix's onmessage assignment, heartbeat timeout text, and `tracks-live`; it does not contain the new queue.

Aircraft chain before this patch:

`conn.onmessage -> Socket.onConnMessage -> decode -> channel membership/trigger -> Supabase Postgres record conversion/filter -> handleTracksRealtimePayload -> aircraft/source/layer/region/exclusion checks -> upsertLiveTrack -> duplicate lookup -> telemetry classification -> recordLiveTrackDataState -> appendTrackHistoryPoint + pruneTrackRegistry + debounced registry notification -> affected entity/animation/label/trail updates -> refreshFocusedTrackIsolation -> syncLiveTrackRenderPopulation`.

The registry notification later invokes `requestAircraftMovementsWidgetRender -> renderAircraftMovementsWidget -> getAircraftWidgetItems -> merge/filter/sort -> row reconciliation`. It is already asynchronous, not an immediate full-widget rebuild inside every socket callback.

## B. Realtime channel/message type

`tracks-live` subscribes to `postgres_changes`, event `*`, public table `tracks`; INSERT/UPDATE use new rows and DELETE uses the old row. `events-live` subscribes to `events`; `active-alerts-live` subscribes to alerts; `warzone:sirens` receives siren broadcasts. All four now have per-channel timing instrumentation. Other data sources include HTTP aircraft history/public-air polling and satellite HTTP updates, not this particular socket subscription.

ADS-B and AIS workers write track arrays in database upsert calls. Supabase's inspected Postgres transformation emits individual changed records to the callback; the application callback reads a single new/old row, not a bulk aircraft array. A batch database write can consequently produce a burst of individual socket messages.

The attached file contains the user's trace summary, not the Chrome trace JSON. The 719 executions cannot yet be independently attributed to a particular channel/type. Aircraft processing is a confirmed synchronous blocking candidate; attribution of all measured long tasks remains pending.

## C. Why messages were expensive

Accepted aircraft updates did collection-wide work in addition to their own visual update. `pruneTrackRegistry()` walked all entries and filtered every stored history on every call. When focus was active, each accepted update also called full render-population reconciliation. Duplicate detection still scans active identities; that behavior is retained and its cost is now timed.

The events channel has a separate conditional expensive path: non-telemetry, military-relevant in-region events reach `handleIncomingEvent -> renderAll`, including downstream map/widget work. Aircraft telemetry exits early in the inspected source. This channel is instrumented but its delivery/notification semantics were not changed speculatively without channel-level trace evidence.

## D. Callback timing before

User-reported production trace: approximately 719 calls, 34.5 seconds CPU, 89 calls over 100 ms, many around 350-490 ms, some enclosing tasks around 1.1 seconds. These figures were not independently recomputed. The supplied data does not establish channel-level p95 or individual reconciliation-stage timings.

## E. Aircraft processing bottlenecks and changes

- Socket receipt now checks lifecycle gates and enqueues a record; it no longer invokes aircraft normalization/Cesium/history work synchronously.
- One scheduled drain handles at most four records, yielding when its configurable four-ms budget is reached. This is a scheduling budget, not a measured callback latency guarantee: an individual atomic operation cannot be preempted.
- Track keys are processed round-robin to avoid one busy aircraft starving other aircraft.
- Intermediate queued upserts retain existing validated data/history processing but skip visual reconciliation. The latest queued state uses the unchanged `animateTrackTo()` path.
- DELETE remains an ordered lifecycle barrier; queue cancellation is part of subscription stop, including hidden/layer-off lifecycle flows.
- A render-pending guard ensures the final coalesced update is not discarded as insignificant merely because its data/history was already ingested. Existing stale-source checks still apply.
- Computed style is obtained once per synchronous upsert, shared across nested upserts, and released in finally. No persistent style cache changes calibration behavior.
- Global registry maintenance is limited to once per second. Updated-track history retains its own point/age pruning.

## F. Widget bottlenecks and changes

The widget already uses keyed card reuse, render signatures, conditional select-option rebuilding, and row moves instead of panel-wide innerHTML replacement. Those mechanisms remain. Full collection merging/filtering/sorting still occurs because telemetry changes recency ordering. Its telemetry refresh cadence is now 500 ms instead of 120 ms; explicit focus/filter/load-more actions retain their immediate refresh. Diagnostics count full reconciliations and cards whose render signatures actually changed, not every individual DOM property assignment.

## G. Trail bottlenecks and changes

Trail positions already use a geometry cache plus a CallbackProperty live head tied to the rendered aircraft. History-to-Cartesian seed conversion is conditional, not a full conversion on every incoming message. Existing curve/smoothing/fade functions remain.

Unchanged committed trail points now return without re-sanitizing/rebuilding cached curved geometry, provided age/length trimming has not changed the trail. Network history receipt no longer unconditionally invalidates focused geometry that is based on the traversed visual trail. An already-existing focused route returns before recomputing all route positions. Actual trail/head/camera/terrain changes continue to use the existing geometry invalidation rules.

## H. Cesium update bottlenecks and changes

Affected-track updates remain targeted. Unchanged label configuration now retains existing callbacks/properties; title, style, and focus changes refresh the configuration. Model/billboard quality, scales, pose logic, and trail rendering are retained. Existing entities' visibility is handled for the affected track; the selected track's neighborhood population check is coalesced into one 260-ms task, gated against hidden/layer-off state. Some static graphic setters and duplicate lookup remain: the new stage timings distinguish whether additional targeted work is warranted.

## I. Queue/coalescing fix

`socket receipt -> small keyed enqueue -> return -> bounded drain -> validate/data/history -> latest-state visual reconciliation -> existing independent wall-clock interpolation`.

Coalescing skips redundant visual work, not historical telemetry/lifecycle records. It does not make a bulk synchronous microtask chain or add per-aircraft timers. There is one pending queue-drain RAF and the existing independent visual animation path.

## J. Heartbeat timeout findings

Phoenix `heartbeatTimeout()` raises `new Error("heartbeat timeout")` on its channels and tears down/reconnects the transport when its pending heartbeat remains unacknowledged. The tracks subscription's CHANNEL_ERROR handler prints `TRACK ERROR`. It is not a custom aircraft-motion watchdog. No timeout value was increased. Main-thread starvation can delay heartbeat processing, but network/service problems can also do so; the supplied trace summary alone cannot prove the timeout's cause. Diagnostics record channel-error times and recent observed long tasks to support correlation.

## K. Terrarium 404 root cause

The CSS custom property was formatted as `/__warzone/terrain/terrarium/ { z } / { x } / { y } .png` with whitespace/newlines. URL generation only replaced literal `{z}`, `{x}`, `{y}`, leaving the spaced tokens encoded in the request. Local webpack middleware has a Terrarium proxy; the static production origin does not provide numeric tiles at the shown path either.

This is the DEM source for contour height sampling, not itself the Cesium viewer's TerrainProvider. It is consulted by contour sampling when contour DEM is enabled; focused terrain provider lifecycle/ArcGIS fallback remains untouched. Image-error handlers eventually resolve null and try fallback sources. These Image requests do not directly increment Cesium's globe imagery tile queue. Exact malformed request frequency and indirect loading impact cannot be recovered without the trace/network log; the tile cache is keyed by numeric tile coordinates rather than malformed URLs.

## L. Terrain fix and source verification

The default CSS template is now the existing intended public source, quoted to prevent brace formatting damage:

`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`.

Template handling strips outer quotes and normalizes whitespace inside legacy placeholders before substitution. No new terrain provider or imagery quality setting was introduced.

Using the application's slippy-coordinate calculation at longitude 23, latitude 37, zoom 9 produces **9/288/199**, verified in an executable test. A real GET of that public tile returned **200, image/png, Access-Control-Allow-Origin: \***. The corresponding numeric production path `/warzone/terrain/terrarium/9/288/198.png` was independently checked and returned **404 from the static S3/CloudFront origin**. This is why simply correcting placeholders while retaining that production path would not suffice.

## M. Files/functions modified in this task

- `dev/assets/js/warzone-realtime-performance.js` (new): `createTrackUpdateQueue`, `instrumentRealtimeCallback`, `installRealtimeSocketDiagnostics`, `measureRealtimeStage`, `recordRealtimeWork`, `recordRealtimeChannelError`, `getRealtimeStats`, bounded diagnostic sample/rate helpers.
- `dev/assets/js/essential.js`: realtime enqueue/processing/start/stop functions, aircraft widget render scheduling, card/full-refresh diagnostic counters. No events/map or authentication changes.
- `dev/assets/js/warzone-live-airforce.js`: upsert wrapper/application function, CSS readers, telemetry classification/render-pending data state, registry maintenance, label configuration reuse, focused route/cache behavior, committed trail no-change guard, focused neighborhood reconciliation scheduling.
- `dev/assets/js/warzone-realtime.js`: timing wrappers on existing events, alerts, and siren callbacks; socket instrumentation installation.
- `dev/assets/js/warzone-globe.js`: realtime diagnostic accessors and Terrarium template normalization only for this task. Earlier uncommitted imagery-refinement work was already present and was not reverted or further tuned.
- `dev/assets/css/root.css`: Terrarium URL custom property only.
- `apps/worker/test/stratops-realtime-performance.test.js` (new): executable queue, library-routing, lifecycle, history/render guard, label/trail, diagnostic, and numeric-template tests.
- `apps/worker/test/cesium-imagery-focus-performance.test.js`: adds the newly imported realtime accessor to the existing isolated VM diagnostic fixture. Earlier tests/changes retained.
- This report, plus generated production artifacts from the single build.

## N. Before/after performance evidence

Controlled source-function comparison, not a Chrome profile: 99 accepted update maintenance calls, 99 tracks, 240 history points per track, fixed same-second clock. Before: 9,801 history visits and 2,352,240 point checks. After: 99 history visits and 23,760 point checks. The installed Phoenix routing test confirms 99 message receipts cause zero immediate reconciliation calls, then four records on the first scheduled drain.

Production callback p95/max, long-task counts, 15-30-second visual continuity, focus responsiveness, and heartbeat improvement remain unmeasured. Browser access failed at setup with the environment's `missing field sandboxPolicy` error. The single post-build local HTTP check also failed with ECONNREFUSED on localhost:4173 (both IPv4 and IPv6); it was not retried. Do not treat these synthetic checks as proof that every production stall is fixed. The event-channel path and any over-budget individual reconciliation record require the new timings/actual trace before further changes.

Remaining coalescing risk: an intermediate valid update can be ingested data-only and then followed by a stale final queued update. The stale final update is rejected, but the intermediate valid state may remain render-pending until another accepted update arrives. The existing tests cover stale rejection and latest-state happy paths separately, not this combined end-to-end case. This needs a targeted follow-up before deploying the coalescing path; runtime verification is not complete and this report is not a production-readiness claim.

## O. Test results

42/42 tests passed across `stratops-realtime-performance.test.js`, `cesium-imagery-focus-performance.test.js`, and `stratops-ui-improvements.test.js`. Relevant JavaScript syntax checks and `git diff --check` passed. Existing imagery policy/camera, satellite focus/unlock, entry/video, CTR highlight and routing-related checks are included; live authentication, layers, onboarding and camera visual QA were not possible.

## P. Build result

`npm run build` passed once: webpack 5.108.4 compiled successfully in 197,269 ms. Main output: `assets/js/bundle.4481f6f8.js` and `assets/css/style.5b6e7ecc.css`. Generated entry/lazy/CSS filenames and HTML references changed normally; deploy the complete output, not just the main bundle. Existing Babel large-file notices were emitted, without build failure.

## Q. Manual validation steps

1. Resolve the coalescing edge noted in N and complete local validation before deployment. When validated, deploy the **complete generated production directory**, retaining all matching hashed HTML/CSS/entry/lazy chunks. No worker/API code changed for this task. Keep API deployment issues separate.
2. From the repository root, `npm run serve` starts the built frontend. Use `http://localhost:4173/warzone/`, with the existing local services/authentication as needed. Diagnostics are enabled on localhost; production instrumentation requires explicit configuration opt-in before initialization.
3. Enable Air Tracker, use a similar active count (around 99), focus a moving aircraft, and record 30 seconds in Chrome Performance. Avoid recording payload contents.
4. Run `__stratopsPerf.printRealtimeSummary()` and `__stratopsPerf.getRealtimeStats()`. Compare `socketCallback`, channel callback timing, reconciliation timing, per-stage timing, queue depth, coalesced updates, five-second rates, long tasks, and channel errors. Timings are bounded recent samples; counters/rates do not log track identifiers or payloads.
5. The selected aircraft should remain centered, move continuously using its existing animation path, and have a trail head matching its rendered position. Check icon and 3D modes, focus/unlock, region/subtype/country filters, hidden-tab recovery, and aircraft layer off/on.
6. Toggle existing terrain/CTR controls and inspect Network: Terrarium requests must contain numeric coordinates, return PNGs, and be CORS-readable; encoded `{ z }` paths must not recur. Verify nearby naval/satellite and entry/authentication flows separately.
7. If `events-live` or one reconciliation stage still accounts for long tasks, supply the actual Chrome trace JSON and the diagnostic summary. Do not infer the channel from the shared conn.onmessage frame or hide heartbeat errors by increasing timeouts.
