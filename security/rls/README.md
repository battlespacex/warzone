# StratOps RLS rollout: staged branch (not deployed)

## Verified on GitHub main (2026-11-03)
- `apps/worker/src/supabase.js`: server-side service role client.
- `apps/api/src/routes.events.js`, `apps/api/src/routes.stratops.js`: service-role client references. **This does not itself prove endpoint authorization**.
- `dev/assets/js/supabase.js`: browser Supabase publishable key; `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false`.
- `dev/assets/js/essential.js` and `dev/assets/js/warzone-realtime.js`: direct reads / Realtime changes for events, tracks and active_alerts.
- Existing production screenshots: anon writes revoked; RLS off; authenticated role still has CRUD; 2 anon SELECT policies exist.

## Gate 1: auth integration
1. Identify and document the existing StratOps login/session system. No assumptions that current identity is Supabase Auth.
2. Select validated bridge: Supabase Auth sign-in (existing UI) or correctly signed/verifiable third-party JWT using Supabase-compatible integration.
3. Ensure tokens are never generated or signed in browser; verify membership independently of login.
4. Add approved-user administration and revocation with an explicit secure service-side flow; no self-approval.
5. Add frontend token lifecycle: acquire, refresh, logout, reconnect; configure Supabase authenticated requests and `supabase.realtime.setAuth(token)` before subscriptions. Preserve current subscriptions.
6. Confirm all service-role API endpoints enforce application authorization as appropriate; RLS does NOT restrict service role endpoints.

## Gate 2: staging
- Create isolated staging DB and representative approved+unapproved users; do not reuse secrets.
- Run `preflight.sql`; inspect unexpected policies/grants and direct database callers.
- Confirm events, active_alerts, tracks SELECT; Realtime INSERT/UPDATE/DELETE as applicable; raw_items and worker_state deny browser users.
- Confirm anon, unsigned, expired, nonmember JWT denial. Check refresh, logout, revocation and reconnect.
- Verify naval, aircraft, Telegram workers, reports, and API authorization.
- Verify Realtime publication and replica-identity behavior for DELETE event payloads.

## Gate 3: production rollout
1. Backup schema, policies/grants and app release; take DB backup/snapshot as supported.
2. Deploy compatible auth-enabled frontend/API first, using feature-gated release and staged session validation.
3. Provision authorized user IDs in `stratops_access` from trusted admin backend, not client.
4. Run `preflight.sql` again; examine all unexpected policies/roles. Remove any conflicting permissive policies.
5. Only after staging acceptance and approved memberships: run the target migration in controlled session with `SET LOCAL stratops.approved_auth_rollout = 'yes';` inserted just after BEGIN. Never use in production without explicit operator approval.
6. Verify each role with real JWTs and Realtime listeners and monitor ingestion.

## Recovery
- **Preferred:** restore previous compatible application release while preserving guarded server-proxy reads for authorized users.
- Keep before-state schema/policies/grants backup and a reviewed rollback script with exact prior settings.
- A rollback that simply DISABLEs RLS would re-expose anonymous SELECT and authenticated writes; do NOT automate or blindly perform it.
- If a critical frontend regression occurs, restore specific secure read path/policy, not unrestricted table access.

## Important gaps
- Existing StratOps login implementation is not yet mapped. This branch deliberately does not assume Supabase Auth user IDs.
- The SQL is a target migration, not safe to deploy before auth changes and accepted staging tests.
- Repository updates in this branch are isolated from main, EC2, and Supabase.
