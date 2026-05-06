"""Helpers for invoking Alembic programmatically.

Alembic is introduced in Task 18 to manage forward-going schema
migrations. The legacy ``app/migrations.py`` module continues to handle
historical data migrations and runs at startup; alembic is additive.

For now these helpers are not auto-wired into the FastAPI lifespan —
they are intended for manual one-shot use (e.g. ``alembic upgrade head``
on a fresh database, or ``stamp head`` on an existing one to mark it as
alembic-managed without re-running migrations).
"""
from __future__ import annotations

import os


def _alembic_config():
    from alembic.config import Config  # local import to avoid hard dep at import time

    cfg_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "alembic.ini",
    )
    return Config(cfg_path)


def stamp_head() -> None:
    """Mark the database as being at the current alembic head.

    Use this on existing databases that pre-date alembic adoption: it
    creates / updates the ``alembic_version`` table without running any
    migrations. Idempotent — safe to call multiple times.
    """
    from alembic import command

    command.stamp(_alembic_config(), "head")


def upgrade_head() -> None:
    """Run ``alembic upgrade head`` against the configured database."""
    from alembic import command

    command.upgrade(_alembic_config(), "head")
