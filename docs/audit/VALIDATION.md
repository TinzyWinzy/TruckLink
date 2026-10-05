# Audit validation — 5 October 2026

Baseline HEAD: `d00c28e`. Local Python 3.14.2; Node 24.12.0; npm 11.6.2. Existing dependencies were used; no package installation or external deployment occurred.

| Command / scope | Observed result |
| --- | --- |
| backend `.venv/Scripts/python.exe -m pytest -m "not live" -q` | 567 passed, 8 deselected; 214 warnings; 148.84s |
| web `npm run lint` | Exit 0; one ui.tsx Fast Refresh warning |
| web `npm run test` | 55 passed, 11 files; 43.02s |
| web `npm run build` | Exit 0; TypeScript, Vite and PWA build passed; large chunk/deprecated option warnings |
| Django `manage.py check` | No issues |
| Django `manage.py makemigrations --check --dry-run` | No changes detected |
| Django `manage.py check --deploy` | Five warnings: HSTS, SSL redirect, audit-only weak secret, session secure cookie, CSRF secure cookie. Short test secret is not evidence of a production secret weakness. |
| web `npm run test:e2e -- --retries=0` | 15 demo Chromium tests passed, 38.4s |
| `docs/audit/reproduce_findings.py` | Eight current-behavior integrity/authorization probes confirmed in disposable in-memory database |

The first Playwright attempt failed at browser launch with `spawn EPERM` under filesystem/process sandboxing. It was stopped and rerun with approved sandbox escalation; all 15 tests passed. This was an execution restriction, not an application assertion failure. No production URL was exercised. Browser results cover existing practice flows, not all new regulatory acceptance criteria or live hardware.

Backend warnings include absent staticfiles directory and naive datetimes in existing dashboard tests. Existing tests primarily use SQLite and local/mocked services. PostgreSQL concurrency, actual production configuration, live UI suite, external notifications, connected weighbridge and regulator/ERP integrations were not validated.

## Isolated reproducer

This historical baseline script is now retired and exits before database setup. Current authority regressions are in `backend/tests/test_gate_integrity.py`; see `docs/BAK_IMPLEMENTATION_PROGRESS.md` for post-change validation. The following command and outcomes document the original audit only.

Original command from `backend/`:

```powershell
.\.venv\Scripts\python.exe ..\docs\audit\reproduce_findings.py
```

It overrides Django's database with `:memory:` before setup/migration, uses synthetic users/sites, makes only in-process API requests, and prints no tokens/secrets. It does not alter the local existing database or call a deployed service. Its assertions document current vulnerable behavior rather than intended acceptance. Once issues are fixed, convert these cases into negative regression tests in the main suite and update the audit status.

1. Payload-selected limits/rated mass produce a server PASS for inflated load input.
2. Failed checklist metadata does not block server PASS.
3. Generic status PATCH moves quarantine through override states to release without approval/check or exit stamp.
4. A same-organisation, different-facility replay key returns an inaccessible facility's check.
5. Resetting one site deletes organisation-wide compliance config.
6. Changing audit action/actor_ref does not invalidate chain verification.
7. Legacy public registration joins shared default organisation with operations role.
8. An authenticated user without an organisation creates a fleet vehicle in the first active organisation.

These results explain why a green baseline suite does not establish production gate integrity. The audit did not modify runtime code to fix them.
