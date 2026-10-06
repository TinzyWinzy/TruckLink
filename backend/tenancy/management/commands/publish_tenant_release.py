"""Onboard through supported manifests; no application fork or fabricated approvals."""
import json
from pathlib import Path
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand,CommandError
from django.core.exceptions import ValidationError
from django.db import transaction
from core.models import Facility
from trip.models import Organisation
from regulatory.engine.evaluator import digest
from tenancy.models import TenantConfiguration,TenantArtifactRevision,ArtifactReview,TenantReleaseVersion,ReleaseActivation
from tenancy.releases import activate


class Command(BaseCommand):
    help = 'Publish a reviewed tenant release manifest, optionally activate it; no users or regulatory knowledge are created'

    def add_arguments(self,parser):
        for name in ('tenant','manifest','author','reviewer','reason'):
            parser.add_argument('--'+name,required=True)
        parser.add_argument('--activate',action='store_true')

    @transaction.atomic
    def handle(self,*args,**options):
        org = Organisation.objects.select_for_update().filter(slug=options['tenant'],is_deleted=False).first()
        if not org:
            raise CommandError('Provision the tenant and sites after operational discovery first')
        users = get_user_model().objects
        author = users.filter(username=options['author'],is_active=True,profile__organisation=org,profile__role='ADMIN').first()
        reviewer = users.filter(username=options['reviewer'],is_active=True,profile__organisation=org,profile__role__in=['ADMIN','COMPLIANCE_OFFICER']).first()
        if not author or not reviewer or author.pk == reviewer.pk:
            raise CommandError('Existing independent authorized author/reviewer in this tenant required')
        try:
            manifest = json.loads(Path(options['manifest']).read_text(encoding='utf-8'))
            if set(manifest) != {'schema_version','artifacts'} or manifest['schema_version'] != 1 or not isinstance(manifest['artifacts'],list):
                raise ValidationError('Release manifest schema version 1 requires an artifacts list')
            configuration = TenantConfiguration.objects.filter(organisation=org).order_by('-version').first()
            if not configuration:
                raise ValidationError('Apply tenant branding and identity configuration first')
            ids = []
            for item in manifest['artifacts']:
                if set(item) - {'kind','key','content','site_slug'}:
                    raise ValidationError('Unknown manifest artifact fields')
                site = Facility.objects.filter(organisation=org,slug=item['site_slug'],is_deleted=False).first() if item.get('site_slug') else None
                if item.get('site_slug') and not site:
                    raise ValidationError('Declared tenant site does not exist')
                if item['kind'] == 'INTEGRATION' and not author.is_superuser:
                    raise ValidationError('Integration binding author must also be an authorized platform operator')
                latest = TenantArtifactRevision.objects.filter(organisation=org,kind=item['kind'],key=item['key']).order_by('-version').first()
                row = TenantArtifactRevision.objects.create(organisation=org,facility=site,creator=author,kind=item['kind'],key=item['key'],
                    version=latest.version+1 if latest else 1,content=item['content'],digest=digest(item['content']),reason=options['reason'])
                if row.kind in ('WORKFLOW','POLICY'):
                    ArtifactReview.objects.create(organisation=org,creator=reviewer,artifact=row,approved=True,reason=options['reason'])
                ids.append(row.pk)
            latest = TenantReleaseVersion.objects.filter(organisation=org).order_by('-version').first()
            release = TenantReleaseVersion.objects.create(organisation=org,creator=author,version=latest.version+1 if latest else 1,
                configuration=configuration,artifact_ids=ids,digest=digest({'configuration_id':configuration.pk,'artifact_ids':ids}),reason=options['reason'])
            if options['activate']:
                activation = ReleaseActivation.objects.filter(organisation=org).order_by('-version').first()
                activate(author,release,activation.version if activation else 0,options['reason'])
        except (ValueError,KeyError,OSError,ValidationError,PermissionError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f'Tenant release {release.version} published; activation {"requested" if options["activate"] else "pending"}. Existing identities and history retained.'))
