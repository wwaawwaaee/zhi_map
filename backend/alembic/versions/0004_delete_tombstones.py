"""Bounded, single-use server-side branch undo."""
from alembic import op
import sqlalchemy as sa

revision = "0004_delete_tombstones"
down_revision = "0003_normalized_history"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("history_tombstones", sa.Column("token", sa.String(), primary_key=True),
                    sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
                    sa.Column("expires", sa.Integer(), nullable=False), sa.Column("data", sa.Text(), nullable=False))
    op.create_index("ix_history_entry_anchor", "history_entries", ["user_id", "branch_id", "id"])
    op.create_index("ix_history_topic_cursor", "history_branches", ["user_id", "position"])


def downgrade():
    op.drop_index("ix_history_entry_anchor", "history_entries")
    op.drop_index("ix_history_topic_cursor", "history_branches")
    op.drop_table("history_tombstones")
