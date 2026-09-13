"""Normalized history; legacy JSON kept intact for recoverability."""

from alembic import op
from app.repository import heads, sessions, branches, entries

revision = "0003_normalized_history"
down_revision = "0002_provider_options"
branch_labels = depends_on = None


def upgrade():
    for table in (heads, sessions, branches, entries):
        table.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError(
        "Export current history before downgrading; legacy JSON is a migration-time backup only."
    )
