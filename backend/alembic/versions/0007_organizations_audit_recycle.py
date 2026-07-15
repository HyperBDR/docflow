"""Organizations, invitations, audit logs, and recycle bin.

Revision ID: 0007_organizations_audit_recycle
Revises: 0006_user_administration
"""
import re
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0007_organizations_audit_recycle"
down_revision = "0006_user_administration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "organizations" not in tables:
        op.create_table(
            "organizations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("slug", sa.String(120), nullable=False),
            sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)
        op.create_index("ix_organizations_created_by_id", "organizations", ["created_by_id"])
    if "organization_members" not in tables:
        op.create_table(
            "organization_members",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("organization_id", "user_id", name="uq_organization_member"),
        )
        op.create_index("ix_organization_members_organization_id", "organization_members", ["organization_id"])
        op.create_index("ix_organization_members_user_id", "organization_members", ["user_id"])
    if "organization_invitations" not in tables:
        op.create_table(
            "organization_invitations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("invited_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_organization_invitations_organization_id", "organization_invitations", ["organization_id"])
        op.create_index("ix_organization_invitations_email", "organization_invitations", ["email"])
        op.create_index("ix_organization_invitations_token_hash", "organization_invitations", ["token_hash"], unique=True)
        op.create_index("ix_organization_invitations_invited_by_id", "organization_invitations", ["invited_by_id"])
    if "audit_logs" not in tables:
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("action", sa.String(80), nullable=False),
            sa.Column("target_type", sa.String(40), nullable=False),
            sa.Column("target_id", sa.String(36), nullable=False),
            sa.Column("target_label", sa.String(320), nullable=False, server_default=""),
            sa.Column("before", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("after", sa.JSON(), nullable=False, server_default="{}"),
            sa.Column("ip_address", sa.String(80), nullable=False, server_default=""),
            sa.Column("user_agent", sa.String(500), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        for column in ("actor_id", "organization_id", "action", "target_type", "target_id", "created_at"):
            op.create_index(f"ix_audit_logs_{column}", "audit_logs", [column])

    additions = {
        "users": [
            sa.Column("current_organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        ],
        "demos": [
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        ],
        "categories": [sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)],
        "tags": [sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)],
    }
    for table, columns in additions.items():
        existing = {item["name"] for item in sa.inspect(bind).get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    for table, column in (("users", "current_organization_id"), ("users", "deleted_at"), ("demos", "organization_id"), ("demos", "deleted_at"), ("categories", "organization_id"), ("tags", "organization_id")):
        indexes = {item["name"] for item in sa.inspect(bind).get_indexes(table)}
        name = f"ix_{table}_{column}"
        if name not in indexes:
            op.create_index(name, table, [column])

    now = datetime.now(timezone.utc)
    users = bind.execute(sa.text("SELECT id, email, name FROM users ORDER BY created_at, id")).mappings().all()
    existing_members = set(bind.execute(sa.text("SELECT user_id FROM organization_members")).scalars())
    for user in users:
        if user["id"] in existing_members:
            continue
        org_id = str(uuid.uuid4())
        base = re.sub(r"[^a-z0-9]+", "-", (user["name"] or user["email"].split("@", 1)[0]).lower()).strip("-") or "workspace"
        slug = f"{base}-{user['id'][:8]}"
        bind.execute(sa.text(
            "INSERT INTO organizations (id,name,slug,created_by_id,created_at,updated_at) "
            "VALUES (:id,:name,:slug,:user,:now,:now)"
        ), {"id": org_id, "name": f"{user['name'] or user['email'].split('@', 1)[0]}'s Workspace", "slug": slug, "user": user["id"], "now": now})
        bind.execute(sa.text(
            "INSERT INTO organization_members (id,organization_id,user_id,role,created_at) VALUES (:id,:org,:user,'owner',:now)"
        ), {"id": str(uuid.uuid4()), "org": org_id, "user": user["id"], "now": now})
        bind.execute(sa.text("UPDATE users SET current_organization_id=:org WHERE id=:user"), {"org": org_id, "user": user["id"]})
        for table in ("demos", "categories", "tags"):
            bind.execute(sa.text(f"UPDATE {table} SET organization_id=:org WHERE owner_id=:user AND organization_id IS NULL"), {"org": org_id, "user": user["id"]})


def downgrade() -> None:
    for table, columns in (("tags", ["organization_id"]), ("categories", ["organization_id"]), ("demos", ["deleted_by_id", "deleted_at", "organization_id"]), ("users", ["deleted_at", "current_organization_id"])):
        for column in columns:
            op.drop_column(table, column)
    op.drop_table("audit_logs")
    op.drop_table("organization_invitations")
    op.drop_table("organization_members")
    op.drop_table("organizations")
