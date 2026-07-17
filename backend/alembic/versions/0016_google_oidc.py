"""Google OIDC settings and external identities.

Revision ID: 0016_google_oidc
Revises: 0015_platform_email_settings
"""
from alembic import op
import sqlalchemy as sa


revision = "0016_google_oidc"
down_revision = "0015_platform_email_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    password_column = next((column for column in inspector.get_columns("users") if column["name"] == "password_hash"), None)
    if password_column and not password_column.get("nullable", False):
        with op.batch_alter_table("users") as batch:
            batch.alter_column("password_hash", existing_type=sa.String(255), nullable=True)

    if "google_auth_settings" not in tables:
        op.create_table(
            "google_auth_settings",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("client_id", sa.String(500), nullable=False),
            sa.Column("client_secret_encrypted", sa.Text(), nullable=False),
            sa.Column("allow_registration", sa.Boolean(), nullable=False),
            sa.Column("allowed_domains", sa.JSON(), nullable=False),
            sa.Column("updated_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "oauth_identities" not in tables:
        op.create_table(
            "oauth_identities",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("provider_subject", sa.String(255), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("display_name", sa.String(160), nullable=False),
            sa.Column("avatar_url", sa.String(1000), nullable=False),
            sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("provider", "provider_subject", name="uq_oauth_provider_subject"),
            sa.UniqueConstraint("provider", "user_id", name="uq_oauth_provider_user"),
        )
        for column in ("provider", "provider_subject", "user_id"):
            op.create_index(f"ix_oauth_identities_{column}", "oauth_identities", [column])
    if "oauth_login_states" not in tables:
        op.create_table(
            "oauth_login_states",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("state_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("provider", sa.String(30), nullable=False),
            sa.Column("mode", sa.String(20), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("nonce", sa.String(255), nullable=False),
            sa.Column("code_verifier_encrypted", sa.Text(), nullable=False),
            sa.Column("return_to", sa.String(1000), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        for column in ("state_hash", "provider", "user_id", "expires_at"):
            op.create_index(f"ix_oauth_login_states_{column}", "oauth_login_states", [column])


def downgrade() -> None:
    op.drop_table("oauth_login_states")
    op.drop_table("oauth_identities")
    op.drop_table("google_auth_settings")
    with op.batch_alter_table("users") as batch:
        batch.alter_column("password_hash", existing_type=sa.String(255), nullable=False)
