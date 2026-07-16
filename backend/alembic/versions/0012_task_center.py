"""Unified task center, cancellation, retry lineage, and lifecycle timestamps.

Revision ID: 0012_task_center
Revises: 0011_ai_governance_audit
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_task_center"
down_revision = "0011_ai_governance_audit"
branch_labels = None
depends_on = None


def _add_job_columns(table: str) -> None:
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}
    with op.batch_alter_table(table) as batch:
        if "retry_of_id" not in columns:
            batch.add_column(sa.Column("retry_of_id", sa.String(36), nullable=True))
            batch.create_foreign_key(f"fk_{table}_retry_of", table, ["retry_of_id"], ["id"], ondelete="SET NULL")
            batch.create_index(f"ix_{table}_retry_of_id", ["retry_of_id"])
        if "cancelled_by_id" not in columns:
            batch.add_column(sa.Column("cancelled_by_id", sa.String(36), nullable=True))
            batch.create_foreign_key(f"fk_{table}_cancelled_by", "users", ["cancelled_by_id"], ["id"], ondelete="SET NULL")
        for name in ["started_at", "completed_at", "cancelled_at"]:
            if name not in columns:
                batch.add_column(sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
    index_name = f"ix_{table}_status_created"
    if index_name not in indexes:
        op.create_index(index_name, table, ["status", "created_at"])


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'cancelled'")
    tables = set(sa.inspect(bind).get_table_names())
    for table in ["export_jobs", "ai_jobs"]:
        if table in tables:
            _add_job_columns(table)


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ["export_jobs", "ai_jobs"]:
        if table not in tables:
            continue
        indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes(table)}
        index_name = f"ix_{table}_status_created"
        if index_name in indexes:
            op.drop_index(index_name, table_name=table)
        columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "retry_of_id" in columns:
                batch.drop_index(f"ix_{table}_retry_of_id")
                batch.drop_constraint(f"fk_{table}_retry_of", type_="foreignkey")
            if "cancelled_by_id" in columns:
                batch.drop_constraint(f"fk_{table}_cancelled_by", type_="foreignkey")
            for name in ["cancelled_at", "completed_at", "started_at", "cancelled_by_id", "retry_of_id"]:
                if name in columns:
                    batch.drop_column(name)
    # PostgreSQL enum values are intentionally retained; removing a value safely
    # requires rebuilding both job columns and is destructive for cancelled rows.
