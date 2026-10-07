# Journey handoffs and distinct yard milestones

7 October 2026. BAK is the configured reference tenant of Trucki. No Trinitas configuration, external provider integration, verified legal instrument or monetary penalty was introduced.

## Behaviour

Newly linked origin visits use `SEPARATE_V1` milestone semantics:

1. The existing regulatory/operational gate authorises release. The visit becomes `RELEASED`; `release_authorized_at` is recorded. Its dock stays occupied, and exit/dwell remain empty.
2. Operations or Facility Manager records `DOCK_VACATED` for an occupied assigned dock. Dock permissions and module restrictions apply. The command frees only a dock whose current occupant is that visit. The retained assigned-dock reference remains historical.
3. Dispatch, Operations or Facility Manager records `DEPARTED`. An occupied dock blocks this command. Versioned inspection authority is revalidated at command time. The observation time becomes the actual exit and trip start; dwell is finalised.
4. Operations or Facility Manager records destination arrival and an evidenced delivery outcome. A rejection can be followed by `DELIVERY_REATTEMPT_PLANNED`, another arrival and a new outcome at the existing destination. The plan requires a reason and cannot complete the trip. Prior receipts remain immutable.

Each observed event creates a retained event, audit record and transactional outbox entry. Exact replay returns the original event without repeating its effects. A conflicting replay is rejected. Site membership, tenant ownership, role ceilings, narrowed permissions and module checks remain authoritative.

The API supplies the next task, responsible roles, scope and action links. The queue links to the selected journey and identifies release-authorised vehicles awaiting exit. Journey acceptance explicitly leaves evidence reconciliation, ERP acknowledgement and commercial closure outstanding. Original delivery documents remain at the recorded external reference; only their reference and fingerprint are stored.

## Compatibility and reporting

The additive migrations default existing visits to `LEGACY_COMBINED`. Existing links are not relabelled and no historical timestamp is inferred or rewritten. Historical combined release retains its original behaviour. A legacy exit timestamp alone is not presented as independently observed physical departure; a retained departure event supplies that observation when available.

For `SEPARATE_V1`, a passed inspection or authorised release with no actual exit remains active waiting time. Completed turnaround uses observed exit. Existing legacy report fallbacks remain for compatibility. CSV exports append milestone semantics and authorisation/vacancy timestamps.

## Boundaries

This increment does not introduce multiple delivery destinations, consignment quantities, returns, a driver/receiver portal or assignment replacement. Reattempts are at the same destination and do not assert any new route clearance. ERP/WMS/tracker imports and acknowledgements remain unconfigured. If release authority expires or changes before departure, exit is blocked; controlled withdrawal and reinspection after release remain a separate recovery workflow to implement. No records are fabricated to make production entry 1 pass.

## Verification

Backend tests cover distinct authorisation/vacancy/exit effects, dock reuse and exact replay, exit/dwell timing, rejection and reattempt sequence, role restrictions, legacy timestamp preservation and existing expiry checks. Frontend tests cover the API-owned handoff and reattempt controls. Chromium contract tests exercise the queue-to-journey link, dock vacancy, departure, rejection, planned reattempt, new receipt and acceptance across desktop and mobile widths. Contract tests use disposable intercepted responses, not a real ERP/tracker.

Production verification is read-only for operational records. Authentication and role-selection audit effects are permitted. Deployment and final test results are recorded after release below.

Local verification passed: 689 backend regression tests, one opt-in browser test skipped and eight live tests deselected; a subsequent 30-test journey/notification run includes two additional new checks. All 78 frontend unit tests passed. Build and lint passed with existing bundle-size and Fast Refresh warnings. Two Chromium contract flows passed, including desktop/mobile journey recovery and inspection setup. Django system checks and migration drift checks passed.
