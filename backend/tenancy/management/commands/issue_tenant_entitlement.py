from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from trip.models import Organisation
from tenancy.subscriptions import issue_entitlement


class Command(BaseCommand):
    help = 'Append an operator-approved tenant entitlement; never activates workflows or collects payment.'

    def add_arguments(self, parser):
        parser.add_argument('--tenant',required=True)
        parser.add_argument('--operator',required=True)
        parser.add_argument('--modules',nargs='*',default=[])
        parser.add_argument('--expected-version',type=int,required=True)
        parser.add_argument('--basis',choices=['CONTRACT','TRIAL'],required=True)
        parser.add_argument('--state',choices=['ACTIVE','SUSPENDED'],default='ACTIVE')
        parser.add_argument('--effective-from')
        parser.add_argument('--effective-to')
        parser.add_argument('--reason',required=True)

    def handle(self,*args,**options):
        try:
            org = Organisation.objects.get(slug=options['tenant'],is_deleted=False)
            actor = get_user_model().objects.get(username=options['operator'])
            dates = {}
            for key in ('effective_from','effective_to'):
                if options.get(key):
                    value = parse_datetime(options[key])
                    if not value or timezone.is_naive(value):
                        raise CommandError('Effective dates require ISO timestamps with timezone offsets')
                    dates[key] = value
            row = issue_entitlement(actor,org,options['modules'],options['expected_version'],options['reason'],
                basis=options['basis'],state=options['state'],**dates)
        except (Organisation.DoesNotExist,get_user_model().DoesNotExist,ValidationError,PermissionError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f'Entitlement {row.version} recorded for {org.slug}; tenant configuration and operational activation are unchanged.'))
