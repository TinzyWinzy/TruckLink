# Trucki production release — 10 October 2026

## Release

Published CI-passed commit `8ffb2d012a8193b630e9b06db0243c385d263cba` to `TinzyWinzy/TruckLink` main. Main was advanced without rewriting history. All backend, frontend, PostgreSQL and browser CI jobs passed on this exact source commit: https://github.com/TinzyWinzy/TruckLink/actions/runs/38040973722.

API: https://spotteraiassessment-khaj.onrender.com. Render deployment `dep-db50aec9v7es738ke8o0` is live, with the exact commit verified by Render. API deployment completed at 11:29:38 South Africa time, before frontend deployment.

Frontend: https://trucki-two.vercel.app. Vercel deployment `dpl_3F8unFFbwuuKsu6JmBnS6tXNeax7` is READY and assigned to the public alias. Production build passed TypeScript, Vite and PWA generation. Public assets `index-DivRED4D.js` and `live-cGrPaNsQ.js` were fetched successfully; they contain the expected production API target and active/compact polling contract respectively.

No paid database was created. The existing PostgreSQL production database and application hosting were used. The Rust experiment is present in the repository but is not imported by Django or built into the deployed application.

## Changes shipped

- One shared board polling timer and in-flight request per session/actor/tenant/site scope, with snapshot reuse, hidden-tab pause and cancellation when subscriptions end. Audit polling remains separate.
- Backward-compatible full reads plus compact active board reads and bounded queue pagination. Inspection-completed legacy visits remain actionable until authorised release; separate exit semantics remain intact.
- Batched related-data fetching, request-scoped tenant decision memoization and direct compact row projection. Memoized data cannot cross requests, tenant scope or commands.
- Explicit `Cache-Control: private, no-store` for board responses. Existing hosted gzip remains responsible for observed API compression; no redundant compression middleware was added.
- Small pure-Python scheduling improvement. Native scheduling stays experimental because the full-model comparison did not justify deployment.
- Responsive tenant navigation, mobile menu/workflow checks, browser actor-switch and command-completion synchronization fixes, and PostgreSQL mixed-load CI.

## Baseline comparison

The following throughput and latency comparisons use the same bounded local SQLite/Django test-client workload: 300 queue entries, 100 acknowledged alerts and 48 reads per run. They exclude HTTP/TLS, hosted CPU limits and network delay. They are optimization evidence, not a production capacity or latency promise.

| Metric | Original baseline | Optimized pipeline | Change |
| --- | ---: | ---: | ---: |
| Board SQL queries/read | 123 | 15 | 87.8% fewer |
| Queue SQL queries/read | 20 | 12 | 40.0% fewer |
| Throughput, concurrency 1 | 2.60 requests/s | 19.73 requests/s | 7.59× |
| Throughput, concurrency 4 | 2.21 requests/s | 25.17 requests/s | 11.39× |
| Throughput, concurrency 8 | 3.11 requests/s | 22.12 requests/s | 7.11× |
| p95, concurrency 8 | 3,746.11 ms | 461.27 ms | 87.7% lower |
| Median, concurrency 8 | 2,236.56 ms | 348.83 ms | 84.4% lower |
| Request errors | 0 | 0 | None observed |

These pipeline load readings precede the final compact projection refinement. A separate paired local profile of that refinement measured 39.344 → 27.994 ms median, a further 28.8% reduction (1.41×). Do not multiply separate benchmark speedups into a claimed production gain.

A history-heavy local board fixture (300 active and 2,700 closed visits) reduced decoded full versus active/compact output from 1,548,143 to 156,825 bytes: 89.9% smaller. This compares response modes, not two hosted samples.

## Measured deployed before/after

Read-only verification reused the same isolated DEMO tenant and seven unchanged queue rows immediately before and after deployment. Test sessions were revoked after each check; credentials stayed in an ignored local file. No operational tenant data was modified.

| Same deployed board request | Before | After |
| --- | ---: | ---: |
| Full JSON response | 5,461 bytes | 5,461 bytes |
| Active/compact JSON response | 5,461 bytes | 4,866 bytes (10.9% smaller) |
| Gzip active/compact body | 1,212 bytes | 1,134 bytes (6.4% smaller) |
| Compact metadata omitted | No | Yes |
| Cache-Control | Absent | private, no-store |
| Identity/gzip decoded JSON equality | Pass | Pass |
| Unauthenticated board read | HTTP 401 | HTTP 401 |
| Logout | HTTP 200 | HTTP 200 |

The 10.9% reduction is smaller than the history-heavy fixture's 89.9% because this production demo fixture has no accumulated closed history to exclude. Full-response compatibility is preserved. The deployed compressed compact response is 79.2% smaller than the original uncompressed body.

Single hosted request timings were recorded but are not sufficient to establish a latency improvement. They include network and hosting variation. No load was generated against production.

Public frontend main JavaScript: 356,235 bytes uncompressed, 113,742 bytes gzip and 116,046 bytes Brotli. Both content encodings were served successfully; the existing verification harness decodes gzip but does not validate Brotli decoded equality. Asset caching is immutable for hashed files; the index requires revalidation. The main JavaScript size is effectively unchanged from the earlier 356,201-byte public sample: this release primarily reduces repeated reads and API work rather than bundle size.

Production browser smoke passed: real sign-in, administrator onboarding, scoped workspace and the pending-activation boundary. No browser runtime errors were recorded; logout returned HTTP 200. This smoke does not perform operational inspection/release writes; those workflows passed against the isolated Django API in CI.

## Critique and next work

The strongest measured gains are fewer queries, less historical data serialized, and shared polling. Avoid adding shared authenticated response caches: the current request-scoped cache and no-store response policy preserve isolation without invalidation complexity.

PostgreSQL mixed-load testing used four tenants, eight sites, 24,000 visits and 800 alerts, plus concurrent audited creates. All 360 bounded requests and audit-chain checks passed. Local throughput peaked at concurrency 4 (18.40 requests/s, p95 323.12 ms), then fell at concurrency 8 (17.30 requests/s, p95 685.34 ms). That suggests contention in this workload; SQL time increased substantially. There is no equivalent pre-change PostgreSQL result, so do not present these numbers as a PostgreSQL speedup or hosted capacity limit.

The full-model Rust experiment was about 2–3% slower than tuned Python across tested sizes despite faster isolated kernel work. Binding, conversion and reconstruction erase the gain. Keep Python in production; reconsider native code only if a measured, substantial batched computation dominates an end-to-end profile.

Next: collect production request rate, p50/p95/p99, errors, database time, CPU and memory over comparable traffic windows. Prioritize query plans and database wait/connection behavior if they dominate. Evaluate larger authenticated compression samples on isolated fixtures. `Vary` still exposes origin without Accept-Encoding in the API path; no-store prevents shared response reuse, but any future intermediary caching must explicitly handle encoding negotiation.

## Evidence and rollback

Evidence files beside this report: `trucki-production-before.json`, `trucki-production-after.json`, `trucki-production-frontend.json`, `trucki-production-frontend-contract.json`, `trucki-production-browser-smoke.json`, and the prior load/profile/Rust JSON reports. Authenticated API evidence is in the before/after reports; the frontend report intentionally uses unauthenticated API probes.

Previous API deployment: `dep-db3k9s3l550s73ajtp10`, commit `93618a02c477e6b9b9b048783f8c2da90fbbc546`. Previous frontend production deployment: `dpl_5CUThHwF62qSaTxQRj6Ezi9dg47b`, https://trucki-b37alvh6f-brandontinozs-projects.vercel.app. These identify rollback targets if post-release telemetry reveals a regression. No new schema migrations were introduced by this release.
