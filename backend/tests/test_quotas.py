import io
import json
from unittest.mock import patch

from PIL import Image

from app.database import SessionLocal
from app.models import Demo, PublishedRevision, Step


def recording_step(client, demo_id: str, event_id: str):
    output = io.BytesIO()
    Image.new('RGB', (320, 180), 'white').save(output, 'PNG')
    return client.post(
        f'/api/recordings/{demo_id}/steps',
        data={'meta': json.dumps({
            'event_id': event_id, 'title': 'Step', 'body': 'Do the thing',
            'viewport_width': 320, 'viewport_height': 180,
            'hotspot': {'x': .5, 'y': .5, 'w': .1, 'h': .1}, 'duration': 3,
        })},
        files={'screenshot': ('screen.png', output.getvalue(), 'image/png')},
    )


def assign_limits(client, organization_id: str, **overrides):
    plans = client.get('/api/admin/quota-plans').json()
    if not plans:
        client.get('/api/workspace/quotas')
        plans = client.get('/api/admin/quota-plans').json()
    plan = plans[0]
    response = client.put(
        f'/api/admin/organizations/{organization_id}/quota',
        json={'plan_id': plan['id'], 'overrides': overrides},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_workspace_quota_summary_and_admin_override(authenticated):
    summary=authenticated.get('/api/workspace/quotas')
    assert summary.status_code==200,summary.text
    value=summary.json();assert len(value['items'])==10;assert value['plan']['name']=='Default'
    organization_id=value['organization_id'];plans=authenticated.get('/api/admin/quota-plans').json();assert plans[0]['is_default'] is True
    updated=authenticated.put(f'/api/admin/organizations/{organization_id}/quota',json={'plan_id':plans[0]['id'],'overrides':{'resources':1}})
    assert updated.status_code==200,updated.text
    assert next(x for x in updated.json()['items'] if x['key']=='resources')['limit']==1
    assert authenticated.post('/api/demos',json={'title':'First'}).status_code==201
    blocked=authenticated.post('/api/demos',json={'title':'Second'})
    assert blocked.status_code==403
    assert blocked.json()['code']=='quota.resources_exceeded'
    assert blocked.json()['quota']=={'metric':'resources','used':1,'limit':1}

def test_quota_plan_lifecycle(authenticated):
    created=authenticated.post('/api/admin/quota-plans',json={'name':'Pro','description':'Pro plan','limits':{'resources':500}})
    assert created.status_code==201,created.text
    assert created.json()['limits']['resources']==500
    updated=authenticated.patch(f"/api/admin/quota-plans/{created.json()['id']}",json={'description':'Updated','is_default':True})
    assert updated.status_code==200
    assert updated.json()['is_default'] is True

    default_delete=authenticated.delete(f"/api/admin/quota-plans/{created.json()['id']}")
    assert default_delete.status_code==409
    assert default_delete.json()['code']=='quota.plan_default'

    removable=authenticated.post('/api/admin/quota-plans',json={'name':'Temporary','limits':{'resources':10}})
    assert removable.status_code==201
    removable_id=removable.json()['id']
    statistics=authenticated.get('/api/admin/quotas/plans').json()
    assert next(item for item in statistics if item['id']==removable_id)['can_delete'] is True
    assert authenticated.delete(f'/api/admin/quota-plans/{removable_id}').status_code==204

    assigned=authenticated.post('/api/admin/quota-plans',json={'name':'Assigned','limits':{'resources':10}})
    organization_id=authenticated.get('/api/workspace/quotas').json()['organization_id']
    assert authenticated.put(f'/api/admin/organizations/{organization_id}/quota',json={'plan_id':assigned.json()['id'],'overrides':{}}).status_code==200
    assigned_delete=authenticated.delete(f"/api/admin/quota-plans/{assigned.json()['id']}")
    assert assigned_delete.status_code==409
    assert assigned_delete.json()['code']=='quota.plan_in_use'

def test_quota_operations_snapshots_and_personal_spaces(authenticated):
    collected=authenticated.post('/api/admin/quotas/collect')
    assert collected.status_code==200,collected.text
    assert collected.json()['spaces']>=1
    overview=authenticated.get('/api/admin/quotas/overview?days=30&metric=resources')
    assert overview.status_code==200,overview.text
    value=overview.json()
    assert value['summary']['total_spaces']>=1
    assert value['summary']['personal_spaces']>=1
    assert value['trend']
    assert len(value['spaces'][0]['items'])==10
    plans=authenticated.get('/api/admin/quotas/plans')
    assert plans.status_code==200
    assert 'statistics' in plans.json()[0]
    organization_id=value['spaces'][0]['id']
    history=authenticated.get(f'/api/admin/quotas/spaces/{organization_id}/history')
    assert history.status_code==200
    assert history.json()['points']

def test_platform_quota_limits_preview_confirmation_and_validation(authenticated):
    initial=authenticated.get('/api/admin/quotas/platform-limits')
    assert initial.status_code==200,initial.text
    value=initial.json();assert len(value['metrics'])==10
    assert value['maximums']['resources']>value['metrics'][1]['default_plan_value']

    proposal={'maximums':{**value['maximums'],'resources':1},'allow_unlimited':value['allow_unlimited']}
    preview=authenticated.post('/api/admin/quotas/platform-limits/preview',json=proposal)
    assert preview.status_code==200,preview.text
    assert preview.json()['affected_plan_count']>=1,preview.text
    assert preview.json()['affected_space_count']>=1

    blocked=authenticated.put('/api/admin/quotas/platform-limits',json=proposal)
    assert blocked.status_code==409
    assert blocked.json()['code']=='quota.platform_limit_impact'
    saved=authenticated.put('/api/admin/quotas/platform-limits',json={**proposal,'confirm_impact':True})
    assert saved.status_code==200,saved.text
    assert saved.json()['maximums']['resources']==1

    # Explicit confirmation grandfathers existing values; it never truncates them.
    assert next(item for item in authenticated.get('/api/workspace/quotas').json()['items'] if item['key']=='resources')['limit']==100
    invalid=authenticated.post('/api/admin/quota-plans',json={'name':'Too large','limits':{'resources':2}})
    assert invalid.status_code==422
    assert invalid.json()['code']=='quota.platform_limit_exceeded'
    valid=authenticated.post('/api/admin/quota-plans',json={'name':'Within boundary','limits':{'resources':1}})
    assert valid.status_code==201,valid.text


def test_capabilities_recover_immediately_after_quota_increase(authenticated):
    demo = authenticated.post('/api/demos', json={'title': 'Quota recovery'}).json()
    organization_id = demo['organization_id']
    assign_limits(authenticated, organization_id, monthly_ai_tokens=0, max_steps_per_resource=0)

    blocked = authenticated.get('/api/workspace/capabilities', params={'demo_id': demo['id']})
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()['actions']['use_ai']['allowed'] is False
    assert blocked.json()['actions']['record_step']['allowed'] is False
    assert blocked.json()['demo_step_count'] == 0
    assert blocked.json()['actions']['use_ai']['blockers'][0]['code'] == 'quota.monthly_ai_tokens_exceeded'

    assign_limits(authenticated, organization_id, monthly_ai_tokens=10_000, max_steps_per_resource=20)
    restored = authenticated.get('/api/workspace/capabilities', params={'demo_id': demo['id']}).json()
    assert restored['actions']['use_ai']['allowed'] is True
    assert restored['actions']['record_step']['allowed'] is True


def test_recording_capabilities_block_resource_creation_and_full_storage(authenticated):
    summary = authenticated.get('/api/workspace/quotas').json()
    organization_id = summary['organization_id']
    assign_limits(authenticated, organization_id, resources=0, storage_bytes=0)

    blocked = authenticated.get('/api/workspace/capabilities', params={'organization_id': organization_id})
    assert blocked.status_code == 200, blocked.text
    value = blocked.json()
    assert value['actions']['create_resource']['allowed'] is False
    assert value['actions']['create_resource']['blockers'][0]['code'] == 'quota.resources_exceeded'
    assert value['actions']['record_step']['allowed'] is False
    assert value['actions']['record_step']['blockers'][0]['code'] == 'quota.storage_bytes_exceeded'


def test_recording_upload_enforces_step_and_storage_quotas(authenticated):
    demo = authenticated.post('/api/demos', json={'title': 'Guarded recording'}).json()
    organization_id = demo['organization_id']

    assign_limits(authenticated, organization_id, max_steps_per_resource=0)
    step_blocked = recording_step(authenticated, demo['id'], 'step-blocked')
    assert step_blocked.status_code == 403
    assert step_blocked.json()['code'] == 'quota.max_steps_per_resource_exceeded'

    assign_limits(authenticated, organization_id, max_steps_per_resource=10, storage_bytes=0)
    storage_blocked = recording_step(authenticated, demo['id'], 'storage-blocked')
    assert storage_blocked.status_code == 403
    assert storage_blocked.json()['code'] == 'quota.storage_bytes_exceeded'


def test_duplicate_and_merge_respect_resource_and_step_quotas(authenticated):
    first = authenticated.post('/api/demos', json={'title': 'First'}).json()
    second = authenticated.post('/api/demos', json={'title': 'Second'}).json()
    organization_id = first['organization_id']
    assign_limits(authenticated, organization_id, resources=2)

    duplicate = authenticated.post(f"/api/demos/{first['id']}/duplicate")
    assert duplicate.status_code == 403
    assert duplicate.json()['code'] == 'quota.resources_exceeded'

    db = SessionLocal()
    try:
        for index, demo_id in enumerate([first['id'], second['id']]):
            db.add(Step(
                demo_id=demo_id, event_id=f'quota-step-{index}', position=0,
                title='Step', body='', asset_key=f'missing-{index}', viewport_width=100, viewport_height=100,
                hotspot={}, redactions=[], duration=3,
            ))
        db.commit()
    finally:
        db.close()
    assign_limits(authenticated, organization_id, resources=100, max_steps_per_resource=1)
    merged = authenticated.post('/api/demos/merge', json={'demo_ids': [first['id'], second['id']], 'title': 'Merged'})
    assert merged.status_code == 403
    assert merged.json()['code'] == 'quota.max_steps_per_resource_exceeded'


def test_export_list_is_read_only_and_creation_recovers_after_increase(authenticated):
    demo_data = authenticated.post('/api/demos', json={'title': 'Export quota'}).json()
    organization_id = demo_data['organization_id']
    db = SessionLocal()
    try:
        demo = db.get(Demo, demo_data['id'])
        revision = PublishedRevision(demo_id=demo.id, number=1, snapshot={'title': demo.title, 'steps': []})
        db.add(revision); db.flush(); demo.current_revision_id = revision.id; db.commit()
    finally:
        db.close()

    assign_limits(authenticated, organization_id, monthly_exports=0)
    history = authenticated.get('/api/exports', params={'demo_id': demo_data['id']})
    assert history.status_code == 200, history.text
    blocked = authenticated.post(f"/api/exports/{demo_data['id']}", json={'kind': 'pdf'})
    assert blocked.status_code == 403
    assert blocked.json()['code'] == 'quota.monthly_exports_exceeded'

    assign_limits(authenticated, organization_id, monthly_exports=1)
    with patch('app.routers.exports.celery.send_task'):
        created = authenticated.post(f"/api/exports/{demo_data['id']}", json={'kind': 'pdf'})
    assert created.status_code == 202, created.text
    exhausted = authenticated.get('/api/workspace/capabilities', params={'demo_id': demo_data['id']}).json()
    assert exhausted['actions']['export']['allowed'] is False

    assign_limits(authenticated, organization_id, monthly_exports=2)
    restored = authenticated.get('/api/workspace/capabilities', params={'demo_id': demo_data['id']}).json()
    assert restored['actions']['export']['allowed'] is True


def test_member_invites_and_share_restore_follow_live_quota(authenticated):
    team = authenticated.post('/api/organizations', json={'name': 'Quota team'}).json()
    assign_limits(authenticated, team['id'], members=1)
    blocked_invite = authenticated.post(
        f"/api/organizations/{team['id']}/invitations",
        json={'email': 'member@example.com', 'role': 'editor'},
    )
    assert blocked_invite.status_code == 403
    assert blocked_invite.json()['code'] == 'quota.members_exceeded'
    assign_limits(authenticated, team['id'], members=2)
    assert authenticated.post(
        f"/api/organizations/{team['id']}/invitations",
        json={'email': 'member@example.com', 'role': 'editor'},
    ).status_code == 201

    authenticated.post(f"/api/organizations/{team['id']}/switch")
    demo_data = authenticated.post('/api/demos', json={'title': 'Share quota'}).json()
    db = SessionLocal()
    try:
        demo = db.get(Demo, demo_data['id'])
        revision = PublishedRevision(demo_id=demo.id, number=1, snapshot={'title': demo.title, 'steps': []})
        db.add(revision); db.flush(); demo.current_revision_id = revision.id; db.commit()
    finally:
        db.close()
    assign_limits(authenticated, team['id'], active_shares=1)
    share = authenticated.post(f"/api/demos/{demo_data['id']}/shares", json={'name': 'Review'}).json()
    assert authenticated.patch(f"/api/demos/{demo_data['id']}/shares/{share['id']}", json={'revoked': True}).status_code == 200
    assign_limits(authenticated, team['id'], active_shares=0)
    blocked_restore = authenticated.patch(f"/api/demos/{demo_data['id']}/shares/{share['id']}", json={'revoked': False})
    assert blocked_restore.status_code == 403
    assign_limits(authenticated, team['id'], active_shares=1)
    assert authenticated.patch(f"/api/demos/{demo_data['id']}/shares/{share['id']}", json={'revoked': False}).status_code == 200
