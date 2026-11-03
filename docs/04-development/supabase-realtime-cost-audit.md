# Supabase Realtime cost audit (Laptop B, 2026-11-01)

This is a source audit and one safe client filter, not a verified billing reduction. The user's prior cycle had 19,527,906 Realtime messages and at most four concurrent connections. The configured Supabase project returned HTTP 402 `exceed_realtime_message_count_quota` during a read-only check. Production per-channel message reports, publication membership, write counters and billing-cycle dates were unavailable; do not treat code counts as production usage.

## Delivery paths

| Feature | Current delivery | Source/writes | Realtime receiving scope |
| --- | --- | --- | --- |
| Map events, alerts, regional/global intelligence | `events-live` Postgres Changes after the guarded operational boot; 12-second API event polling remains a recovery path | Main worker `events` writes; ADS-B and AIS workers also upsert `events`; API can insert events | All `events` INSERT/UPDATE/DELETE, including tracker-derived events. One channel per operational page. |
| Aircraft Tracker | `tracks-live` Postgres Changes only while aircraft layer is active/visible, plus 12-second history reconciliation | ADS-B worker writes `tracks` and `aircraft_tracks_log` | Previously all `tracks`, including naval. Now aircraft INSERT/UPDATE only, plus unfiltered DELETE for lifecycle correctness. |
| Naval Tracker | Existing API snapshots and event-derived naval signals | AIS worker writes `tracks`, `naval_tracks_log` and `events` | No separate naval Postgres Changes channel; `events-live` can carry naval signals. |
| Siren alerts | `warzone:sirens` Broadcast only while alerts layer is on | Siren worker broadcasts and writes `active_alerts`/`events` | One guarded client channel; each siren sends a broadcast. |
| Active alert table | API bootstrap/polling helper and optional `active-alerts-live` function | Main and siren workers upsert `active_alerts` | `subscribeToActiveAlerts` and its 20-second polling fallback have no application call site, so this channel is not started by the current boot. |
| Military satellites, Orbital Intelligence, AOI, Intel Wire, reports | Existing API requests, worker jobs and feature-specific refresh paths | Separate satellite, intelligence and reporting writers | No additional Supabase frontend Realtime channel found in these modules. Existing service/worker functionality was not changed. |

Frontend Supabase client: `dev/assets/js/supabase.js` (publishable key, no persisted user session). Worker service-role client: `apps/worker/src/supabase.js`. API creates server-side clients in `routes.events.js` and `routes.stratops.js`. No frontend Presence subscription was found. `raw_items` has worker writes but no frontend Realtime listener in source. The repository does not define the deployed `supabase_realtime` publication; inspect its actual tables in the Supabase dashboard before changing publication or RLS.

## Ranked causes and limits

1. **Proven wasted delivery:** the aircraft channel previously received every naval `tracks` change and rejected it in `handleTracksRealtimePayload`. A server-side `track_type=eq.aircraft` filter now rejects naval INSERT/UPDATE before delivery. DELETE remains unfiltered because Supabase cannot evaluate non-key filters on deleted rows. This preserves the existing aircraft cleanup path. The same channel and 5-second worker cadence remain.
2. **Likely high-volume fan-out, unmeasured:** ADS-B and AIS workers upsert per-asset `tracks` and `events` on live cycles (default 5 seconds). `events-live` receives every `events` change for each connected page, even while trackers are off. Some writes include a new `updated_at` per cycle. Whether the underlying observation actually changed requires source-timestamp and record comparisons before suppressing a write; no such suppression was made.
3. **Potential duplicate information:** tracker data is also available through API history/snapshot paths. These paths support recovery and historical accuracy; they were retained. The global `events` stream cannot safely be narrowed to a geographic region with the current filter API, and excluding a report type could remove operational alerts.
4. **Low-volume or unproven:** siren Broadcast sends only on an alert. The operational boot guards its one `events-live` call, aircraft startup guards its one channel, and siren ON/OFF guards its one channel. Main worker jobs and live pollers have in-process overlap guards; multiple deployed worker instances remain an operational check.

The 402 restriction is an upstream service state. The API health endpoint returned 200 while `/events/map` returned 500; a read-only Supabase REST query with server credentials returned 402 with the quota code. The API currently masks database errors as `{"error":"Failed"}`, so deployed API logs should confirm its exact failure. Frontend event polling has a two-minute restricted-API backoff; the Supabase client's reconnect behavior still needs a post-restoration network test. No critical channel was shut off in response to 402.

## Measurement and budget procedure

Use the Supabase **organization** Realtime Messages report for the actual billing cycle, with per-project filtering where available. Record per-channel event counts, publication tables, and per-table INSERT/UPDATE/DELETE deltas over the same hour before and after deployment, at comparable connected-client counts and aircraft/naval workloads. Database lifetime counters alone are not an hourly rate. Compare `events`, `tracks`, `active_alerts`, Broadcast and Presence separately. The source change saves one delivered message for each naval INSERT/UPDATE that would otherwise reach an aircraft subscriber; savings depend on the number of such writes and subscribed clients. No production percentage is yet defensible.

A deterministic local delivery fixture used 1,000 aircraft and 1,000 naval UPDATEs with one aircraft subscriber: the old wildcard would deliver 2,000 callbacks, and the new filter delivers 1,000. That is a 50% reduction **for this synthetic tracks-channel mix only**. It does not measure the global events channel, other projects, or billable production messages.

Read-only SQL for a database administrator, if permitted after service restoration:

```sql
select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1, 2;
select relname, n_tup_ins, n_tup_upd, n_tup_del from pg_stat_user_tables where schemaname = 'public' and relname in ('events', 'tracks', 'active_alerts', 'raw_items') order by relname;
select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('events', 'tracks', 'active_alerts', 'raw_items') order by relname;
```

The existing opt-in `getRealtimeStats()` in `warzone-realtime-performance.js` reports browser callback counts per channel and queue cost without sending telemetry to Supabase; it is a **single-client estimate**, not billing. For organization budget warnings, copy the actual Supabase usage total and exact cycle dates into the offline tool:

```powershell
node apps/worker/scripts/realtime-usage-budget.mjs --messages=19527906 --cycleStart=2026-10-01T00:00:00Z --cycleEnd=2026-11-01T00:00:00Z --asOf=2026-11-01T00:00:00Z
```

Defaults: review at 100,000/day, warning at 130,000/day, critical at 160,000/day, and budget risk at a projected 4,000,000/cycle. Override with `--review=`, `--warning=`, `--critical=`, and `--monthly=`. Projection uses the supplied cycle length, not a fixed 30-day month. It makes no network request. The supplied 19,527,906 total implies 15 whole 1-million overage packages, or $37.50 Realtime overage at $2.50/package, assuming a 5-million Pro quota. At under 4 million there is no Realtime overage; $25 is only the Pro base, excluding other services, taxes and credits. Future cost cannot be estimated responsibly until post-change usage is measured.

Supabase references: [message billing and usage reports](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages), [Postgres Changes filters](https://supabase.com/docs/guides/realtime/postgres-changes), [DELETE filter limitation](https://supabase.com/blog/postgres-changes-filters-and-column-selection), [HTTP 402 service restriction](https://supabase.com/kb/troubleshooting/http-status-codes).

## Security and release

The reported disabled RLS on `public.events`, `public.active_alerts` and `public.raw_items` may expose rows or writes through the publishable client depending on grants. Review actual grants, policies and API dependencies with a database administrator. Keep service-role keys server-side. Do not enable RLS, revoke privileges, remove publication tables or apply SQL from this audit without a separately tested migration and authorization.

Deploy the frontend build through the existing reviewed process only after approval. The subscription filter needs no migration and does not change worker or API binaries. Rollback is the previous frontend bundle (or remove the three filtered bindings and restore the prior `event: "*"` `tracks` binding), then rebuild and redeploy; retain the database and worker unchanged. Validate aircraft INSERT/UPDATE/DELETE, naval simultaneous tracking, layer OFF/ON and region switching, then compare Supabase billing metrics over an equivalent interval. This local build and tests do not prove production savings.

## V1.1 follow-up: writer and live-delivery audit (2026-11-01)

Laptop B worker configuration enables the aircraft and naval live pollers at 5,000 ms each. These are configured local values; deployed process configuration was not read. Each poller skips overlap within its own process, and the five-minute general cycle excludes its corresponding fallback when live polling is enabled. This does not prove there is only one deployed worker instance.

| One qualified record in a successful cycle | `events` | `tracks` | History table |
| --- | --- | --- | --- |
| Aircraft | One event only if that aircraft has not appeared in the 45-minute in-process seen cache; otherwise zero | One upsert every cycle | One `aircraft_tracks_log` upsert every cycle |
| Naval | One `signal` upsert every cycle, keyed by vessel identity | One upsert every cycle | One `naval_tracks_log` upsert every cycle |

The row builders are in `adsb-worker.js` and `ais-worker.js`; the writes occur at the end of `runAdsbWorker` and `runAisWorker`. An identity reconciliation can additionally mark an old naval `tracks` row ended. Two identical-observation fixture cycles wrote aircraft `events` rows `[1,0]`, aircraft tracks/history `[1,1]`, and naval events/tracks/history `[1,1]` each. The naval event has the same source `occurred_at` on both cycles. These are persistence-call counts, not proof of committed rows or billable messages.

Read-only project checks now return HTTP 200. Current row counts were 45,525 aircraft tracks, 1,757 naval tracks, 4,424 `flight_tracking` events, and 711 `signal` events. These include retained historical rows and are not active-object counts. Across two 16-second samples of the 500 most recently updated naval tracks, 88 shared rows changed `updated_at`, while only one changed `occurred_at` or position. For aircraft tracks, 15 changed `updated_at` and `occurred_at`, and 12 changed position. The 500 sampled `flight_tracking` and 500 sampled `signal` event rows had no observed-time or position change. The deployed `events` table has no `updated_at` column, so row snapshots cannot count its updates.

A simultaneous, read-only 30-second Realtime comparison used temporary public-key subscriptions that were removed immediately afterward. All four channels subscribed successfully. Old/new `events` subscriptions each received 540 messages; none of the old messages was `flight_tracking` or DELETE. The old `tracks` subscription received 520 messages, including 450 naval; the V1 aircraft-filtered subscription received 70. In a separate 20-second event-type sample, all 356 messages were AIS `signal` UPDATEs: 348 from AISStream and eight multi-source. These measurements are per one test client and short observation windows, not monthly billed totals. The V1.1 `events` filter was accepted by the deployed Realtime service, but yielded zero savings in the 30-second comparison because no aircraft event was emitted then. It continues to preserve null/other report types and excludes only the `flight_tracking` rows that `handleIncomingEvent` already discards, plus DELETE events its callback already ignores.

For a cycle with A qualified aircraft, N qualified naval vessels, and E aircraft not seen in the last 45 minutes, source code issues up to A+N `tracks` upserts, N+E `events` upserts, and A+N history upserts, before other worker/API traffic. With C_event pages and C_air aircraft subscribers, a simplified delivered-message model for these published streams is `C_event * (N + E + other_event_changes) + C_air * (A + naval_deletes)`, after V1 but before V1.1; V1.1 removes the E term from event delivery. This assumes successful writes and one message per delivered change. Live messages confirm `events` and `tracks` are published. Actual billing also includes Broadcast, other subscribers, reconnect traffic, and any additional published tables. Other tables' publication membership and billable cycle totals remain unverified without dashboard/SQL access.

The next likely high-impact change is a **database-side conditional naval event upsert**: update a vessel event only when its meaningful fields differ, while inserting missing rows and updating on any new observation, position, classification, or metadata change. This would avoid Realtime notifications for unchanged snapshots without relying on a process-local cache. It needs the actual `events` schema, conflict constraints, publication membership and a tested migration/RPC plan. A frontend filter cannot remove AIS `signal` events because Naval Tracker consumes them. No naval writer, collection interval, database function, or publication was changed in V1.1. The 4-million-message goal cannot be projected reliably from these short samples; compare the organization billing report over an equivalent period after an approved deployment.

V1.1 rollback: redeploy the preceding frontend bundle, or restore the original wildcard `events-live` binding in `warzone-realtime.js` and rebuild. The lifecycle test correction only supplies the resize callback already defined by production; it has no runtime effect. No worker or database rollback is required for V1.1.
