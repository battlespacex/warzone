# BattlespaceX ASP.NET identity mapping (uploaded sources, 2026-11-03)

## Confirmed implementation
- `BattlespaceX.Public.Controllers.Api.AuthController`: legacy ASP.NET MVC with WebMatrix `WebSecurity.Login` and forms-cookie session; validates `Request.IsAuthenticated` and `User.Identity.Name`, then account's `IS_DELETED` and `IS_ACTIVE` fields through `IUserManagement.GetUserByEmail`.
- `RouteConfig.cs`: routes `api/auth/login`, `api/auth/validate`, `api/auth/logout` explicitly; production StratOps frontend already calls this origin with credentialed requests.
- `BattlespaceX.Service.Concrete.UserManagement` delegates `GetUserByEmail`, `GetUserByID`, `GetUserByUsername` to `IUserManagementRepository`; `ADM_USER.USER_ID` is numeric `int` and remains the stable identity key.
- `AuthController.Validate` as provided returned `isAuthenticated=true` when the user-management service is unavailable. This should be changed to fail closed before a token issuer is implemented.
- The provided `UserManagement.cs` is NOT a JWT token issuer, and there is no verified OIDC/JWKS setup.

## Safe integration design
1. Preserve the current login UI and WebSecurity authentication cookies. Make token exchange a *new* server-side MVC endpoint protected by the existing authenticated cookie, strict origin checks and suitable CSRF protection. No email, user ID, auth flag, or token from the request body may be trusted as identity.
2. Fail closed on unavailable user-management dependency; re-read the authenticated user's record by `User.Identity.Name`. Require `!IS_DELETED && IS_ACTIVE` and distinct StratOps permission membership.
3. Assign immutable, persistent UUID identity for each `ADM_USER.USER_ID` in a server-owned mapping store. Do not compute a new random UUID on each call. Use the UUID as JWT `sub`; `role=authenticated` and short expiry. Avoid using email as stable identity.
4. Use a configured supported Supabase verification path: an imported asymmetric JWT signing key under controlled server ownership, or fully configured custom OIDC issuer/JWKS. Third-party OIDC requires asymmetric signatures and issuer discovery. Do not paste private signing keys into source or browser, and do not use Supabase service-role key to mint browser identities.
5. Expose refresh via the same protected session endpoint; never accept untrusted refresh tokens or rely on UI-only staging auth bypass. Logout clears browser access token/subscriptions and the forms session. Re-check account/approval at each refresh.
6. Verify that JWT `iss`, `aud`, `sub`, `role`, `exp`, `kid` and key configuration are accepted by the live Supabase project in staging tests before enabling RLS.
7. Restrict privileged service-role API GET routes for protected intelligence to verified authorized users or deliberately classified public data. CORS alone is not security. The `POST /events` route separately checks `ADMIN_API_KEY`; preserve it for backend machine clients.

## SQL specifics
- Current target SQL uses `stratops_access.user_id UUID`, independent of `auth.users` after revision, because BattlespaceX identities reside in an external DB.
- Provision membership only from a trusted admin backend using stable mapped UUID; unauthorized/BattlespaceX accounts should not be auto-provisioned.
- Do NOT activate migration until token issuance, frontend and API authorization, and staging Realtime tests pass.

## Build/deploy
- GitHub holds only StratOps source; ASP.NET BattlespaceX website code must be compiled/deployed separately through its own project. `npm run build` on warzone does not compile `AuthController.cs` or the BattlespaceX .NET backend.
- Existing EC2 branch is historically ahead of origin/main; preserve commits and untracked reports before synchronization. No blind `git pull`.

## Secrets
Only names of required settings (issuer, key identifier, signing key path, Supabase project URL) should appear in source. User supplies secrets directly through deployment secret management, never this chat or Git.
