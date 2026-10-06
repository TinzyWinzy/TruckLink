"""Freeze BAK's existing behavior; no second tenant or regulatory publication."""
import hashlib
import json
from django.db import migrations
from django.utils import timezone

MODULES = ['yard','docks','inspection','release','fleet','routing','notifications','reports','modelling','audit']
TRANSITIONS = ['arrival','dock','inspect','request_override','approve_override','release','update_status']


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def preserve_bak(apps,schema_editor):
    Configuration = apps.get_model('tenancy','TenantConfiguration')
    Artifact = apps.get_model('tenancy','TenantArtifactRevision')
    Release = apps.get_model('tenancy','TenantReleaseVersion')
    Activation = apps.get_model('tenancy','ReleaseActivation')
    Facility = apps.get_model('core','Facility')
    Organisation = apps.get_model('trip','Organisation')
    for org in Organisation.objects.filter(slug__in=['bak-operations','bak-logistics'],name__in=['BAK Operations','BAK Logistics']):
        configuration = Configuration.objects.filter(organisation=org).order_by('-version').first()
        if not configuration or Release.objects.filter(organisation=org).exists():
            continue
        now = timezone.now()
        reason = 'Compatibility migration: preserve validated BAK behavior; no statutory verification or invented independent review'
        ids = []

        def add(kind,key,content,facility=None):
            row = Artifact.objects.create(organisation=org,kind=kind,key=key,version=1,content=content,
                digest=fingerprint(content),reason=reason,effective_from=now,facility=facility)
            ids.append(row.pk)

        add('MODULES','validated-capabilities',{key:True for key in MODULES})
        flow = configuration.content['workflow']
        add('WORKFLOW','yard-lifecycle',{'template':'yard-lifecycle-v1','transitions':TRANSITIONS,'workflow':flow})
        add('POLICY','bak-required-attestations',{'classification':'TENANT_POLICY',
            'document_ref':'tenants/bak/tenant.json#configuration.workflow',
            'document_sha256':fingerprint(flow),
            'controls':[{'key':key,'definition':{'kind':'CHECKLIST','item_id':key,'applicability':{},
                'failure_action':'HOLD','override_policy':'NOT_ALLOWED'}} for key in flow['mandatory_checks']]})
        add('PERMISSIONS','validated-permissions',{'grants':configuration.content['permissions']})
        for site in Facility.objects.filter(organisation=org,is_deleted=False):
            add('SITE',f'site-{site.pk}',{'timezone':site.timezone,'operating_parameters':site.yard_config},site)
        for provider,binding in configuration.content.get('integrations',{}).get('notifications',{}).items():
            add('INTEGRATION',f'{provider}-binding',{'adapter':f'{provider}-v1',**binding})
        release = Release.objects.create(organisation=org,version=1,configuration=configuration,artifact_ids=ids,
            digest=fingerprint({'configuration_id':configuration.pk,'artifact_ids':ids}),reason=reason,
            effective_from=now,compatibility=True)
        Activation.objects.create(organisation=org,release=release,version=1,reason=reason,effective_from=now)


class Migration(migrations.Migration):
    dependencies = [('tenancy','0003_tenantartifactrevision_artifactreview_and_more'),
        ('regulatory','0004_inspectionattempt_tenant_configuration_snapshot_and_more')]
    operations = [migrations.RunPython(preserve_bak,migrations.RunPython.noop)]
