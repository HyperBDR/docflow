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
