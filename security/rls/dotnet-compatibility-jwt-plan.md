# .NET compatibility and verified JWT path (2026-11-03)

Evidence from user-provided ASP.NET project files:
- `BattleSpaceX.Public.csproj`: `TargetFrameworkVersion=v4.8`, `LangVersion=7.3`, ASP.NET MVC 5.2.7, WebMatrix.WebData, Newtonsoft.Json 13.0.3.
- `packages.config`: legacy packages.config NuGet setup, NOT SDK-style project. No `System.IdentityModel.Tokens.Jwt` / `Microsoft.IdentityModel.Tokens` packages listed.
- `AuthController.cs`: WebSecurity forms cookies and active/deleted account validation.
- `UserManagement.cs`: stable integer `ADM_USER.USER_ID`, email lookup.
- Supabase has an existing active ECC P-256 signing key and previous HS256 key. **Private ECC key is not exportable. Do not rotate or repurpose it**.

## Supported integration choices (verified against Supabase docs)
**Preferred:** Supabase third-party Auth with external OIDC issuer.
- Requires implementing standards-compliant OIDC discovery (`/.well-known/openid-configuration`), JWKS, ES256/RS256 JWT with `kid`, issuer, role and stable UUID subject, then enabling third-party provider in Supabase.
- A mere `/api/auth/stratops-token` endpoint without issuer discovery and key publishing is NOT enough for custom OIDC.
- Separate billing may apply to third-party MAU. Check account plan and quota before deployment.

**Alternative:** Import an *independently owned signing key* into Supabase and sign issued JWTs using that key.
- This requires secure key generation/import and safe storage; **never export or rotate the project's current active ECC private key**, which is not extractable.
- Supabase signing key import and activation steps need testing and can have global implications: do not perform them as part of source-only changes.
- Use established JWT libraries compatible with .NET 4.8 and C# 7.3, not ad hoc hand-written crypto. Confirm dependencies and binding redirects in Visual Studio build.

## Product and security constraints
- Existing BattlespaceX account remains canonical; do not create a second login or automatically authorize all registered users.
- Membership uses trusted UID->UUID mapping and explicitly approved rows in `public.stratops_access`. Local and staging UI bypasses are not permissions.
- Token issue endpoint must check logged-in cookie, active/not-deleted user, and approval. Protect against CSRF/cross-origin token leaks. Responses no-store; short expiration; refresh gated by re-validation.
- Add robust API authorization for service-role-backed routes; CORS is not access control.
- Set `accessToken` option on Supabase JS client for authenticated PostgREST; configure Realtime auth before subscriptions. `auth.uid()` requires valid UUID subject.
- Maintain a secure recovery plan with versioned DB policies and explicit anonymous denial.
- Only code in `battlespacex/warzone` can be pushed to its GitHub repo; the uploaded ASP.NET project is not in this repository. A warzone `npm run build` does not compile ASP.NET .NET Framework sources.

## Next implementation gate
1. Configure and stage a supported JWT trust path without changing active production key.
2. Add account token issuance to ASP.NET with version-compatible libraries.
3. Hook client auth session to the Supabase token helper; test REST and Realtime with real token (not placeholder).
4. Add API route authorization and stage SQL + negative tests.
5. Merge only when complete, then synchronize local and server changes without destructive Git operations.
