# Trucki load benchmark and optimization — 10 October 2026

The yard polling API improved from 3.11 to 16.14 requests/second at eight concurrent requests (5.2×). Approximate p95 request latency fell from 3,746 ms to 698 ms (81% lower). All measured requests returned HTTP 200.

## Workload and measurements

Both runs used the same synthetic dataset: 300 queued visits and 100 acknowledged alerts. Each concurrency level issued 48 requests, alternating `/api/yard/board/` and `/api/queue/`, through Django's test client. Requests include real token authentication, permissions, middleware, ORM work and JSON rendering. Each worker closes its database connection after each request.

| Concurrent requests | Before requests/s | After requests/s | Before median ms | After median ms | Before p95 ms | After p95 ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 2.60 | 11.30 | 335.50 | 76.32 | 745.62 | 171.18 |
| 4 | 2.21 | 14.94 | 1,625.83 | 238.70 | 3,058.88 | 428.63 |
| 8 | 3.11 | 16.14 | 2,236.56 | 473.50 | 3,746.11 | 697.69 |

The final optimized run took place after correctness checks finished. An earlier optimized run also showed a substantial improvement but is not used in this table. Raw results are in `trucki-load-baseline.json` and `trucki-load-optimized.json` beside this report.

## Bottlenecks and changes

The yard-board read made 123 database queries with 100 acknowledged alerts. `AlertSerializer` accessed each alert's acknowledging user separately. Loading that relation with `select_related('acknowledged_by')` removed 100 queries, reducing the board to 23. The same query fix applies to the alert-list endpoint.

The board and queue also constructed a new ModelSerializer, including its field definitions, for each row. Board, queue, dock-list and alert-list responses now use one serializer with `many=True` per collection. The queue still uses 20 database queries, but spends much less time constructing serializers.

The measured response sizes stayed unchanged at 149,925 bytes for queue and 178,525 bytes for board. No response truncation, caching of operational state, or permission changes were introduced.

## Verification

83 targeted tests passed, covering payload equivalence, bounded alert query growth, yard APIs, gate integrity and cross-tenant isolation. Both baseline and final optimized load tests passed with zero HTTP errors across 144 measured requests each.

The new regression tests compare collection payloads against individually serialized records and verify that adding 29 acknowledged alerts does not add 29 database queries.

## Reproduce locally

From `backend/`, in PowerShell:

```powershell
New-Item -ItemType Directory -Force .test-tmp | Out-Null
$env:RUN_LOAD_BENCHMARK='1'
$env:LOAD_REPORT='../docs/analysis/trucki-load-rerun.json'
.\.venv\Scripts\python.exe -m pytest tests/test_load_benchmark.py -s -q --basetemp=.test-tmp/load-rerun
```

Use a fresh basetemp directory per run. The opt-in benchmark requires SQLite and creates a disposable migrated test database; it does not use the application database. Run it alone for comparable timings.

## Limits and remaining cost

This is a local, single-process threaded application benchmark on file SQLite, not a production capacity test. It excludes HTTP transport, TLS, deployment workers, Postgres behavior, browser rendering and concurrent writes. Each concurrency sample is short; these measurements establish a local improvement rather than sustained capacity or a production SLA.

The queue and board still return all queue entries, so response size and serialization cost grow with yard history. Pagination or incremental polling is a separate interface change requiring coordinated frontend work. Production load and write-contention testing remain unmeasured.
