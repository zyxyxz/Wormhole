from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import event, text
from app.config import settings
from app.migrations import run_migrations

def _build_database_url() -> str:
    if settings.DATABASE_URL:
        url = settings.DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url
    return f"sqlite+aiosqlite:///{settings.DATABASE_PATH}"


DATABASE_URL = _build_database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

# echo=False so we don't drown the prod log in SQL chatter; flip to True locally
# when debugging. The async log_worker (Task 13) emits batches every second,
# which used to add ~100 lines/s of noise.
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=not IS_SQLITE)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


if IS_SQLITE:
    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_concurrency_pragmas(dbapi_conn, _):
        """Per-connection PRAGMAs to make SQLite tolerate concurrent writers."""
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def create_tables():
    # Register every model on Base.metadata before create_all. Relying on route
    # import side effects is fragile on first-boot deploys such as Railway.
    import models.chat  # noqa: F401
    import models.chat_read  # noqa: F401
    import models.chat_sticker  # noqa: F401
    import models.emoji_diary  # noqa: F401
    import models.feed  # noqa: F401
    import models.logs  # noqa: F401
    import models.message_reaction  # noqa: F401
    import models.notes  # noqa: F401
    import models.notify  # noqa: F401
    import models.space  # noqa: F401
    import models.system  # noqa: F401
    import models.user  # noqa: F401
    import models.vault  # noqa: F401
    import models.wallet  # noqa: F401

    async with engine.begin() as conn:
        # 旧版本曾为空间号创建唯一索引，这里在建表前移除
        try:
            await conn.execute(text("DROP INDEX IF EXISTS ix_spaces_code"))
        except Exception:
            # sqlite 以外的数据库若不存在该索引会直接跳过
            pass
        await conn.run_sync(Base.metadata.create_all)
        await run_migrations(conn)
