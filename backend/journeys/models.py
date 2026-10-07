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
        'DELIVERY_REATTEMPT_PLANNED','RETURN_IN_TRANSIT','RETURN_ARRIVED','RETURN_RECEIVED')])
    observed_at = models.DateTimeField()
    details = models.JSONField(default=dict, blank=True)
    client_key = models.CharField(max_length=64)
    stop_index = models.PositiveSmallIntegerField(null=True, blank=True)
    return_order = models.ForeignKey('ReturnOrder', on_delete=models.PROTECT, null=True, blank=True, related_name='events')
    receiving_visit = models.ForeignKey('yard.QueueEntry', on_delete=models.PROTECT, null=True, blank=True, related_name='return_arrivals')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['journey','client_key'],name='unique_journey_event_replay')]

    def clean(self):
        super().clean()
        if self.journey.organisation_id != self.organisation_id:
            raise ValidationError('Event belongs to another tenant')
        if self.return_order_id and (self.return_order.journey_id != self.journey_id or self.return_order.organisation_id != self.organisation_id):
            raise ValidationError('Return belongs to another journey or tenant')
        if self.receiving_visit_id and (not self.return_order_id or self.receiving_visit.organisation_id != self.organisation_id
                or self.receiving_visit.facility_id != self.return_order.facility_id):
            raise ValidationError('Receiving visit must belong to the authorised return site')
        if self.kind in ('DELIVERY_ACCEPTED','DELIVERY_REJECTED','RETURN_RECEIVED'):
            if (not isinstance(self.details,dict) or set(self.details) != {'receiver','evidence_reference','evidence_sha256'}
                    or any(not isinstance(v,str) or not v.strip() or len(v)>300 for v in self.details.values())):
                raise ValidationError('Delivery requires a named receiver and retained evidence reference/digest')
            sha = self.details['evidence_sha256']
            if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
                raise ValidationError('Invalid delivery evidence digest')
        elif self.details:
            raise ValidationError('Unexpected journey observation details')


class DeliveryPlan(Retained):
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    journey = models.ForeignKey(JourneyLink, on_delete=models.PROTECT, related_name='delivery_plans')
    version = models.PositiveIntegerField()
    client_key = models.CharField(max_length=64)
    stops = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['journey','version'],name='unique_delivery_plan_version'),
            models.UniqueConstraint(fields=['journey','client_key'],name='unique_delivery_plan_replay')]

    def clean(self):
        super().clean()
        if self.journey.organisation_id != self.organisation_id:
            raise ValidationError('Delivery plan belongs to another tenant')
        from .execution import validate_stops
        validate_stops(self.journey, self.stops)
        if self._state.adding and self.journey.delivery_plans.filter(consignment_allocations__isnull=False).exists():
            raise ValidationError('Retain the delivery plan that owns customer allocations')


class ReturnOrder(Retained):
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    journey = models.ForeignKey(JourneyLink, on_delete=models.PROTECT, related_name='returns')
    rejection = models.OneToOneField(JourneyEvent, on_delete=models.PROTECT, related_name='authorised_return')
    facility = models.ForeignKey('core.Facility', on_delete=models.PROTECT)
    client_key = models.CharField(max_length=64)
    route_reference = models.CharField(max_length=300)
    route_sha256 = models.CharField(max_length=64)
    route_type = models.CharField(max_length=20, choices=[('DOMESTIC','Domestic'),('CROSS_BORDER','Cross border')])
    jurisdictions = models.JSONField()
    consignments = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['journey','client_key'],name='unique_return_order_replay')]

    def clean(self):
        super().clean()
        if (self.journey.organisation_id != self.organisation_id or self.rejection.journey_id != self.journey_id
                or self.rejection.kind != 'DELIVERY_REJECTED' or self.facility.organisation_id != self.organisation_id):
            raise ValidationError('Return requires a retained rejection and a site in the same tenant')
        if (not self.route_reference.strip() or len(self.route_sha256)!=64 or any(c not in '0123456789abcdef' for c in self.route_sha256)
                or not isinstance(self.jurisdictions,list) or not self.jurisdictions
                or any(not isinstance(j,str) or not j.strip() or len(j)>20 for j in self.jurisdictions)
                or len(set(self.jurisdictions)) != len(self.jurisdictions)):
            raise ValidationError('Return route reference, fingerprint and unique declared jurisdictions required')


class Consignment(Retained):
    """Customer order context, separate from statutory rules and ERP acknowledgement."""
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    facility = models.ForeignKey('core.Facility', on_delete=models.PROTECT)
    reference = models.CharField(max_length=120)
    customer_name = models.CharField(max_length=200)
    customer_reference = models.CharField(max_length=120, blank=True)
    commodity = models.CharField(max_length=200)
    target_quantity = models.DecimalField(max_digits=13, decimal_places=3)
    unit = models.CharField(max_length=120)
    deadline = models.DateField(null=True, blank=True)
    external_system = models.CharField(max_length=80, blank=True)
    external_reference = models.CharField(max_length=120, blank=True)
    client_key = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['organisation', 'reference'], name='unique_tenant_consignment_reference'),
            models.UniqueConstraint(fields=['organisation', 'client_key'], name='unique_consignment_replay'),
            models.CheckConstraint(condition=models.Q(target_quantity__gt=0), name='positive_consignment_target'),
        ]

    def clean(self):
        super().clean()
        if self.facility.organisation_id != self.organisation_id:
            raise ValidationError('Consignment site belongs to another tenant')
        if bool(self.external_system) != bool(self.external_reference):
            raise ValidationError('External system and reference must be supplied together')
        if self.target_quantity is not None and not 0 < self.target_quantity <= 1000000000:
            raise ValidationError('Target quantity must be positive and at most one billion')
        if any(not getattr(self, name).strip() for name in ('reference', 'customer_name', 'commodity', 'unit', 'client_key')):
            raise ValidationError('Consignment identity, customer, commodity, unit and replay key are required')


class ConsignmentAllocation(Retained):
    """A retained delivery-plan line allocates quantity once, without changing the load."""
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    consignment = models.ForeignKey(Consignment, on_delete=models.PROTECT, related_name='allocations')
    plan = models.ForeignKey(DeliveryPlan, on_delete=models.PROTECT, related_name='consignment_allocations')
    stop_index = models.PositiveSmallIntegerField()
    reference = models.CharField(max_length=120)
    quantity = models.DecimalField(max_digits=13, decimal_places=3)
    client_key = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['plan', 'reference'], name='unique_allocated_plan_line'),
            models.UniqueConstraint(fields=['consignment', 'client_key'], name='unique_allocation_replay'),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name='positive_consignment_allocation'),
        ]

    def clean(self):
        super().clean()
        from decimal import Decimal
        if (self.consignment.organisation_id != self.organisation_id or self.plan.organisation_id != self.organisation_id
                or self.plan.journey.facility_id != self.consignment.facility_id):
            raise ValidationError('Allocation must belong to the same tenant and origin site')
        if self.stop_index >= len(self.plan.stops):
            raise ValidationError('Choose a delivery stop in the retained plan')
        line = next((item for item in self.plan.stops[self.stop_index]['consignments'] if item['reference'] == self.reference), None)
        if not line or line['unit'] != self.consignment.unit or Decimal(str(line['quantity'])) != self.quantity:
            raise ValidationError('Allocation quantity and unit must exactly match the retained delivery-plan line')
        from django.db.models import Sum
        allocated = self.consignment.allocations.exclude(pk=self.pk).aggregate(total=Sum('quantity'))['total'] or Decimal('0')
        if allocated + self.quantity > self.consignment.target_quantity:
            raise ValidationError('Allocation exceeds the remaining consignment quantity')
