"""Platform monitoring, alert rules, events, and notification channels.

Revision ID: 0014_monitoring_alerts
Revises: 0013_persist_legacy_hotspots
"""
from alembic import op
import sqlalchemy as sa


revision = "0014_monitoring_alerts"
down_revision = "0013_persist_legacy_hotspots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Revision 0001 creates the current metadata on brand-new databases. In
    # that path these tables already exist by the time Alembic reaches 0014;
    # upgraded installations still need the explicit DDL below.
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if {"monitoring_snapshots", "alert_rules", "alert_events", "notification_channels"}.issubset(existing):
        return
    op.create_table(
        "monitoring_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("metric_key", sa.String(100), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(30), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_monitoring_snapshots_category", "monitoring_snapshots", ["category"])
    op.create_index("ix_monitoring_snapshots_metric_key", "monitoring_snapshots", ["metric_key"])
    op.create_index("ix_monitoring_snapshots_status", "monitoring_snapshots", ["status"])
    op.create_index("ix_monitoring_snapshots_collected_at", "monitoring_snapshots", ["collected_at"])
    op.create_index("ix_monitoring_snapshot_key_collected", "monitoring_snapshots", ["metric_key", "collected_at"])

    op.create_table(
        "alert_rules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("metric_key", sa.String(100), nullable=False),
        sa.Column("operator", sa.String(8), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("consecutive_periods", sa.Integer(), nullable=False),
        sa.Column("cooldown_minutes", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("built_in", sa.Boolean(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    for name in ["metric_key", "severity", "enabled"]:
        op.create_index(f"ix_alert_rules_{name}", "alert_rules", [name])

    op.create_table(
        "alert_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("rule_id", sa.String(36), sa.ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metric_key", sa.String(100), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("message", sa.String(1000), nullable=False),
        sa.Column("current_value", sa.Float(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    for name in ["rule_id", "metric_key", "severity", "status", "started_at"]:
        op.create_index(f"ix_alert_events_{name}", "alert_events", [name])
    op.create_index("ix_alert_event_status_started", "alert_events", ["status", "started_at"])

    op.create_table(
        "notification_channels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("target_encrypted", sa.Text(), nullable=False),
        sa.Column("minimum_severity", sa.String(20), nullable=False),
        sa.Column("last_status", sa.String(20), nullable=False),
        sa.Column("last_error", sa.String(500), nullable=False),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notification_channels_kind", "notification_channels", ["kind"])
    op.create_index("ix_notification_channels_enabled", "notification_channels", ["enabled"])


def downgrade() -> None:
    op.drop_table("notification_channels")
    op.drop_table("alert_events")
    op.drop_table("alert_rules")
    op.drop_table("monitoring_snapshots")
