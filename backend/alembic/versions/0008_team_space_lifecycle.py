"""Team-space kinds, lifecycle, and session-scoped context.

Revision ID: 0008_team_space_lifecycle
Revises: 0007_organizations_audit_recycle
"""
import re
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0008_team_space_lifecycle"
down_revision = "0007_organizations_audit_recycle"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(bind).get_columns(table)}


def _indexes(bind, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    organization_columns = _columns(bind, "organizations")
    additions = [
        sa.Column("kind", sa.String(20), nullable=False, server_default="team"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("personal_owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scheduled_purge_at", sa.DateTime(timezone=True), nullable=True),
    ]
    for column in additions:
        if column.name not in organization_columns:
            op.add_column("organizations", column)

    for column in ("kind", "status", "archived_at"):
        name = f"ix_organizations_{column}"
        if name not in _indexes(bind, "organizations"):
            op.create_index(name, "organizations", [column])
    if "ux_organizations_personal_owner_id" not in _indexes(bind, "organizations"):
        op.create_index("ux_organizations_personal_owner_id", "organizations", ["personal_owner_id"], unique=True)

    for table in ("sessions", "extension_tokens"):
        if "active_organization_id" not in _columns(bind, table):
            op.add_column(table, sa.Column(
                "active_organization_id", sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True,
            ))
        index = f"ix_{table}_active_organization_id"
        if index not in _indexes(bind, table):
            op.create_index(index, table, ["active_organization_id"])

    now = datetime.now(timezone.utc)
    users = bind.execute(sa.text("SELECT id,email,name,current_organization_id FROM users WHERE deleted_at IS NULL ORDER BY created_at,id")).mappings().all()
    for user in users:
        candidate = bind.execute(sa.text(
            "SELECT o.id FROM organizations o "
            "JOIN organization_members m ON m.organization_id=o.id "
            "WHERE o.created_by_id=:user AND m.user_id=:user AND m.role='owner' "
            "AND (o.slug LIKE :marker OR o.name=:old_name OR o.name=:new_name) "
            "ORDER BY o.created_at,o.id LIMIT 1"
        ), {
            "user": user["id"], "marker": f"%{user['id'][:8]}%",
            "old_name": f"{user['name'] or user['email'].split('@', 1)[0]}'s Workspace",
            "new_name": f"{user['name'] or user['email'].split('@', 1)[0]}'s Space",
        }).scalar()
        if not candidate:
            candidate = str(uuid.uuid4())
            base = re.sub(r"[^a-z0-9]+", "-", (user["name"] or user["email"].split("@", 1)[0]).lower()).strip("-") or "space"
            slug = f"{base}-{user['id'][:8]}-personal"
            while bind.execute(sa.text("SELECT 1 FROM organizations WHERE slug=:slug"), {"slug": slug}).scalar():
                slug = f"{base}-{user['id'][:8]}-{uuid.uuid4().hex[:6]}"
            bind.execute(sa.text(
                "INSERT INTO organizations (id,name,slug,kind,status,personal_owner_id,settings,created_by_id,created_at,updated_at) "
                "VALUES (:id,:name,:slug,'personal','active',:user,:settings,:user,:now,:now)"
            ), {
                "id": candidate, "name": f"{user['name'] or user['email'].split('@', 1)[0]}'s Space",
                "slug": slug, "user": user["id"], "settings": "{}", "now": now,
            })
            bind.execute(sa.text(
                "INSERT INTO organization_members (id,organization_id,user_id,role,created_at) "
                "VALUES (:id,:org,:user,'owner',:now)"
            ), {"id": str(uuid.uuid4()), "org": candidate, "user": user["id"], "now": now})
        bind.execute(sa.text(
            "UPDATE organizations SET kind='personal',personal_owner_id=:user,status='active' WHERE id=:id"
        ), {"id": candidate, "user": user["id"]})
        if not user["current_organization_id"]:
            bind.execute(sa.text("UPDATE users SET current_organization_id=:org WHERE id=:user"), {"org": candidate, "user": user["id"]})

    bind.execute(sa.text(
        "UPDATE sessions SET active_organization_id=(SELECT current_organization_id FROM users WHERE users.id=sessions.user_id) "
        "WHERE active_organization_id IS NULL"
    ))
    bind.execute(sa.text(
        "UPDATE extension_tokens SET active_organization_id=(SELECT current_organization_id FROM users WHERE users.id=extension_tokens.user_id) "
        "WHERE active_organization_id IS NULL"
    ))


def downgrade() -> None:
    for table in ("extension_tokens", "sessions"):
        op.drop_index(f"ix_{table}_active_organization_id", table_name=table)
        op.drop_column(table, "active_organization_id")
    op.drop_index("ux_organizations_personal_owner_id", table_name="organizations")
    for column in ("archived_at", "status", "kind"):
        op.drop_index(f"ix_organizations_{column}", table_name="organizations")
    for column in ("scheduled_purge_at", "archived_by_id", "archived_at", "settings", "personal_owner_id", "status", "kind"):
        op.drop_column("organizations", column)
