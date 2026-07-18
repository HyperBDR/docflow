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
