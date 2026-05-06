from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import event, text
from app.config import settings
from app.migrations import run_migrations

DATABASE_URL = f"sqlite+aiosqlite:///{settings.DATABASE_PATH}"

# echo=False so we don't drown the prod log in SQL chatter; flip to True locally
# when debugging. The async log_worker (Task 13) emits batches every second,
# which used to add ~100 lines/s of noise.
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


@event.listens_for(engine.sync_engine, "connect")
def _sqlite_concurrency_pragmas(dbapi_conn, _):
    """Per-connection PRAGMAs to make SQLite tolerate concurrent writers.

    Without these, the moment Task 13's log_worker flushes a batch while a
    chat-history GET is reading, one of them gets `database is locked` and
    the resulting 500 disconnects the chat WS client → reconnect storm.

    - journal_mode=WAL: readers no longer block on writers, single writer
      still serialised but fine for our load.
    - synchronous=NORMAL: durability slightly weaker than FULL but matches
      WAL's safety guarantees on power loss.
    - busy_timeout=5000: wait up to 5s for a lock to release before raising
      OperationalError.
    """
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
    async with engine.begin() as conn:
        # 旧版本曾为空间号创建唯一索引，这里在建表前移除
        try:
            await conn.execute(text("DROP INDEX IF EXISTS ix_spaces_code"))
        except Exception:
            # sqlite 以外的数据库若不存在该索引会直接跳过
            pass
        await conn.run_sync(Base.metadata.create_all)
        await run_migrations(conn)
