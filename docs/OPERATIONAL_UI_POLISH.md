# Reports and Inspection interface update

The visual direction keeps Trucki's navy, warm paper and amber palette while putting the movement and its next action before secondary analytics.

## Changes

- Reports leads with review priority, followed by a movement worklist sorted to show blocked handoffs first. Each row shows the vehicle, status, next action, responsible role, assigned person and a guided movement link.
- Missing metrics use subdued text. Queue and dock feeds distinguish loading, failed reads and genuinely empty results. Failed queue reads disable export and offer Retry.
- Inspection leads with recorded movement identity. Missing setup records and responsible roles remain visible. Setup forms, internal IDs, rule provenance, measurements and supporting explanations can be expanded when needed.
- The tenant, yard and single connection indicator share a compact header. Account details and sign-out are in the Account disclosure. Admin role switching remains available only to admin accounts.
- Queue fields have persistent labels; its inspection action is named Open inspection.
- Blocked, warning, active and ready statuses use semantic colours independent of tenant branding. Practice mode remains labelled.

## Verification

- Frontend unit suite: 92 passed.
- Build passes; lint has the existing shared UI Fast Refresh warning. Build retains existing bundle-size and PWA deprecation warnings.
- Synthetic browser contracts pass for guided dispatch through release and physical exit, offline arrival replay, setup, Reports loading/error/retry, exports, read-only presentation and tenant configuration. Desktop (1440 px) and mobile (390 px) screenshots were inspected; overflow, keyboard focus, action size and reduced-motion checks passed.
- Practice browser checks passed for all 18 cases across role sign-in, restrictions, pilot workflow, export and workspace navigation. The older compliance landing assertion was updated to the existing Pending Approvals screen and rechecked independently.
- The Northstar test is a disposable intercepted fixture. No additional production tenant has been configured.

The backend evaluator, permissions, independent approvals and release/gate policies are unchanged. This interface update does not assert legal verification. Production operational records must not be created or released during UI verification.

## Scope remaining

Admin's proposed Fleet/Staff/Yard/Evidence/Configuration tabs remain a later pass. Outdoor field readability has not been physically tested.
