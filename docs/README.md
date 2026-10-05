# BAK documentation index

Current direction: renewed BAK INTEL work, grounded in the existing yard application and a reusable N-ROK regulatory service. Documentation status as of 5 October 2026:

| Document | Authority/status |
| --- | --- |
| [User stories and delivery backlog](BAK_USER_STORIES.md) | Draft stories, acceptance criteria, implementation gaps, dependencies and PRD/SAD/brief traceability |
| [User-story flow test results](USER_STORY_FLOW_TEST_RESULTS.md) | Real browser/API journeys, story coverage, production blockers and test-driven fixes |
| [Implementation progress](BAK_IMPLEMENTATION_PROGRESS.md) | Stabilization changes, rollout constraints, remaining work and post-change tests |
| [Regulatory domain and engine](REGULATORY_DOMAIN_AND_ENGINE.md) | Implemented provenance, context, evaluation, approvals, gate policy and API contract |
| [Existing-system audit](BAK_EXISTING_SYSTEM_AUDIT.md) | Historical baseline at d00c28e; gaps and validation limits |
| [Upgrade plan](BAK_REGOPS_UPGRADE_PLAN.md) | Proposed file-level changes, migrations and phase exit gates |
| [Directory/product strategy](BAK_DIRECTORY_AND_PRODUCT_STRATEGY.md) | Recommended BAK/N-ROK/Trucki boundaries and cleanup sequence |
| [Provided master brief](briefs/BAK_INTEL_MASTER_BRIEF_2026-10.txt) | Stakeholder target requirements; not implemented/verified law |
| [Audit validation](audit/VALIDATION.md) | Executed checks and reproducible probes |
| [Regulatory source inventory](../REGULATORY_SOURCES.md) | Referenced instruments/assumptions; all statutory content remains unverified |
| [Trucki PRD v2](PRD_v2_Trucki.md), [SAD v2](SAD_v2_Trucki.md) | Previous broader roadmap/architecture lineage; some requirements are implemented and some claims conflict with current source |
| `archive/` | Historical BAK proposals/specifications/meeting evidence |
| `reference/` | Non-runtime events/WMS implementation references; not connected services |

Product activation, legal verification and live connectivity require their own evidence. Passing the current suite does not establish the new master brief's acceptance criteria. Future architecture/provenance/engine/offline/security documents should be maintained as implementations land, with planned behavior distinguished from observed behavior.
