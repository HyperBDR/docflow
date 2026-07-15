"""Account UI locale, demo content locale, and localized job errors.

Revision ID: 0005_internationalization
Revises: 0004_library_analytics_comments
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_internationalization"
down_revision = "0004_library_analytics_comments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {table: {item["name"] for item in inspector.get_columns(table)} for table in ("users", "demos", "export_jobs", "ai_jobs")}
    if "ui_locale" not in columns["users"]:
        op.add_column("users", sa.Column("ui_locale", sa.String(10), nullable=False, server_default="zh-CN"))
    if "content_locale" not in columns["demos"]:
        op.add_column("demos", sa.Column("content_locale", sa.String(10), nullable=False, server_default="zh-CN"))
    if "error_code" not in columns["export_jobs"]:
        op.add_column("export_jobs", sa.Column("error_code", sa.String(100), nullable=True))
    if "error_code" not in columns["ai_jobs"]:
        op.add_column("ai_jobs", sa.Column("error_code", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_jobs", "error_code")
    op.drop_column("export_jobs", "error_code")
    op.drop_column("demos", "content_locale")
    op.drop_column("users", "ui_locale")
