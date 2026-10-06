from django.db import models


class WhatsAppSession(models.Model):
    """Tracks a WhatsApp conversation with a driver."""
    phone_number = models.CharField(max_length=30)
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT,null=True,blank=True)
    trip_id = models.IntegerField(null=True, blank=True)
    state = models.CharField(
        max_length=30,
        choices=[
            ("idle", "Idle"),
            ("awaiting_trip_accept", "Awaiting Trip Accept"),
            ("awaiting_status", "Awaiting Status"),
            ("sos", "SOS"),
        ],
        default="idle",
    )
    last_message_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_message_at"]
        constraints = [
            models.UniqueConstraint(fields=['organisation','phone_number'],name='unique_tenant_whatsapp_phone'),
            models.UniqueConstraint(fields=['phone_number'],condition=models.Q(organisation__isnull=True),name='unique_legacy_whatsapp_phone'),
        ]

    def __str__(self):
        return f"{self.phone_number} ({self.state})"
