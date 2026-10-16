"""Phase 2: read-only stage transition fit verification."""
import io
import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


def _make_operators(user_model, organisation, facility, count=1):
    from trip.models import UserProfile
    users = []
    for index in range(count):
        user = user_model.objects.create(username=f'stage-ops-{index}')
        profile = UserProfile.objects.create(user=user, organisation=organisation)
        profile.facilities.add(facility)
        users.append(user)
    return users


def _assign_visit(entry, facility, owner, creator, stages):
    from yard.models import MovementOwnership
    for stage in stages:
        MovementOwnership.objects.create(
            organisation=entry.organisation, facility=facility, queue_entry=entry,
            stage=stage, owner=owner, creator=creator, reason='synthetic assignment for fit test',
        )


@pytest.mark.django_db
def test_fit_stage_transitions_empty_facility_declines(default_facility):
    buffer = io.StringIO()
    call_command('fit_stage_transitions', '--facility', str(default_facility.pk), stdout=buffer)
    report = json.loads(buffer.getvalue())
    assert report['fitted'] is False
    assert report['transitions_observed'] == 0
    assert report['visits_with_ownership'] == 0
    assert 'transition_matrix' not in report


@pytest.mark.django_db
def test_fit_stage_transitions_missing_facility_errors():
    with pytest.raises(CommandError):
        call_command('fit_stage_transitions', '--facility', '999999')


@pytest.mark.django_db
def test_fit_stage_transitions_seeded_matrix_and_counts(default_org, default_facility):
    from django.contrib.auth import get_user_model
    from trip.models import UserProfile
    from yard.models import MovementOwnership, QueueEntry

    owner, creator = _make_operators(get_user_model(), default_org, default_facility, count=2)
    entry_a = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                        reg_number='FIT-A')
    entry_b = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                        reg_number='FIT-B')
    entry_c = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                        reg_number='FIT-C')
    # Chronology per visit follows insertion order (pk ascending within equal timestamps).
    _assign_visit(entry_a, default_facility, owner, creator,
                  ['SETUP', 'INSPECTION', 'RELEASE'])
    _assign_visit(entry_b, default_facility, owner, creator,
                  ['SETUP', 'INSPECTION'])
    _assign_visit(entry_c, default_facility, owner, creator,
                  ['INSPECTION', 'SETUP'])

    before_rows = MovementOwnership.objects.count()
    before_entries = QueueEntry.objects.count()

    buffer = io.StringIO()
    call_command('fit_stage_transitions', '--facility', str(default_facility.pk), stdout=buffer)
    thin = json.loads(buffer.getvalue())
    assert thin['fitted'] is False  # default minimum is 8; only 4 transitions exist
    assert 'transition_matrix' not in thin
    assert thin['transitions_observed'] == 4
    buffer = io.StringIO()
    call_command('fit_stage_transitions', '--facility', str(default_facility.pk),
                 '--min-transitions', '4', stdout=buffer)
    report = json.loads(buffer.getvalue())
    assert report['fitted'] is True
    assert report['transitions_observed'] == 4
    assert report['visits_with_ownership'] == 3
    assert report['transition_counts'] == {
        'SETUP->INSPECTION': 2, 'INSPECTION->RELEASE': 1, 'INSPECTION->SETUP': 1,
    }
    assert report['transition_matrix']['SETUP'] == {'INSPECTION': 1.0}
    assert report['transition_matrix']['INSPECTION'] == {'RELEASE': 0.5, 'SETUP': 0.5}
    assert report['gap_seconds_between_assignments']['count'] == 4
    # Read-only: the command must not write.
    assert MovementOwnership.objects.count() == before_rows
    assert QueueEntry.objects.count() == before_entries
    # User profiles remain intact (fixtures valid).
    for user in (owner, creator):
        profile = UserProfile.objects.filter(user=user).first()
        assert profile is not None and profile.facilities.filter(pk=default_facility.pk).exists()


@pytest.mark.django_db
def test_fit_stage_transitions_output_persists_report(tmp_path, default_org, default_facility):
    from django.contrib.auth import get_user_model
    from yard.models import MovementOwnership, QueueEntry

    owner, creator = _make_operators(get_user_model(), default_org, default_facility, count=2)
    entry = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                      reg_number='FIT-E')
    _assign_visit(entry, default_facility, owner, creator, ['SETUP', 'INSPECTION'])
    target = tmp_path / 'fit-stage-transitions-smoke.json'
    buffer = io.StringIO()
    call_command('fit_stage_transitions', '--facility', str(default_facility.pk),
                 '--min-transitions', '1', '--output', str(target), stdout=buffer)
    report = json.loads(target.read_text(encoding='utf-8'))
    assert report['fitted'] is True
    assert report['transition_counts'] == {'SETUP->INSPECTION': 1}
    assert json.loads(target.read_text(encoding='utf-8')) == json.loads(buffer.getvalue())


@pytest.mark.django_db
def test_fit_stage_transitions_reassignment_is_not_a_transition(default_org, default_facility):
    from django.contrib.auth import get_user_model
    from yard.models import MovementOwnership, QueueEntry

    owner, creator = _make_operators(get_user_model(), default_org, default_facility, count=2)
    entry = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                      reg_number='FIT-D')
    _assign_visit(entry, default_facility, owner, creator,
                  ['SETUP', 'SETUP', 'INSPECTION'])
    buffer = io.StringIO()
    call_command('fit_stage_transitions', '--facility', str(default_facility.pk),
                 '--min-transitions', '1', stdout=buffer)
    report = json.loads(buffer.getvalue())
    assert report['transition_counts'] == {'SETUP->INSPECTION': 1}
    assert report['ownership_rows'] == 3
    assert report['transitions_observed'] == 1
    assert MovementOwnership.objects.count() >= 3
