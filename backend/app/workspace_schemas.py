from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class WorkspaceTrendPoint(BaseModel):
    date: str
    resources: int = 0
    views: int = 0
    ai_tokens: int = 0
    jobs: int = 0


class WorkspaceResourceSummary(BaseModel):
    id: str
    title: str
    status: Literal["draft", "published"]
    step_count: int = 0
    views: int = 0
    updated_at: datetime


class WorkspaceJobItem(BaseModel):
    id: str
    job_type: Literal["ai", "export"]
    kind: str
    status: Literal["queued", "running", "complete", "failed", "cancelled"]
    progress: int = 0
    resource_id: str
    resource_title: str = ""
    owner_name: str = ""
    error_code: str | None = None
    created_at: datetime
    updated_at: datetime
    download_url: str | None = None


class WorkspaceJobPage(BaseModel):
    items: list[WorkspaceJobItem]
    total: int
    page: int
    page_size: int
    summary: dict[str, int] = Field(default_factory=dict)


class WorkspaceOverview(BaseModel):
    organization_id: str
    organization_name: str
    organization_kind: Literal["personal", "team"]
    member_count: int = 0
    resources: int = 0
    draft_resources: int = 0
    published_resources: int = 0
    steps: int = 0
    storage_bytes: int = 0
    views: int = 0
    unique_viewers: int = 0
    exports: int = 0
    ai_requests: int = 0
    ai_tokens: int = 0
    failed_jobs: int = 0
    active_jobs: int = 0
    job_summary: dict[str, int] = Field(default_factory=dict)
    trend: list[WorkspaceTrendPoint] = Field(default_factory=list)
    recent_resources: list[WorkspaceResourceSummary] = Field(default_factory=list)
    recent_jobs: list[WorkspaceJobItem] = Field(default_factory=list)
