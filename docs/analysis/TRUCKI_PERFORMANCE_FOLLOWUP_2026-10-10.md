# Trucki performance follow-up — 10 October 2026

## Workflow corrections

Both workbench browser tests and all four real gate browser/API stories pass. Mobile navigation opens Menu before following Compliance and confirms it closes. Missing corridor setup hides inspection inputs and submission, keeps exceptions unavailable, returns 409 on release and creates no inspection/release record.

The real browser tests exposed an active-filter regression: legacy COMPLETED can mean inspection passed and awaiting release. The filter now retains such visits when they have a versioned inspection or legacy demo compliance check and no release record. Seeded historical completions without inspection records remain excluded. A released legacy visit leaves the active board but remains in full-history reads. Separate-milestone visits stay active after authorization until physical exit.

## Hosted staging

The current application uses Django/PostgreSQL, not MongoDB. Settings read DATABASE_URL and otherwise use local SQLite. Render inspection in the user-confirmed My Workspace found one production API (`srv-d9kj83tg1s2s73f2pc6g`) and one PostgreSQL 17 database (`dpg-db22qa97lnhs73dddri0-a`); no staging service/database exists.

Render rejected creating a second free database. A paid isolated staging database has not been authorized; no paid resource, staging service or production deployment was created. Hosted authenticated compression and workflow checks remain pending this environment decision. No production records were changed.

The Vercel CLI is available (59.23.2). Explicit inspection confirmed the locally linked Trucki project and team. The Vercel connector could not access that project, so it was not used to deploy elsewhere.

`scripts/verify_compression.py` now accepts an existing session via a named environment variable and a facility identifier, performs read-only authenticated identity/gzip checks and stores only selected headers/body sizes. It requires HTTPS and refuses authenticated redirects. Three unit tests cover decoding, redirection and credential-free output. An authenticated compression result requires gzip, at least 1 KiB decoded and equal identity/gzip board data; the script does not assert a deployed success until measured.

## PostgreSQL load validation

`compose.performance.yaml` defines a disposable PostgreSQL 17 instance with synthetic credentials, a loopback-only port and ephemeral storage. Docker Desktop failed to start on this machine. Instead, an official EDB portable PostgreSQL 17.11 archive was downloaded into the ignored test directory, extracted without system installation, and used for a temporary localhost-only cluster with synthetic credentials.

`backend/tests/test_postgres_load.py` and the PostgreSQL CI job provide a reproducible alternative. The harness refuses any base database name other than `trucki_perf` and uses pytest's `test_trucki_perf` database. It seeds four synthetic tenants with two sites each, 300 active and 2,700 historical visits per site and 100 alerts per site. It checks cross-tenant rejection and response scope, runs 360 requests at concurrency 1/4/8 with 10% audited queue creates, verifies each audit chain and reports p95/p99, CPU, SQL time/query count, and a separate Python allocation sample. It exercises middleware/ORM/rendering through the Django test client; it excludes HTTP, TLS, database-process CPU/memory and hosted capacity. A passing benchmark is evidence for this bounded workload, not proof that every concurrent operational command is race-free.

The local PostgreSQL test passed: all 360 requests succeeded, cross-tenant reads were rejected, returned rows matched their site/tenant, and all eight audit chains verified. A separate eight-request memory sample also passed and peaked at 5,533,940 traced Python bytes (not process RSS).

| Concurrency | Requests/s | Median | p95 | p99 | Median SQL time | Application CPU |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 8.69 | 96.06 ms | 210.73 ms | 215.68 ms | 43.45 ms | 3.609 s |
| 4 | 18.40 | 202.61 ms | 323.12 ms | 335.02 ms | 106.13 ms | 5.797 s |
| 8 | 17.30 | 412.50 ms | 685.34 ms | 729.10 ms | 252.96 ms | 8.031 s |

Each sample has 120 requests, including 12 commands. Read query count is 15. Connections close after each request; PostgreSQL setup/authentication and thread contention differ from a deployed worker with persistent connections. Throughput peaked at four clients; increasing concurrency did not improve this bounded local workload. Raw results: `trucki-postgres-load.json`. CI execution and hosted capacity remain unverified.

Portable runtime provenance: vendor download `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616`, linked from EDB's PostgreSQL binaries page; archive SHA256 `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`. The executable reports PostgreSQL 17.11; it is not Authenticode-signed. This is a recorded local archive hash, not a vendor-published checksum attestation.

## Board serialization

Compact polling now projects scalar queue columns and the linked trip ID directly. It avoids constructing queue, assigned-dock and journey model objects for each row. DRF's datetime formatter preserves timezone and null handling; the full legacy response retains its serializer contract. Tests compare linked trips, dock IDs, timestamps, timezone overrides and null values, and assert a single projection query.

The final alternating same-fixture measurement recorded 39.344 ms with the original compact serializer and 27.994 ms with the projection: 1.405× (29% lower latency), with byte-for-byte identical JSON. This comparison includes the corrected active predicate and normal authentication/configuration work. Query count remains 15. Raw evidence: `trucki-read-projection-profile.json`. This run followed the full test suite to reduce background-load interference; it is a local read comparison, not a production SLA.

## Full modelling and Rust

The production scheduling loop uses `available.index(min(available))`, preserving lowest-index ties without invoking a callback for each dock. The isolated full-model Rust harness includes scenario evaluation, RNG in the original order, movement construction, summaries, canonical digest and DRF JSON rendering. Native code is not imported by Django.

All 54 exact report-and-digest comparisons passed across three sizes, three seeds, three dock counts and two variants. The normal API permits at most 300 vehicles; 5,000 movements is an experimental larger batch. In the initial interleaved measurement Rust was slower than tuned Python at every tested size. The raw scheduling-kernel advantage did not survive full-model conversion and result construction. Keep Rust experimental; do not increase operational API limits or add native deployment dependencies on the strength of the kernel-only result.

Final full-model medians from 31 randomized interleaved samples per variant:

| Movements | Original Python | Tuned Python | Rust batch |
|---|---:|---:|---:|
| 72 | 1.158 ms | 1.136 ms | 1.167 ms |
| 300 (API maximum) | 2.663 ms | 2.583 ms | 2.649 ms |
| 5,000 (experimental) | 35.474 ms | 34.341 ms | 35.090 ms |

The Python change improves larger cases by approximately 3%; Rust is approximately 2–3% slower than tuned Python. Differences this small should not be treated as durable capacity gains. The native experiment offers no demonstrated end-to-end advantage here. Raw full-model results: `trucki-full-model-benchmark.json`.

## Local validation

- Full backend run: 781 passed, 4 opt-in tests skipped, 8 live tests deselected. A later fresh run of all 13 polling scope/projection tests also passed, including the newly added demo-completion regression.
- Frontend: 121 tests passed; source lint and production build passed with existing warnings.
- Browser: two workbench tests, four real gate stories, shared polling/site switching and connected journey recovery passed.
- Compression harness: three unit tests passed.
- PostgreSQL mixed-load test: passed with zero request errors and valid audit chains.
- Rust full model: 54 exact report/digest comparisons passed. No native deployment dependency was added.

Changes are staged on `codex/performance-validation`. Automatic approval review rejected committing/pushing to the external GitHub remote without explicit destination/payload authorization; no commit or push was performed. The source and evidence remain local and reviewable.

An optional PostgreSQL serializer/projection comparison rerun was blocked when automatic approval review hit its usage limit. That extra comparison was removed from the harness, restoring the already executed version. No additional benchmark result is claimed.

## Reproduction

Local PostgreSQL, once Docker is working:

```powershell
docker compose -p trucki-performance -f compose.performance.yaml up -d --wait
$env:DATABASE_URL='postgres://trucki_perf:local-synthetic-performance-only@127.0.0.1:55432/trucki_perf'
$env:RUN_POSTGRES_LOAD='1'
$env:POSTGRES_LOAD_REPORT='../docs/analysis/trucki-postgres-load.json'
Set-Location backend
.\.venv\Scripts\python.exe -m pytest tests/test_postgres_load.py -q -s
Remove-Item Env:DATABASE_URL,Env:RUN_POSTGRES_LOAD,Env:POSTGRES_LOAD_REPORT
Set-Location ..
docker compose -p trucki-performance -f compose.performance.yaml down
```

Hosted authenticated verification, after supplying an approved staging URL and existing session through the environment:

```powershell
.\backend\.venv\Scripts\python.exe scripts/verify_compression.py --web $env:TRUCKI_STAGING_WEB --api $env:TRUCKI_STAGING_API --facility $env:TRUCKI_STAGING_FACILITY --token-env TRUCKI_STAGING_TOKEN --output docs/analysis/trucki-staging-compression.json
```

Rust full-model comparison after the release library is built:

```powershell
.\backend\.venv\Scripts\python.exe experiments/rust-yard-kernel/full_model_benchmark.py --repeats 31
```
