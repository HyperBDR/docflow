from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import AIModelConfig, AIPlatformSettings


def platform_settings(db: Session) -> AIPlatformSettings:
    value = db.get(AIPlatformSettings, "global")
    if value:
        return value
    # Fresh installs without a model start disabled. Databases created from
    # metadata in tests or development retain the intuitive model-first flow.
    has_model = bool(db.scalar(select(func.count(AIModelConfig.id)).where(AIModelConfig.enabled.is_(True))))
    value = AIPlatformSettings(id="global", enabled=has_model, chunk_size=8)
    db.add(value)
    db.commit()
    db.refresh(value)
    return value


def ai_runtime_enabled(db: Session) -> bool:
    return platform_settings(db).enabled


def ai_chunk_size(db: Session) -> int:
    return max(1, min(12, platform_settings(db).chunk_size))


def active_model(db: Session, model_id: str | None = None) -> AIModelConfig | None:
    if not ai_runtime_enabled(db):
        return None
    statement = select(AIModelConfig).where(AIModelConfig.enabled.is_(True))
    if model_id:
        statement = statement.where(AIModelConfig.id == model_id)
    else:
        statement = statement.order_by(AIModelConfig.is_default.desc(), AIModelConfig.created_at)
    return db.scalar(statement)


def set_default(db: Session, model: AIModelConfig) -> None:
    db.execute(update(AIModelConfig).where(AIModelConfig.id != model.id).values(is_default=False))
    model.is_default = True
    model.enabled = True
