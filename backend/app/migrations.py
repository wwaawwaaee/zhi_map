"""One migration entry point for web and frozen desktop startup."""

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade(engine):
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    config = Config()
    config.set_main_option("script_location", str(root / "alembic"))
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
