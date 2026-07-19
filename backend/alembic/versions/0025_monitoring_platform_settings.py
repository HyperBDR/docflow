"""Runtime monitoring and quota collection settings.

Revision ID: 0025_monitoring_settings
Revises: 0024_demo_ai_context
"""
from alembic import op
import sqlalchemy as sa


revision = "0025_monitoring_settings"
down_revision = "0024_demo_ai_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "monitoring_platform_settings" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "monitoring_platform_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("monitoring_interval_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("quota_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("quota_interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("retention_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("raw_ranges", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("monitoring_platform_settings")
