"""Alembic env.py for Wormhole.

Imports app metadata for autogenerate. Resolves the SQLite URL from
``app.config.settings`` rather than the placeholder in ``alembic.ini``.
The application uses ``sqlite+aiosqlite``; alembic uses a sync driver
(``sqlite``) here intentionally.
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make sure the project root is on sys.path so we can import ``app.*`` and
# ``models.*`` regardless of how alembic is invoked.
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# Import models so their tables register on Base.metadata.
from app.database import Base  # noqa: E402
from app.config import settings  # noqa: E402

import models.chat          # noqa: F401, E402
import models.chat_sticker  # noqa: F401, E402
import models.emoji_diary   # noqa: F401, E402
import models.feed          # noqa: F401, E402
import models.logs          # noqa: F401, E402
import models.notes         # noqa: F401, E402
import models.notify        # noqa: F401, E402
import models.space         # noqa: F401, E402
import models.system        # noqa: F401, E402
import models.user          # noqa: F401, E402
import models.vault         # noqa: F401, E402
import models.wallet        # noqa: F401, E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _sync_db_url() -> str:
    """Build a sync SQLite URL from settings (alembic uses a sync engine)."""
    return f"sqlite:///{settings.DATABASE_PATH}"


target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=_sync_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    section = config.get_section(config.config_ini_section, {}) or {}
    section["sqlalchemy.url"] = _sync_db_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite needs batch mode for ALTER TABLE
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
