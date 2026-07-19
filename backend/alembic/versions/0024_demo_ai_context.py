"""store demo context for AI generation

Revision ID: 0024_demo_ai_context
Revises: 0023_quota_enforcement
"""

from alembic import op
import sqlalchemy as sa


revision = "0024_demo_ai_context"
down_revision = "0023_quota_enforcement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_context" not in {column["name"] for column in inspector.get_columns("demos")}:
        op.add_column("demos", sa.Column("ai_context", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_context" in {column["name"] for column in inspector.get_columns("demos")}:
        op.drop_column("demos", "ai_context")
