"""AI runtime governance, encrypted credentials, and audit dimensions.

Revision ID: 0011_ai_governance_audit
Revises: 0010_storage_management
"""
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

from app.secrets import encrypt_secret

revision = "0011_ai_governance_audit"
down_revision = "0010_storage_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_platform_settings" not in tables:
        op.create_table(
            "ai_platform_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("chunk_size", sa.Integer(), nullable=False, server_default="8"),
            sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        enabled = bool(bind.execute(sa.text("SELECT COUNT(*) FROM ai_model_configs WHERE enabled = true")).scalar()) if "ai_model_configs" in tables else False
        now = datetime.now(timezone.utc)
        bind.execute(sa.text(
            "INSERT INTO ai_platform_settings (id, enabled, chunk_size, created_at, updated_at) "
            "VALUES (:id, :enabled, :chunk_size, :created_at, :updated_at)"
        ), {"id": "global", "enabled": enabled, "chunk_size": 8, "created_at": now, "updated_at": now})

    if "ai_model_configs" in tables:
        columns = {item["name"] for item in sa.inspect(bind).get_columns("ai_model_configs")}
        if "api_key_encrypted" not in columns:
            op.add_column("ai_model_configs", sa.Column("api_key_encrypted", sa.Text(), nullable=False, server_default=""))
            if "api_key" in columns:
                rows = bind.execute(sa.text("SELECT id, api_key FROM ai_model_configs")).mappings().all()
                for row in rows:
                    bind.execute(sa.text(
                        "UPDATE ai_model_configs SET api_key_encrypted = :value WHERE id = :id"
                    ), {"id": row["id"], "value": encrypt_secret(row["api_key"] or "")})
                op.drop_column("ai_model_configs", "api_key")

    if "audit_logs" in tables:
        columns = {item["name"] for item in sa.inspect(bind).get_columns("audit_logs")}
        if "source" not in columns:
            op.add_column("audit_logs", sa.Column("source", sa.String(30), nullable=False, server_default="web"))
            op.create_index("ix_audit_logs_source", "audit_logs", ["source"])
        if "outcome" not in columns:
            op.add_column("audit_logs", sa.Column("outcome", sa.String(20), nullable=False, server_default="success"))
            op.create_index("ix_audit_logs_outcome", "audit_logs", ["outcome"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "audit_logs" in tables:
        columns = {item["name"] for item in sa.inspect(bind).get_columns("audit_logs")}
        if "outcome" in columns:
            op.drop_index("ix_audit_logs_outcome", table_name="audit_logs")
            op.drop_column("audit_logs", "outcome")
        if "source" in columns:
            op.drop_index("ix_audit_logs_source", table_name="audit_logs")
            op.drop_column("audit_logs", "source")
    if "ai_model_configs" in tables:
        columns = {item["name"] for item in sa.inspect(bind).get_columns("ai_model_configs")}
        if "api_key_encrypted" in columns:
            op.add_column("ai_model_configs", sa.Column("api_key", sa.Text(), nullable=False, server_default=""))
            op.drop_column("ai_model_configs", "api_key_encrypted")
    if "ai_platform_settings" in tables:
        op.drop_table("ai_platform_settings")
