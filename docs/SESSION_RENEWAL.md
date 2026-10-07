# Session renewal

Credential sign-in endpoints ignore Authorization headers. The browser also omits the stored access token when submitting Staff ID/PIN or username/password, so an obsolete token cannot prevent valid credentials from being checked.

New password/PIN sessions return the existing `token` contract, an opaque `refresh_token` and `expires_in: 1800`. The renewable session lasts 30 days from sign-in, with a fixed expiry. Only a SHA-256 digest of its random 48-byte secret is stored in `core.RefreshSession`. A password/PIN fingerprint binds renewal to the current credentials. Inactive users, credential changes, expired sessions, explicit token deletion and sign-out prevent renewal. The current single-token-per-user API is retained; sign-out revokes all renewable sessions for that account.

`POST /api/auth/refresh/` accepts the renewal credential without access-token authentication. It checks the account and session under a user row lock, replaces the access token and preserves an administrator's selected working role. The renewal secret remains stable until expiry or revocation. Existing clients with legacy tokens and no renewable sessions retain their existing authentication contract.

The web client persists the renewal credential beside its existing access token, shares concurrent renewal attempts, retries an authentication-rejected request once, and prevents a delayed renewal response from undoing local sign-out or a newer sign-in. Permission failures are not retried. A definitive session rejection clears stored credentials. Network/server failures retain them and session restoration offers a connection retry instead of silently treating the user as signed out. No private workspace is restored from an unverified identity cache.

Existing users should sign in once after deployment to obtain a renewal credential. Legacy stale tokens are cleared on rejection, and fresh credential sign-in works regardless of the old header.

Validation: eight backend renewal tests, 37 existing authentication/tenancy/role/throttle regressions, five client/session tests, build/lint and 20 practice browser journeys passed. Backend tests cover stale login headers, expired access replacement, working-role retention, logout, fixed renewal expiry, inactive users, password/PIN changes, token deletion and invalid secrets. The production admin journey additionally replaces its access token while away from the app, then returns using the stored renewal credential.
