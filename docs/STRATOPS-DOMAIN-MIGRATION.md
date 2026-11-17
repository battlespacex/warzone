# StratOps domain migration and separate public website

Local implementation: 2026-11-16. No deployment, AWS API operation, certificate/DNS change, environment-file edit, database migration, commit or push was performed. The working tree was clean at the start; earlier tracker, GNSS, naval OSINT and performance implementations remain in place.

## Domain contract

| Origin | Responsibility |
| --- | --- |
| `https://stratops.space` | New static public website; build directory `public-site/` |
| `https://www.stratops.space` | Permanent redirect to apex, on the public distribution only |
| `https://app.stratops.space` | Existing operational portal; normal build directory `production/` |
| `https://api.battlespacex.com` | Existing API, unchanged |
| `https://www.battlespacex.com` | Existing company/account authentication, unchanged |
| `https://stratops.battlespacex.com` | Retired application hostname; not a new primary URL |

`apps/shared/stratops-domains.json` is the shared origin contract used by operational SEO, API default CORS, billing callback defaults and the public build. Existing explicit environment overrides retain precedence. Existing feature-specific API configuration remains intact; this is not a rewrite of all URL handling.

Confirmed repository defects corrected: malformed CORS defaults ending in `stratops.space.com`; operational canonical/social base incorrectly pointing to the marketing apex; report breadcrumb typo `app.stratops.spacem`; billing default pointing to the marketing site; production-host protections in staging tools missing the new names.

Remaining old-host references are historical reports/artifacts, compatibility/security rejection tests, retained production load-test denylists and operator environment overrides. They were not blindly replaced. S3 bucket `warzone.battlespacex.com`, API, imagery/source URLs, company links and account endpoints are intentionally unchanged. No generated operational bundles were hand-edited.

## Source changes

| Files | Change / functions |
| --- | --- |
| `apps/shared/stratops-domains.json` | Separate public, portal, API, company and retired origins |
| `apps/api/src/index.js` | Correct `DEFAULT_CORS_ORIGINS`; retain configured origins and existing middleware |
| `server/billing-routes.js` | `getStratopsDomain` defaults to the portal, retaining explicit configuration |
| `seo/site.js`, `seo/pages.js` | Portal canonical/social origin, noindex application home, corrected breadcrumb |
| `dev/public/robots.txt`, `dev/public/sitemap.xml` | Separate public sitemap ownership; noindex portal pages omitted from sitemap; static assets remain crawlable |
| `dev/assets/js/index.js` | Existing single boot calls `initStratopsIntro({skipPreEntryShowcase:true})` |
| `dev/assets/js/essential.js` | Existing direct intro branch marks showcase complete and invokes `openEntryIntroModal`; consent and auth handlers unchanged |
| `dev/marketing/index.html`, `site.css`, `site.js`, `robots.txt`, `sitemap.xml` | Independent public site, scoped styles, accessible navigation/tool tabs, media visibility controls, public SEO |
| `webpack.marketing.config.cjs` | Mode-aware config factory: development style injection and existing filesystem watch policy; production hashed JS/CSS, existing brand media/font copy, no operational imports or environment injection |
| `server/serve-public-site.cjs`, `package.json`, `.gitignore` | Dedicated static preview/build commands and ignored public build output |
| `scripts/dev.cjs`, `scripts/dev-site.cjs`, `scripts/tests/dev-site.test.cjs` | One-command local website plus portal startup, recognized existing-app reuse and owned-server/compiler cleanup |
| `scripts/deploy-production.ps1` | `Assert-DeploymentTarget` staging checks reject new production hosts/aliases as well as retired host |
| `scripts/gnss-load-test.cjs`, `scripts/tracker-stability-test.cjs` | Keep production domains excluded from staging/load runs |
| `scripts/cloudfront/public-www-redirect.js` | Manually deployable public-only www redirect; paths/repeated query values retained |
| `scripts/verify-marketing-browser.cjs` | Local rendered responsive/menu/tab/network checks and screenshots; no production target |
| `scripts/marketing-assets.cjs`, `scripts/tests/marketing-assets.test.cjs` | Public-only local/live byte, MIME and cache metadata gate including media/font dependencies |
| `scripts/tests/domain-migration.test.cjs`, `marketing-runtime.test.cjs`, `deploy-production.test.ps1` | Domain separation, original entry branch, media/menu/tab behavior, redirect and staging protections |
| `apps/api/test/reporting-capture-route.test.js` | Update four obsolete URL assertions to match existing app-domain fixtures |

No operational CSS/root token, camera, model, tracker, satellite, GNSS, worker implementation, ingestion or database schema was changed. Operational webpack, dependency versions and lockfiles are unchanged.

## Entry and public website

The portal skips only `initPreEntryShowcase`. It opens the existing Capabilities / Rules of Engagement modal through its existing function. It does not click ENTER, check acknowledgement, authenticate, select a region, reinitialize the viewer or start operational trackers. The existing optional mobile-warning gate is retained if enabled. Existing guest/sign-in/consent/region transitions still own entry. Full browser gate verification is pending.

The public site implements all thirteen requested sections: cinematic hero, overview, eight domains, globe showcase, operational capabilities, workflow, technology, interactive tools, audiences, transparency, access, final CTA and footer. Copy distinguishes observations, reported areas and orbital prediction; no universal coverage, live imagery, pricing or partnership claims were added. The gallery changes explanatory content for implemented tools, without booting the operational application. Existing branded globe media is used, not fabricated dashboard screenshots.

Root design tokens are imported unchanged; new selectors are scoped to the marketing page. The existing Chakra Petch font and its OFL license are copied. No framework, external font request, analytics, credentials, API polling or Cesium initialization is added to the public website.

The actual existing hero movie is **98.5 MiB**. It is preserved rather than recompressed or replaced. Video uses `preload=none`, poster, offscreen/background pause and a pause/play control. Mobile (<=800px), reduced-motion and Save-Data visitors do not automatically download it; explicit Play opts in. Desktop playback still transfers a large movie. A separately approved smaller encoding remains a useful future media improvement; no measured page-load gain is claimed.

Footer links use repository-confirmed company, contact, social and portal rules destinations. **No independently verified public privacy-policy URL was found.** Privacy enquiries link to the existing contact mailbox; the Terms link opens the portal containing its existing rules. A dedicated approved public Terms/Privacy destination is a remaining content dependency, not invented legal text.

## Authentication and external configuration: release checks

The portal uses BattlespaceX cookie authentication (`https://www.battlespacex.com/api/auth/validate` and `/login`), with credentialed requests. `app.stratops.space` and `battlespacex.com` are different sites. An old cookie/localStorage session does not migrate to the new origin automatically. The company authentication backend is not available here and was not changed.

Before release, the account-backend owner must check its exact CORS allowlist for `https://app.stratops.space`, credentials support, CSRF/Origin validation and approved return URLs. Inspect actual session cookie Domain/Path/Secure/HttpOnly/SameSite attributes and third-party cookie behavior. `SameSite=None; Secure` is necessary for cookies used cross-site but is not sufficient when a browser blocks third-party cookies. Use the existing backend's supported secure auth flow; do not copy tokens across origins, wildcard credentialed CORS, or weaken CSRF. A supported same-site/redirect architecture may be required from that backend if browser policy blocks the present flow. Sign-in/subscription compatibility cannot be certified by this source patch alone.

The local API `.env.production` still has old-host `CORS_ORIGIN` and `STRATOPS_DOMAIN` settings. **It was not modified.** The operator should review the deployed API configuration and change only these intended settings when authorized:

```dotenv
STRATOPS_DOMAIN=https://app.stratops.space
CORS_ORIGIN=https://app.stratops.space,https://stratops.space
```

Preserve approved staging origins if needed; remove obsolete/malformed origins deliberately. Code adds exact new defaults, but `STRATOPS_DOMAIN` overrides the billing fallback. Inspect the separate server process environment too if billing runs there. Do not rotate provider keys or change `api.battlespacex.com`.

Review Stripe checkout success/cancel and customer-portal return URLs in actual integration configuration, including supporter returns. Keep the API webhook URL unchanged. Review Supabase Auth Site URL/redirect allowlist **only for flows actually using Supabase Auth**; client-library presence alone does not establish that the BattlespaceX session uses it. Add exact app callbacks where applicable; do not use an unrestricted wildcard. Check email verification/password-reset links, account registration `returnUrl`, logout contract and company CSP connect/frame/form policies. No logout endpoint or OAuth flow was invented.

## AWS already completed versus remaining

User-confirmed existing configuration: app alias/certificate/Route53 work on distribution `E2EFV9935XX3MV`. Preserve its S3, frontend EC2 and `api.battlespacex.com` origins, current `/events/intel-feed/media/*`, `/api/*`, `/poster*`, `/assets/cesium/*` and default behavior order. Do not replace its certificate, re-add the retired alias, create a second operational distribution or change nameservers. Existing apex/wildcard ACM certificate in us-east-1 should be reused for the public site.

AWS says each flat-rate plan covers one distribution and up to one apex domain. App and apex share the same root; this rule alone does **not** force two distributions. However, CloudFront behaviors route by path, whereas both experiences use `/` and `/assets/*`. Sharing the current distribution would require host-aware edge routing/origin changes and certificate changes, contrary to the instruction to leave it unchanged. Therefore use a separate **public** static distribution, reusing the existing private S3 bucket with prefix `public-site/`. No second app, EC2 server, new bucket or plan upgrade is inherently necessary. Check the account's permitted plan/distribution allocation before creation; no zero-cost eligibility or final cost is asserted. [AWS plan documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

Manual public Console setup, after authorization:

1. S3 > `warzone.battlespacex.com`: keep Block Public Access, ownership, encryption and versioning settings unchanged. Store public files under `public-site/` only. Do not change operational keys.
2. CloudFront > create/select the separate PUBLIC distribution. Origin: bucket regional REST endpoint, **not website endpoint**. Origin path `/public-site` (no trailing slash). Use OAC, signing always. Add only an OAC bucket-policy statement permitting `s3:GetObject` on `arn:aws:s3:::warzone.battlespacex.com/public-site/*` with `AWS:SourceArn` equal to this public distribution ARN. Preserve all existing statements; no bucket-wide public access.
3. General: default root object `index.html`; aliases `stratops.space`, `www.stratops.space`; attach existing issued apex/wildcard certificate from us-east-1; SNI, TLS1.2 or newer policy. Viewer protocol redirect HTTP to HTTPS; GET/HEAD only. Enable IPv6 if using AAAA DNS.
4. Public default behavior: managed **CachingDisabled** so mutable HTML is not stale. Public `assets/*` behavior: **CachingOptimized**, compression on, no cookies/query/header variants beyond managed compression normalization. Both target the same public S3 origin. Keep short object headers for fixed-name media (300 seconds) and immutable headers only for hashed JS/CSS. Managed CachingOptimized has min TTL 1 second; do not claim it honors no-store at TTL zero. These managed-policy choices avoid depending on plan-restricted custom cache policies. [AWS managed policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html).
5. PUBLIC error responses only: 403/404 -> `/404.html`, response code **404**, error caching TTL 0 (S3-origin minimum caching behavior may still apply). Do not use an index.html/200 fallback. Do not modify operational asset error handling.
6. CloudFront Functions: runtime 2.0; copy `scripts/cloudfront/public-www-redirect.js`, test apex pass-through and www redirect, publish and associate viewer-request on **both public default and assets behaviors**. Never attach it to the operational distribution. Fixed apex destination prevents an open redirect.
7. Route53 existing hosted zone: apex A/AAAA Alias -> PUBLIC distribution; www A/AAAA Alias -> same PUBLIC distribution. Leave app A/AAAA pointed at `E2EFV9935XX3MV`. Do not change nameservers.
8. Wait for Deployed, then verify cert, HTTPS, apex page, www path/query redirect, public404, asset MIME/headers and app independence. Do not enable paid logging or services as part of this patch.

A legacy-domain redirect would separately require control of its old DNS, a serving endpoint/distribution with the old hostname alias and a matching attached certificate, and a fixed app redirect. Its presence on an unused certificate is insufficient. It was not configured and is not a prerequisite for the new site's local build.

## Build and local verification

The default development command starts both local experiences:

```powershell
npm run dev
# Website: http://localhost:4174/ ; local application: http://localhost:4173/
# ENTER STRATOPS navigates from the website to that running local application.

# Optional independent commands (not needed alongside the combined command):
npm run dev:app
# Operational globe and existing capabilities gate: http://localhost:4173/pages/index.html
npm run dev:marketing
# Website only; requires an app server on 4173 for local portal links to work.
```

Initially the dev command opened only the portal; the first correction opened only marketing, leaving local portal links unreachable unless a second server was started manually. `npm run dev` now uses the existing optimized environment bootstrap and starts **separate webpack compilers and servers** for both experiences. Only the marketing browser tab auto-opens. The local app is probed once at startup: a recognized existing portal is reused without allocating another app compiler or taking ownership of its process; an unrecognized occupied app port is rejected. There is no recurring health polling. Ctrl+C stops only servers/compilers started by this launcher. `dev:app` retains the original standalone launcher. `dev:marketing` retains website-only development.

Marketing development CTAs point to `http://localhost:4173/`; production CTAs still point to `https://app.stratops.space/`. Stop the previous website-only dev process, then restart `npm run dev`. Wait for the application's initial compilation before entry. `npm run dev -- --no-open --port 4186` changes only the public website port; the combined app stays on 4173. Other webpack arguments remain available through the standalone commands. The static production-artifact preview `serve:marketing` intentionally retains production CTA destinations.

The public dev client overlays compilation/runtime **errors only**. Size warnings remain in the terminal/browser console and production build output; they do not cover the page. Restart `npm run dev` after changing dev-server configuration. This does not compress the existing 98.5 MiB movie or remove its legitimate production warning.

### CSS save / hot-update correction

The original marketing configuration extracted content-hashed CSS in development as well as production. A real isolated watch/HTTP reproduction confirmed a save changed `/assets/site.b3063995.css` to `/assets/site.cdf371e2.css`; the old URL immediately returned **404**. The installed MiniCssExtractPlugin hot-reload fallback reloads the existing link URL and removes the previous stylesheet even on a loading error. That combination can leave stale or missing styles after a save. File watching itself did trigger the reproduction's rebuild.

Development now uses the existing `style-loader` dependency to update style elements in place, a stable development JS URL, explicit HMR/live reload, `no-store` response headers and the project's existing native-local/network-polling watch policy. It no longer emits a changing CSS link for each save. Production still extracts/minifies content-hashed CSS. The combined launcher invokes the marketing config factory with development mode; standalone dev and production CLI calls use the same factory. No declaration in the user's `dev/marketing/site.css` or operational/root CSS was edited for this correction.

After this configuration change, stop the old dev process and restart `npm run dev`, then reload `http://localhost:4174/` once to replace the old hot-update client. Subsequent saved CSS edits should apply without manual refresh. `http://localhost:4175/` is a static production-artifact preview and intentionally requires rebuilding; it is not the live development server.

Verification: **16 focused tests passed**, including `scripts/tests/marketing-dev-hmr.test.cjs`, which starts a real isolated dev server, replaces a fixture CSS file atomically twice, verifies each rebuild and corresponding HTTP-200 hot-update payload, and confirms the stable JS resource stays available with no extracted stylesheet link. The fixture does not touch user CSS. Marketing production build and all eight public assets passed. Chrome launch still failed `spawn EPERM`, so in-browser style application/visual appearance is not claimed verified. Existing large-film warnings remain.

Operational production recheck after the CSS development correction: passed in **46,714 ms**, with 392 Cesium assets, 27 application JS/CSS assets and 64 GLB assets passing integrity checks. Operational rendering code was unchanged.

```powershell
npm run build:marketing
node scripts/marketing-assets.cjs --verify public-site
npm run serve:marketing
# Open http://127.0.0.1:4175 (preview is static; no API/auth initialization).
```

Operational normal release command remains `npm run build`. For this task the **real production config** was built with an output-only wrapper, leaving tracked `production/` intact:

```powershell
npm run build -- --config .generated/domain-migration/webpack.config.cjs
node scripts/cesium-assets.cjs --verify .generated/domain-migration/build
node scripts/frontend-assets.cjs --verify .generated/domain-migration/build
node scripts/model-assets.cjs --verify .generated/domain-migration/build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -ValidateOnly -BuildDirectory .generated/domain-migration/build
```

The wrapper loads `webpack.config.js` and redirects only output and corresponding CopyPlugin destinations; it is a local artifact, not an alternative deploy configuration. Recreate it with that same output-only approach if absent, or intentionally use normal `production/` for a reviewed release.

## Operator deployment commands: NOT RUN

Save the previous served HTML, manifests and non-hashed assets/configuration in a private release archive first. Keep old hashed bundles and complete Cesium releases. Reusing S3 does not mean using the same publish root.

Operational upload: existing reviewed script; first inspect a dry run, then use `-Execute` only after sign-in/guest staging acceptance and explicit deployment approval:

```powershell
$awsProfile = 'YOUR_APPROVED_DEPLOY_PROFILE'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-production.ps1 -SkipBuild -BuildDirectory .generated/domain-migration/build -TargetEnvironment production -Bucket warzone.battlespacex.com -DistributionId E2EFV9935XX3MV -PublicBaseUrl https://app.stratops.space -Profile $awsProfile
# After approval ONLY: repeat the exact command with -Execute.
```

The existing script uploads immutable Cesium, validates it, uploads application assets, validates JS/CSS/GLBs, and publishes HTML last. It does not delete retained assets. Its root HTML remains `pages/index.html` according to existing routing; do not set operational default root to the marketing index. API/backend publication is a separate normal operator deployment, with reviewed configuration; no automatic EC2 command is introduced here.

Public upload dry run (PUBLIC distribution ID must differ from the operational ID):

```powershell
$awsProfile = 'YOUR_APPROVED_DEPLOY_PROFILE'
$publicDistributionId = 'YOUR_PUBLIC_DISTRIBUTION_ID'
if ($publicDistributionId -eq 'E2EFV9935XX3MV') { throw 'Public and app distributions must be separate.' }
aws --profile $awsProfile s3 sync public-site/ s3://warzone.battlespacex.com/public-site/ --exclude '*.html' --cache-control 'public, max-age=300' --dryrun
aws --profile $awsProfile s3 sync public-site/ s3://warzone.battlespacex.com/public-site/ --exclude '*' --include '*.html' --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, no-store, must-revalidate' --dryrun
```

After separate deployment approval, upload assets first, validate through PUBLIC CloudFront, then HTML:

```powershell
aws --profile $awsProfile s3 sync public-site/ s3://warzone.battlespacex.com/public-site/ --exclude '*.html' --exclude 'assets/site.*.js' --exclude 'assets/site.*.css' --cache-control 'public, max-age=300'
if ($LASTEXITCODE -ne 0) { throw 'Public supporting asset upload failed; stop.' }
aws --profile $awsProfile s3 sync public-site/ s3://warzone.battlespacex.com/public-site/ --exclude '*' --include 'assets/site.*.js' --include 'assets/site.*.css' --cache-control 'public, max-age=31536000, immutable'
if ($LASTEXITCODE -ne 0) { throw 'Public bundle upload failed; stop.' }
node scripts/marketing-assets.cjs --verify-live public-site https://stratops.space
if ($LASTEXITCODE -ne 0) { throw 'Public asset validation failed; do not publish HTML.' }
aws --profile $awsProfile s3 sync public-site/ s3://warzone.battlespacex.com/public-site/ --exclude '*' --include '*.html' --content-type 'text/html; charset=utf-8' --cache-control 'no-cache, no-store, must-revalidate'
if ($LASTEXITCODE -ne 0) { throw 'Public HTML upload failed; inspect partial publication.' }
aws --profile $awsProfile cloudfront create-invalidation --distribution-id $publicDistributionId --paths '/' '/index.html' '/404.html' '/robots.txt' '/sitemap.xml'
```

No `--delete` and no bucket-root marketing sync. AWS CLI sync does not repair metadata on unchanged objects; inspect headers and perform separately reviewed key-specific metadata correction if needed. Retain old hashed public bundles for cached HTML. Fixed-name marketing images/video/font changes need affected `/assets/...` invalidations; do not invalidate the app distribution for public files. Never run the operational deploy script against `public-site/` (it correctly lacks the required operational manifests).

## Actual validation and release limits

- Operational production build: **passed**, webpack 5.108.4, isolated output; initial run 38,152 ms and development-entry follow-up run 118,121 ms.
- Operational integrity: **392 Cesium assets, 27 application JS/CSS assets, 64 GLBs passed**; deployment ValidateOnly passed with no AWS calls. Cesium manifest/release/file hashes exactly match the preceding local naval build (`1.143.0-a807d548a0cedded-standard`). This does not identify live production bytes.
- Domain/delivery/model/load-runner and marketing runtime/integrity regression group: **27 passed, zero failed**, including the default public dev entry and separate local portal/production CTA regression.
- API reporting + entry/startup/optional notice/layer ownership/resource lifecycle group: **53 passed, zero failed**.
- PowerShell deployment tests: **22 mocked scenarios passed**, no AWS/network activity.
- Marketing production build: passed, with two webpack performance warnings for the existing 98.5 MiB film; JS/CSS integrity passed. Video is not an automatic mobile/reduced-motion/Save-Data transfer.
- Complete public local asset gate: **8 assets passed**, including movie, posters, logos and font/license. Local preview HTTP checks returned 200 with correct MIME for all eight, the homepage CTA points to the app, and a missing route returns actual 404. These are HTTP checks, not rendered browser acceptance.
- `npm run dev -- --no-open`: actual dev server compiled successfully and served the marketing homepage at `http://localhost:4174/`; HTTP checks confirmed local portal CTAs and absence of the operational intro modal from that HTML. Production marketing HTML still links to `https://app.stratops.space/`. The test server was stopped afterward. Browser auto-open and rendered appearance remain unverified.
- Combined-launcher follow-up: **15 focused tests passed**, including four startup/reuse/failure-cleanup tests. Actual `npm run dev -- --no-open --port 4186` started both servers; website HTTP 200 contained marketing and local app links, app HTTP 200 contained the original intro modal. App development compilation passed in 4,569 ms. A second public server on 4187 reused that app; stopping the second server left the app responding correctly. Browser click/auth/visual results remain unverified. One local webpack cache-write EPERM warning was observed; compilation and HTTP serving succeeded.
- Combined-launcher production recheck: operational production build passed in **61,820 ms**; public production build passed in **2,135 ms**, retaining the two existing movie-size performance warnings. Both outputs remain separate. All test servers owned by this check (4173/4186/4187) were stopped; the pre-existing website-only process on 4174 was not stopped or replaced.
- JavaScript syntax and `git diff --check`: passed. No claim that every repository test was run.
- Browser automation: installed Playwright browser missing; installed Chrome launch failed `spawn EPERM`; alternate browser-control initialization also failed in this environment. **No rendered responsive screenshots, real sign-in/guest flow, operational visual/performance or live AWS results are claimed.**

Run `node scripts/verify-marketing-browser.cjs` on a desktop allowing Chrome automation. It checks 320/375/390/430/768/1024/1440/1920 widths and 844x390 landscape, overflow, menu/tab operation, local assets, no external requests and reduced-motion video behavior; saves full-page screenshots. Visually review those screenshots and manually test touch/keyboard, video crop/pause/resume and legal destinations. Automated geometry checks alone do not establish a premium visual result.

Then test the authorized staging portal: direct navigation and refresh show the original modal; no old showcase; acknowledgement required; guest and account entry; region changes; one existing viewer and decorative satellite lifecycle; no repeated loader, camera reset, duplicate subscriptions or trackers. Verify Air/Naval/Orbital/GNSS/NOTAM/AOI/reports/focus and GLBs, API CORS, actual session cookies, subscription returns and logout using supported backend behavior. Compare the same baseline dataset/device for performance. None of these live flow checks are substituted by static tests.

**Release status:** local implementation/build gates pass. Production readiness remains conditional on rendered responsive/portal acceptance, account-backend cross-site authentication, approved legal links, operator environment review and manual public hosting setup. CloudFront's earlier `503 LimitExceeded` enforcement is separate and is not resolved or stress-tested by a domain/marketing patch.

## Rollback

Public: restore the saved previous public HTML and any deliberately changed non-hashed files under `public-site/`; invalidate only affected public entry/media paths. Retained hashed assets keep older sessions usable. On a first deployment, remove/restore only the newly approved public DNS aliases or distribution association as an operator action; never repoint app DNS or overwrite its keys to roll back marketing.

Portal: restore the exact archived previous application HTML/manifests/non-hashed files and reviewed backend configuration, retaining both old and new immutable Cesium releases and hashed JS/CSS. Invalidate the affected operational entry routes using the existing runbook. Do not rebuild an old checkout and assume identical bytes. Do not reset the source working tree, delete S3 objects, remove the app alias/certificate, or change provider data. Treat rollback and environment edits as separately authorized operator actions.
