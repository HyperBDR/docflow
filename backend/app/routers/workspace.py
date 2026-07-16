from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import User
from app.services import current_organization_id
from app.workspace_schemas import WorkspaceJobPage, WorkspaceOverview
from app.workspace_service import get_workspace_jobs, get_workspace_overview


router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("/overview", response_model=WorkspaceOverview)
def overview(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return get_workspace_overview(db, current_organization_id(db, user), user)


@router.get("/jobs", response_model=WorkspaceJobPage)
def jobs(
    status: Literal["", "queued", "running", "complete", "failed", "cancelled"] = "",
    job_type: Literal["", "ai", "export"] = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return get_workspace_jobs(
        db,
        current_organization_id(db, user),
        user,
        status=status,
        job_type=job_type,
        page=page,
        page_size=page_size,
    )
