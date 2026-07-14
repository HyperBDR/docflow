from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import User
from app.schemas import DemoOut
from app.services import demo_out, owned_demo

router = APIRouter(prefix="/api/demos", tags=["demos"])


class StepOrder(BaseModel):
    step_ids: list[str] = Field(min_length=1, max_length=100)


@router.post("/{demo_id}/steps/reorder", response_model=DemoOut)
def reorder_steps(payload: StepOrder, demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    existing = {step.id: step for step in demo.steps}
    if len(payload.step_ids) != len(existing) or set(payload.step_ids) != set(existing):
        raise HTTPException(status_code=422, detail="step_ids must contain every step exactly once")
    for position, step_id in enumerate(payload.step_ids):
        existing[step_id].position = position
    db.commit()
    db.refresh(demo)
    return demo_out(db, demo)

