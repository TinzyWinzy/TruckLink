"""Operational inspection requirements; these are not statutory rules."""

MANDATORY_CHECKLIST_IDS = (
    "driver-license", "vehicle-reg", "cargo-manifest", "weight-cert", "axle-calc",
)


def missing_checks(checklist, organisation=None):
    """Only explicit boolean attestations count; strings and numbers do not."""
    if organisation:
        from tenancy.configuration import workflow
        required = workflow(organisation)['mandatory_checks']
    else:
        required = MANDATORY_CHECKLIST_IDS
    return [key for key in required if checklist.get(key) is not True]
