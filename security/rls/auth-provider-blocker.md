# Production security blocker: cookie auth provider and privileged public API

## Evidence verified against main (2026-11-03)
- `dev/assets/js/essential.js` uses `https://www.battlespacex.com/api/auth/login` and `/validate` with `credentials:"include"` and maintains `window.__stratopsAuthState`.
- These endpoints use cookie sessions. `window.__stratopsAuthState` and the local/staging bypass branches are UI state only, **not** a trustworthy database JWT.
- `dev/assets/js/supabase.js` uses a publishable key with session persistence/refresh disabled and no known user JWT.
- `apps/api/src/routes.events.js` serves `GET /events/map`, `/events`, `/events/alerts`, `/events/since`, `/events/intel-feed`, and many other endpoints using a service-role client; API route authorization must be audited. The route also has `POST /events` and its writer authorization must be checked separately.
- `apps/api/src/index.js` mounts events routes without a global auth middleware. A CORS allowlist is not user authentication.

## Why no automatic merge / production SQL execution
- Supabase RLS cannot authorize BattlespaceX cookie users until the trusted BattlespaceX auth backend supports a verifiable, authorized token exchange compatible with Supabase.
- That backend is NOT in the sole connected repo, `battlespacex/warzone`. Client-side cookies cannot safely be promoted to database identity.
- Browser UI flags or local/staging auth bypass must never grant DB read or write rights.
- Switching on RLS now will break real-time events/tracks/alerts for existing customers.
- Turning off unauthenticated API routes without a working token bridge will break the application too.
- Keeping unrestricted server-role API endpoints after RLS is enabled would still expose data.

## Next integration task
1. Obtain source access for the BattlespaceX web backend implementing /api/auth/login and /api/auth/validate.
2. Implement an authenticated, origin-checked, CSRF-resistant, session-bound token exchange on that trusted backend. Use short-lived JWTs verified by Supabase (or properly configured third-party JWT integration), never any browser-asserted account ID or a publicly callable signing endpoint. Include revocation/expiry strategy.
3. Provision verified Supabase Auth identities and approved user membership. The staged SQL currently expects auth.users UUIDs.
4. Implement on StratOps frontend a secure token handoff, token refresh / logout, and Realtime setAuth before subscription. Maintain current UX. Fix local/staging bypass to remain UI-only.
5. Audit and gate sensitive service-role API routes on validated identity, with product decision on what remains public. Ensure background backend actors use separate machine auth.
6. Add integration tests including negative anonymous and nonmember requests; test all Realtime event types.
7. Once tests pass, build locally, merge, deploy frontend/API, apply staged migration using controlled gate, and verify EC2 ingestion.

## Git safety for user workflow
EC2 previously had 3 local commits and a merge not pushed to GitHub, leaving it ahead. `git pull --ff-only` will not import those EC2-only commits to the user's laptop, and can fail due to divergence. Before any merge/deployment, inspect `git status -sb` and `git log --left-right --oneline origin/main...main` on **both** machines. Back up local branches and preserve untracked report files. No reset, clean, or force push.

This note is an audit artifact only. No RLS activation or production security completion is claimed.
