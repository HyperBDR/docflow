"""Persist legacy screenshot hotspots.

Revision ID: 0013_persist_legacy_hotspots
Revises: 0012_task_center
"""
import uuid

from alembic import op
import sqlalchemy as sa


revision = "0013_persist_legacy_hotspots"
down_revision = "0012_task_center"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    steps = sa.table(
        "steps",
        sa.column("id", sa.String()),
        sa.column("body", sa.Text()),
        sa.column("hotspot", sa.JSON()),
    )
    hotspots = sa.table(
        "hotspots",
        sa.column("id", sa.String()),
        sa.column("step_id", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("selector", sa.JSON()),
        sa.column("fallback_rect", sa.JSON()),
        sa.column("trigger", sa.String()),
        sa.column("action", sa.JSON()),
        sa.column("tooltip", sa.JSON()),
        sa.column("style", sa.JSON()),
        sa.column("manual_fields", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    for row in bind.execute(sa.select(steps.c.id, steps.c.body, steps.c.hotspot)):
        exists = bind.execute(sa.select(sa.func.count()).select_from(hotspots).where(hotspots.c.step_id == row.id)).scalar()
        if row.hotspot and not exists:
            bind.execute(hotspots.insert().values(
                id=str(uuid.uuid4()),
                step_id=row.id,
                position=0,
                selector={},
                fallback_rect=row.hotspot,
                trigger="click",
                action={"type": "next"},
                tooltip={"content": row.body or "", "placement": "auto", "alignment": "center", "offset": 12, "max_width": 320, "show_arrow": True},
                style={"shape": "rectangle", "pulse": True, "spotlight": False, "padding": 6, "color": "#635bff", "overlay_opacity": 0.45},
                manual_fields=[],
                created_at=sa.func.now(),
            ))


def downgrade() -> None:
    # This is a data repair. Removing rows on downgrade could delete hotspots
    # that users edited after the migration was applied.
    pass
