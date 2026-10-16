"""Read-only stage transition fit from retained movement ownership records.

This command never writes. Stage progression is not logged as its own event
stream; this fit uses the append-only MovementOwnership rows (one row per
stage that received an assigned owner, ordered by created_at/pk) per visit.
Reported gaps measure time between consecutive ownership assignments, not
true stage dwell — no claim is made that one equals the other.
"""
import json
import statistics
from collections import Counter, defaultdict

from django.core.management.base import BaseCommand, CommandError

from core.models import Facility
from yard.models import MovementOwnership, QueueEntry

DEFAULT_MIN_TRANSITIONS = 8


class Command(BaseCommand):
    help = ('Read-only: fit per-facility stage transition counts from append-only '
            'movement ownership records. Prints JSON; performs no writes.')

    def add_arguments(self, parser):
        parser.add_argument('--facility', type=int, required=True)
        parser.add_argument('--min-transitions', type=int, default=DEFAULT_MIN_TRANSITIONS)
        parser.add_argument('--output', type=str, default='',
                            help='Optional file path to also persist the JSON report '
                                 '(dated artifact, like docs/analysis/<name>.json).')

    def handle(self, *args, **options):
        facility_id = options['facility']
        min_transitions = options['min_transitions']
        output_path = options['output']
        if min_transitions < 1:
            raise CommandError('min-transitions must be at least 1')
        try:
            facility = Facility.objects.get(pk=facility_id)
        except Facility.DoesNotExist:
            raise CommandError(f'facility {facility_id} not found')

        visits = 0
        stage_occurrences = Counter()
        transition_counts = Counter()
        gap_seconds = []
        for entry in (QueueEntry.objects.filter(facility=facility)
                      .prefetch_related('ownerships')):
            rows = sorted(entry.ownerships.all(), key=lambda row: (row.created_at, row.pk))
            if not rows:
                continue
            visits += 1
            stages = []
            for row in rows:
                stage_occurrences[row.stage] += 1
                # Owner reassignment inside one stage is not a transition.
                if not stages or stages[-1][0] != row.stage:
                    if stages:
                        gap_seconds.append((row.created_at - stages[-1][1].created_at).total_seconds())
                    stages.append((row.stage, row))
            for before, after in zip(stages, stages[1:]):
                transition_counts[(before[0], after[0])] += 1

        total = sum(transition_counts.values())
        matrix = None
        if total >= min_transitions and transition_counts:
            outgoing = defaultdict(int)
            for (before, _after), count in transition_counts.items():
                outgoing[before] += count
            matrix = {}
            for before in sorted({stage for stage, _ in transition_counts}):
                row = {_after: transition_counts[(before, _after)] / outgoing[before]
                       for _after in sorted({s for p, s in transition_counts if p == before})}
                matrix[before] = row
        report = {
            'facility': facility.pk,
            'organisation': facility.organisation_id,
            'visits_with_ownership': visits,
            'ownership_rows': sum(stage_occurrences.values()),
            'stage_occurrences': dict(stage_occurrences),
            'transitions_observed': total,
            'min_transitions': min_transitions,
            'fitted': matrix is not None,
            'transition_counts': {f'{before}->{_after}': count
                                  for (before, _after), count in sorted(transition_counts.items())},
            'gap_seconds_between_assignments': {
                'count': len(gap_seconds),
                'median': statistics.median(gap_seconds) if gap_seconds else None,
                'mean': statistics.mean(gap_seconds) if gap_seconds else None,
            } if transition_counts else {'count': 0, 'median': None, 'mean': None},
            'limitations': [
                'Stage progression is inferred from append-only movement ownership rows, '
                'not from dedicated stage-change events.',
                'Gaps measure time between consecutive ownership assignments, never stage dwell.',
                'Below min-transitions no matrix is emitted; thin data must not invent structure.',
            ],
        }
        if matrix is not None:
            report['transition_matrix'] = matrix
        rendered = json.dumps(report, indent=2)
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as stream:
                stream.write(rendered)
        self.stdout.write(rendered)
