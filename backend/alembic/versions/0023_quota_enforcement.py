"""reserve quota for asynchronous AI work

Revision ID: 0023_quota_enforcement
Revises: 0022_in_app_notifications
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_quota_enforcement"
down_revision = "0022_in_app_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    export_columns = {column["name"] for column in inspector.get_columns("export_jobs")}
    ai_columns = {column["name"] for column in inspector.get_columns("ai_jobs")}
    if "quota_reserved_bytes" not in export_columns:
        op.add_column("export_jobs", sa.Column("quota_reserved_bytes", sa.Integer(), nullable=False, server_default="0"))
    if "quota_reserved_tokens" not in ai_columns:
        op.add_column("ai_jobs", sa.Column("quota_reserved_tokens", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "quota_reserved_tokens" in {column["name"] for column in inspector.get_columns("ai_jobs")}:
        op.drop_column("ai_jobs", "quota_reserved_tokens")
    if "quota_reserved_bytes" in {column["name"] for column in inspector.get_columns("export_jobs")}:
        op.drop_column("export_jobs", "quota_reserved_bytes")
