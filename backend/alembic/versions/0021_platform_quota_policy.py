"""Platform-wide quota safety limits.

Revision ID: 0021_platform_quota_policy
Revises: 0020_quota_usage_snapshots
"""
from alembic import op
import sqlalchemy as sa


revision = "0021_platform_quota_policy"
down_revision = "0020_quota_usage_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "platform_quota_policies" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "platform_quota_policies",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("maximums", sa.JSON(), nullable=False),
        sa.Column("allow_unlimited", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("platform_quota_policies")
