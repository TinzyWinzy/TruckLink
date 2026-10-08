from django.db import migrations
from django.utils import timezone

MODULES = ['audit','docks','fleet','inspection','modelling','notifications','release','reports','routing','yard']


def preserve_existing(apps, schema_editor):
    Organisation = apps.get_model('trip','Organisation')
    Grant = apps.get_model('tenancy','TenantEntitlementVersion')
    Activation = apps.get_model('tenancy','ReleaseActivation')
    alias = schema_editor.connection.alias
    now = timezone.now()
    for org in Organisation.objects.using(alias).all().iterator():
        if Grant.objects.using(alias).filter(organisation_id=org.pk).exists():
            continue
        established = not org.requires_release or Activation.objects.using(alias).filter(organisation_id=org.pk,effective_from__lte=now).exists()
        Grant.objects.using(alias).create(organisation_id=org.pk,version=1,modules=MODULES if established else ['audit'],
            state='ACTIVE',basis='LEGACY_CONTINUITY',effective_from=now,
            reason='Preserve existing validated access; continuity is not evidence of a paid subscription')


class Migration(migrations.Migration):
    dependencies = [('tenancy','0005_tenantentitlementversion_tenantmoduleselection')]
    operations = [migrations.RunPython(preserve_existing,migrations.RunPython.noop)]
