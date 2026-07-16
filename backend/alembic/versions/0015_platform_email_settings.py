"""Database-backed platform email settings.

Revision ID: 0015_platform_email_settings
Revises: 0014_monitoring_alerts
"""
from alembic import op
import sqlalchemy as sa


revision = "0015_platform_email_settings"
down_revision = "0014_monitoring_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "email_platform_settings" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "email_platform_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("host", sa.String(320), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(320), nullable=False),
        sa.Column("password_encrypted", sa.Text(), nullable=False),
        sa.Column("from_email", sa.String(320), nullable=False),
        sa.Column("from_name", sa.String(160), nullable=False),
        sa.Column("security", sa.String(20), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("email_platform_settings")
