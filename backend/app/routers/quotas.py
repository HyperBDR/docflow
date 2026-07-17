from fastapi import APIRouter,Depends,HTTPException,Query,Request
from sqlalchemy import func,select,update
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import admin_user,current_user
from app.models import Organization,OrganizationQuotaAssignment,QuotaPlan,User
from app.quota import DEFAULT_LIMITS,effective_plan,quota_summary
from app.quota_analytics import collect_quota_usage,operations_overview,plan_statistics,space_history
from app.services import current_organization_id,write_audit

router=APIRouter(tags=["quotas"])

def plan_out(p):return {"id":p.id,"name":p.name,"description":p.description,"is_default":p.is_default,"limits":{**DEFAULT_LIMITS,**(p.limits or {})},"created_at":p.created_at,"updated_at":p.updated_at}

@router.get("/api/workspace/quotas")
def workspace_quotas(db:Session=Depends(get_db),user:User=Depends(current_user)):return quota_summary(db,current_organization_id(db,user))

@router.get("/api/admin/quota-plans")
def plans(db:Session=Depends(get_db),_:User=Depends(admin_user)):return [plan_out(x) for x in db.scalars(select(QuotaPlan).order_by(QuotaPlan.is_default.desc(),QuotaPlan.name)).all()]

@router.post("/api/admin/quota-plans",status_code=201)
def create_plan(payload:dict,request:Request,db:Session=Depends(get_db),actor:User=Depends(admin_user)):
    p=QuotaPlan(name=str(payload.get("name") or "").strip(),description=str(payload.get("description") or ""),limits={**DEFAULT_LIMITS,**(payload.get("limits") or {})},is_default=bool(payload.get("is_default")),created_by_id=actor.id)
    if not p.name:raise HTTPException(422,"plan name is required")
    if p.is_default:db.execute(update(QuotaPlan).values(is_default=False))
    db.add(p);db.flush();write_audit(db,actor,"quota_plan.created","quota_plan",p.id,p.name,request=request);db.commit();db.refresh(p);return plan_out(p)

@router.patch("/api/admin/quota-plans/{plan_id}")
def update_plan(plan_id:str,payload:dict,request:Request,db:Session=Depends(get_db),actor:User=Depends(admin_user)):
    p=db.get(QuotaPlan,plan_id)
    if not p:raise HTTPException(404,"quota plan not found")
    if "name" in payload:p.name=str(payload["name"]).strip()
    if "description" in payload:p.description=str(payload["description"])
    if "limits" in payload:p.limits={**DEFAULT_LIMITS,**payload["limits"]}
    if payload.get("is_default"):db.execute(update(QuotaPlan).values(is_default=False));p.is_default=True
    write_audit(db,actor,"quota_plan.updated","quota_plan",p.id,p.name,request=request);db.commit();db.refresh(p);return plan_out(p)

@router.delete("/api/admin/quota-plans/{plan_id}",status_code=204)
def delete_plan(plan_id:str,request:Request,db:Session=Depends(get_db),actor:User=Depends(admin_user)):
    p=db.get(QuotaPlan,plan_id)
    if not p:raise HTTPException(404,{"message":"quota plan not found","code":"quota.plan_not_found"})
    if p.is_default:raise HTTPException(409,{"message":"the default quota plan cannot be deleted","code":"quota.plan_default"})
    assigned=db.scalar(select(func.count(OrganizationQuotaAssignment.organization_id)).where(OrganizationQuotaAssignment.plan_id==p.id)) or 0
    if assigned:raise HTTPException(409,{"message":"quota plan is assigned to workspaces","code":"quota.plan_in_use"})
    write_audit(db,actor,"quota_plan.deleted","quota_plan",p.id,p.name,before={"name":p.name,"description":p.description,"limits":p.limits or {}},request=request)
    db.delete(p);db.commit()

@router.get("/api/admin/organizations/{organization_id}/quota")
def admin_org_quota(organization_id:str,db:Session=Depends(get_db),_:User=Depends(admin_user)):
    if not db.get(Organization,organization_id):raise HTTPException(404,"organization not found")
    result=quota_summary(db,organization_id);a=db.get(OrganizationQuotaAssignment,organization_id);result["assignment"]={"plan_id":a.plan_id,"overrides":a.overrides} if a else None;return result

@router.put("/api/admin/organizations/{organization_id}/quota")
def assign(organization_id:str,payload:dict,request:Request,db:Session=Depends(get_db),actor:User=Depends(admin_user)):
    plan=db.get(QuotaPlan,str(payload.get("plan_id") or ""));org=db.get(Organization,organization_id)
    if not plan or not org:raise HTTPException(404,"quota plan or organization not found")
    a=db.get(OrganizationQuotaAssignment,organization_id) or OrganizationQuotaAssignment(organization_id=organization_id,plan_id=plan.id)
    a.plan_id=plan.id;a.overrides=payload.get("overrides") or {};a.updated_by_id=actor.id;db.add(a);write_audit(db,actor,"organization.quota_updated","organization",org.id,org.name,org.id,after={"plan_id":plan.id,"overrides":a.overrides},request=request);db.commit();return admin_org_quota(organization_id,db,actor)

@router.get("/api/admin/quotas/overview")
def admin_quota_overview(
    days:int=Query(30,ge=1,le=400),metric:str="storage_bytes",kind:str="",plan_id:str="",health:str="",
    db:Session=Depends(get_db),_:User=Depends(admin_user),
):
    return operations_overview(db,days,metric,kind,plan_id,health)

@router.get("/api/admin/quotas/plans")
def admin_quota_plans(db:Session=Depends(get_db),_:User=Depends(admin_user)):
    return plan_statistics(db)

@router.get("/api/admin/quotas/spaces/{organization_id}/history")
def admin_quota_space_history(organization_id:str,days:int=Query(90,ge=1,le=400),db:Session=Depends(get_db),_:User=Depends(admin_user)):
    result=space_history(db,organization_id,days)
    if not result:raise HTTPException(404,"organization not found")
    return result

@router.post("/api/admin/quotas/collect")
def admin_collect_quotas(db:Session=Depends(get_db),_:User=Depends(admin_user)):
    return collect_quota_usage(db)
