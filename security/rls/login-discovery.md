# Login integration discovery, 2026-11-03

Repository inspection confirmed:
- `production/pages/index.html` renders an intro sign-in form (`intro-auth-form`) and a separate `wz-login-modal`; copy says "Log in with your BattlespaceX account". The nav calls `window.__openLoginModal?.()`.
- `dev/assets/js/supabase.js` uses a public publishable key with `persistSession:false` and `autoRefreshToken:false`.
- Backend API files use service-role Supabase client references, and worker uses service-role config.
- The frontend subscribes to `events`, `active_alerts`, and `tracks` using postgres_changes.
- Static login markup does **not** identify a Supabase Auth session provider. Do not assume `auth.uid()` maps to BattlespaceX accounts.
- Authenticated-only RLS activation requires a verified JWT issuer/mapping, a trusted membership provisioner, and end-to-end staging tests.

Actionable next discovery:
1. Locate source modules binding `intro-auth-form`, `wz-login-modal`, `__openLoginModal`, and user session refresh.
2. Determine login endpoint and identity backend, cookie/token shape, expiry and logout flow without exposing secrets.
3. Decide whether to use Supabase Auth directly or a secure third-party JWT integration; align stable user IDs and `stratops_access` mapping.
4. Audit protected backend API routes: using service-role RLS bypass means each private route must authorize incoming user identity.
5. Deploy authentication-compatible client code *before* applying protected RLS, and test Realtime reauthorization on reconnect.

No production changes are made by this note.
