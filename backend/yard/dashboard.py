"""Tenant/site dashboard aggregates over recorded yard facts, never release authority."""
from datetime import timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Q
from django.db.models.functions import TruncDay, TruncHour
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit_views import resolve_facility
from core.rbac import RoleAccess, rbac_allows
from trip.permissions import get_user_role
from yard.models import Alert, Dock, QueueEntry


class DashboardView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = 'reports'

    def get(self, request):
        site, error = resolve_facility(request)
        if error is not None:
            return error
        from tenancy.releases import module_enabled
        if not module_enabled(site.organisation,'reports'):
            return Response({'detail':'Operational intelligence requires an entitled, configured reports module'},status=403)
        window = request.query_params.get('window', '24h')
        days = {'24h': 1, '7d': 7, '30d': 30}.get(window)
        if days is None:
            return Response({'detail': 'Window must be 24h, 7d or 30d'}, status=400)
        now = timezone.now()
        start = now - timedelta(days=days)
        try:
            site_tz = ZoneInfo(site.timezone)
        except ZoneInfoNotFoundError:
            return Response({'detail': 'Site timezone requires configuration'}, status=409)
        role = get_user_role(request.user)
        if not rbac_allows(role, 'queue', 'read', site.organisation, site):
            return Response({'detail': 'Yard data read permission required'}, status=403)
        entries = QueueEntry.objects.filter(organisation=site.organisation, facility=site)
        # Legacy completed/released timestamps can mean authorisation, not physical exit.
        physical = entries.filter(milestone_semantics='SEPARATE_V1',
            exit_timestamp__gte=F('entry_timestamp'), exit_timestamp__lte=now)
        active = entries.filter(entry_timestamp__lte=now, exit_timestamp__isnull=True).exclude(
            Q(milestone_semantics='LEGACY_COMBINED') & Q(status__in=['COMPLETED', 'RELEASED']))
        duration = ExpressionWrapper(F('exit_timestamp') - F('entry_timestamp'), output_field=DurationField())
        exited = physical.filter(exit_timestamp__gte=start)
        exit_stats = exited.aggregate(mean=Avg(duration), count=Count('pk'))
        statuses = dict(active.values('status').annotate(n=Count('pk')).values_list('status', 'n'))
        ages = [
            {'label': 'Under 30m', 'count': active.filter(entry_timestamp__gt=now-timedelta(minutes=30)).count()},
            {'label': '30 to 60m', 'count': active.filter(entry_timestamp__lte=now-timedelta(minutes=30), entry_timestamp__gt=now-timedelta(minutes=60)).count()},
            {'label': '60 to 120m', 'count': active.filter(entry_timestamp__lte=now-timedelta(minutes=60), entry_timestamp__gt=now-timedelta(minutes=120)).count()},
            {'label': '120m+', 'count': active.filter(entry_timestamp__lte=now-timedelta(minutes=120)).count()},
        ]
        # Hourly bins are UTC instants, including DST folds. Daily bins use site calendar days.
        hourly = window == '24h'
        bucket_tz = dt_timezone.utc if hourly else site_tz
        trunc = TruncHour if hourly else TruncDay
        def grouped(query, field):
            return {row['bucket'].isoformat(): row['n'] for row in query.order_by().annotate(
                bucket=trunc(field, tzinfo=bucket_tz)).values('bucket').annotate(n=Count('pk'))}
        arrivals = grouped(entries.filter(entry_timestamp__gte=start, entry_timestamp__lte=now), 'entry_timestamp')
        exits = grouped(exited, 'exit_timestamp')
        bucket = start.astimezone(bucket_tz).replace(minute=0, second=0, microsecond=0)
        end_bucket = now.astimezone(bucket_tz).replace(minute=0, second=0, microsecond=0)
        if not hourly:
            bucket = bucket.replace(hour=0)
            end_bucket = end_bucket.replace(hour=0)
        series = []
        while bucket <= end_bucket:
            key = bucket.isoformat()
            series.append({'at': key, 'arrivals': arrivals.get(key, 0), 'exits': exits.get(key, 0)})
            bucket += timedelta(hours=1) if hourly else timedelta(days=1)
        can_docks = module_enabled(site.organisation, 'docks') and rbac_allows(role, 'docks', 'read', site.organisation, site)
        docks = Dock.objects.filter(organisation=site.organisation, facility=site)
        dock_counts = dict(docks.values('status').annotate(n=Count('pk')).values_list('status', 'n')) if can_docks else None
        can_alerts = module_enabled(site.organisation, 'yard') and rbac_allows(role, 'alerts', 'read', site.organisation, site)
        alerts = Alert.objects.filter(organisation=site.organisation, facility=site, acknowledged=False)
        alert_counts = dict(alerts.values('severity').annotate(n=Count('pk')).values_list('severity', 'n')) if can_alerts else None
        payload = {
            'metric_version': 'yard-dashboard-1', 'as_of': now, 'refresh_seconds': 5,
            'facility': {'id': site.pk, 'name': site.name, 'timezone': site.timezone},
            'window': {'key': window, 'from': start, 'to': now, 'bucket': 'hour' if hourly else 'day',
                'partial_edge_buckets': True},
            'series': series, 'active_statuses': statuses, 'age_buckets': ages,
            'summary': {'active': sum(statuses.values()),
                'blocked': statuses.get('QUARANTINED', 0) + statuses.get('PENDING_OVERRIDE', 0),
                'arrivals': sum(arrivals.values()), 'physical_exits': exit_stats['count'],
                'mean_turnaround_minutes': exit_stats['mean'].total_seconds()/60 if exit_stats['mean'] else (0 if exit_stats['count'] else None)},
            'docks': dock_counts, 'alerts': alert_counts,
            'coverage': {
                'legacy_completions_excluded': entries.filter(milestone_semantics='LEGACY_COMBINED').filter(
                    Q(exit_timestamp__gte=start, exit_timestamp__lte=now) |
                    Q(exit_timestamp__isnull=True, status__in=['RELEASED', 'COMPLETED'], updated_at__gte=start, updated_at__lte=now)).count(),
                'invalid_exit_timestamps': entries.filter(exit_timestamp__gte=start, exit_timestamp__lte=now,
                    exit_timestamp__lt=F('entry_timestamp')).count(),
                'future_arrivals_excluded': entries.filter(entry_timestamp__gt=now).count(),
                'latest_yard_record_update': entries.aggregate(latest=Max('updated_at'))['latest'],
                'active_scope': 'All recorded active visits, including arrivals before the selected chart window.',
                'exit_scope': 'Separate yard milestones with a valid recorded physical exit. Legacy completion proxies excluded.',
                'source': 'Recorded Trucki yard data. Poll time does not verify telemetry freshness.',
                'tracker': 'NOT_CONFIGURED', 'erp': 'NOT_CONFIGURED',
            },
        }
        response = Response(payload)
        response['Cache-Control'] = 'private, no-store'
        return response
