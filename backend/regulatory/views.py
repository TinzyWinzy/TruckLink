from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from trip.permissions import get_user_organisation, get_user_role, scope_facility
from yard.models import QueueEntry
from . import models as m, services as s, serializers as z
from tenancy.configuration import workflow


def output(record):
    data = z.record_serializer(type(record))(record).data
    if type(record) in (m.SourceRevision, m.EvidenceRevision, m.VehicleConfiguration):
        approved, review = s.reviewed(record)
        data['review_status'] = 'REVIEWED' if approved else 'UNVERIFIED'
        data['review_id'] = review.pk if review else None
    if isinstance(record, m.RuleSetVersion):
        data['publication_id'] = m.Publication.objects.filter(ruleset=record).values_list('pk', flat=True).first()
    return data


def command(fn, status=201):
    try:
        return Response({'ok': True, **fn()}, status=status)
    except PermissionError as exc:
        return Response({'ok': False, 'error': str(exc)}, status=403)
    except (ValidationError, ValueError, IntegrityError) as exc:
        error = '; '.join(exc.messages) if isinstance(exc, ValidationError) else ('Conflicting record or replay key' if isinstance(exc, IntegrityError) else str(exc))
        return Response({'ok': False, 'error': error}, status=409)


class TenantView(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        from rest_framework.exceptions import PermissionDenied
        if not get_user_organisation(request.user) or not get_user_role(request.user):
            raise PermissionDenied('Tenant identity required')

    def subject(self, model, pk):
        return get_object_or_404(model.objects.filter(organisation=get_user_organisation(self.request.user)), pk=pk)

    def entry(self, pk):
        return get_object_or_404(scope_facility(QueueEntry.objects.filter(organisation=get_user_organisation(self.request.user)), self.request.user), pk=pk)

    def validate(self, serializer, data):
        obj = serializer(data=data, context={'organisation': get_user_organisation(self.request.user)})
        obj.is_valid(raise_exception=True)
        return obj.validated_data


class RegistryView(TenantView):
    def get(self, request, kind):
        model = z.RECORDS[kind][0] if kind in z.RECORDS else m.RuleSetVersion
        rows = model.objects.filter(organisation=get_user_organisation(request.user)).order_by('-created_at', '-pk')[:200]
        return Response({'ok': True, 'records': [output(x) for x in rows]})

    def post(self, request, kind):
        if kind == 'rulesets':
            data = self.validate(z.RuleSetCreateSerializer, request.data)
            return command(lambda: {'record': output(s.create_ruleset(request.user, **data))})
        model, serializer = z.RECORDS[kind]
        data = self.validate(serializer, request.data)
        def create():
            s.require_role(request.user, s.REVIEWERS)
            if (model == m.SourceRevision and data.get('kind') == 'STATUTE') or (model == m.RuleUnit and data['source'].kind == 'STATUTE'):
                raise PermissionError('New statutory sources and ROUs belong to the platform knowledge registry')
            row = model.objects.create(organisation=get_user_organisation(request.user), creator=request.user, **data)
            return {'record': output(row)}
        return command(create)


class ReviewView(TenantView):
    def post(self, request):
        data = self.validate(z.ReviewSerializer, request.data)
        model = {'source': m.SourceRevision, 'evidence': m.EvidenceRevision, 'configuration': m.VehicleConfiguration}[data['subject']]
        subject = self.subject(model, data['subject_id'])
        return command(lambda: {'review': output(s.review_record(request.user, subject, data['approved'], data['reason']))})


class PublishView(TenantView):
    def post(self, request, pk):
        ruleset = self.subject(m.RuleSetVersion, pk)
        data = self.validate(z.ReasonSerializer, request.data)
        return command(lambda: {'publication': output(s.publish_ruleset(request.user, ruleset, data['reason']))})


class ContextView(TenantView):
    def get(self, request, pk):
        entry = self.entry(pk)
        context = entry.regulatory_contexts.order_by('-created_at', '-pk').first()
        attempt = entry.inspection_attempts.first()
        configuration = output(context.configuration) if context else None
        readiness_error = None
        bundles = []
        if context:
            try:
                from tenancy.releases import snapshot
                snapshot(entry.organisation,entry.facility)
                s.context_snapshot(context, s.timezone.now())
                bundles = s.bundles_for(context, s.timezone.now())
            except ValidationError as exc:
                readiness_error = '; '.join(exc.messages)
        return Response({'ok': True, 'mode': 'VERSIONED' if context or entry.facility.yard_config.get('mode') != 'DEMO' else 'LEGACY_DEMO',
            'workflow': workflow(entry.organisation,entry.facility),
            'context': output(context) if context else None, 'configuration': configuration, 'readiness_error': readiness_error,
            'rulesets': [{'id': x['id'], 'digest': x['digest'], 'content': x['content']} for x in bundles],
            'attempt': output(attempt) if attempt else None})

    def post(self, request, pk):
        entry = self.entry(pk)
        data = self.validate(z.ContextSerializer, request.data)
        return command(lambda: {'context': output(s.create_context(request.user, entry, **data))})


class InspectView(TenantView):
    def post(self, request):
        data = self.validate(z.InspectionSerializer, request.data)
        entry = self.entry(data.pop('queue_entry'))
        def inspect():
            attempt, replayed = s.inspect_entry(request.user, entry, **data)
            return {'attempt': output(attempt), 'replayed': replayed}
        return command(inspect)


class AttemptView(TenantView):
    def get(self, request, pk):
        attempt = self.subject(m.InspectionAttempt, pk)
        self.entry(attempt.queue_entry_id)
        return Response({'ok': True, 'attempt': output(attempt),
            'requests': [output(x) for x in attempt.override_requests.order_by('created_at', 'pk')],
            'approvals': [output(x) for x in m.OverrideApproval.objects.filter(request__attempt=attempt)]})


class OverrideRequestView(TenantView):
    def post(self, request, pk):
        attempt = self.subject(m.InspectionAttempt, pk)
        self.entry(attempt.queue_entry_id)
        data = self.validate(z.ReasonSerializer, request.data)
        return command(lambda: {'request': output(s.request_override(request.user, attempt, data['reason']))})


class OverrideApprovalView(TenantView):
    def post(self, request, pk):
        subject = self.subject(m.OverrideRequest, pk)
        self.entry(subject.attempt.queue_entry_id)
        data = self.validate(z.ApprovalSerializer, request.data)
        return command(lambda: {'approval': output(s.approve_override(request.user, subject, **data))})
