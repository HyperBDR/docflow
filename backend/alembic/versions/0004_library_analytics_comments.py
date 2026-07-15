"""Library categories, tags, analytics and step comments.

Revision ID: 0004_library_analytics_comments
Revises: 0003_animation_autoplay
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_library_analytics_comments"
down_revision = "0003_animation_autoplay"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The original baseline migration builds the current SQLAlchemy metadata.
    # On a brand-new database these objects therefore already exist by the
    # time this historical migration runs; keep the migration replay-safe.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    demo_columns = {item["name"] for item in inspector.get_columns("demos")}
    if {"categories", "tags", "demo_tags", "analytics_events", "step_comments"}.issubset(tables) and "category_id" in demo_columns:
        return
    op.create_table(
        "categories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(32), nullable=False, server_default="#635bff"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "parent_id", "name", name="uq_category_owner_parent_name"),
    )
    op.create_index("ix_categories_owner_id", "categories", ["owner_id"])
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])
    op.add_column("demos", sa.Column("category_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_demos_category_id", "demos", "categories", ["category_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_demos_category_id", "demos", ["category_id"])

    op.create_table(
        "tags",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("color", sa.String(32), nullable=False, server_default="#635bff"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_id", "name", name="uq_tag_owner_name"),
    )
    op.create_index("ix_tags_owner_id", "tags", ["owner_id"])
    op.create_table(
        "demo_tags",
        sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.String(36), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "analytics_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("share_id", sa.String(36), sa.ForeignKey("share_tokens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_id", sa.String(36), sa.ForeignKey("published_revisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(36), nullable=True),
        sa.Column("visitor_id", sa.String(80), nullable=False),
        sa.Column("session_id", sa.String(80), nullable=False),
        sa.Column("event_type", sa.String(24), nullable=False),
        sa.Column("operating_system", sa.String(80), nullable=False, server_default=""),
        sa.Column("browser", sa.String(80), nullable=False, server_default=""),
        sa.Column("device", sa.String(40), nullable=False, server_default=""),
        sa.Column("country", sa.String(100), nullable=False, server_default=""),
        sa.Column("region", sa.String(100), nullable=False, server_default=""),
        sa.Column("city", sa.String(100), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(1000), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("share_id", "demo_id", "revision_id", "step_id", "visitor_id", "session_id", "event_type", "created_at"):
        op.create_index(f"ix_analytics_events_{column}", "analytics_events", [column])

    op.create_table(
        "step_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("share_id", sa.String(36), sa.ForeignKey("share_tokens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_id", sa.String(36), sa.ForeignKey("published_revisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(36), nullable=False),
        sa.Column("visitor_id", sa.String(80), nullable=False, server_default=""),
        sa.Column("author_name", sa.String(100), nullable=False, server_default="访客"),
        sa.Column("author_email", sa.String(320), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="published"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for column in ("share_id", "demo_id", "revision_id", "step_id", "status"):
        op.create_index(f"ix_step_comments_{column}", "step_comments", [column])


def downgrade() -> None:
    op.drop_table("step_comments")
    op.drop_table("analytics_events")
    op.drop_table("demo_tags")
    op.drop_table("tags")
    op.drop_index("ix_demos_category_id", table_name="demos")
    op.drop_constraint("fk_demos_category_id", "demos", type_="foreignkey")
    op.drop_column("demos", "category_id")
    op.drop_table("categories")
