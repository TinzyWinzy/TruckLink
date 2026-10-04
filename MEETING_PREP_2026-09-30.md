# BAK Logistics × RadBit Studios — Meeting Prep
**Wednesday 30 September 2026, 09:00 AM Microsoft Teams**
**Attendee:** Takudzwa Mandiwanza, Business Development Manager, BAK Logistics
**Objective:** Validate the operational problem, demonstrate the prototype, secure pilot commitment

---

## 1. THE 15-MINUTE CONVERSATION ARCHITETECTURE

### Minutes 0-2: Problem Framing (Your Opening)
**Goal:** Establish that you understand BAK's world, not just selling software.

**Say this:**
> "Takudzwa, I've been studying BAK's position as a regional transit gateway. I see two specific operational pressures: first, yard visibility — knowing where every truck is, how long it's waiting, and whether docks are being used efficiently. Second, compliance risk — the government's Zero Tolerance campaign means one overweight truck can trigger fines, delays, and reputational damage. I built a system to address both. But I'm not assuming I have BAK's exact workflow right. I'd rather show you what I've built, hear how it compares to reality, and see if there's a genuine fit."

**Why this works:** You lead with their problem, not your product. You signal humility. You frame the meeting as validation, not a pitch.

---

### Minutes 2-7: The Live Demonstration (One Truck's Journey)
**Goal:** Show the complete operational chain — not features, but a workflow.

**Demo path (use demo mode — practice data, no risk):**

1. **Register** (`/queue`): "A truck arrives at the gate. The dispatcher registers plate, driver, cargo, destination. The truck appears in the live queue instantly."
   - Show: AEH 4521 already queued
   - Point out: "Oldest first — the queue is fair and visible to everyone."

2. **Assign Dock** (`/docks`): "The yard supervisor sees a free dock, taps it, and the oldest truck is assigned automatically."
   - Show: Tap Dock 3 (available) → oldest truck assigns
   - Point out: "No radio calls. No confusion about who goes where."

3. **Compliance Check** (`/compliance`): "Before the truck leaves, the dispatcher runs a 4-step check: vehicle type, weights from the weighbridge, physical checks, then validate."
   - Show: Enter entry ID → select route → enter weights → tick checks → Validate
   - **Show a PASS first** (weights within limits)
   - **Then show a FAIL** (Axle 2 = 11000kg → over limit)
   - Point out: "A failed check quarantines the truck. It cannot be released. The system enforces the law, not the dispatcher's mood."

4. **Quarantine Override** (still in `/compliance`): "If there's a legitimate reason to override — say a re-weigh confirms the load is legal — a supervisor can request an override. But a DIFFERENT supervisor must approve it. The requester can never approve their own override."
   - Show: Request override → reason required → second approver needed
   - Point out: "This is the September 2025 incident solved. No single person can wave a truck through."

5. **Release** (`/queue`): "Once the truck passes compliance — or gets a legitimate override — it can be released. Every action is logged in the audit trail."
   - Show: Release button on COMPLETED/OVERRIDE_APPROVED trucks
   - Point out: "The audit trail is hash-chained. It's tamper-proof evidence for ZIMRA or any regulatory dispute."

6. **Reports** (`/reports`): "At the end of the shift, the facility manager sees: how many trucks were overdue, average turnaround, dock utilization, and can export a CSV for you."
   - Show: Stats dashboard + CSV export button
   - Point out: "This is the baseline data BAK currently lacks. After 14 days, you have hard numbers to optimize against."

**Demo tips:**
- Use Chrome on your laptop — full screen, no distractions
- Have the prototype already open in demo mode
- Don't click around randomly — follow the truck's journey
- If something breaks, say "That's exactly why we pilot — to find these issues before go-live"

---

### Minutes 7-12: Discovery Questions (Get Him Talking)
**Goal:** Validate whether your assumptions match BAK's reality.

**Ask these questions (listen more than you talk):**

1. **"Walk me through what happens when a truck arrives at the Harare yard today. Who does what, in what order?"**
   - Listen for: paper-based processes, radio communication, manual calculations, bottlenecks

2. **"How do you currently handle axle load compliance? Who checks, and what happens when a truck is over?"**
   - Listen for: manual calculations, weighbridge processes, override culture, fine history

3. **"What's the biggest source of delay or frustration in the yard right now?"**
   - Listen for: dock allocation disputes, truck queuing, paperwork, communication gaps

4. **"After the September 2025 incident, what changed in your gate processes?"**
   - Listen for: new procedures, trust issues, audit concerns, pressure from management

5. **"If you could see one number at the end of each shift that you don't see today, what would it be?"**
   - Listen for: turnaround time, dock utilization, compliance pass rate, truck wait time

6. **"Who would actually use this system day-to-day? What devices do they have?"**
   - Listen for: tablet availability, smartphone usage, computer literacy, shift patterns

**What to do with the answers:**
- If he confirms your assumptions: "That's exactly what the system addresses."
- If he corrects you: "That's really helpful — that's something we'd need to adapt in the pilot."
- If he reveals a new pain point: "Interesting — is that something you'd want included in the pilot scope?"

---

### Minutes 12-15: The Close (Next Steps, Not Pressure)
**Goal:** Leave with a concrete commitment, not a vague "we'll think about it."

**Say this:**
> "Takudzwa, based on what you've described, I believe there's a genuine operational case for a pilot. I'd propose we start with a focused 6-week deployment at one facility — Harare, if that makes sense. The pilot would include:
> - The yard queue and dock management system
> - The compliance gatekeeper with weighbridge integration
> - Three ruggedized tablets for your dispatch team
> - Full training and go-live support
>
> The investment is US$6,200 — US$5,000 for the software and US$1,200 for the tablets. Based on the ZINARA penalty of US$0.50 per excess kilogram, seven avoided overload events would repay the entire pilot.
>
> But I don't want to rush you. What I'd suggest is this: I'll send you the prototype link and a short summary of what we discussed today. You can share it with your operations team. If they see the same value you do, we can schedule a follow-up to finalize the pilot scope and start date.
>
> Does that work for you?"

**Why this works:**
- You propose a specific next step (share with team)
- You give him an easy out (no pressure)
- You anchor the ROI (7 overloads = pilot repaid)
- You position yourself as a partner, not a vendor

---

## 2. OBJECTION HANDLING

### "We already have systems for this."
**Response:** "That's exactly why this is designed as an overlay, not a replacement. It sits on top of your existing WMS/ERP. During the pilot, it operates completely independently — no integration required, no disruption to your current operations. If it proves value, we can discuss API integration in Phase 2."

### "Our staff won't adopt new technology."
**Response:** "That's a legitimate concern, and it's why the system is designed for tablets with large touch targets, offline capability, and a 7-step walkthrough built in. We also train 1-2 'champions' per shift who support their peers. The demo you saw is the actual interface — it's simpler than most apps your team already uses."

### "US$6,200 is a significant investment."
**Response:** "It is, which is why the pilot is designed to prove value quickly. At US$0.50 per excess kilogram, a single 1,800kg overload costs US$900 in direct penalties. Seven of those events repay the entire pilot. And that's before counting reduced detention fees, faster turnaround, and the reputational protection of a tamper-proof audit trail."

### "We need to think about it / discuss with the team."
**Response:** "Absolutely — I'd expect nothing less. I'll send you the prototype and a summary today. You can review it with your operations team. If they see value, we schedule a follow-up. If not, no hard feelings — at least you'll have a clear picture of what's possible."

### "What if the system goes down during operations?"
**Response:** "The system is offline-first. If the internet goes down, your team keeps working — entries queue locally and sync when connectivity returns. The compliance check works offline too. The only thing that requires connectivity is real-time sync between tablets, and even that queues safely."

### "How is this different from a generic logistics app?"
**Response:** "Three things: First, it's built specifically for Zimbabwe's regulatory environment — the axle load limits, the ZINARA penalty structure, the S.I. 129/2015 and S.I. 159/2022 regulations. Second, it's designed for the yard environment — offline-first, tablet-optimized, role-based. Third, it's built around BAK's actual workflow — the queue, the dock assignment, the compliance gate, the quarantine override. It's not a generic tool; it's a purpose-built operational layer."

---

## 3. WHAT YOU MUST KNOW BEFORE WALKING IN

### The Product (What You Built)
- **Stack:** React + TypeScript + Vite PWA, Firebase (Firestore + Cloud Functions)
- **Modules:** Queue management, Dock board, Compliance check, Alerts, Reports, Audit trail
- **Key features:** Offline-first, role-based access, weighbridge integration (Web Serial API), push notifications, hash-chained audit trail
- **Demo mode:** Practice data, no risk, works without Firebase
- **Live mode:** Real Firebase backend, real data

### The Economics
- **Pilot cost:** US$6,200 (US$5,000 software + US$1,200 tablets)
- **ROI anchor:** US$0.50/kg axle-overload penalty → 7 avoided 1,800kg events = US$6,300
- **Break-even:** Within the first month if the system catches just 7 overloads

### The Regulatory Context
- **S.I. 129/2015 + S.I. 159/2022:** Zimbabwe axle load regulations
- **Zero Tolerance campaign:** Launched November 2025, targeting Bulawayo-Vic Falls corridor
- **Penalty:** US$0.50 per excess kilogram per axle
- **Enforcement:** Mobile weighbridges, 24-hour checkpoints

### The Competitive Context
- **Ryder System:** AI-driven Yard OS → 85% gate processing reduction, 5.7x 3-year ROI
- **Industry trend:** 70% of logistics enterprises adopting digital transformation
- **BAK's position:** Zimbabwe's largest inland port operator — scale demands digital leverage

### The Prototype URL
- **https://bak-five.vercel.app/**
- Use demo mode (practice data) for the walkthrough
- The seeded shift includes: 8 trucks in various states, 4 docks, alerts, audit trail entries

---

## 4. THE CLOSE — WHAT "WINNING" LOOKS LIKE

**Best outcome:** Takudzwa agrees to a follow-up meeting with his operations team to finalize pilot scope.

**Good outcome:** Takudzwa asks for the prototype link and summary to share internally — you get a second conversation.

**Minimum outcome:** You learn where your assumptions are wrong, and you leave with a clear picture of what BAK actually needs.

**What you must NOT do:**
- Do not lead with price
- Do not pressure for a same-day commitment
- Do not dismiss his concerns about adoption or cost
- Do not claim the system is perfect — it's a pilot, and you're there to learn

---

## 5. POST-MEETING ACTION ITEMS

1. **Today:** Send Takudzwa the prototype link + a 1-page summary of what you discussed
2. **Tomorrow (if no response):** Follow up with a brief email — "Thanks for your time today. The prototype link is below. Looking forward to your team's feedback."
3. **Within 3 days:** If no response, call him — "Just checking you received the prototype. Any initial thoughts?"
4. **If he agrees to follow-up:** Schedule within 1 week, include operations team, finalize pilot scope and start date

---

## 6. YOUR MINDSET GOING IN

**You are not there to sell. You are there to discover.**

The prototype is your credibility. The demo is your evidence. The discovery questions are your real product. If Takudzwa validates the problem, the sale follows. If he corrects your assumptions, you've learned something valuable either way.

**Remember:** You built a working system that solves a real problem in a regulated industry. That puts you ahead of 99% of people who pitch ideas. Let the work speak.

---

*Prepared by RadBit Studios — 29 September 2026*
