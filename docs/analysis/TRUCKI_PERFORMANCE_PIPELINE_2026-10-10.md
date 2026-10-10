# Trucki performance pipeline — 10 October 2026

Implemented local improvements to shared polling, response scope and request-scoped tenant configuration caching. Verified public deployed compression, profiled remaining work and built an isolated Rust scheduling experiment. Application changes have not been deployed.

Subsequent workflow fixes, a compact read projection, PostgreSQL validation preparation and the full-model Rust comparison are recorded in [the follow-up report](TRUCKI_PERFORMANCE_FOLLOWUP_2026-10-10.md). The measurements below preserve the initial pipeline baseline.

## Shared polling

`web/src/lib/sharedPoll.ts` provides one timer and one in-flight request per session/API/actor/tenant/role/site scope. The live queue, docks and alerts feeds subscribe to one board snapshot. A late subscriber can reuse a snapshot younger than one polling interval; stale/error snapshots are not replayed to a new subscriber. Empty groups cancel their request and timer. Hidden tabs pause reads and resume on visibility change.

The dock screen previously issued three board requests every five seconds. The synthetic browser check verifies one request per cycle, followed by a new scoped request when the selected yard changes. Unit tests also verify that responses started under another actor, role, site or session generation are discarded.

Snapshots remain in tab memory only. There is no shared authenticated browser/service-worker response cache. The existing API service worker remains network-only for private reads.

## Smaller responses

The client requests `/api/yard/board/?facility=<id>&scope=active&compact=1`. Active rows include separate-milestone release authorizations until a physical exit is recorded. Released legacy rows, physically exited rows and historical legacy completions without inspection records are excluded. Legacy completions with a recorded versioned or demo inspection remain visible until release; this correction was established in the follow-up browser stories. No limit truncates active visits or docks. Compact queue rows omit facility, creation time and idempotency key, which the polling adapter does not consume.

Existing unparameterized board and queue requests preserve full-history behavior and response row fields. Bounded history is available through `/api/queue/?facility=<id>&scope=history&limit=100&offset=0`; responses include `total` and `next_offset`. Limits must be 1–200. History uses deterministic timestamp/ID ordering. Offset pages are live views, not an immutable export snapshot.

Synthetic profile dataset: 300 active visits, 2,700 closed visits and 100 acknowledged alerts.

| Read | Uncompressed bytes | Median local latency | SQL queries |
|---|---:|---:|---:|
| Full board | 1,548,143 | 219.467 ms | 15 |
| Active compact board | 156,825 | 37.056 ms | 15 |

Payload size fell 89.9%; median local latency fell 83.1%. These two reads run against the same post-change fixture. Most of the size reduction comes from excluding historical rows, not changing JSON encoders.

## Scoped caching

`TenantReadCacheMiddleware` owns a fresh ContextVar dictionary for each GET/HEAD request and resets it in a `finally` block. Tenant configuration, active release and entitlement/module resolution are memoized by function and all arguments, including typed tenant/site IDs and explicit effective time. Returned values are copied so callers cannot mutate another consumer's configuration.

POST/PATCH/PUT/DELETE commands do not use this cache. No entitlement, evidence review, release eligibility or mutable yard response is cached across requests. This avoids stale authorization and requires no new shared-cache service. A request may reuse the configuration it already resolved earlier in that same read; subsequent requests resolve it anew.

The original 300-visit/100-alert concurrent benchmark was rerun with unchanged endpoint parameters and response sizes:

| Concurrency | Prior optimized requests/s | Pipeline requests/s | Prior p95 ms | Pipeline p95 ms |
|---|---:|---:|---:|---:|
| 1 | 11.30 | 19.73 | 171.18 | 75.90 |
| 4 | 14.94 | 25.17 | 428.63 | 191.04 |
| 8 | 16.14 | 22.12 | 697.69 | 461.27 |

At concurrency 8 this is another 37% throughput improvement and 34% lower p95 latency. Board queries went from 23 to 15; queue queries from 20 to 12. All 144 requests returned HTTP 200. The benchmark does not incorporate the additional reduction in browser request count from shared polling.

## Compression verification

Read-only checks targeted the documented production frontend and backend URLs. No authentication or operational writes were performed.

| Public frontend asset | Transferred body bytes | Observed Content-Encoding |
|---|---:|---|
| identity | 356,201 | none |
| gzip | 113,740 | gzip |
| Brotli | 115,955 | br |

Both compressed encodings are deployed. Brotli was slightly larger for this particular response; compression level/provider behavior was not measured. The versioned asset also returned `Cache-Control: public, max-age=31536000, immutable`.

The API health response was only 35 bytes and uncompressed. The unauthenticated board returned 401 and 58 bytes. These do not verify compression of large authenticated operational responses. That check remains outstanding with an authorized API session. One health request took 35.6 seconds; this single observation does not establish its cause or normal latency.

Local gzip tests on the synthetic compact board produced 8,761 bytes at level 1 in approximately 0.096 ms, and 6,521 bytes at level 6 in approximately 0.359 ms. These figures demonstrate compressibility, not deployed API transfer size. No additional application compression layer was added before authenticated deployment behavior could be established.

`scripts/verify_compression.py` reproduces the public checks and stores headers/body sizes without persisting response contents or credentials.

## Profiling and Rust

Profiles cover eight board reads per response shape and ten synthetic model runs with 5,000 movements. cProfile uses its default elapsed timer, so cumulative function times include database waits and profiler overhead; separate process CPU totals are also recorded. Nested cumulative times must not be summed as independent costs.

For the compact board, DRF list serialization was approximately 0.455 seconds of a 0.744-second profiled request stack. ORM materialization was another substantial contributor, partly nested inside serialization. In the model, the main simulation function's self time was approximately 0.135 seconds of 0.560 seconds overall, random scenario selection accumulated approximately 0.118 seconds and canonical JSON generation approximately 0.098 seconds. The regulatory evaluator itself accumulated only approximately 0.004 seconds. This did not justify porting the release evaluator.

The Rust experiment therefore targets the synthetic scheduling loop with precomputed inputs. It uses a dependency-free release-built Rust library through a local ctypes harness. It is not imported by Django. Naive per-element bindings can erase the kernel gain; the experiment compares bulk buffer copies and tuple reconstruction explicitly. Results and parity evidence are in `trucki-rust-experiment.json` and the experiment README.

Rust feasibility is demonstrated, but no full-application speedup is claimed. RNG, model row creation, canonical hashing, database work and API serialization remain outside the measured kernel. Operational mass/Decimal semantics, evidence, approvals and audit hashes are unchanged.

Final isolated benchmark medians include input conversion and reconstruction of Python result tuples:

| Movements | Original Python | Tuned Python | Rust bulk binding | Rust versus tuned Python |
|---|---:|---:|---:|---:|
| 100 | 0.0447 ms | 0.0214 ms | 0.0204 ms | 1.05× |
| 5,000 | 1.9965 ms | 1.0076 ms | 0.7643 ms | 1.32× |
| 50,000 | 21.1996 ms | 11.0374 ms | 8.8255 ms | 1.25× |

The naive Rust binding was slower than the original Python loop at every batch size. Bulk conversion makes native execution feasible, but the remaining advantage over a simple Python optimization is modest. Keep this experiment isolated until a full modelling benchmark demonstrates worthwhile end-to-end gains. A component consuming 20% of request time caps the total gain at 1.25× even if its cost disappears entirely.

## Validation and reproduction

- Frontend: 121 unit tests passed; source lint passed with the existing Fast Refresh warning; production build passed.
- Browser: shared polling/site switching and the connected journey recovery test both passed with synthetic intercepted API responses.
- Targeted backend checks: all 115 selected tests passed across the runs (subscription tests required the documented synthetic AUDIT_SALT environment setting).
- Rust: two unit tests and 27 batch parity comparisons plus a blocked/tie fixture passed.
- Full backend suite: 779 passed, 3 skipped and 8 deselected with the synthetic AUDIT_SALT setting.

From `backend/`, set `RUN_LOAD_BENCHMARK=1` and `LOAD_REPORT=<output>` to run `tests/test_load_benchmark.py`. Set `RUN_PERFORMANCE_PROFILE=1` and `PROFILE_REPORT=<output>` to run `tests/test_performance_profile.py`. Both opt-in tests require SQLite and create a disposable migrated file database; supply a fresh workspace `--basetemp` directory. Use `AUDIT_SALT=local-performance-tests-only` for the normal backend suite, as CI does with its synthetic salt.

Raw artifacts: `trucki-load-pipeline.json`, `trucki-performance-profile.json`, `trucki-deployed-compression.json` and `trucki-rust-experiment.json` beside this report.
