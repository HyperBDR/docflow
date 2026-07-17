from datetime import datetime, timezone
from calendar import monthrange
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import AIUsageRecord, AnalyticsEvent, Demo, ExportDownloadEvent, ExportJob, OrganizationMember, OrganizationQuotaAssignment, PublishedRevision, QuotaPlan, ShareToken, Step
from app.storage import storage

DEFAULT_LIMITS={"storage_bytes":10737418240,"resources":100,"max_steps_per_resource":500,"members":10,"active_shares":50,"monthly_ai_tokens":100000,"monthly_exports":50,"monthly_video_minutes":60,"monthly_public_views":20000,"monthly_download_bytes":21474836480}
SOFT={"monthly_public_views","monthly_download_bytes"}

def month_range():
    now=datetime.now(timezone.utc);start=now.replace(day=1,hour=0,minute=0,second=0,microsecond=0);end=start.replace(day=monthrange(start.year,start.month)[1],hour=23,minute=59,second=59);return start,end

def default_plan(db:Session)->QuotaPlan:
    plan=db.scalar(select(QuotaPlan).where(QuotaPlan.is_default.is_(True)).order_by(QuotaPlan.created_at)) or db.scalar(select(QuotaPlan).order_by(QuotaPlan.created_at))
    if not plan:
        plan=QuotaPlan(name="Default",description="Default workspace quota",is_default=True,limits=DEFAULT_LIMITS);db.add(plan);db.commit();db.refresh(plan)
    return plan

def effective_plan(db:Session,organization_id:str):
    assignment=db.get(OrganizationQuotaAssignment,organization_id);plan=db.get(QuotaPlan,assignment.plan_id) if assignment else default_plan(db)
    limits={**DEFAULT_LIMITS,**(plan.limits or {}),**((assignment.overrides or {}) if assignment else {})}
    return plan,limits,assignment

def usage(db:Session,organization_id:str)->dict[str,int]:
    start,end=month_range();demos=db.scalars(select(Demo).where(Demo.organization_id==organization_id,Demo.deleted_at.is_(None))).all();ids=[d.id for d in demos]
    steps=db.execute(select(Step.demo_id,func.count(Step.id)).where(Step.demo_id.in_(ids)).group_by(Step.demo_id)).all() if ids else []
    keys=set()
    if ids:
        for asset,snapshot in db.execute(select(Step.asset_key,Step.dom_snapshot_key).where(Step.demo_id.in_(ids))):
            if asset:keys.add(asset)
            if snapshot:keys.add(snapshot)
        keys.update(x for x in db.scalars(select(ExportJob.result_key).where(ExportJob.demo_id.in_(ids),ExportJob.result_key.is_not(None))).all() if x)
    exports=db.scalars(select(ExportJob).where(ExportJob.demo_id.in_(ids),ExportJob.created_at>=start,ExportJob.created_at<=end)).all() if ids else []
    revisions={r.id:r for r in db.scalars(select(PublishedRevision).where(PublishedRevision.id.in_([x.revision_id for x in exports if x.kind=="mp4"]))).all()} if exports else {}
    video_seconds=sum(sum(float(s.get("duration",3)) for s in revisions.get(x.revision_id).snapshot.get("steps",[])) for x in exports if x.kind=="mp4" and revisions.get(x.revision_id))
    return {
      "storage_bytes":sum(storage.size(k) for k in keys),"resources":len(ids),"max_steps_per_resource":max([c for _,c in steps],default=0),
      "members":db.scalar(select(func.count(OrganizationMember.id)).where(OrganizationMember.organization_id==organization_id)) or 0,
      "active_shares":db.scalar(select(func.count(ShareToken.id)).join(Demo,Demo.id==ShareToken.demo_id).where(Demo.organization_id==organization_id,ShareToken.revoked.is_(False),or_(ShareToken.expires_at.is_(None),ShareToken.expires_at>datetime.now(timezone.utc)))) or 0,
      "monthly_ai_tokens":db.scalar(select(func.sum(AIUsageRecord.total_tokens)).where(AIUsageRecord.organization_id==organization_id,AIUsageRecord.created_at>=start,AIUsageRecord.created_at<=end)) or 0,
      "monthly_exports":len(exports),"monthly_video_minutes":round(video_seconds/60),
      "monthly_public_views":db.scalar(select(func.count(distinct(AnalyticsEvent.session_id))).join(Demo,Demo.id==AnalyticsEvent.demo_id).where(Demo.organization_id==organization_id,AnalyticsEvent.created_at>=start,AnalyticsEvent.created_at<=end)) or 0,
      "monthly_download_bytes":db.scalar(select(func.sum(ExportDownloadEvent.bytes_transferred)).where(ExportDownloadEvent.organization_id==organization_id,ExportDownloadEvent.status=="completed",ExportDownloadEvent.created_at>=start,ExportDownloadEvent.created_at<=end)) or 0,
    }

def quota_summary(db:Session,organization_id:str)->dict:
    plan,limits,assignment=effective_plan(db,organization_id);used=usage(db,organization_id);start,end=month_range();items=[]
    for key,limit in limits.items():
        value=int(used.get(key,0));percent=round(value/int(limit)*100,1) if limit else 0;items.append({"key":key,"used":value,"limit":limit,"percent":percent,"status":"exceeded" if limit and value>=limit else "warning" if limit and percent>=80 else "normal","enforcement":"soft" if key in SOFT else "hard"})
    return {"organization_id":organization_id,"plan":{"id":plan.id,"name":plan.name,"description":plan.description},"items":items,"period":{"starts_at":start,"resets_at":end},"has_overrides":bool(assignment and assignment.overrides)}

def enforce(db:Session,organization_id:str,key:str,increment:int=1):
    _,limits,_=effective_plan(db,organization_id);limit=limits.get(key)
    if key in SOFT or limit is None:return
    current=usage(db,organization_id).get(key,0)
    if current+increment>int(limit):
        raise HTTPException(status_code=403,detail={"message":"workspace quota exceeded","code":f"quota.{key}_exceeded","quota":{"metric":key,"used":current,"limit":limit}})
