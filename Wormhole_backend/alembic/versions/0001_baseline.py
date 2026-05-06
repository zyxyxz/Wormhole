"""baseline

Revision ID: 0001
Revises:
Create Date: 2026-05-06

This baseline marks the schema state at Task 18 (Alembic introduction).
The actual table creation is still handled by SQLAlchemy
``Base.metadata.create_all`` plus the legacy ``app/migrations.py`` data
migrations applied at startup.

Future schema changes should be authored as new alembic revisions on top
of this baseline.
"""
from typing import Sequence, Union

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline: no-op. Existing schema is built by Base.metadata.create_all
    # and legacy app/migrations.py migrations.
    pass


def downgrade() -> None:
    # Baseline cannot be downgraded.
    pass
