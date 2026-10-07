# Connected transport journey, 7 October 2026

This change connects an assigned trip to one origin yard visit without guessing historical relationships. The existing regulatory OperationalContext trip relationship remains authoritative for inspections; linked visits must agree with it. This refines the earlier acceptance-plan gap assessment: an inspection-context trip link existed, but registration, release and destination events did not share an explicit journey identity.

BAK remains the reference tenant. Tariro's incumbent ERP observations concern Trinitas. No Trinitas configuration or second production tenant is created. No statutory instrument or monetary penalty is asserted as verified law.

## Available flow

In Routes & map, select an operational assigned trip and link its registered origin visit. The vehicle, driver, tenant, site and existing inspection context must agree. Optionally record a manual dispatch reference. Registration, dock assignment audit events, inspection attempts, independent release authority and subsequent staff observations share a timeline.

Yard release does not mark a trip in transit. An authorised dispatch, operations or facility working role records physical departure. Versioned journeys recheck effective evidence, rules, tenant policy, approval and inspection freshness at that point. Operations or facility staff then record destination arrival and delivery acceptance or rejection. Acceptance requires a receiver, an evidence reference and a document SHA-256 fingerprint. Only acceptance completes the trip. Observations retain author, observed time, recorded time, reason and replay key. Legacy status, booking and WhatsApp shortcuts cannot complete linked trips.

All six existing staff roles can read journeys where tenant modules, site membership and permissions allow. Admin must select an authorised working role to attest observations. Assignment snapshots and journey events are retained; linked trip identity cannot be overwritten through ordinary saves. Existing unlinked trip and yard workflows remain supported. Historical visits are not automatically linked.

## Boundaries and further discovery

- ERP and tracking adapters are not configured. Manual references and position reports are explicitly labelled; no provider acknowledgement, automatic geofence event, invoice posting or ERP reconciliation is claimed.
- Delivery documents stay on the operator's device. The platform stores a reference and fingerprint, not an uploaded document or independently verified proof. A fingerprint does not establish authenticity.
- This iteration supports one origin visit and one destination outcome. Rejected deliveries remain incomplete. Returns, reattempts, multi-origin collections, multiple consignments, receiver/driver portal identities and assignment corrections need versioned workflows and customer discovery.
- If release evidence expires before departure, departure is blocked. A post-release remediation/reopening workflow is still required; the old release is not overwritten.
- Existing demonstration releases remain explicitly unverified in the timeline. They do not become versioned regulatory authority.
- Integration discovery must establish source ownership, stable external identifiers, tenant/site mappings, permissions, event timestamps, retries/replay semantics and reconciliation contracts before a real provider is enabled.

## Verification

- Backend non-live suite: 681 passed, one opt-in real-browser harness skipped, eight live tests deselected. Includes connected journey lifecycle, replay, assignment protection, site access, all six reading roles, restricted writes, rejected delivery and expired authority.
- Frontend: 67 existing unit tests plus three JourneyPanel tests passed; build and lint passed with existing warnings.
- Chromium: 20 existing practice scenarios and one new synthetic API-contract journey scenario passed. New scenario exercises departure, arrival and fingerprinted delivery on desktop/mobile. Contract fixtures are not evidence of a real ERP or telematics connection.
- Production verification is recorded separately after deployment; local synthetic tests do not establish production end-to-end operational acceptance.
