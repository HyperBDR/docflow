"""Administrator-managed AI models and request usage metrics.

Revision ID: 0009_ai_models_usage
Revises: 0008_team_space_lifecycle
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_ai_models_usage"
down_revision = "0008_team_space_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ai_model_configs" not in tables:
        op.create_table(
        "ai_model_configs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False, server_default="openai_compatible"),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=False, server_default=""),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("vision_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="120"),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.2"),
        sa.Column("extra_options", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    model_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("ai_model_configs")}
    if "ix_ai_model_configs_name" not in model_indexes:
        op.create_index("ix_ai_model_configs_name", "ai_model_configs", ["name"], unique=True)
    if "ix_ai_model_configs_enabled" not in model_indexes:
        op.create_index("ix_ai_model_configs_enabled", "ai_model_configs", ["enabled"])
    if "ix_ai_model_configs_is_default" not in model_indexes:
        op.create_index("ix_ai_model_configs_is_default", "ai_model_configs", ["is_default"])
    job_columns = {item["name"] for item in sa.inspect(bind).get_columns("ai_jobs")}
    if "model_config_id" not in job_columns:
        op.add_column("ai_jobs", sa.Column("model_config_id", sa.String(36), sa.ForeignKey("ai_model_configs.id", ondelete="SET NULL"), nullable=True))
    job_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("ai_jobs")}
    if "ix_ai_jobs_model_config_id" not in job_indexes:
        op.create_index("ix_ai_jobs_model_config_id", "ai_jobs", ["model_config_id"])
    if "ai_usage_records" not in tables:
        op.create_table(
        "ai_usage_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("request_id", sa.String(120), nullable=False, server_default=""),
        sa.Column("model_config_id", sa.String(36), sa.ForeignKey("ai_model_configs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("provider", sa.String(40), nullable=False, server_default="openai_compatible"),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("ai_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("demo_id", sa.String(36), sa.ForeignKey("demos.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation", sa.String(80), nullable=False, server_default="generation"),
        sa.Column("status", sa.String(20), nullable=False, server_default="success"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_token_ms", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("request_detail", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("response_detail", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    usage_indexes = {item["name"] for item in sa.inspect(bind).get_indexes("ai_usage_records")}
    for column in ("request_id", "model_config_id", "model_name", "job_id", "user_id", "organization_id", "demo_id", "operation", "status", "created_at"):
        name = f"ix_ai_usage_records_{column}"
        if name not in usage_indexes:
            op.create_index(name, "ai_usage_records", [column])


def downgrade() -> None:
    op.drop_table("ai_usage_records")
    op.drop_index("ix_ai_jobs_model_config_id", table_name="ai_jobs")
    op.drop_column("ai_jobs", "model_config_id")
    op.drop_table("ai_model_configs")
