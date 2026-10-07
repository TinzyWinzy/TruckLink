# Evidence, deliveries and offline recovery

Trucki now exposes three existing capability areas as tenant-aware operator workspaces. BAK remains the first configured tenant. No second customer tenant, statutory instrument or monetary penalty is introduced.

## Evidence

`/evidence` searches the tenant evidence register by document key, type, vehicle, driver, destination or load reference. It shows review state separately from issue and expiry dates, as of the displayed server read time. Filters apply to the latest 200 matching revisions; search narrows the server query. Entity choices show the latest 200 master records per type.

Admin and Compliance authors with the tenant's regulatory review permission can record evidence against exactly one existing vehicle, driver, trip or load. Renewal appends a new revision; it does not replace previous records. The existing vehicle-rating and configuration desk remains available. Independent decisions remain in Pending approvals and the server rejects self-approval.

The browser fingerprints a selected local document. The file is not uploaded and authenticity is not established. Authors must retain the file at the recorded location. Evidence type codes must match the tenant's configured inspection requirements. Reviewed evidence does not itself authorise movement release.

## Deliveries and exceptions

`/deliveries` lists linked journeys originating at the selected, assigned yard. Search covers vehicle, driver, destination and manually retained external reference. Server pagination returns 20 matching journeys; stage filters explicitly apply to the current page.

The board uses the existing journey state and next-action policy. Opening a movement exposes the existing independently authorised commands for gate exit, destination arrival, delivery outcomes, same-destination reattempts, ordered consignments, release withdrawal and authorised returns. Physical delivery, retained evidence, ERP acknowledgement and commercial closure remain separate.

The board skips constructing full audit history for each card. A selected journey loads its retained history through the existing journey endpoint. The board does not silently include unlinked drafts, receiving-site journeys originating elsewhere, or claim live tracker or ERP integration. Routes and Dispatch flow remain available for planning and linking.

## Offline recovery

`/recovery` lists saved submissions and retry history belonging to the current staff identity, selected yard and backend on the current device. Header backlog links use the same ownership filter. Other identities' payloads are excluded.

IndexedDB version 4 retains existing pending submissions and adds local recovery history. Explicit retries are limited to arrival submissions blocked after confirmed transient failures. They require a reason, preserve the original payload and idempotency key, and record the previous error and attempt count before resetting retry state. Replay remains subject to server authorisation.

Permanent server rejections, legacy failures without a known category, and offline inspection actions require manual reconciliation. They are retained, not reassigned, edited, silently discarded or automatically unblocked. Recovery records can be exported as JSON and remain available after successful replay, until browser storage is cleared. Versioned inspections, approvals and release still require connectivity.

## Verification

- 101 frontend unit tests passed, including ownership restrictions, immutable retry keys, terminal rejection and retained recovery history.
- 38 focused backend tests passed, including all four evidence associations, renewal, self-approval rejection, tenant isolation, board scope, pagination, read-only requests and existing journey execution.
- Four synthetic Chromium browser cases passed: renewal authoring, delivery error/retry and selected actions, offline replay/export, and existing dock-exit-delivery recovery.
- Desktop and 390px mobile screenshots were captured and visually inspected for all three workspaces. Existing contrast, focus and reduced-motion styling is reused.
- Build passed; lint has only the pre-existing shared UI Fast Refresh warning.

Production verification uses only operational reads, authentication and role switches. Successful authoring and replay are demonstrated with synthetic intercepted APIs and isolated backend test records. Production absence of complete journeys is reported honestly and is not filled with invented customer data.

## Production release, 7 October 2026

- Application commit: `b1a39b1c42937600c763ad64f5983cdb0da9f95c`.
- Backend deploy `dep-db36rkeq1p3s73f78q0g` confirmed live at that commit.
- Frontend deployment `dpl_HBnqmvhFC8HESeVuDZ6spiXFXA2A` ready and promoted after backend activation.
- Production: https://trucki-two.vercel.app/ . Immutable frontend: https://trucki-omq53knpm-brandontinozs-projects.vercel.app/ .
- Fourteen production checks passed across admin/session/roles, protected API, practice navigation and the three new workspaces. The new workspace check was rerun after correcting a test selector to use the combobox's accessible name.
- The first tenant's site 1 returned zero evidence revisions and zero linked journeys. Entry 1 still had VEHICLE, TRIP, RATINGS and LOAD prerequisites. No customer evidence, journey, inspection, approval, release or delivery was created or changed by these checks.
- Production mobile screenshots for Evidence and Deliveries were captured and visually inspected. Production remains an incomplete operational demonstration until tenant master records and a properly reviewed practice case are supplied.
