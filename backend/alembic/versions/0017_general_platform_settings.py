"""General public platform settings.

Revision ID: 0017_general_platform_settings
Revises: 0016_google_oidc
"""
from alembic import op
import sqlalchemy as sa


revision = "0017_general_platform_settings"
down_revision = "0016_google_oidc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "general_platform_settings" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "general_platform_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("help_url", sa.String(1000), nullable=False),
            sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("general_platform_settings")
