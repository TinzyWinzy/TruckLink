from django.db import models
from django.core.exceptions import ValidationError
from tenancy.models import Retained


class JourneyLink(Retained):
    """One origin yard visit anchors a trip; historical visits are never guessed."""
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    facility = models.ForeignKey('core.Facility', on_delete=models.PROTECT)
    trip = models.OneToOneField('trip.Trip', on_delete=models.PROTECT, related_name='journey_link')
    visit = models.OneToOneField('yard.QueueEntry', on_delete=models.PROTECT, related_name='journey_link')
    assignment = models.JSONField()
    external_system = models.CharField(max_length=80, blank=True)
    external_reference = models.CharField(max_length=120, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','external_system','external_reference'],
            condition=~models.Q(external_reference=''), name='unique_journey_external_reference')]

    def clean(self):
        super().clean()
        if (self.trip.organisation_id != self.organisation_id or self.visit.organisation_id != self.organisation_id
                or self.facility.organisation_id != self.organisation_id or self.visit.facility_id != self.facility_id
                or self.trip.facility_id not in (None,self.facility_id)):
            raise ValidationError('Journey references must belong to the same tenant and origin site')
        if bool(self.external_system) != bool(self.external_reference):
            raise ValidationError('External system and reference must be supplied together')
        if not self.trip.vehicle_id or not self.trip.driver_id:
            raise ValidationError('Assign an existing vehicle and driver before linking')
        if self.trip.vehicle.organisation_id != self.organisation_id or self.trip.driver.organisation_id != self.organisation_id:
            raise ValidationError('Assignment belongs to another tenant')
        if self.trip.vehicle.plate.strip().upper() != self.visit.reg_number.strip().upper():
            raise ValidationError('Registered vehicle does not match the assigned trip vehicle')


class JourneyEvent(Retained):
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    journey = models.ForeignKey(JourneyLink, on_delete=models.PROTECT, related_name='events')
    kind = models.CharField(max_length=30, choices=[(v,v) for v in (
        'DOCK_VACATED','DEPARTED','DESTINATION_ARRIVED','DELIVERY_ACCEPTED','DELIVERY_REJECTED',
        'DELIVERY_REATTEMPT_PLANNED')])
    observed_at = models.DateTimeField()
    details = models.JSONField(default=dict, blank=True)
    client_key = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['journey','client_key'],name='unique_journey_event_replay')]

    def clean(self):
        super().clean()
        if self.journey.organisation_id != self.organisation_id:
            raise ValidationError('Event belongs to another tenant')
        if self.kind in ('DELIVERY_ACCEPTED','DELIVERY_REJECTED'):
            if (not isinstance(self.details,dict) or set(self.details) != {'receiver','evidence_reference','evidence_sha256'}
                    or any(not isinstance(v,str) or not v.strip() or len(v)>300 for v in self.details.values())):
                raise ValidationError('Delivery requires a named receiver and retained evidence reference/digest')
            sha = self.details['evidence_sha256']
            if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
                raise ValidationError('Invalid delivery evidence digest')
        elif self.details:
            raise ValidationError('Unexpected journey observation details')
