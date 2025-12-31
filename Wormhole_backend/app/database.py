from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text
from app.config import settings
from app.migrations import run_migrations

DATABASE_URL = f"sqlite+aiosqlite:///{settings.DATABASE_PATH}"

engine = create_async_engine(DATABASE_URL, echo=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()

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
