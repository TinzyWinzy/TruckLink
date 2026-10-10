"""Read-request memoization; no cross-request state or cached command authority."""
from contextvars import ContextVar
from copy import deepcopy
from functools import wraps
from inspect import signature

_cache = ContextVar('tenant_read_cache', default=None)


class TenantReadCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _cache.set({} if request.method in ('GET', 'HEAD') else None)
        try:
            return self.get_response(request)
        finally:
            _cache.reset(token)


def memoize_read(function):
    """Keys include every argument; model arguments include type, tenant/site ID."""
    parameters = signature(function)

    @wraps(function)
    def wrapped(*args, **kwargs):
        cache = _cache.get()
        if cache is None:
            return function(*args, **kwargs)
        bound = parameters.bind(*args, **kwargs)
        bound.apply_defaults()
        def key(value):
            if hasattr(value, '_meta'):
                return (value._meta.label, value.pk)
            return value
        identity = (function.__module__, function.__name__,
                    tuple((name, key(value)) for name, value in bound.arguments.items()))
        if identity not in cache:
            cache[identity] = function(*args, **kwargs)
        # Callers must not mutate another consumer's configuration/ORM instance.
        return deepcopy(cache[identity])
    return wrapped
