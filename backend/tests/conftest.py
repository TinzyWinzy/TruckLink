"""Pytest fixtures for backend integration tests.

Provides:
  - `api_client`   — DRF APIClient
  - `mock_geo_router` — patches `geocoding.geocode` + `routing.route` with synthetic data
  - `freezer`      — pins datetime so tests are deterministic
  - `live_network` — fixture requiring a live backend
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spotter_backend.settings")
os.environ.setdefault("DJANGO_SECRET_KEY", "pytest-local-only-not-a-secret")

import django  # noqa: E402
django.setup()

from rest_framework.test import APIClient  # noqa: E402

CITY_COORDS = {
    "Harare, Zimbabwe":         (-17.8292, 31.0522),
    "Beitbridge, Zimbabwe":     (-22.0000, 29.9833),
    "Johannesburg, South Africa": (-26.2041, 28.0473),
    "Mutare, Zimbabwe":         (-18.9667, 32.6667),
    "Bulawayo, Zimbabwe":       (-20.1500, 28.5833),
    "Lusaka, Zambia":           (-15.3875, 28.3228),
    "Unknown City, ZZ":         (None, None),
}


def _synthetic_route(coords):
    """Mimics OSRM: a straight-line geometry between waypoints."""
    import math

    R_MI = 3958.8
    total_mi = 0.0
    for i in range(1, len(coords)):
        lat1, lon1 = coords[i - 1]
        lat2, lon2 = coords[i]
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        total_mi += R_MI * c
    return {
        "distance_mi": total_mi,
        "duration_seconds": total_mi / 55.0 * 3600,
        "geometry": {
            "type": "LineString",
            "coordinates": [[lon, lat] for (lat, lon) in coords],
        },
    }


@pytest.fixture(autouse=True)
def _reset_throttle_cache():
    """DRF throttles count in the shared cache; reset every test so
    AnonRateThrottle (10/h) never leaks across tests."""
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def default_org(db):
    """The single org every test object belongs to (slug='default')."""
    from trip.models import Organisation
    return Organisation.objects.get_or_create(
        slug="default", defaults={"name": "Test Fleet"},
    )[0]


@pytest.fixture
def default_facility(default_org):
    """The facility every test operator belongs to."""
    from core.models import Facility
    fac, _ = Facility.objects.get_or_create(
        organisation=default_org, slug="main-yard",
        defaults={"name": "Main Yard"},
    )
    return fac


@pytest.fixture
def auth_user(default_org, default_facility):
    """Staff-adjacent operator: real user + profile bound to the default org
    and facility, with a real DRF token (so tests may override credentials)."""
    from django.contrib.auth import get_user_model
    from rest_framework.authtoken.models import Token
    from trip.models import UserProfile

    User = get_user_model()
    user, _ = User.objects.get_or_create(username="ops")
    if not user.has_usable_password():
        user.set_password("ops-pass-123")
        user.save()
    profile, _ = UserProfile.objects.get_or_create(
        user=user, defaults={"organisation": default_org},
    )
    if profile.organisation_id != default_org.id:
        profile.organisation = default_org
        profile.save(update_fields=["organisation"])
    profile.facilities.add(default_facility)
    Token.objects.get_or_create(user=user)
    return user


@pytest.fixture
def api_client(auth_user):
    """Authenticated API client — the default for endpoint tests.
    Anonymous behaviour must be tested with `anon_client`."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {auth_user.auth_token.key}")
    return client


@pytest.fixture
def anon_client():
    """Unauthenticated client for AllowAny endpoints (health, services)."""
    return APIClient()


@pytest.fixture
def mock_geo_router():
    """Patch geocoding.geocode + routing.route with deterministic synthetic data."""
    def fake_geocode(query):
        if query in CITY_COORDS:
            lat, lon = CITY_COORDS[query]
            if lat is None:
                return None
            return {"lat": lat, "lon": lon, "display_name": query, "label": query}
        return None

    def fake_route(lonlat_pairs):
        coords_latlon = [(lat, lon) for (lon, lat) in lonlat_pairs]
        return _synthetic_route(coords_latlon)

    with patch("trip.views.geocoding.geocode", side_effect=fake_geocode) as geo_patch, \
         patch("trip.views.routing.route", side_effect=fake_route) as route_patch:
        yield {
            "geocode": geo_patch,
            "route": route_patch,
        }


@pytest.fixture
def frozen_time():
    """Pin datetime.utcnow() to a known moment."""
    fixed = datetime(2026, 6, 5, 6, 0, 0)
    with patch("trip.views.datetime") as dt_patch:
        dt_patch.utcnow.return_value = fixed
        yield fixed


@pytest.fixture
def live_network():
    """Skip test if the live backend isn't reachable."""
    import socket
    from urllib.parse import urlparse

    url = os.environ.get("SPOTTER_LIVE_URL", "http://127.0.0.1:8001")
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=3):
            return url
    except OSError:
        pytest.skip(f"Live backend not reachable at {url}")
