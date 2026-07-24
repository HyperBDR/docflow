"""Add page-local hotspot playback mode.

Revision ID: 0027_step_hotspot_mode
Revises: 0026_recording_sessions
"""

from alembic import op
import sqlalchemy as sa


revision = "0027_step_hotspot_mode"
down_revision = "0026_recording_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "hotspot_mode" not in {column["name"] for column in inspector.get_columns("steps")}:
        op.add_column(
            "steps",
            sa.Column("hotspot_mode", sa.String(20), nullable=False, server_default="independent"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "hotspot_mode" in {column["name"] for column in inspector.get_columns("steps")}:
        op.drop_column("steps", "hotspot_mode")
