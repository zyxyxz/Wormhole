from datetime import datetime
from sqlalchemy import text


async def ensure_migrations_table(conn):
    await conn.execute(text(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT DEFAULT (datetime('now'))
        )
        """
    ))


async def has_migration(conn, name: str) -> bool:
    result = await conn.execute(text("SELECT 1 FROM schema_migrations WHERE name = :name"), {"name": name})
    return result.first() is not None


async def mark_migration(conn, name: str):
    await conn.execute(text("INSERT INTO schema_migrations(name, applied_at) VALUES (:name, :applied_at)"), {
        "name": name,
        "applied_at": datetime.utcnow().isoformat()
    })


async def column_exists(conn, table: str, column: str) -> bool:
    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    for row in result.mappings():
        if row.get("name") == column:
            return True
    return False


async def add_deleted_at_to_posts(conn):
    if await column_exists(conn, "posts", "deleted_at"):
        return
    await conn.execute(text("ALTER TABLE posts ADD COLUMN deleted_at DATETIME"))


MIGRATIONS = [
    ("202401_add_deleted_at_to_posts", add_deleted_at_to_posts),
]


async def run_migrations(conn):
    await ensure_migrations_table(conn)
    for name, handler in MIGRATIONS:
        if await has_migration(conn, name):
            continue
        await handler(conn)
        await mark_migration(conn, name)
