"""Daily workspace quota usage snapshots.

Revision ID: 0020_quota_usage_snapshots
Revises: 0019_workspace_quotas
"""
from alembic import op
import sqlalchemy as sa


revision = "0020_quota_usage_snapshots"
down_revision = "0019_workspace_quotas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "quota_usage_snapshots" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "quota_usage_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric_key", sa.String(60), nullable=False),
        sa.Column("used", sa.BigInteger(), nullable=False),
        sa.Column("limit", sa.BigInteger(), nullable=True),
        sa.Column("usage_percent", sa.Float(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "metric_key", "snapshot_date", name="uq_quota_usage_snapshot_daily"),
    )
    op.create_index("ix_quota_usage_snapshots_organization_id", "quota_usage_snapshots", ["organization_id"])
    op.create_index("ix_quota_usage_snapshots_metric_key", "quota_usage_snapshots", ["metric_key"])
    op.create_index("ix_quota_usage_snapshots_snapshot_date", "quota_usage_snapshots", ["snapshot_date"])
    op.create_index("ix_quota_usage_snapshots_collected_at", "quota_usage_snapshots", ["collected_at"])
    op.create_index("ix_quota_usage_snapshot_metric_date", "quota_usage_snapshots", ["metric_key", "snapshot_date"])


def downgrade() -> None:
    op.drop_table("quota_usage_snapshots")
