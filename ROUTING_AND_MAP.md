# Routes and reported positions

Trucki adapts the Leaflet itinerary and fleet-position patterns from SpotterAiAssessment's `frontend/src/components/RouteMap.tsx`, `LiveMapPage.tsx` and `TripPlannerPage.tsx`. The workspace is available at `/routes` for all six staff roles. ADMIN, DISPATCH_SUPERVISOR, OPERATIONS_SUPERVISOR and FACILITY_MANAGER may save drafts; EXECUTIVE and COMPLIANCE_OFFICER can read and preview.

## Scope and evidence

The server resolves the selected facility from authenticated tenant membership. Trips must be assigned to that yard, or be legacy trips explicitly linked through an operational inspection context at the yard. Unassigned legacy trips are not silently backfilled. Legacy fleet endpoints retain their tenant behavior for unassigned trips and enforce yard membership for newly assigned trips.

Migration `trip.0008` adds a nullable protected facility, routing snapshot and replay key to existing Trip records. A conditional unique constraint and yard transaction lock prevent duplicate draft saves with the same key. Conflicting payloads return 409. Saving appends a yard audit event and leaves the trip at inquiry status. It creates no inspection attempt, approval or release record.

Route snapshots contain ordered geocoded stops, OSRM geometry, generic driving distance/time, provider, generation date, input digest and user-declared jurisdictions. Cross-border inputs require at least two distinct jurisdiction codes; geographic labels do not verify those declarations. Reported positions carry timestamp, source and accuracy, with reports older than five minutes marked stale. Missing positions remain unknown. Linked inspection decisions and ruleset snapshots are contextual evidence, not release authorization.

## APIs

- `GET /api/routes/workspace/?facility=<id>`: authorized yard trips, tenant vehicles/drivers and effective-role save capability.
- `POST /api/routes/preview/`: origin, destination, up to eight intermediate stops, route type, jurisdiction codes and optional tenant vehicle/driver IDs.
- `POST /api/routes/drafts/`: preview inputs plus `client_key`; replay returns the previously saved draft.

Both commands require facility membership, validate assignments before provider calls and share a 30-per-hour authenticated-user throttle. Saving rechecks assignments inside its transaction. Invalid or unavailable provider results return 502 without saving. The older `/api/trip/estimate/` now also orders origin, intermediate stops, destination correctly.

## Service limits

The planner reuses the existing Nominatim/Photon geocoder and OSRM public demo service. Generic driving geometry is not evidence of heavy-vehicle suitability, border permission, truck restrictions, statutory hours or regulatory clearance. No instrument or monetary penalty is asserted as verified law. Production service availability and capacity must be evaluated before relying on this for high-volume dispatch.

Leaflet uses standard OpenStreetMap tiles with visible attribution. The app does not prefetch tiles for offline use. Failed imagery leaves itinerary lists and overlays usable. Synthetic journeys are an explicit, read-only scenario dated 1 January 2026; their dashed straight connections are invented, with road distance/time unavailable. They are never inserted into the operational database.

References: [SpotterAiAssessment](https://github.com/TinzyWinzy/SpotterAiAssessment), [Leaflet documentation](https://leafletjs.com/reference.html), [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Verification before release

Backend regression checks: 66 tests passed for trip APIs, tenant isolation and regulatory evaluation; nine route checks passed after provider validation and command throttling changes. These cover ordered intermediate stops, audit creation, replay/conflict handling, yard isolation through old endpoints, stale positions, foreign assignments, read-only roles and malformed provider responses.

Frontend: production build, lint and 63 unit tests passed. All 20 practice browser flows passed, including map selection, mobile overflow, expansion/Escape, stale/no-position evidence and tile failure. Production checks are recorded after deployment in `PRODUCTION_INTERFACE_VALIDATION.md`.
