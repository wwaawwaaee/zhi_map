"""Protocol families; existing encrypted credentials remain untouched."""

from alembic import op
import sqlalchemy as sa

revision = "0002_provider_options"
down_revision = "0001_initial"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "user_ai_configs",
        sa.Column("provider", sa.String(), nullable=False, server_default="openai"),
    )
    op.add_column(
        "user_ai_configs",
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="4096"),
    )
    op.add_column(
        "user_ai_configs", sa.Column("temperature", sa.Float(), nullable=True)
    )


def downgrade():
    op.drop_column("user_ai_configs", "temperature")
    op.drop_column("user_ai_configs", "max_tokens")
    op.drop_column("user_ai_configs", "provider")
