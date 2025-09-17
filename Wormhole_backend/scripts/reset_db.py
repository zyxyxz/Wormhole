import asyncio
import os
import sys
from pathlib import Path


def ensure_dirs():
    static_uploads = Path(__file__).resolve().parents[1] / 'static' / 'uploads'
    static_uploads.mkdir(parents=True, exist_ok=True)


async def recreate_db():
    # Remove existing SQLite file
    backend_root = Path(__file__).resolve().parents[1]
    db_path = backend_root / 'wormhole.db'
    if db_path.exists():
        db_path.unlink()

    # Create tables via app.database
    # Ensure backend root on import path
    sys.path.insert(0, str(backend_root))

    # Import all models to register metadata tables
    from app.database import create_tables  # type: ignore
    import models.space  # noqa: F401
    import models.user   # noqa: F401
    import models.chat   # noqa: F401
    import models.notes  # noqa: F401
    import models.wallet # noqa: F401
    import models.feed   # noqa: F401
    await create_tables()


if __name__ == '__main__':
    ensure_dirs()
    asyncio.run(recreate_db())
    print('Database recreated and static/uploads ensured.')
