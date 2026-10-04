"""Health check tests."""
from __future__ import annotations


class TestHealth:
    def test_health_returns_ok(self, anon_client):
        resp = anon_client.get("/api/health/")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["service"] == "truckledger"

    def test_health_does_not_require_db(self, anon_client):
        resp = anon_client.get("/api/health/")
        assert resp.status_code == 200

    def test_health_only_accepts_get(self, anon_client):
        resp = anon_client.post("/api/health/")
        assert resp.status_code == 405
