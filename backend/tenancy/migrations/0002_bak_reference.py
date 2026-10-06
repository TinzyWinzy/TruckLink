from django.db import migrations
from django.utils import timezone

CONTENT = {'schema_version': 1, 'branding': {'display_name': 'BAK Logistics', 'accent': '#c2570b', 'navy': '#0b1526', 'paper': '#f4f1e8'}, 'roles': {'DISPATCH_SUPERVISOR': {'label': 'Dispatch Supervisor', 'enabled': True}, 'FACILITY_MANAGER': {'label': 'Facility Manager', 'enabled': True}, 'OPERATIONS_SUPERVISOR': {'label': 'Operations Supervisor', 'enabled': True}, 'EXECUTIVE': {'label': 'Executive', 'enabled': True}, 'ADMIN': {'label': 'Admin', 'enabled': True}, 'COMPLIANCE_OFFICER': {'label': 'Compliance Officer', 'enabled': True}}, 'permissions': {}, 'workflow': {'mandatory_checks': ['driver-license', 'vehicle-reg', 'cargo-manifest', 'weight-cert', 'axle-calc'], 'inspection_max_age_seconds': 3600, 'escalation_minutes': {'FM': 10, 'EXEC': 30}}, 'integrations': {'notifications': {'twilio': {'enabled': True, 'env_prefix': 'TWILIO'}, 'webpush': {'enabled': True, 'env_prefix': 'VAPID'}}}}
DIGEST = 'c47d3aeb19a0b47925f58150901abdf141c2a74220476c3592e047f4f3d5f16d'


def configure_reference(apps, schema_editor):
    Organisation = apps.get_model('trip','Organisation')
    Configuration = apps.get_model('tenancy','TenantConfiguration')
    for org in Organisation.objects.filter(slug__in=['bak-operations','bak-logistics']):
        if org.name not in ('BAK Operations','BAK Logistics') or Configuration.objects.filter(organisation=org).exists():
            continue
        Configuration.objects.create(organisation=org,version=1,content=CONTENT,digest=DIGEST,
                                     effective_from=timezone.now(),reason='Preserve validated BAK prototype as first tenant reference configuration')


class Migration(migrations.Migration):
    dependencies = [('tenancy','0001_initial')]
    operations = [migrations.RunPython(configure_reference,migrations.RunPython.noop)]
