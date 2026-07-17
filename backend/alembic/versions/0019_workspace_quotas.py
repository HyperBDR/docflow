"""Workspace quota plans and assignments."""
from alembic import op
import sqlalchemy as sa
import uuid
from datetime import datetime, timezone

revision="0019_workspace_quotas"
down_revision="0018_resource_governance"
branch_labels=None
depends_on=None

DEFAULT_LIMITS={"storage_bytes":10737418240,"resources":100,"max_steps_per_resource":500,"members":10,"active_shares":50,"monthly_ai_tokens":100000,"monthly_exports":50,"monthly_video_minutes":60,"monthly_public_views":20000,"monthly_download_bytes":21474836480}

def upgrade():
    existing=set(sa.inspect(op.get_bind()).get_table_names())
    if "quota_plans" not in existing:
        op.create_table("quota_plans",sa.Column("id",sa.String(36),primary_key=True),sa.Column("name",sa.String(120),nullable=False,unique=True),sa.Column("description",sa.String(500),nullable=False),sa.Column("is_default",sa.Boolean(),nullable=False),sa.Column("limits",sa.JSON(),nullable=False),sa.Column("created_by_id",sa.String(36),sa.ForeignKey("users.id",ondelete="SET NULL")),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
        op.create_index("ix_quota_plans_is_default","quota_plans",["is_default"])
    if "organization_quota_assignments" not in existing:
        op.create_table("organization_quota_assignments",sa.Column("organization_id",sa.String(36),sa.ForeignKey("organizations.id",ondelete="CASCADE"),primary_key=True),sa.Column("plan_id",sa.String(36),sa.ForeignKey("quota_plans.id",ondelete="RESTRICT"),nullable=False),sa.Column("overrides",sa.JSON(),nullable=False),sa.Column("updated_by_id",sa.String(36),sa.ForeignKey("users.id",ondelete="SET NULL")),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False))
        op.create_index("ix_organization_quota_assignments_plan_id","organization_quota_assignments",["plan_id"])
    plans=sa.table("quota_plans",sa.column("id",sa.String),sa.column("name",sa.String),sa.column("description",sa.String),sa.column("is_default",sa.Boolean),sa.column("limits",sa.JSON),sa.column("created_at",sa.DateTime(timezone=True)),sa.column("updated_at",sa.DateTime(timezone=True)))
    if not op.get_bind().execute(sa.select(sa.func.count()).select_from(plans)).scalar():
        now=datetime.now(timezone.utc);op.bulk_insert(plans,[{"id":str(uuid.uuid4()),"name":"Default","description":"Default workspace quota","is_default":True,"limits":DEFAULT_LIMITS,"created_at":now,"updated_at":now}])

def downgrade():
    op.drop_table("organization_quota_assignments");op.drop_table("quota_plans")
