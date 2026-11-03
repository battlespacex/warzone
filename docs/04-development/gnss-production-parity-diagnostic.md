# GNSS local / production parity diagnostic (read-only)

## Scope and evidence
- Local screenshot: 11,323 regional GNSS cells, Cesium hexagons visible.
- Production screenshot: no hexagons, unknown observation period, source unavailable.
- Repository route: `GET /events/gnss-interference` in `apps/api/src/routes.events.js`, mounted by `apps/api/src/index.js`.
- Provider: `apps/api/src/gnss-gpsinterference.js` requests `https://api.gpsinterference.com/v1/interference/latest` server-side.
- Frontend: `dev/assets/js/warzone-gnss.js` renders `sourceMode: gpsinterference` observations using Cesium.
- Screenshots alone **cannot** establish whether the difference is deployment version, routing, CDN cache, server egress, missing config or entitlement.

## Production evidence from the EC2 PowerShell screenshots
- The production checkout is on `main` and reports **1 local commit ahead and 10 remote commits behind** `origin/main`; do not use a blind `git pull`.
- `apps/api/src/gnss-gpsinterference.js` is **absent** on EC2, although it exists on the current repository main branch. This confirms missing GNSS provider code in the production checkout.
- EC2 `apps/api/src/routes.events.js` registers `/gnss-interference` with the legacy inline route and imports `getPublicGnssInterferenceCells`. Current main uses `createGnssInterferenceHandler` with the GPSInterference provider and the public cells function only as fallback.
- The EC2 API response exposes `sourceMode: live`, with the requested V3 metadata fields empty. The API process is online, not necessarily current.
- The tested production public URL in the screenshot is `https://stratops.battlespacex.com/api/events/gnss-interference`. The browser Network panel remains authoritative for the actual request.
- The `localhost:3000` and `localhost:8080` checks were executed on the EC2 server, not the working local development machine.
- The screenshots show untracked `generated/reports/daily/global/2026-11-01/` and `index.html`. Preserve both.

## Safe Git reconciliation (no automatic deployment)
1. On EC2 run `git fetch origin`, `git status`, `git log --oneline origin/main..HEAD`, and `git diff --name-status HEAD..origin/main`. Fetch does not modify the working tree.
2. Create a preservation ref with `git branch backup/ec2-before-gnss-sync HEAD` (use a unique name if it already exists). Copy the untracked reports and `index.html` to a safe location outside the repository before any merge.
3. Prefer integrating the reviewed PR into `origin/main` in GitHub, then use a separate staging checkout/worktree to run the tests and review conflicts. Do not overwrite the running checkout or assume `git pull` is conflict-free.
4. Reconcile the server-only commit by review or cherry-pick as appropriate, without discarding it. If you choose an in-place merge after backups, use `git merge origin/main` and resolve conflicts deliberately; it must not silently overwrite untracked files.
5. Check the exact PM2 `warzone-api` cwd and start command before a controlled deployment. Merging Git alone does not restart or update the running Node process.

## Changes in this PR
- GNSS API returns `X-StratOps-GNSS-API-Version: gpsinterference-v3`. If absent on production, inspect routing/deployment before assuming the new handler is deployed.
- GNSS API returns `Cache-Control: no-store, max-age=0` to avoid caching an old empty GNSS response.
- GNSS upstream failures log one bounded, sanitized diagnostic per retry cooldown; no credentials or raw payload are logged.
- No new poller, Supabase writes, entitlement bypass, visual changes or provider subscriptions.

## Read-only verification commands (Windows PowerShell)

Use identical parameters locally and in production. These bounds are a North America comparison sample; they are not a guarantee of 11,323 cells.

```powershell
$path = "/events/gnss-interference?date=latest&minLat=15&maxLat=75&minLon=-170&maxLon=-50&limit=12000"
$prod = Invoke-WebRequest -Uri ("https://stratops.battlespacex.com/api" + $path) -Headers @{ "Cache-Control" = "no-cache" } -UseBasicParsing
$prod.StatusCode
$prod.Headers["X-StratOps-GNSS-API-Version"]
$prod.Headers["Cache-Control"]
$data = $prod.Content | ConvertFrom-Json
$data | Select-Object sourceMode,sourceHealth,observationPeriod,updatedAt,totalCells,liveAvailable,tableAvailable,message
$data.cells.Count
```

**Check the actual browser request in Chrome DevTools > Network > GNSS request**. A reverse proxy or frontend configuration may use a different host or path. Record full request URL, HTTP status, response JSON keys, version header, and `x-cache` / `age` headers if present. Compare the same query with the local API port in use (do not assume it is 8080).

If production returns 404, the request is routed to the wrong API or an older API build. If the version header is absent, verify the deployed process/build or an intermediary stripping the header. If header is present but `sourceHealth: unavailable`, inspect API PM2 logs for `[gnss-provider]` upstream failures and verify the server can reach the provider; this is not a frontend rendering defect. If `sourceMode: gpsinterference` and cells exist but hexes are missing, inspect entitlement, layer toggle, console errors, Cesium primitive batches and CDN frontend build hashes.

Check process identity and server-only Git changes **before** any update:

```powershell
pm2 list
pm2 describe warzone-api
git status
git log --oneline origin/main..HEAD
git log --oneline HEAD..origin/main
```

If `warzone-api` is not the PM2 process name, inspect the actual service without restarting anything. Do not print or share secrets from environment files or PM2 environment dumps.

## Deployment and rollback
1. Merge only after reviewing API tests: `node --test apps/api/test/gnss-route.test.js apps/api/test/gnss-gpsinterference.test.js`.
2. Preserve any server-only commit, untracked reports and configuration. Do not use `git reset --hard`, `git clean`, forced pulls/pushes or blanket PM2 restarts.
3. Confirm frontend and backend artifact versions independently. Deploy API and static assets through the existing controlled process; do not infer that a frontend deploy updates the API.
4. Verify the production response version header, `sourceMode`, `cells.length`, `observationPeriod` and Cesium rendering for the same bounds/date/severity.
5. Rollback by redeploying the previous known-good API commit and static asset release through the existing deployment mechanism, after preserving all server changes. The GNSS response marker can verify rollback; no database rollback is required by this PR.

**Not verified here:** Actual production response, CloudFront invalidation, PM2 process code path, production provider network reachability, entitlement state, and live browser rendering. Do not report a definitive root cause until those checks are performed.
