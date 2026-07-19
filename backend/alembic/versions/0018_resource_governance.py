"""Resource sharing and download governance.

Revision ID: 0018_resource_governance
Revises: 0017_general_platform_settings
"""
from alembic import op
import sqlalchemy as sa


revision = "0018_resource_governance"
down_revision = "0017_general_platform_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("share_tokens")}
    additions = {
        "name": sa.Column("name", sa.String(160), nullable=False, server_default=""),
        "created_by_id": sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        "password_hash": sa.Column("password_hash", sa.String(255), nullable=True),
        "expires_at": sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        "access_count": sa.Column("access_count", sa.Integer(), nullable=False, server_default="0"),
        "last_accessed_at": sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("share_tokens", column)
    share_indexes = {item["name"] for item in inspector.get_indexes("share_tokens")}
    for name in ("created_by_id", "expires_at"):
        index_name = f"ix_share_tokens_{name}"
        if index_name not in share_indexes:
            op.create_index(index_name, "share_tokens", [name], if_not_exists=True)

    analytics_columns = {item["name"] for item in inspector.get_columns("analytics_events")}
    for name, length in (("referrer", 1000), ("referrer_host", 255), ("utm_source", 160), ("utm_medium", 160), ("utm_campaign", 200), ("utm_content", 200), ("utm_term", 200)):
        if name not in analytics_columns:
            op.add_column("analytics_events", sa.Column(name, sa.String(length), nullable=False, server_default=""))
    for name in ("referrer_host", "utm_source"):
        op.create_index(f"ix_analytics_events_{name}", "analytics_events", [name], if_not_exists=True)

    export_columns = {item["name"] for item in inspector.get_columns("export_jobs")}
    if "result_size" not in export_columns:
        op.add_column("export_jobs", sa.Column("result_size", sa.Integer(), nullable=False, server_default="0"))

    if "export_download_events" not in inspector.get_table_names():
        op.create_table(
            "export_download_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("export_job_id", sa.String(36), sa.ForeignKey("export_jobs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="CASCADE"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("requested_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("request_id", sa.String(64), nullable=False, unique=True),
            sa.Column("external_id", sa.String(255), nullable=True, unique=True),
            sa.Column("source", sa.String(30), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("bytes_transferred", sa.Integer(), nullable=False),
            sa.Column("ip_address", sa.String(80), nullable=False),
            sa.Column("user_agent", sa.String(1000), nullable=False),
            sa.Column("referrer", sa.String(1000), nullable=False),
            sa.Column("country", sa.String(100), nullable=False),
            sa.Column("event_metadata", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        for name in ("export_job_id", "demo_id", "organization_id", "requested_by_id", "request_id", "source", "status", "created_at"):
            op.create_index(f"ix_export_download_events_{name}", "export_download_events", [name], if_not_exists=True)
        op.create_index("ix_export_download_demo_created", "export_download_events", ["demo_id", "created_at"], if_not_exists=True)
        op.create_index("ix_export_download_job_created", "export_download_events", ["export_job_id", "created_at"], if_not_exists=True)


def downgrade() -> None:
    op.drop_table("export_download_events")
    op.drop_column("export_jobs", "result_size")
    for name in ("utm_term", "utm_content", "utm_campaign", "utm_medium", "utm_source", "referrer_host", "referrer"):
        op.drop_column("analytics_events", name)
    for name in ("last_accessed_at", "access_count", "expires_at", "password_hash", "created_by_id", "name"):
        op.drop_column("share_tokens", name)
