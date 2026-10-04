"""Compliance engine (SAD v2 section 9) - pure port of BAK.

Sources:
  - src/lib/validation/compliance.ts  (validateLoad, canTransition)
  - src/lib/validation/siTables.ts    (resolveSiLimits, bundled pilot tables)
  - src/lib/powersync/operations.ts   (overload kg / fine formula, USD 0.50/kg)

No DB access: tenant config is passed in as `remote` (dict shaped like the
BAK SiRemoteConfig interface).
"""
from __future__ import annotations

SI_ROUTES = ("BEITBRIDGE", "CHIRUNDU", "FORBES", "HARARE_LOCAL", "DEFAULT")

_PILOT_3AXLE = {
    "DEFAULT": [8000, 9000, 9000],
    "FLATBED": [8000, 9000, 9000],
    "TANKER": [8000, 8000, 9000],
    "REFRIGERATED": [7500, 9000, 9000],
    "CONTAINER": [8000, 9000, 9000],
    "DRY_VAN": [8000, 9000, 9000],
}

DEFAULT_SI_TABLES_BY_ROUTE = {route: dict(_PILOT_3AXLE) for route in SI_ROUTES}
FALLBACK_AXLE_LIMITS = [8000, 9000, 9000]

FEE_PER_KG_USD = 0.50

# Queue gate FSM. BAK's GateState called the loading state LOADING; the merged
# schema (operations.ts / firestore.rules) calls it AT_DOCK.
QUEUE_TRANSITIONS = {
    "QUEUED": ["ASSIGNED"],
    "ASSIGNED": ["AT_DOCK"],
    "AT_DOCK": ["COMPLETED", "QUARANTINED"],
    "COMPLETED": ["QUARANTINED", "RELEASED"],
    "QUARANTINED": ["PENDING_OVERRIDE"],
    "PENDING_OVERRIDE": ["OVERRIDE_APPROVED", "QUARANTINED"],
    "OVERRIDE_APPROVED": ["RELEASED"],
    "RELEASED": [],
}


class ComplianceInputError(ValueError):
    """Invalid engine input (zod-schema equivalent)."""


def normalize_route(route) -> str:
    key = (route or "DEFAULT").upper()
    return key if key in SI_ROUTES else "DEFAULT"


def normalize_vehicle(vehicle) -> str:
    key = (vehicle or "DEFAULT").upper()
    return key or "DEFAULT"


def resolve_si_limits(route, vehicle, remote=None) -> list[float]:
    """Resolve axle limits for (route, vehicle). Pure - safe offline."""
    r = normalize_route(route)
    v = normalize_vehicle(vehicle)
    remote = remote or {}

    by_route = (remote.get("siTablesByRoute") or {}).get(r) or {}
    if by_route.get(v):
        return list(by_route[v])
    if by_route.get("DEFAULT"):
        return list(by_route["DEFAULT"])

    flat = remote.get("siTables") or {}
    if flat.get(v):
        return list(flat[v])
    if flat.get("DEFAULT"):
        return list(flat["DEFAULT"])

    axle_default = (remote.get("axleLimits") or {}).get("default") or []
    if axle_default:
        return list(axle_default)

    bundled = DEFAULT_SI_TABLES_BY_ROUTE.get(r) or {}
    if bundled.get(v):
        return list(bundled[v])
    if bundled.get("DEFAULT"):
        return list(bundled["DEFAULT"])

    return list(FALLBACK_AXLE_LIMITS)


def validate_load(measured_weights, limits, total_weight, gvm_rating) -> dict:
    """Axle + GVM check. Returns per-axle findings and overall PASS|FAIL."""
    if not measured_weights:
        raise ComplianceInputError("At least one axle weight is required")
    if not limits:
        raise ComplianceInputError("Limits are required")
    if len(measured_weights) != len(limits):
        raise ComplianceInputError("measuredWeights and limits must have the same length")
    if any(w < 0 for w in measured_weights):
        raise ComplianceInputError("measuredWeights must be nonnegative")
    if any(limit <= 0 for limit in limits):
        raise ComplianceInputError("limits must be positive")
    if total_weight < 0:
        raise ComplianceInputError("totalWeight must be nonnegative")
    if gvm_rating <= 0:
        raise ComplianceInputError("gvmRating must be positive")

    violations = []
    axles = []
    for i, weight in enumerate(measured_weights):
        limit = limits[i]
        status = "PASS" if weight <= limit else "FAIL"
        if status == "FAIL":
            violations.append(f"Axle {i + 1}: {weight:g}kg exceeds limit {limit:g}kg")
        axles.append({
            "axle_position": i + 1,
            "measured_weight": weight,
            "limit": limit,
            "status": status,
        })

    gvm_status = "PASS" if total_weight <= gvm_rating else "FAIL"
    if gvm_status == "FAIL":
        violations.append(f"Total {total_weight:g}kg exceeds GVM {gvm_rating:g}kg")

    overall_status = "PASS" if not violations else "FAIL"
    return {
        "axles": axles,
        "gvm_status": gvm_status,
        "overall_status": overall_status,
        "violations": violations,
    }


def overload_kg(axles, total_weight, gvm_rating) -> float:
    """Worst excess across axles and GVM (operations.ts submitCompliancePS)."""
    axle_excess = sum(max(0.0, a["measured_weight"] - a["limit"]) for a in axles)
    return max(0.0, axle_excess, total_weight - gvm_rating)


def overload_fee_usd(kg: float) -> float:
    return kg * FEE_PER_KG_USD


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in QUEUE_TRANSITIONS.get(from_status, [])
