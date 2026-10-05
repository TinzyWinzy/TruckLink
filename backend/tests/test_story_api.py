"""User-story regressions exposed by full browser/API navigation."""
import pytest
from rest_framework.test import APIClient
from tests.test_regulatory import domain, inspect

pytestmark = pytest.mark.django_db


def test_bak_01_16_recorded_inspection_survives_context_refresh(domain):
    attempt = inspect(domain)
    client = APIClient()
    client.force_authenticate(domain['inspector'])
    response = client.get(f'/api/regulatory/queue/{domain["entry"].pk}/context/')
    assert response.status_code == 200
    assert response.data['attempt']['id'] == attempt.pk
    assert response.data['attempt']['decision'] == 'PASS'
