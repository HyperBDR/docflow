from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Demo, User
from app.resource_transfer_schemas import ResourceTransferInput
from app.resource_transfer_service import transfer_resource
from app.schemas import DemoOut
from app.services import demo_out, write_audit

router = APIRouter(prefix="/api/demos", tags=["resource-transfers"])


@router.post("/{demo_id}/transfer", response_model=DemoOut, status_code=201)
def transfer_demo(
    demo_id: str,
    payload: ResourceTransferInput,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    source = db.scalar(select(Demo).where(
        Demo.id == demo_id, Demo.deleted_at.is_(None),
    ).with_for_update())
    if not source:
        raise HTTPException(status_code=404, detail="demo not found")
    result, source_organization_id = transfer_resource(
        db, source, user, payload.target_organization_id, payload.action,
    )
    write_audit(
        db,
        user,
        "resource.copied_to_space" if payload.action == "copy" else "resource.moved_to_space",
        "resource",
        result.id,
        result.title,
        result.organization_id,
        before={"organization_id": source_organization_id, "source_resource_id": source.id},
        after={"organization_id": result.organization_id, "action": payload.action},
        request=request,
    )
    db.commit()
    db.refresh(result)
    return demo_out(db, result)
