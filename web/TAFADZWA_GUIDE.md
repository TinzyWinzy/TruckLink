# Tafadzwa's System Guide — BAK Intel (Harare Yard)

**Staff ID:** BAK-07-TAFADZWA · **Role:** DISPATCH_SUPERVISOR (Gate: register + validate)
**Start here in the app:** `/hub` (answers) → `/guide` (click-by-click, ticks save on the tablet)

## The 7 steps (also in-app at /guide)

0. **Sign in** (Gate sign-in `/`): demo → pick DISPATCH_SUPERVISOR → Start shift. Staging → Staff ID `BAK-07-TAFADZWA` + PIN. Done when you land on Shift queue.
1. **Register** (`/queue`): Plate + Driver + Cargo + Destination → + Register. Done when a ◆ QUEUED row appears. Offline shows ⏳ and syncs later.
2. **Pre-departure check** (`/compliance`): 1 Vehicle (route + type) → 2 Weights (⚖ Read from weighbridge or type) → 3 Checks (all REQUIRED) → 4 Validate. PASS enables release; FAIL quarantines + CRITICAL alert. Practice FAIL: Axle 2 = 11000kg.
3. **Docks** (`/docks`): tap a green AVAILABLE dock → oldest QUEUED assigns. Needs signal. As DISPATCH you watch; Ops taps. Demo: ABZ 9901 → Dock 3.
4. **Quarantine path** (`/compliance` → override panel): request needs a reason; a DIFFERENT supervisor approves. Requester never self-approves. ADP 3357 is the live example.
5. **Alerts** (`/alerts`): CRITICAL first, acknowledge what you own. DISPATCH is read-only here — hidden button is correct.
6. **Release + Reports** (`/queue` → `/reports`): release COMPLETED / OVERRIDE_APPROVED rows, then Reports → ↓ Export CSV for Takudzwa.

## Seeded shift you are looking at (demo + staging seed)

| Plate | Driver | Status | Meaning |
|---|---|---|---|
| AEH 4521 | T. Moyo | QUEUED | Assign next |
| AGX 9033 | S. Ndlovu | ASSIGNED | On Dock 1/2, loading |
| AFM 1187 | K. Sibanda | QUARANTINED | Axle 2 +1,400kg, Bay 4 |
| ABZ 9901 | R. Dube | QUEUED | Overdue 74m — prioritise |
| AEO 2210 | P. Chikafu | RELEASED | Cleared example |
| ADP 3357 | J. Banda | PENDING_OVERRIDE | Needs 2nd approver |
| AEW 7712 | M. Hove | OVERRIDE_APPROVED | Releasable |
| AFX 6640 | D. Mutasa | QUEUED | Newest arrival |

Docks: D1 Heavy OCCUPIED · D2 General OCCUPIED · D3 General AVAILABLE (tap target) · D4 Quarantine Bay (AFM 1187).

## Law in one card

S.I. 129/2015 + S.I. 159/2022: **$0.50/excess kg**. 1,500kg mismatch ≈ **$945** all-in. 7 stopped overloads repay the $6,200 pilot. Pilot axle limits: 8000/9000/9000 (TANKER axle-2: 8000; REFRIGERATED axle-1: 7500).

## When stuck

Offline → keep registering (⏳). PIN fails → caps, 4–12 digits, 3 tries then ADMIN. Scale won't pair → Chromium + manual entry works. Permission error → sign out/in. Quarantined truck → never wave through.

Full answer wall: in-app `/hub`.
