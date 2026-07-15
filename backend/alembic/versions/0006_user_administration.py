"""User profiles, roles, and administration.

Revision ID: 0006_user_administration
Revises: 0005_internationalization
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_user_administration"
down_revision = "0005_internationalization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {item["name"] for item in inspector.get_columns("users")}
    if "name" not in columns:
        op.add_column("users", sa.Column("name", sa.String(100), nullable=False, server_default=""))
    if "role" not in columns:
        op.add_column("users", sa.Column("role", sa.String(20), nullable=False, server_default="user"))
    indexes = {item["name"] for item in sa.inspect(op.get_bind()).get_indexes("users")}
    if "ix_users_role" not in indexes:
        op.create_index("ix_users_role", "users", ["role"])
    # Guarantee that an upgraded installation always has an administrator.
    op.execute(sa.text(
        "UPDATE users SET role = 'admin' WHERE id = "
        "(SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1) "
        "AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')"
    ))


def downgrade() -> None:
    op.drop_index("ix_users_role", table_name="users")
    op.drop_column("users", "role")
    op.drop_column("users", "name")
