from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str


class AuthInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class Hotspot(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(default=0.04, ge=0, le=1)
    h: float = Field(default=0.04, ge=0, le=1)


class Redaction(Hotspot):
    pass


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


class DemoCreate(BaseModel):
    title: str = Field(default="未命名演示", min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)


class DemoUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)


class StepUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body: str | None = Field(default=None, max_length=5000)
    hotspot: Hotspot | None = None
    redactions: list[Redaction] | None = None
    duration: float | None = Field(default=None, ge=1, le=15)
    position: int | None = Field(default=None, ge=0)


class DemoOut(BaseModel):
    id: str
    title: str
    description: str
    status: str
    created_at: datetime
    updated_at: datetime
    steps: list[StepOut] = []
    share_url: str | None = None


class RecordingStepMeta(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=5000)
    viewport_width: int = Field(gt=0, le=10000)
    viewport_height: int = Field(gt=0, le=10000)
    hotspot: Hotspot
    duration: float = Field(default=3, ge=1, le=15)
    password_rect: Redaction | None = None


class ExportCreate(BaseModel):
    kind: Literal["pdf", "mp4", "markdown"]


class ExportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    status: str
    progress: int
    error: str | None
    download_url: str | None = None

