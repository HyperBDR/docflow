"""runtime-configurable extension capture feedback

Revision ID: 0029_extension_capture_settings
Revises: 0028_extension_releases
"""

from alembic import op
import sqlalchemy as sa


revision = "0029_extension_capture_settings"
down_revision = "0028_extension_releases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "extension_capture_settings" in inspector.get_table_names():
        return
    op.create_table(
        "extension_capture_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("feedback_duration_ms", sa.Integer(), nullable=False, server_default="1100"),
        sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    if "extension_capture_settings" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("extension_capture_settings")
