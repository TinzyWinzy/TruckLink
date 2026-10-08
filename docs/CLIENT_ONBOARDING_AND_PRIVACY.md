# Client onboarding and minimum personal information

8 October 2026. The user authorized a separate Trinitas administrator onboarding workspace, with operations locked pending discovery. This creates a tenant identity, not a discovered Trinitas operating configuration. No BAK workflow, policy, site, integration or regulatory assignment is copied.

## Implemented foundation

`POST /api/tenancy/signup/` retains the legacy password signup contract and adds a minimal PIN bootstrap. The PIN path accepts company/workspace identifiers, an optional username, staff ID and a 6–12 digit PIN. It rejects additional personal/contact fields. Company, workspace, one ADMIN account, membership, PIN hash, renewable session and bootstrap audit are written atomically. A failed credential or audit write rolls back the bootstrap. PIN login does not create another user. Public signup is subject to the credential IP throttle; stale access headers are ignored at this unauthenticated endpoint.

The account has no email, first/last name, usable password, Django staff privileges or platform-superuser privileges. PIN and session secrets are absent from the bootstrap audit. The returned credentials support the existing refresh-token flow.

The tenant requires an independently reviewed configuration release. Until activation, only the audit module is enabled. An onboarding workspace is explicitly marked as an administrative placeholder and does not establish a real yard or dock inventory. New unreleased administrators land on `/onboarding`, with tenant identity, activation status and a discovery checklist; established tenant landing behavior is retained. No checklist item is silently recorded as legal approval.

## Collection decisions

| Data | Initial setup | Purpose / later decision |
| --- | --- | --- |
| Company display name | Required | Tenant identification; registered legal details can be confirmed later |
| Workspace name/timezone | Required or explicit placeholder | Scope access; confirm actual operating sites during discovery |
| Staff identifier | Required | Sign-in and accountable audit identity; can still identify a person |
| Role/site membership | Required | Least-privilege access within the tenant |
| PIN hash/session records | Required | Authentication and session security |
| Employee name, email or phone | Omitted | Add only when a documented business purpose requires it |
| National ID, DOB, home address, biometrics, payroll/health data | Omitted | No purpose in initial workspace creation |
| Driver/licence records and document copies | Not collected at setup | Agree exact operational/regulatory purpose, minimum fields and retention before import |
| ERP/WMS/tracker data | Not imported | Discover vendor, contract, identifiers and minimum event fields first |

Use individual accounts for operations and independent approvals. Assign the bootstrap account to a confirmed owner before handover. Do not describe staff IDs, location history or activity logs as anonymous merely because names are absent.

## Legal source review

POTRAZ is the designated authority under the **Cyber and Data Protection Act [Chapter 12:07], Act 5 of 2021**. Section 7 requires proportionate data, accuracy and limited identifiable retention; sections 15–16 address notices when data is obtained directly or indirectly. Sections 28–29 address transfers abroad. These principles support minimum collection but require a purpose and governance beyond reducing fields. [Act published by POTRAZ](https://www.potraz.gov.zw/wp-content/uploads/2025/02/Cyber-and-Data-Protection-Act-Chapter-1207.pdf).

**S.I. 155 of 2024**, sections 3–4, establishes controller licensing duties; section 10 addresses controller responsibilities including processor agreements and notification of intended transfers abroad. DPO requirements appear in section 12. Applicability, licensing category, appointments and transfer arrangements require assessment against the actual processing activities. This implementation does not certify any organisation or Trucki as compliant. [Regulations published by POTRAZ](https://www.potraz.gov.zw/wp-content/uploads/2025/02/sI-155-of-2024-Cyber-and-Data-Protection-Normal_240913_1250178.pdf).

## Still required before real staff/driver imports

Agree controller/processor responsibilities, a processing inventory, field-level purpose and lawful basis, notices, privacy contact/rights process, processor contracts, hosting/transfer review, incident response, retention schedules and legal holds. Current infrastructure includes hosting outside Zimbabwe; minimum collection does not resolve transfer requirements.

The discovery checklist is guidance, not a stored privacy authorization, consent register or enforced retention engine. Automatic deletion, access/correction request workflows, self-service PIN rotation/first-use change and identity-verified customer invitations remain future work. Public signup is not evidence of company ownership; production customer onboarding needs an authorized representative and controlled handover. No additional operational integrations or data imports are enabled by this change.

## Validation

13 new synthetic backend cases test single-account creation, blank personal fields, PIN hashing, scoped renewable access, locked writes, invalid/excessive inputs, duplicate credentials, cross-tenant access and rollback. Together with retained auth and architecture tests, 50 backend cases pass. Browser verification covers the new tenant landing, restoration, navigation and mobile width. Existing tenant data is not part of the synthetic tests.

## Production receipt, 8 October 2026

Application commit `13bb6de174066b23181e700da07f47ee65717984` is deployed. Render `dep-db3jlnijnfac738e48kg` reached LIVE at 06:41:33 UTC. Vercel production `dpl_GJeqgxqSPvpRoKpYbmPfw13YDRgv` was staged, passed 10 read-only smoke checks, and was promoted to https://trucki-two.vercel.app. Its immutable URL is https://trucki-osukpokl8-brandontinozs-projects.vercel.app.

The user-approved Trinitas tenant is organisation 2, with administrative placeholder workspace 2 and one ADMIN user 3 (`TRK-TRINITAS-ADMIN`). Provisioning submitted no personal contact fields. Only audit is enabled; no active release, discovered policies, integrations or operational inventory were created. Credentials and local provisioning/verification helpers are excluded from Git, with no PIN or session secret in this record.

Production Chromium verification passed actual PIN sign-in, Trinitas identity, operational-module lock state, own-site audit read, denial of BAK audit access, session restoration, desktop/mobile layout and sign-out. API verification also denied access to BAK dashboard aggregates. No operational writes were made during verification. The staged suite's separate BAK-authenticated dashboard check remained skipped because BAK credentials were unavailable; this Trinitas verification does not establish a complete customer dispatch lifecycle.

Frontend build and lint passed with the existing shared-UI Fast Refresh warning. 105 existing frontend unit cases passed in the full run; the new gate case initially had an incomplete synthetic module fixture, which was corrected and all six gate cases then passed. The synthetic onboarding browser check passed. No database migration was required for this release.
