"""Managed local and S3-compatible storage targets.

Revision ID: 0010_storage_management
Revises: 0009_ai_models_usage
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_storage_management"
down_revision = "0009_ai_models_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "storage_configs" not in set(sa.inspect(bind).get_table_names()):
        op.create_table(
            "storage_configs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("kind", sa.String(20), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("local_path", sa.String(1000), nullable=False, server_default=""),
            sa.Column("endpoint_url", sa.String(1000), nullable=False, server_default=""),
            sa.Column("region", sa.String(120), nullable=False, server_default=""),
            sa.Column("bucket", sa.String(255), nullable=False, server_default=""),
            sa.Column("access_key_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("secret_key_encrypted", sa.Text(), nullable=False, server_default=""),
            sa.Column("prefix", sa.String(500), nullable=False, server_default="docflow"),
            sa.Column("force_path_style", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("direct_download", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("public_base_url", sa.String(1000), nullable=False, server_default=""),
            sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    indexes = {item["name"] for item in sa.inspect(bind).get_indexes("storage_configs")}
    for column, unique in (("name", True), ("kind", False), ("enabled", False), ("is_default", False)):
        name = f"ix_storage_configs_{column}"
        if name not in indexes:
            op.create_index(name, "storage_configs", [column], unique=unique)


def downgrade() -> None:
    op.drop_table("storage_configs")
