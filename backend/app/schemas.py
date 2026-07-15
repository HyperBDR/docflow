from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl

Locale = Literal["zh-CN", "en"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    ui_locale: Locale = "zh-CN"


class AuthInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    ui_locale: Locale | None = None


class UserPreferenceUpdate(BaseModel):
    ui_locale: Locale


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


class DemoOut(BaseModel):
    id: str
    title: str
    description: str
    content_locale: Locale = "zh-CN"
    status: str
    created_at: datetime
    updated_at: datetime
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
