from django.db import migrations


def bind_existing(apps, schema_editor):
    Session = apps.get_model('whatsapp','WhatsAppSession')
    Trip = apps.get_model('trip','Trip')
    Driver = apps.get_model('trip','Driver')
    for session in Session.objects.filter(organisation__isnull=True):
        org = Trip.objects.filter(pk=session.trip_id).values_list('organisation_id',flat=True).first() if session.trip_id else None
        if org is None:
            owners = list(Driver.objects.filter(phone_number=session.phone_number).values_list('organisation_id',flat=True).distinct()[:2])
            org = owners[0] if len(owners) == 1 else None
        if org and not Session.objects.filter(organisation_id=org,phone_number=session.phone_number).exists():
            Session.objects.filter(pk=session.pk).update(organisation_id=org)


class Migration(migrations.Migration):
    dependencies = [('whatsapp','0002_whatsappsession_organisation_and_more')]
    operations = [migrations.RunPython(bind_existing,migrations.RunPython.noop)]
