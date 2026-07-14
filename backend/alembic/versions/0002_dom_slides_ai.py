"""DOM slides, hotspots and AI jobs.

Revision ID: 0002_dom_slides_ai
Revises: 0001_initial
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_dom_slides_ai"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _json_default(value: str) -> sa.TextClause:
    return sa.text(f"'{value}'")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    demo_columns = {item["name"] for item in inspector.get_columns("demos")}
    step_columns = {item["name"] for item in inspector.get_columns("steps")}
    tables = set(inspector.get_table_names())

    if "theme" not in demo_columns:
        op.add_column("demos", sa.Column("theme", sa.JSON(), nullable=False, server_default=_json_default("{}")))
    if "navigation" not in demo_columns:
        op.add_column("demos", sa.Column("navigation", sa.JSON(), nullable=False, server_default=_json_default("{}")))
    if "manual_fields" not in demo_columns:
        op.add_column("demos", sa.Column("manual_fields", sa.JSON(), nullable=False, server_default=_json_default("[]")))

    step_additions = [
        ("render_mode", sa.Column("render_mode", sa.String(length=20), nullable=False, server_default="image")),
        ("dom_snapshot_key", sa.Column("dom_snapshot_key", sa.String(length=500), nullable=True)),
        ("page_context", sa.Column("page_context", sa.JSON(), nullable=False, server_default=_json_default("{}"))),
        ("scroll_state", sa.Column("scroll_state", sa.JSON(), nullable=False, server_default=_json_default("{}"))),
        ("capture_warnings", sa.Column("capture_warnings", sa.JSON(), nullable=False, server_default=_json_default("[]"))),
        ("manual_fields", sa.Column("manual_fields", sa.JSON(), nullable=False, server_default=_json_default("[]"))),
        ("ai_metadata", sa.Column("ai_metadata", sa.JSON(), nullable=False, server_default=_json_default("{}"))),
    ]
    for name, column in step_additions:
        if name not in step_columns:
            op.add_column("steps", column)

    if "hotspots" not in tables:
        op.create_table(
        "hotspots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("step_id", sa.String(length=36), sa.ForeignKey("steps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("selector", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("fallback_rect", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("trigger", sa.String(length=20), nullable=False, server_default="click"),
        sa.Column("action", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("tooltip", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("style", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("manual_fields", sa.JSON(), nullable=False, server_default=_json_default("[]")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_hotspots_step_id", "hotspots", ["step_id"])

    if "ai_jobs" not in tables:
        status_type = (
            postgresql.ENUM("queued", "running", "complete", "failed", name="jobstatus", create_type=False)
            if bind.dialect.name == "postgresql" else sa.Enum("queued", "running", "complete", "failed", name="jobstatus")
        )
        op.create_table(
        "ai_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("owner_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("demo_id", sa.String(length=36), sa.ForeignKey("demos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(length=36), sa.ForeignKey("steps.id", ondelete="CASCADE"), nullable=True),
        sa.Column("status", status_type, nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("result", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("applied_patch", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("inverse_patch", sa.JSON(), nullable=False, server_default=_json_default("{}")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_ai_jobs_owner_id", "ai_jobs", ["owner_id"])
        op.create_index("ix_ai_jobs_demo_id", "ai_jobs", ["demo_id"])

    steps = sa.table("steps", sa.column("id", sa.String()), sa.column("hotspot", sa.JSON()))
    hotspots = sa.table(
        "hotspots",
        sa.column("id", sa.String()), sa.column("step_id", sa.String()), sa.column("position", sa.Integer()),
        sa.column("selector", sa.JSON()), sa.column("fallback_rect", sa.JSON()), sa.column("trigger", sa.String()),
        sa.column("action", sa.JSON()), sa.column("tooltip", sa.JSON()), sa.column("style", sa.JSON()),
        sa.column("manual_fields", sa.JSON()), sa.column("created_at", sa.DateTime(timezone=True)),
    )
    now = sa.func.now()
    for row in bind.execute(sa.select(steps.c.id, steps.c.hotspot)):
        exists = bind.execute(sa.select(sa.func.count()).select_from(hotspots).where(hotspots.c.step_id == row.id)).scalar()
        if row.hotspot and not exists:
            bind.execute(hotspots.insert().values(
                id=str(uuid.uuid4()), step_id=row.id, position=0, selector={}, fallback_rect=row.hotspot,
                trigger="click", action={"type": "next"}, tooltip={"content": "", "placement": "auto"},
                style={}, manual_fields=[], created_at=now,
            ))


def downgrade() -> None:
    op.drop_table("ai_jobs")
    op.drop_table("hotspots")
    for column in ["ai_metadata", "manual_fields", "capture_warnings", "scroll_state", "page_context", "dom_snapshot_key", "render_mode"]:
        op.drop_column("steps", column)
    for column in ["manual_fields", "navigation", "theme"]:
        op.drop_column("demos", column)
