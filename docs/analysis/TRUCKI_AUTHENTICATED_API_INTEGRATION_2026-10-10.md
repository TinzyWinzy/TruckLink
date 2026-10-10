# Authenticated API verification and integration pathway

Tested 10 October 2026 against https://spotteraiassessment-khaj.onrender.com using a newly provisioned, isolated DEMO tenant. Only this tenant was seeded; existing operational tenants were not modified. No paid database was created.

## Results

| Check | Result |
| --- | --- |
| Tenant creation / demo seed | Successful / HTTP 200 seed |
| Authenticated board, identity / gzip | HTTP 200 / HTTP 200 |
| Decoded JSON equality | Exact equality |
| Identity response body | 5,461 bytes |
| Gzip response body | 1,212 bytes |
| Body reduction | 77.81% |
| Fixture | Seven queue rows |
| Unauthenticated same board | HTTP 401 |
| Logout / session revocation | HTTP 200 |

Raw, secret-free evidence: `trucki-authenticated-compression.json`. Credentials are in ignored `backend/.test-tmp/deployed-test-credentials.json`; they are not included in evidence or source control. Password login remains available for deliberate follow-up testing; access and refresh sessions from this run were revoked. The isolated test tenant and demo fixture remain provisioned.

## Critique

This closes the deployed authenticated gzip verification gap: compression works for a successful JSON response larger than 1 KiB and preserves its data. Application settings contain no Django GZipMiddleware, so the observed compression is likely provided by the hosting/proxy path; the exact layer was not independently isolated. Adding another compression layer now is unnecessary without measurements.

The fixture is small. This is neither a load benchmark nor a claim about large-payload compression or hosted capacity. Identity took 668 ms and gzip 1,876 ms, but one sequential sample per encoding cannot distinguish compression CPU, network variation, or host scheduling. Do not claim a latency win from these timings. The reduction measures response-body bytes, excluding HTTP/TLS overhead.

Both responses had no Cache-Control header and exposed Vary: origin without Accept-Encoding. Authenticated tenant data should receive explicit no-store. Verify encoding variation across the full deployed proxy path; if any intermediary caches negotiated representations, it must vary appropriately on Accept-Encoding. A missing header alone does not establish that an intermediary caches these responses.

The local optimization branch has not been published or deployed. Sending scope=active and compact=1 to production does not prove those features exist there; older handlers can silently ignore query parameters. Reverify field omission, active filtering, release visibility and cache headers after deployment.

The earlier local PostgreSQL benchmark exercised realistic data volume and auditing but excluded HTTP/TLS and hosted resource constraints. Its zero errors are useful correctness evidence, not a production capacity guarantee. The full-model Rust experiment showed no end-to-end advantage over tuned Python; keep Rust isolated.

## Integration pathway

1. Review and publish `codex/performance-validation` to `TinzyWinzy/TruckLink` after explicit publishing authorization. Run the existing frontend, backend, browser and PostgreSQL CI checks. Keep credential files and temporary runtimes out of the commit.
2. Review the combined API/client change before rollout. Preserve default full-response compatibility; deploy API support for active/compact reads and explicit no-store before enabling the shared-polling client. Confirm the deployed commit SHA rather than assuming main contains the local work.
3. Reuse the isolated demo credentials to log in and run `scripts/verify_compression.py` with a token supplied through an environment variable, facility 3, and the production API URL. This verifier is read-only. Do not rerun `scripts/test_deployed_authenticated.py` unless another test tenant is wanted.
4. Verify gzip/identity equality, no-store, encoding negotiation, compact field omissions and active-versus-history behavior. Exercise inspection-to-release and physical-exit workflows before accepting the rollout. Revoke the session again after verification.
5. Compare production telemetry before and after rollout: request rate, p50/p95/p99, errors, database time, CPU, memory and response bytes. Keep synthetic load generation on disposable local PostgreSQL until a separate hosted load-test environment is explicitly chosen. Low-volume authenticated verification on the demo tenant is sufficient for the compression gate.
6. Retain scoped request memoization and smaller reads; investigate measured residual database/CPU hotspots next. Reconsider Rust only for substantial batched computation with parity tests and an end-to-end speedup that exceeds binding/serialization overhead. Do not introduce a Rust runtime dependency for this model.

Rollback: revert the frontend shared-polling change if client regressions occur; retain backward-compatible full API responses. Revert the compact projection separately if deployed workflow checks fail. Do not use shared response caching for authenticated tenant boards.
