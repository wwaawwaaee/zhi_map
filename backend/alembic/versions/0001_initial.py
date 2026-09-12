"""initial Python backend schema, compatible with existing table names"""
from alembic import op
import sqlalchemy as sa
revision="0001_initial"; down_revision=None; branch_labels=None; depends_on=None
def upgrade():
    op.create_table("users",sa.Column("id",sa.String(),primary_key=True),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),if_not_exists=True)
    op.create_table("auth_sessions",sa.Column("id",sa.String(),primary_key=True),sa.Column("user_id",sa.String(),sa.ForeignKey("users.id"),nullable=False),sa.Column("token_hash",sa.String(),nullable=True),sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),sa.Column("expires_at",sa.DateTime(timezone=True),nullable=False),if_not_exists=True)
    op.create_table("workspaces",sa.Column("user_id",sa.String(),sa.ForeignKey("users.id"),primary_key=True),sa.Column("state",sa.Text(),nullable=False),sa.Column("version",sa.Integer(),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False),if_not_exists=True)
    op.create_table("user_ai_configs",sa.Column("user_id",sa.String(),sa.ForeignKey("users.id"),primary_key=True),sa.Column("version",sa.Integer(),nullable=False),sa.Column("base_url",sa.Text(),nullable=False),sa.Column("model",sa.String(),nullable=False),sa.Column("timeout_ms",sa.Integer(),nullable=False),sa.Column("encrypted_key",sa.Text(),nullable=False),sa.Column("nonce",sa.String(),nullable=False),sa.Column("auth_tag",sa.String(),nullable=True),sa.Column("updated_at",sa.DateTime(timezone=True),nullable=False),if_not_exists=True)
def downgrade(): pass
