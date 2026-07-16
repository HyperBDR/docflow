from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["info", "warning", "critical"]
HealthStatus = Literal["healthy", "warning", "critical", "unknown"]


class MonitoringServiceOut(BaseModel):
    key: str
    status: HealthStatus
    value: float = 0
    unit: str = ""
    message: str = ""
    metrics: dict = Field(default_factory=dict)
    collected_at: datetime | None = None


class MonitoringTrendPoint(BaseModel):
    collected_at: datetime
    requests: int = 0
    status_2xx: int = 0
    status_4xx: int = 0
    status_5xx: int = 0
    error_rate: float = 0
    avg_latency_ms: float = 0
    p95_latency_ms: float = 0
    queued_jobs: int = 0
    failed_jobs: int = 0
    ai_failure_rate: float = 0


class MonitoringOverview(BaseModel):
    overall_status: HealthStatus
    services: list[MonitoringServiceOut]
    api: dict = Field(default_factory=dict)
    jobs: dict = Field(default_factory=dict)
    storage: dict = Field(default_factory=dict)
    ai: dict = Field(default_factory=dict)
    active_alerts: dict[str, int] = Field(default_factory=dict)
    trend: list[MonitoringTrendPoint] = Field(default_factory=list)
    thresholds: dict[str, float] = Field(default_factory=dict)
    updated_at: datetime | None = None
    next_collection_at: datetime | None = None
    interval_seconds: int = 60
    collector_stale: bool = False


class AlertRuleInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    metric_key: str = Field(min_length=1, max_length=100)
    operator: Literal["gt", "gte", "lt", "lte", "eq"] = "gte"
    threshold: float
    severity: Severity = "warning"
    consecutive_periods: int = Field(default=2, ge=1, le=60)
    cooldown_minutes: int = Field(default=15, ge=1, le=1440)
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    operator: Literal["gt", "gte", "lt", "lte", "eq"] | None = None
    threshold: float | None = None
    severity: Severity | None = None
    consecutive_periods: int | None = Field(default=None, ge=1, le=60)
    cooldown_minutes: int | None = Field(default=None, ge=1, le=1440)
    enabled: bool | None = None


class AlertRuleOut(AlertRuleInput):
    model_config = ConfigDict(from_attributes=True)
    id: str
    built_in: bool
    failure_count: int
    last_value: float | None = None
    last_evaluated_at: datetime | None = None
    last_triggered_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AlertEventOut(BaseModel):
    id: str
    rule_id: str | None = None
    metric_key: str
    severity: Severity
    status: Literal["active", "acknowledged", "resolved"]
    title: str
    message: str
    current_value: float
    threshold: float
    started_at: datetime
    last_seen_at: datetime
    acknowledged_at: datetime | None = None
    acknowledged_by_name: str = ""
    resolved_at: datetime | None = None


class MetricHistoryPoint(BaseModel):
    collected_at: datetime
    status: HealthStatus
    values: dict[str, float] = Field(default_factory=dict)


class MonitoringMetricDetail(BaseModel):
    key: str
    snapshot_key: str
    category: str
    status: HealthStatus
    unit: str = ""
    summary: dict = Field(default_factory=dict)
    points: list[MetricHistoryPoint] = Field(default_factory=list)
    breakdown: list[dict] = Field(default_factory=list)
    alerts: list[AlertEventOut] = Field(default_factory=list)


class AlertEventPage(BaseModel):
    items: list[AlertEventOut]
    total: int
    page: int
    page_size: int


class NotificationChannelInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["webhook", "email"]
    target: str = Field(min_length=3, max_length=2000)
    minimum_severity: Severity = "warning"
    enabled: bool = True


class NotificationChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target: str | None = Field(default=None, min_length=3, max_length=2000)
    minimum_severity: Severity | None = None
    enabled: bool | None = None


class NotificationChannelOut(BaseModel):
    id: str
    name: str
    kind: Literal["webhook", "email"]
    target_masked: str
    target_configured: bool
    minimum_severity: Severity
    enabled: bool
    last_status: str
    last_error: str
    last_sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class MetricDefinition(BaseModel):
    key: str
    unit: str
    recommended_operator: str
    recommended_threshold: float
