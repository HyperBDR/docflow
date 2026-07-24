"""extension release distribution

Revision ID: 0028_extension_releases
Revises: 0027_step_hotspot_mode
"""

from alembic import op
import sqlalchemy as sa


revision = "0028_extension_releases"
down_revision = "0027_step_hotspot_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "extension_releases" in inspector.get_table_names():
        return
    op.create_table(
        "extension_releases",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("channel", sa.String(20), nullable=False, server_default="stable"),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("minimum_version", sa.String(40), nullable=False, server_default="0.0.0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("release_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("storage_key", sa.String(1500), nullable=False),
        sa.Column("filename", sa.String(320), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("channel", "version", name="uq_extension_release_channel_version"),
    )
    for name, columns in (
        ("ix_extension_releases_channel", ["channel"]),
        ("ix_extension_releases_version", ["version"]),
        ("ix_extension_releases_status", ["status"]),
        ("ix_extension_releases_sha256", ["sha256"]),
        ("ix_extension_releases_created_by_id", ["created_by_id"]),
        ("ix_extension_releases_published_at", ["published_at"]),
        ("ix_extension_releases_created_at", ["created_at"]),
    ):
        op.create_index(name, "extension_releases", columns)


def downgrade() -> None:
    if "extension_releases" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("extension_releases")
