"""Operational inspection requirements; these are not statutory rules."""

MANDATORY_CHECKLIST_IDS = (
    "driver-license", "vehicle-reg", "cargo-manifest", "weight-cert", "axle-calc",
)


def missing_checks(checklist):
    """Only explicit boolean attestations count; strings and numbers do not."""
    return [key for key in MANDATORY_CHECKLIST_IDS if checklist.get(key) is not True]
