import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


class DemoStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    complete = "complete"
    failed = "failed"


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[str] = mapped_column(String(20), default="user", index=True)
    ui_locale: Mapped[str] = mapped_column(String(10), default="zh-CN")
    current_organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL", use_alter=True, name="fk_users_current_organization"),
        nullable=True, index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    @property
    def active_organization_id(self) -> str | None:
        return getattr(self, "_active_organization_id", None) or self.current_organization_id


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="team", index=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    personal_owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, unique=True)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    archived_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    scheduled_purge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class OrganizationMember(Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_organization_member"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class OrganizationInvitation(Base):
    __tablename__ = "organization_invitations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(40), index=True)
    target_id: Mapped[str] = mapped_column(String(36), index=True)
    target_label: Mapped[str] = mapped_column(String(320), default="")
    before: Mapped[dict] = mapped_column(JSON, default=dict)
    after: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_address: Mapped[str] = mapped_column(String(80), default="")
    user_agent: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(30), default="web", index=True)
    outcome: Mapped[str] = mapped_column(String(20), default="success", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


demo_tags = Table(
    "demo_tags",
    Base.metadata,
    Column("demo_id", ForeignKey("demos.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("owner_id", "parent_id", "name", name="uq_category_owner_parent_name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(32), default="#635bff")
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_tag_owner_name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(32), default="#635bff")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active_organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ExtensionPair(Base):
    __tablename__ = "extension_pairs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class ExtensionToken(Base):
    __tablename__ = "extension_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    active_organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Demo(Base):
    __tablename__ = "demos"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(200), default="未命名演示")
    description: Mapped[str] = mapped_column(Text, default="")
    content_locale: Mapped[str] = mapped_column(String(10), default="zh-CN")
    theme: Mapped[dict] = mapped_column(JSON, default=dict)
    navigation: Mapped[dict] = mapped_column(JSON, default=dict)
    playback: Mapped[dict] = mapped_column(JSON, default=dict)
    manual_fields: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[DemoStatus] = mapped_column(Enum(DemoStatus), default=DemoStatus.draft)
    current_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    steps: Mapped[list["Step"]] = relationship(back_populates="demo", cascade="all, delete-orphan", order_by="Step.position")
    tags: Mapped[list[Tag]] = relationship(secondary=demo_tags, lazy="selectin")


class Step(Base):
    __tablename__ = "steps"
    __table_args__ = (UniqueConstraint("demo_id", "event_id", name="uq_step_demo_event"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(String(64))
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    asset_key: Mapped[str] = mapped_column(String(500))
    render_mode: Mapped[str] = mapped_column(String(20), default="image")
    dom_snapshot_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    viewport_width: Mapped[int] = mapped_column(Integer)
    viewport_height: Mapped[int] = mapped_column(Integer)
    hotspot: Mapped[dict] = mapped_column(JSON, default=dict)
    redactions: Mapped[list] = mapped_column(JSON, default=list)
    page_context: Mapped[dict] = mapped_column(JSON, default=dict)
    scroll_state: Mapped[dict] = mapped_column(JSON, default=dict)
    capture_warnings: Mapped[list] = mapped_column(JSON, default=list)
    manual_fields: Mapped[list] = mapped_column(JSON, default=list)
    ai_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    animation: Mapped[dict] = mapped_column(JSON, default=dict)
    duration: Mapped[float] = mapped_column(Float, default=3.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    demo: Mapped[Demo] = relationship(back_populates="steps")
    hotspots: Mapped[list["Hotspot"]] = relationship(
        back_populates="step", cascade="all, delete-orphan", order_by="Hotspot.position"
    )


class Hotspot(Base):
    __tablename__ = "hotspots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    step_id: Mapped[str] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    selector: Mapped[dict] = mapped_column(JSON, default=dict)
    fallback_rect: Mapped[dict] = mapped_column(JSON, default=dict)
    trigger: Mapped[str] = mapped_column(String(20), default="click")
    action: Mapped[dict] = mapped_column(JSON, default=dict)
    tooltip: Mapped[dict] = mapped_column(JSON, default=dict)
    style: Mapped[dict] = mapped_column(JSON, default=dict)
    manual_fields: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    step: Mapped[Step] = relationship(back_populates="hotspots")


class PublishedRevision(Base):
    __tablename__ = "published_revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ShareToken(Base):
    __tablename__ = "share_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("published_revisions.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AnalyticsEvent(Base):
    __tablename__ = "analytics_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    share_id: Mapped[str] = mapped_column(ForeignKey("share_tokens.id", ondelete="CASCADE"), index=True)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("published_revisions.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    visitor_id: Mapped[str] = mapped_column(String(80), index=True)
    session_id: Mapped[str] = mapped_column(String(80), index=True)
    event_type: Mapped[str] = mapped_column(String(24), index=True)
    operating_system: Mapped[str] = mapped_column(String(80), default="")
    browser: Mapped[str] = mapped_column(String(80), default="")
    device: Mapped[str] = mapped_column(String(40), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    region: Mapped[str] = mapped_column(String(100), default="")
    city: Mapped[str] = mapped_column(String(100), default="")
    user_agent: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class StepComment(Base):
    __tablename__ = "step_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    share_id: Mapped[str] = mapped_column(ForeignKey("share_tokens.id", ondelete="CASCADE"), index=True)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("published_revisions.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str] = mapped_column(String(36), index=True)
    visitor_id: Mapped[str] = mapped_column(String(80), default="")
    author_name: Mapped[str] = mapped_column(String(100), default="访客")
    author_email: Mapped[str] = mapped_column(String(320), default="")
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="published", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ExportJob(Base):
    __tablename__ = "export_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("published_revisions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.queued)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    result_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class AIJob(Base):
    __tablename__ = "ai_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    demo_id: Mapped[str] = mapped_column(ForeignKey("demos.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str | None] = mapped_column(ForeignKey("steps.id", ondelete="CASCADE"), nullable=True)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus), default=JobStatus.queued)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    model_config_id: Mapped[str | None] = mapped_column(ForeignKey("ai_model_configs.id", ondelete="SET NULL"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(200), default="")
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    applied_patch: Mapped[dict] = mapped_column(JSON, default=dict)
    inverse_patch: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class AIModelConfig(Base):
    """Administrator-managed OpenAI-compatible model endpoint."""
    __tablename__ = "ai_model_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(40), default="openai_compatible")
    base_url: Mapped[str] = mapped_column(String(500), default="https://api.openai.com/v1")
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(200))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    vision_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=120)
    temperature: Mapped[float] = mapped_column(Float, default=.2)
    extra_options: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    @property
    def api_key(self) -> str:
        from app.secrets import decrypt_secret
        return decrypt_secret(self.api_key_encrypted)

    @api_key.setter
    def api_key(self, value: str) -> None:
        from app.secrets import encrypt_secret
        self.api_key_encrypted = encrypt_secret(value or "")


class AIPlatformSettings(Base):
    """Singleton runtime policy shared by every configured AI model."""
    __tablename__ = "ai_platform_settings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="global")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    chunk_size: Mapped[int] = mapped_column(Integer, default=8)
    updated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class AIUsageRecord(Base):
    """One row per upstream model request, including failed requests."""
    __tablename__ = "ai_usage_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_id: Mapped[str] = mapped_column(String(120), default="", index=True)
    model_config_id: Mapped[str | None] = mapped_column(ForeignKey("ai_model_configs.id", ondelete="SET NULL"), nullable=True, index=True)
    model_name: Mapped[str] = mapped_column(String(200), default="", index=True)
    provider: Mapped[str] = mapped_column(String(40), default="openai_compatible")
    job_id: Mapped[str | None] = mapped_column(ForeignKey("ai_jobs.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True)
    demo_id: Mapped[str | None] = mapped_column(ForeignKey("demos.id", ondelete="SET NULL"), nullable=True, index=True)
    operation: Mapped[str] = mapped_column(String(80), default="generation", index=True)
    status: Mapped[str] = mapped_column(String(20), default="success", index=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    first_token_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    request_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    response_detail: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class StorageConfig(Base):
    """A server-local directory or S3-compatible object-storage target."""
    __tablename__ = "storage_configs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # local | s3
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    local_path: Mapped[str] = mapped_column(String(1000), default="")
    endpoint_url: Mapped[str] = mapped_column(String(1000), default="")
    region: Mapped[str] = mapped_column(String(120), default="")
    bucket: Mapped[str] = mapped_column(String(255), default="")
    access_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    secret_key_encrypted: Mapped[str] = mapped_column(Text, default="")
    prefix: Mapped[str] = mapped_column(String(500), default="docflow")
    force_path_style: Mapped[bool] = mapped_column(Boolean, default=False)
    direct_download: Mapped[bool] = mapped_column(Boolean, default=True)
    public_base_url: Mapped[str] = mapped_column(String(1000), default="")
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
