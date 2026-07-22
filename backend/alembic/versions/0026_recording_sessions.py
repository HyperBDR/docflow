"""transactional recording sessions

Revision ID: 0026_recording_sessions
Revises: 0025_monitoring_settings
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_recording_sessions"
down_revision = "0025_monitoring_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "recording_sessions" not in tables:
        op.create_table(
            "recording_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="SET NULL"), nullable=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("mode", sa.String(20), nullable=False, server_default="html"),
            sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("auto_created", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("original_settings", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_recording_sessions_demo_id", "recording_sessions", ["demo_id"])
        op.create_index("ix_recording_sessions_organization_id", "recording_sessions", ["organization_id"])
        op.create_index("ix_recording_sessions_owner_id", "recording_sessions", ["owner_id"])
        op.create_index("ix_recording_sessions_status", "recording_sessions", ["status"])
        op.create_index("ix_recording_sessions_created_at", "recording_sessions", ["created_at"])
    step_columns = {column["name"] for column in inspector.get_columns("steps")}
    if "recording_session_id" not in step_columns:
        op.add_column("steps", sa.Column("recording_session_id", sa.String(36), nullable=True))
        op.create_foreign_key(
            "fk_steps_recording_session", "steps", "recording_sessions",
            ["recording_session_id"], ["id"], ondelete="SET NULL",
        )
        op.create_index("ix_steps_recording_session_id", "steps", ["recording_session_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "steps" in inspector.get_table_names() and "recording_session_id" in {column["name"] for column in inspector.get_columns("steps")}:
        op.drop_index("ix_steps_recording_session_id", table_name="steps")
        op.drop_constraint("fk_steps_recording_session", "steps", type_="foreignkey")
        op.drop_column("steps", "recording_session_id")
    if "recording_sessions" in inspector.get_table_names():
        op.drop_table("recording_sessions")
