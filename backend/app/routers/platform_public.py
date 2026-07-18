from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.platform_settings import general_runtime_config
from app.platform_settings_schemas import PublicPlatformConfig


router = APIRouter(prefix="/api/platform", tags=["platform-public"])


@router.get("/config", response_model=PublicPlatformConfig)
def public_platform_config(db: Session = Depends(get_db)):
    config = general_runtime_config(db)
    return PublicPlatformConfig(help_url=config.help_url, upgrade_url=config.upgrade_url)
