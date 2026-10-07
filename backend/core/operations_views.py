"""Read-only tenant/site handoffs. No aggregate grants release authority."""
from django.utils import timezone
from rest_framework.decorators import api_view,permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.audit_views import find_facility
from core.rbac import rbac_allows
from trip.permissions import get_user_role
from yard.models import QueueEntry,Dock,MovementOwnership
from regulatory.views import setup_data
from regulatory import models as m,services as s


def movement(entry,actor):
    setup=setup_data(entry,actor,include_choices=False)
    context=entry.regulatory_contexts.order_by('-created_at','-pk').first()
    attempt=entry.inspection_attempts.first()
    link=getattr(entry,'journey_link',None)
    blockers=setup['blockers']
    code=next((b['code'] for b in blockers),None)
    href=f'/dispatch?entry={entry.pk}'
    if entry.exit_timestamp and (entry.milestone_semantics=='SEPARATE_V1' or link and link.events.filter(kind='DEPARTED').exists()):
        action='Follow delivery and exceptions';stage='JOURNEY';roles=['OPERATIONS_SUPERVISOR','FACILITY_MANAGER']
    elif entry.status=='RELEASED':
        action='Confirm dock vacancy and physical gate exit' if link else 'Review historical release milestones';stage='EXIT';roles=['OPERATIONS_SUPERVISOR','DISPATCH_SUPERVISOR']
    elif code=='VEHICLE':action='Register the matching vehicle';stage='FLEET';roles=['ADMIN']
    elif code=='TRIP':action='Assign vehicle and driver to a trip';stage='TRIP';roles=['DISPATCH_SUPERVISOR']
    elif not link:action='Link the assigned trip to this origin visit';stage='TRIP';roles=['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR']
    elif code=='RATINGS':action='Record and independently review rating evidence';stage='EVIDENCE';roles=['ADMIN','COMPLIANCE_OFFICER']
    elif code=='LOAD' or not context:action='Select trip, load and route context';stage='SETUP';roles=['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR']
    elif entry.status=='PENDING_OVERRIDE':action='Obtain independent operational exception approval';stage='APPROVAL';roles=['OPERATIONS_SUPERVISOR']
    elif entry.status in ('COMPLETED','OVERRIDE_APPROVED'):action='Authorise release using current evidence';stage='RELEASE';roles=['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER']
    else:action='Resolve readiness and record a fresh inspection';stage='INSPECTION';roles=['DISPATCH_SUPERVISOR']
    ownership=entry.ownerships.filter(stage=stage).select_related('owner').first()
    owner=ownership.owner if ownership else None
    return {'id':entry.pk,'plate':entry.reg_number,'driver_name':entry.driver_name,'status':entry.status,
        'entered_at':entry.entry_timestamp,'age_minutes':max(0,int((timezone.now()-entry.entry_timestamp).total_seconds()/60)),
        'trip_id':link.trip_id if link else context.trip_id if context else None,'journey_linked':bool(link),
        'context_id':context.pk if context else None,'attempt_id':attempt.pk if attempt else None,
        'decision':attempt.decision if attempt else None,'blockers':blockers,
        'next_action':{'stage':stage,'label':action,'href':href,'owner_roles':roles,
            'assigned_person':owner.get_full_name() or owner.username if owner else None,
            'assignment_id':ownership.pk if ownership else None,'assigned_person_id':owner.pk if owner else None,
            'owner_available':bool(owner and owner.is_active and get_user_role(owner) in roles and owner.profile.facilities.filter(pk=entry.facility_id).exists())}}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def operations(request):
    site=find_facility(request.query_params.get('facility',''),request.user)
    if not site:return Response({'detail':'Assigned site not found'},status=404)
    role=get_user_role(request.user)
    if not rbac_allows(role,'compliance','read',site.organisation,site):
        return Response({'detail':'Operational inspection read access required'},status=403)
    entries=QueueEntry.objects.filter(organisation=site.organisation,facility=site).select_related('journey_link').order_by('-entry_timestamp')
    selected=request.query_params.get('entry')
    if selected:
        if not str(selected).isdigit():return Response({'detail':'Invalid visit'},status=400)
        entries=entries.filter(pk=selected)
        if not entries.exists():return Response({'detail':'Visit not found'},status=404)
    rows=[movement(e,request.user) for e in entries[:100]]
    return Response({'facility':{'id':site.pk,'name':site.name,'timezone':site.timezone},'as_of':timezone.now(),
        'movements':rows,'limit':100,'docks':Dock.objects.filter(organisation=site.organisation,facility=site).count(),
        'notice':'Latest 100 visits. Next tasks and recorded ownership do not grant release authority.'})


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def movement_owner(request,pk):
    from django.db import transaction
    from django.contrib.auth import get_user_model
    from django.core.exceptions import ValidationError
    from core.audit import append_audit
    from trip.permissions import scope_facility,get_user_organisation
    with transaction.atomic():
        entry=scope_facility(QueueEntry.objects.filter(organisation=get_user_organisation(request.user)),request.user).select_for_update().filter(pk=pk).first()
        if not entry:return Response({'detail':'Visit not found'},status=404)
        role=get_user_role(request.user)
        permitted=(role=='ADMIN' and rbac_allows(role,'admin','update',entry.organisation,entry.facility)) or (role in ('OPERATIONS_SUPERVISOR','FACILITY_MANAGER') and rbac_allows(role,'queue','update',entry.organisation,entry.facility))
        if not permitted:return Response({'detail':'An authorised operations coordinator assigns handoff owners'},status=403)
        if not rbac_allows(role,'compliance','read',entry.organisation,entry.facility):return Response({'detail':'Inspection read access required'},status=403)
        current=movement(entry,request.user)['next_action']
        candidates=get_user_model().objects.filter(is_active=True,profile__organisation=entry.organisation,profile__facilities=entry.facility,profile__role__in=current['owner_roles']).select_related('profile').distinct()
        eligible=[u for u in candidates if get_user_role(u) in current['owner_roles']]
        if request.method=='GET':return Response({'stage':current['stage'],'assignment_id':current['assignment_id'],'owner_id':current['assigned_person_id'],
            'candidates':[{'id':u.pk,'label':u.get_full_name() or u.username,'role':u.profile.role} for u in eligible]})
        data=request.data
        if not isinstance(data,dict) or set(data)!={'stage','expected_assignment_id','owner_id','reason'} or type(data.get('owner_id')) is not int or (data.get('expected_assignment_id') is not None and type(data['expected_assignment_id']) is not int):
            return Response({'detail':'Provide stage, current assignment ID, staff ID and reason'},status=400)
        if data.get('stage')!=current['stage'] or data.get('expected_assignment_id')!=current['assignment_id']:
            return Response({'detail':'Movement stage or owner changed; refresh before assigning'},status=409)
        owner=next((u for u in eligible if u.pk==data.get('owner_id')),None)
        if not owner or not isinstance(data.get('reason'),str) or not data['reason'].strip():return Response({'detail':'Choose eligible site staff and provide an assignment reason'},status=400)
        try:row=MovementOwnership.objects.create(organisation=entry.organisation,facility=entry.facility,queue_entry=entry,stage=current['stage'],owner=owner,creator=request.user,reason=data['reason'].strip())
        except ValidationError as exc:return Response({'detail':'; '.join(exc.messages)},status=409)
        append_audit(facility=entry.facility,actor=request.user,action='ASSIGN_MOVEMENT_OWNER',payload={'queue_entry_id':entry.pk,'reg_number':entry.reg_number,'stage':row.stage,'owner_id':owner.pk,'assignment_id':row.pk,'supersedes_assignment_id':current['assignment_id'],'reason':row.reason})
        return Response({'assignment_id':row.pk},status=201)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pending_approvals(request):
    site=find_facility(request.query_params.get('facility',''),request.user)
    if not site:return Response({'detail':'Assigned site not found'},status=404)
    role=get_user_role(request.user);org=site.organisation
    if role not in ('ADMIN','COMPLIANCE_OFFICER','OPERATIONS_SUPERVISOR','FACILITY_MANAGER') or not rbac_allows(role,'compliance','read',org,site):
        return Response({'detail':'Review workspace access required'},status=403)
    reviews=[];expired=[]
    for model,subject in ((m.EvidenceRevision,'evidence'),(m.VehicleConfiguration,'configuration')):
        for row in model.objects.filter(organisation=org).order_by('-created_at','-pk')[:200]:
            approved,review=s.reviewed(row)
            stale=(row.expires_at<=timezone.now()) if subject=='evidence' else bool(row.effective_to and row.effective_to<timezone.now().date())
            item={'id':row.pk,'subject':subject,'vehicle_id':row.vehicle_id,
                'label':row.document_ref if subject=='evidence' else f'{row.vehicle_class} / revision {row.revision}',
                'creator_id':row.creator_id,'created_at':row.created_at,'last_review': 'APPROVED' if approved else 'REJECTED' if review else 'PENDING',
                'can_review':not approved and not stale and row.creator_id!=request.user.pk and rbac_allows(role,'regulatory','review',org,site),
                'expired':stale,'document_ref':row.document_ref if subject=='evidence' else row.rating_evidence.document_ref,
                'document_sha256':row.document_sha256 if subject=='evidence' else row.rating_evidence.document_sha256}
            if stale:expired.append(item)
            elif not approved:reviews.append(item)
    requests=[]
    for row in m.OverrideRequest.objects.filter(organisation=org,attempt__facility=site,approval__isnull=True).select_related('attempt__queue_entry').order_by('-created_at')[:100]:
        entry=row.attempt.queue_entry
        latest=entry.inspection_attempts.first();latest_request=row.attempt.override_requests.order_by('-created_at','-pk').first()
        current=entry.status=='PENDING_OVERRIDE' and latest.pk==row.attempt_id and latest_request.pk==row.pk
        if current:requests.append({'id':row.pk,'entry_id':entry.pk,'plate':entry.reg_number,'attempt_id':row.attempt_id,
            'reason':row.reason,'creator_id':row.creator_id,'created_at':row.created_at,
            'can_review':request.user.pk not in (row.creator_id,row.attempt.creator_id) and rbac_allows(role,'regulatory','operate',org,site)})
    return Response({'as_of':timezone.now(),'evidence_reviews':reviews,'expired':expired,'exceptions':requests,
        'scope':'Evidence is tenant-wide. Operational exception requests are restricted to the selected site. Latest 200 revisions of each evidence type and 100 open exception requests are considered.'})
