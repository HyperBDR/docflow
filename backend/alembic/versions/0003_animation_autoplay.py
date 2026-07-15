"""Step animation and demo autoplay settings.

Revision ID: 0003_animation_autoplay
Revises: 0002_dom_slides_ai
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_animation_autoplay"
down_revision = "0002_dom_slides_ai"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    demo_columns = {item["name"] for item in inspector.get_columns("demos")}
    step_columns = {item["name"] for item in inspector.get_columns("steps")}
    if "playback" not in demo_columns:
        op.add_column("demos", sa.Column("playback", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "animation" not in step_columns:
        op.add_column("steps", sa.Column("animation", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("steps", "animation")
    op.drop_column("demos", "playback")
