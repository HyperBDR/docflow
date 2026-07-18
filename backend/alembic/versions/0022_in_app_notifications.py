"""In-app notifications and the public upgrade link.

Revision ID: 0022_in_app_notifications
Revises: 0021_platform_quota_policy
"""
from alembic import op
import sqlalchemy as sa


revision = "0022_in_app_notifications"
down_revision = "0021_platform_quota_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()
    if "upgrade_url" not in {column["name"] for column in inspector.get_columns("general_platform_settings")}:
        op.add_column("general_platform_settings", sa.Column("upgrade_url", sa.String(1000), nullable=False, server_default=""))
    if "in_app_notifications" not in tables:
        op.create_table(
            "in_app_notifications",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("recipient_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
            sa.Column("scope", sa.String(20), nullable=False),
            sa.Column("category", sa.String(30), nullable=False),
            sa.Column("severity", sa.String(20), nullable=False),
            sa.Column("event_type", sa.String(80), nullable=False),
            sa.Column("title", sa.String(240), nullable=False),
            sa.Column("message", sa.String(1000), nullable=False),
            sa.Column("action_url", sa.String(1000), nullable=False),
            sa.Column("notification_data", sa.JSON(), nullable=False),
            sa.Column("dedupe_key", sa.String(240), nullable=True),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("recipient_id", "scope", "dedupe_key", name="uq_in_app_notification_dedupe"),
        )
        op.create_index("ix_in_app_notifications_recipient_id", "in_app_notifications", ["recipient_id"])
        op.create_index("ix_in_app_notifications_organization_id", "in_app_notifications", ["organization_id"])
        op.create_index("ix_in_app_notifications_scope", "in_app_notifications", ["scope"])
        op.create_index("ix_in_app_notifications_category", "in_app_notifications", ["category"])
        op.create_index("ix_in_app_notifications_severity", "in_app_notifications", ["severity"])
        op.create_index("ix_in_app_notifications_event_type", "in_app_notifications", ["event_type"])
        op.create_index("ix_in_app_notifications_read_at", "in_app_notifications", ["read_at"])
        op.create_index("ix_in_app_notifications_expires_at", "in_app_notifications", ["expires_at"])
        op.create_index("ix_in_app_notifications_created_at", "in_app_notifications", ["created_at"])
        op.create_index("ix_in_app_notification_recipient_scope_created", "in_app_notifications", ["recipient_id", "scope", "created_at"])


def downgrade() -> None:
    op.drop_table("in_app_notifications")
    op.drop_column("general_platform_settings", "upgrade_url")
