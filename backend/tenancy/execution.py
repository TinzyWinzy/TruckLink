"""Pin existing authoritative commands to their tenant workflow, without bypasses."""
from django.core.exceptions import ValidationError
from .registry import ACTION_MODULE, TRANSITIONS
from .releases import active_release,artifacts,snapshot,require_module
from .models import WorkflowExecution, WorkflowEvent


def record_audit(row,payload):
    module = ACTION_MODULE.get(row.action)
    if module:
        try:
            require_module(row.organisation,module)
        except PermissionError as exc:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied(str(exc)) from exc
    transition = TRANSITIONS.get(row.action)
    release = active_release(row.organisation)
    if not release or not transition:
        return
    from yard.models import QueueEntry
    from regulatory.models import InspectionAttempt
    ref = payload.get('queue_entry_id') or payload.get('queueEntryId') or payload.get('queue_entry')
    if row.action in ('CREATE_QUEUE_ENTRY','UPDATE_QUEUE_STATUS'):
        ref = payload.get('id')
    if not ref and payload.get('checkId'):
        from yard.models import ComplianceCheck
        ref = ComplianceCheck.objects.filter(pk=payload['checkId'],organisation=row.organisation,facility=row.facility).values_list('queue_entry_id',flat=True).first()
    if not ref and payload.get('attempt_id'):
        ref = InspectionAttempt.objects.filter(pk=payload['attempt_id'],organisation=row.organisation,facility=row.facility).values_list('queue_entry_id',flat=True).first()
    if not ref:
        return
    entry = QueueEntry.objects.filter(pk=ref,organisation=row.organisation,facility=row.facility).first()
    if not entry:
        raise ValidationError('Workflow event references a missing tenant/site entity')
    execution = WorkflowExecution.objects.filter(queue_entry=entry).first()
    if execution:
        workflow = execution.workflow  # Ongoing execution retains its selected template/version.
    else:
        selected = artifacts(release,row.facility,kind='WORKFLOW')
        if not selected:
            return  # The audit still records the failed readiness evaluation; no workflow is invented.
        workflow = selected[0]
        execution = WorkflowExecution.objects.create(organisation=row.organisation,facility=row.facility,
            queue_entry=entry,release=release,workflow=workflow,creator=row.actor,reason='Pin authoritative yard operation',
            configuration_snapshot=snapshot(row.organisation,row.facility,strict=False))
    if transition not in workflow.content['transitions']:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied('Transition is disabled in the pinned tenant workflow')
    WorkflowEvent.objects.create(organisation=row.organisation,execution=execution,audit=row,creator=row.actor,
        reason='Authoritative operation recorded',transition=transition,state=entry.status,
        configuration_snapshot=snapshot(row.organisation,row.facility,strict=False))
