"""Operator-applied tenant manifests; preserves entity IDs and existing sites."""
import json
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ValidationError
from django.db import transaction
from core.models import Facility
from trip.models import Organisation
from tenancy.models import TenantConfiguration
from regulatory.engine.evaluator import digest


class Command(BaseCommand):
    help = 'Apply a reviewed tenant manifest to an existing organisation without deleting data'

    def add_arguments(self, parser):
        parser.add_argument('--tenant',required=True)
        parser.add_argument('--manifest',required=True)
        parser.add_argument('--reason',required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        org = Organisation.objects.select_for_update().filter(slug=options['tenant'],is_deleted=False).first()
        if not org:
            raise CommandError('Configured tenant not found; create it through tenancy signup first')
        try:
            manifest = json.loads(Path(options['manifest']).read_text(encoding='utf-8'))
            content = manifest['configuration']
            fingerprint = digest(content)
            prior = TenantConfiguration.objects.filter(organisation=org).order_by('-version').first()
            if prior is None or prior.digest != fingerprint:
                row = TenantConfiguration(organisation=org,content=content,digest=fingerprint,version=prior.version+1 if prior else 1,reason=options['reason'])
                row.save()
            for site in manifest.get('sites',[]):
                Facility.objects.get_or_create(organisation=org,slug=site['slug'],defaults={
                    'name':site['name'],'timezone':site.get('timezone','UTC'),'yard_config':site.get('workflow',{})})
        except (ValueError,KeyError,OSError,ValidationError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS('Tenant manifest applied; existing entities, memberships and site configuration retained'))
