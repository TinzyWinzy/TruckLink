from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from tenancy.configuration import resolved, defaults
from tenancy.read_cache import TenantReadCacheMiddleware
from tests.test_tenant_platform import configure
from trip.models import Organisation

pytestmark = pytest.mark.django_db


def test_read_cache_reuses_queries_without_mutation_leak_and_expires_at_request_end(default_org):
    def view(request):
        first = resolved(default_org)
        first['content']['branding']['display_name'] = 'Mutated by caller'
        with CaptureQueriesContext(connection) as repeated:
            second = resolved(default_org)
        assert len(repeated) == 0
        assert second['content']['branding']['display_name'] == default_org.name
        return second
    middleware = TenantReadCacheMiddleware(view)
    assert middleware(SimpleNamespace(method='GET'))['version'] == 0
    content = defaults(); content['branding']['display_name'] = 'New revision'
    configure(default_org, content)
    response = TenantReadCacheMiddleware(lambda request: resolved(default_org))(SimpleNamespace(method='GET'))
    assert response['version'] == 1 and response['content']['branding']['display_name'] == 'New revision'
    with CaptureQueriesContext(connection) as outside:
        resolved(default_org)
    assert len(outside) > 0


def test_tenant_site_and_explicit_effective_time_have_distinct_keys(default_org, default_facility):
    other = Organisation.objects.create(name='Other cached tenant', slug='other-cached')
    def view(request):
        one = resolved(default_org)
        two = resolved(other)
        assert one['content']['branding']['display_name'] != two['content']['branding']['display_name']
        for kwargs in ({'facility': default_facility}, {'at': timezone.now()-timedelta(days=1)}):
            with CaptureQueriesContext(connection) as queries:
                resolved(default_org, **kwargs)
            assert len(queries) > 0
        return one
    TenantReadCacheMiddleware(view)(SimpleNamespace(method='GET'))


def test_commands_never_reuse_cached_authority_and_exception_resets_context(default_org):
    def command(request):
        resolved(default_org)
        with CaptureQueriesContext(connection) as fresh:
            resolved(default_org)
        assert len(fresh) > 0
    TenantReadCacheMiddleware(command)(SimpleNamespace(method='POST'))
    def fails(request):
        resolved(default_org)
        raise RuntimeError('Synthetic failure')
    with pytest.raises(RuntimeError):
        TenantReadCacheMiddleware(fails)(SimpleNamespace(method='GET'))
    with CaptureQueriesContext(connection) as fresh:
        resolved(default_org)
    assert len(fresh) > 0
