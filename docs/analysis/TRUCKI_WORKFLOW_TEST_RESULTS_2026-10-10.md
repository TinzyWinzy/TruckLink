# Trucki workflow test results — 10 October 2026

Tested locally against practice data and a disposable Django test database.

## Results

- Backend: 94 passed across connected journey, journey execution, operations workspace, gate integrity, consignments, minimal onboarding and route workspace.
- Frontend: 113 passed across all 29 Vitest files.
- Practice browser workflows: 19 passed; 1 failed on its first attempt. The automatic retry was stopped after inspecting the failure.
- Real browser/API gate stories: 3 passed; 1 failed, causing the pytest wrapper to fail.

## Findings

1. `web/e2e/workbench.spec.ts:14` clicks Compliance after switching to a 390px viewport without opening the mobile Menu. It timed out after 90 seconds. Update the journey to open Menu and then follow Compliance, asserting the navigation closes afterward.
2. `web/e2e/stories/gate.stories.spec.ts:87` calls the inspection helper for a missing corridor configuration. The UI instead renders “Complete setup before inspection” and “Setup required. Inspection and release remain blocked.” There are no axle fields; the helper timed out after 45 seconds. Reconcile the story with the intended setup prerequisite, retain assertions that release returns 409 and exceptions are unavailable, and test REVIEW_REQUIRED separately if that remains a supported path.

The three successful real gate stories verified PASS persistence and release, quarantine bypass rejection followed by corrected reinspection, and rejected self-approval followed by independent approval and release.

## Limits

These results do not validate production, all live browser journeys, or external integrations. Browser startup required execution outside the sandbox for localhost access. No application source was changed. Test-generated tracked screenshots were restored.

Failure evidence is under `web/test-results/practice/workbench-BAK-workbench-stays-usable-on-desktop-and-mobile-chromium/` and `web/test-results/stories/gate.stories-BAK-16-28-abs-4497b-ses-or-permits-an-exception/` (error contexts and traces).

## Follow-up verification

Both workbench browser tests now pass. The mobile story opens Menu, checks the expanded Close button, follows Compliance and confirms navigation closes.

All four real gate stories pass in the disposable Django browser harness. Missing corridor setup is asserted to hide axle inputs, inspection submission and exception requests; release remains 409 and no inspection/release record is created. Completed legacy visits with recorded versioned or demo inspections remain active until release, correcting a regression exposed by the new compact filter. Released legacy visits disappear from the active board while full-history API reads retain their RELEASED state. Separate-milestone release-authorized visits continue to remain active until physical exit.

These are local synthetic validations; hosted staging is pending an isolated database decision.
