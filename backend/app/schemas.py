from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl

Locale = Literal["zh-CN", "en"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str = ""
    role: Literal["user", "admin"] = "user"
    is_active: bool = True
    ui_locale: Locale = "zh-CN"
    current_organization_id: str | None = None
    active_organization_id: str | None = None
    created_at: datetime


class AuthInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    ui_locale: Locale | None = None


class UserPreferenceUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    ui_locale: Locale | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


OrganizationRole = Literal["owner", "admin", "editor", "viewer"]


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_id: str | None = None


class OrganizationUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class OrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    kind: Literal["personal", "team"] = "team"
    status: Literal["active", "archived"] = "active"
    role: OrganizationRole
    access_source: Literal["membership", "platform_admin"] = "membership"
    member_count: int = 0
    demo_count: int = 0
    created_at: datetime


class OrganizationMemberOut(BaseModel):
    id: str
    user_id: str
    name: str
    email: str
    role: OrganizationRole
    is_active: bool
    created_at: datetime


class OrganizationMemberUpdate(BaseModel):
    role: OrganizationRole


class InvitationCreate(BaseModel):
    email: EmailStr
    role: OrganizationRole = "editor"


class InvitationOut(BaseModel):
    id: str
    email: str
    role: OrganizationRole
    organization_id: str
    organization_name: str
    invite_url: str | None = None
    expires_at: datetime
    accepted_at: datetime | None = None
    created_at: datetime


class InvitationRegister(BaseModel):
    name: str = Field(default="", max_length=100)
    password: str = Field(min_length=8, max_length=128)
    ui_locale: Locale = "zh-CN"


class AuditLogOut(BaseModel):
    id: str
    actor_id: str | None
    actor_name: str
    actor_email: str
    organization_id: str | None
    organization_name: str
    action: str
    target_type: str
    target_id: str
    target_label: str
    before: dict
    after: dict
    ip_address: str
    user_agent: str
    source: str
    outcome: str
    created_at: datetime


class RecycleItemOut(BaseModel):
    id: str
    item_type: Literal["user", "resource", "team_space"]
    title: str
    owner_email: str = ""
    deleted_at: datetime
    deleted_by_name: str = ""
    expires_at: datetime


class AdminOrganizationOut(BaseModel):
    id: str
    name: str
    slug: str
    kind: Literal["personal", "team"]
    status: Literal["active", "archived"]
    owner_name: str = ""
    owner_email: str = ""
    member_count: int
    demo_count: int
    storage_bytes: int
    created_by_email: str
    created_at: datetime
    archived_at: datetime | None = None


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int
    page: int
    page_size: int


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    email: EmailStr | None = None
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None
    ui_locale: Locale | None = None


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class AdminMembershipCreate(BaseModel):
    organization_id: str
    role: OrganizationRole = "viewer"


class AdminMembershipUpdate(BaseModel):
    role: OrganizationRole


class AdminMembershipOut(BaseModel):
    id: str
    organization_id: str
    organization_name: str
    organization_slug: str
    organization_kind: Literal["personal", "team"] = "team"
    role: OrganizationRole
    is_current: bool = False
    created_at: datetime


class UserStats(BaseModel):
    demos: int = 0
    steps: int = 0
    published_demos: int = 0
    views: int = 0
    unique_viewers: int = 0
    exports: int = 0
    storage_bytes: int = 0


class AdminUserOut(UserOut):
    stats: UserStats = Field(default_factory=UserStats)
    memberships: list[AdminMembershipOut] = Field(default_factory=list)


class AdminUserPage(BaseModel):
    items: list[AdminUserOut]
    total: int
    page: int
    page_size: int


class MetricPoint(BaseModel):
    key: str
    label: str
    value: int = 0
    secondary: int = 0


class OverviewTrendPoint(BaseModel):
    date: str
    users: int = 0
    demos: int = 0
    views: int = 0
    ai_tokens: int = 0


class OverviewFailedJob(BaseModel):
    id: str
    job_type: Literal["ai", "export"]
    kind: str
    resource_id: str
    resource_title: str
    user_name: str = ""
    user_email: str = ""
    error: str = ""
    created_at: datetime


class OverviewExportJob(BaseModel):
    id: str
    kind: str
    status: str
    progress: int = 0
    resource_id: str
    resource_title: str
    user_name: str = ""
    user_email: str = ""
    created_at: datetime


class OverviewResourceTraffic(BaseModel):
    id: str
    title: str
    owner_name: str = ""
    owner_email: str = ""
    views: int = 0
    unique_viewers: int = 0
    last_viewed_at: datetime | None = None


class AdminOverview(BaseModel):
    users: int = 0
    active_users: int = 0
    admins: int = 0
    organizations: int = 0
    demos: int = 0
    draft_demos: int = 0
    published_demos: int = 0
    steps: int = 0
    views: int = 0
    unique_viewers: int = 0
    exports: int = 0
    ai_requests: int = 0
    ai_tokens: int = 0
    failed_jobs: int = 0
    storage_bytes: int = 0
    trend: list[OverviewTrendPoint] = Field(default_factory=list)
    demo_status: list[MetricPoint] = Field(default_factory=list)
    content_locales: list[MetricPoint] = Field(default_factory=list)
    top_organizations: list[MetricPoint] = Field(default_factory=list)
    recent_failed_jobs: list[OverviewFailedJob] = Field(default_factory=list)
    recent_exports: list[OverviewExportJob] = Field(default_factory=list)
    top_resources: list[OverviewResourceTraffic] = Field(default_factory=list)


class AIModelConfigInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: Literal["openai_compatible"] = "openai_compatible"
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=2000)
    model: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    is_default: bool = False
    vision_enabled: bool = True
    timeout_seconds: int = Field(default=120, ge=5, le=600)
    temperature: float = Field(default=.2, ge=0, le=2)
    extra_options: dict = Field(default_factory=dict)


class AIModelConfigUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=2000)
    model: str | None = Field(default=None, min_length=1, max_length=200)
    enabled: bool | None = None
    is_default: bool | None = None
    vision_enabled: bool | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=600)
    temperature: float | None = Field(default=None, ge=0, le=2)
    extra_options: dict | None = None


class AIModelConfigOut(BaseModel):
    id: str
    name: str
    provider: str
    base_url: str
    model: str
    enabled: bool
    is_default: bool
    vision_enabled: bool
    timeout_seconds: int
    temperature: float
    extra_options: dict
    api_key_configured: bool
    created_at: datetime
    updated_at: datetime


class AIPlatformSettingsUpdate(BaseModel):
    enabled: bool
    chunk_size: int = Field(default=8, ge=1, le=12)


class AIPlatformSettingsOut(AIPlatformSettingsUpdate):
    enabled_models: int = 0
    configured_models: int = 0
    effective: bool = False
    updated_at: datetime


class AIUsagePoint(BaseModel):
    key: str
    label: str
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    avg_first_token_ms: int | None = None
    avg_latency_ms: int = 0


class AIUsageSummary(BaseModel):
    totals: AIUsagePoint
    trend: list[AIUsagePoint]
    by_user: list[AIUsagePoint]
    by_organization: list[AIUsagePoint]
    by_model: list[AIUsagePoint]
    by_resource: list[AIUsagePoint]
    by_status: list[AIUsagePoint]
    by_operation: list[AIUsagePoint]


class AIUsageRecordOut(BaseModel):
    id: str
    request_id: str
    model_config_id: str | None
    model_name: str
    user_id: str | None
    user_name: str
    user_email: str
    organization_id: str | None
    organization_name: str
    demo_id: str | None
    demo_title: str
    operation: str
    status: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    first_token_ms: int | None
    latency_ms: int
    request_detail: dict
    response_detail: dict
    error: str
    created_at: datetime


class AIUsageRecordPage(BaseModel):
    items: list[AIUsageRecordOut]
    total: int
    page: int
    page_size: int


class StorageConfigInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["local", "s3"]
    enabled: bool = True
    is_default: bool = False
    local_path: str = Field(default="", max_length=1000)
    endpoint_url: str = Field(default="", max_length=1000)
    region: str = Field(default="", max_length=120)
    bucket: str = Field(default="", max_length=255)
    access_key: str | None = Field(default=None, max_length=1000)
    secret_key: str | None = Field(default=None, max_length=2000)
    prefix: str = Field(default="docflow", max_length=500)
    force_path_style: bool = False
    direct_download: bool = True
    public_base_url: str = Field(default="", max_length=1000)


class StorageConfigUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    is_default: bool | None = None
    local_path: str | None = Field(default=None, max_length=1000)
    endpoint_url: str | None = Field(default=None, max_length=1000)
    region: str | None = Field(default=None, max_length=120)
    bucket: str | None = Field(default=None, max_length=255)
    access_key: str | None = Field(default=None, max_length=1000)
    secret_key: str | None = Field(default=None, max_length=2000)
    prefix: str | None = Field(default=None, max_length=500)
    force_path_style: bool | None = None
    direct_download: bool | None = None
    public_base_url: str | None = Field(default=None, max_length=1000)


class StorageConfigOut(BaseModel):
    id: str
    name: str
    kind: Literal["local", "s3"]
    enabled: bool
    is_default: bool
    local_path: str
    endpoint_url: str
    region: str
    bucket: str
    prefix: str
    force_path_style: bool
    direct_download: bool
    public_base_url: str
    credentials_configured: bool
    object_count: int = 0
    total_bytes: int = 0
    created_at: datetime
    updated_at: datetime


class StorageObjectOut(BaseModel):
    key: str
    name: str
    is_directory: bool
    size: int
    updated_at: datetime | None = None


class AdminResourceOwner(BaseModel):
    id: str
    name: str
    email: str


class AdminResourceOut(BaseModel):
    id: str
    title: str
    description: str
    status: Literal["draft", "published"]
    content_locale: Locale
    owner: AdminResourceOwner
    step_count: int
    views: int
    unique_viewers: int
    storage_bytes: int
    thumbnail_url: str | None = None
    created_at: datetime
    updated_at: datetime


class AdminResourcePage(BaseModel):
    items: list[AdminResourceOut]
    total: int
    page: int
    page_size: int


class Hotspot(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(default=0.04, ge=0, le=1)
    h: float = Field(default=0.04, ge=0, le=1)


class Redaction(Hotspot):
    pass


class PlaybackConfig(BaseModel):
    autoplay: bool = False
    step_duration_ms: int = Field(default=2000, ge=250, le=60000)
    transition_delay_ms: int = Field(default=1000, ge=0, le=30000)
    loop: bool = False


class ZoomAnimation(BaseModel):
    enabled: bool = True
    rect: Hotspot
    duration_ms: int = Field(default=3000, ge=500, le=10000)
    transition_duration_ms: int = Field(default=1200, ge=0, le=5000)


class StepAnimation(BaseModel):
    zoom: ZoomAnimation | None = None


TooltipPlacement = Literal[
    "auto", "top", "top-start", "top-end", "bottom", "bottom-start", "bottom-end",
    "left", "left-start", "left-end", "right", "right-start", "right-end",
]


class SelectorInfo(BaseModel):
    css: str | None = Field(default=None, max_length=1000)
    node_id: int | None = None
    tag: str | None = Field(default=None, max_length=100)
    role: str | None = Field(default=None, max_length=100)
    aria_label: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=1000)


class HotspotAction(BaseModel):
    type: Literal["next", "goto", "link", "end"] = "next"
    target_step_id: str | None = None
    url: str | None = Field(default=None, max_length=2000)


class TooltipConfig(BaseModel):
    content: str = Field(default="", max_length=5000)
    placement: TooltipPlacement = "auto"
    alignment: Literal["start", "center", "end"] = "center"
    offset: int = Field(default=12, ge=0, le=100)
    max_width: int = Field(default=320, ge=160, le=800)
    show_arrow: bool = True


class HotspotStyle(BaseModel):
    shape: Literal["rectangle", "circle"] = "rectangle"
    pulse: bool = True
    spotlight: bool = False
    padding: int = Field(default=6, ge=0, le=100)
    color: str = Field(default="#635bff", max_length=32)
    overlay_opacity: float = Field(default=0.45, ge=0, le=0.9)


class HotspotCreate(BaseModel):
    selector: SelectorInfo = Field(default_factory=SelectorInfo)
    fallback_rect: Hotspot
    trigger: Literal["click", "hover"] = "click"
    action: HotspotAction = Field(default_factory=HotspotAction)
    tooltip: TooltipConfig = Field(default_factory=TooltipConfig)
    style: HotspotStyle = Field(default_factory=HotspotStyle)


class HotspotUpdate(BaseModel):
    selector: SelectorInfo | None = None
    fallback_rect: Hotspot | None = None
    trigger: Literal["click", "hover"] | None = None
    action: HotspotAction | None = None
    tooltip: TooltipConfig | None = None
    style: HotspotStyle | None = None
    position: int | None = Field(default=None, ge=0)


class HotspotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    position: int
    selector: dict
    fallback_rect: dict
    trigger: str
    action: dict
    tooltip: dict
    style: dict


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_id: str
    position: int
    title: str
    body: str
    viewport_width: int
    viewport_height: int
    hotspot: dict
    redactions: list
    duration: float
    image_url: str | None = None
    render_mode: str = "image"
    snapshot_url: str | None = None
    page_context: dict = Field(default_factory=dict)
    scroll_state: dict = Field(default_factory=dict)
    capture_warnings: list = Field(default_factory=list)
    manual_fields: list = Field(default_factory=list)
    ai_metadata: dict = Field(default_factory=dict)
    animation: dict = Field(default_factory=dict)
    hotspots: list[HotspotOut] = Field(default_factory=list)


class DemoCreate(BaseModel):
    title: str = Field(default="未命名演示", min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    category_id: str | None = None
    content_locale: Locale = "zh-CN"
    auto_title: bool = False


class DemoUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    theme: dict | None = None
    navigation: dict | None = None
    playback: PlaybackConfig | None = None
    category_id: str | None = None
    tag_ids: list[str] | None = Field(default=None, max_length=30)
    content_locale: Locale | None = None


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: str | None = None
    color: str = Field(default="#635bff", max_length=32)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    parent_id: str | None = None
    color: str | None = Field(default=None, max_length=32)
    position: int | None = Field(default=None, ge=0)


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    parent_id: str | None
    color: str
    position: int


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(default="#635bff", max_length=32)


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, max_length=32)


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    color: str


class MergeDemos(BaseModel):
    demo_ids: list[str] = Field(min_length=2, max_length=5)
    title: str = Field(default="合并演示", min_length=1, max_length=200)
    category_id: str | None = None


class AnalyticsEventCreate(BaseModel):
    event_type: Literal["view", "step_view", "interaction", "complete"]
    visitor_id: str = Field(min_length=1, max_length=80)
    session_id: str = Field(min_length=1, max_length=80)
    step_id: str | None = None


class CommentCreate(BaseModel):
    step_id: str
    visitor_id: str = Field(default="", max_length=80)
    author_name: str = Field(default="访客", max_length=100)
    author_email: str = Field(default="", max_length=320)
    content: str = Field(min_length=1, max_length=5000)


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    step_id: str
    author_name: str
    author_email: str
    content: str
    status: str
    created_at: datetime


class StepUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=5000)
    hotspot: Hotspot | None = None
    redactions: list[Redaction] | None = None
    duration: float | None = Field(default=None, ge=1, le=15)
    position: int | None = Field(default=None, ge=0)
    render_mode: Literal["image", "dom"] | None = None
    animation: StepAnimation | None = None


class DemoAuthorOut(BaseModel):
    id: str
    name: str = ""
    email: str


class DemoOut(BaseModel):
    id: str
    organization_id: str
    title: str
    description: str
    content_locale: Locale = "zh-CN"
    status: str
    created_at: datetime
    updated_at: datetime
    created_by: DemoAuthorOut
    steps: list[StepOut] = []
    thumbnail_url: str | None = None
    share_url: str | None = None
    theme: dict = Field(default_factory=dict)
    navigation: dict = Field(default_factory=dict)
    playback: dict = Field(default_factory=dict)
    manual_fields: list = Field(default_factory=list)
    ai_enabled: bool = False
    category_id: str | None = None
    tags: list[TagOut] = Field(default_factory=list)


class AdminResourceDetail(AdminResourceOut):
    demo: DemoOut


class RecordingStepMeta(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=5000)
    viewport_width: int = Field(gt=0, le=10000)
    viewport_height: int = Field(gt=0, le=10000)
    hotspot: Hotspot
    duration: float = Field(default=3, ge=1, le=15)
    ai_enabled: bool = True
    password_rect: Redaction | None = None


class RecordingDomMeta(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=5000)
    viewport_width: int = Field(gt=0, le=10000)
    viewport_height: int = Field(gt=0, le=10000)
    duration: float = Field(default=3, ge=1, le=15)
    ai_enabled: bool = True
    terminal: bool = False
    target: SelectorInfo | None = None
    hotspot: Hotspot | None = None
    page_context: dict = Field(default_factory=dict)
    scroll_state: dict = Field(default_factory=dict)
    password_rects: list[Redaction] = Field(default_factory=list)
    capture_warnings: list[str] = Field(default_factory=list)


class RecordingAuditInput(BaseModel):
    action: Literal["started", "paused", "resumed", "completed"]
    mode: Literal["html", "screenshot"] = "html"
    ai_enabled: bool = False
    step_count: int = Field(default=0, ge=0, le=100)


class ExportCreate(BaseModel):
    kind: Literal["pdf", "mp4", "markdown"]


class ExportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    status: str
    progress: int
    error: str | None
    error_code: str | None = None
    download_url: str | None = None
    created_at: datetime


class AIJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    demo_id: str
    step_id: str | None
    status: str
    progress: int
    model: str
    result: dict
    error: str | None
    error_code: str | None = None
    can_revert: bool = False
