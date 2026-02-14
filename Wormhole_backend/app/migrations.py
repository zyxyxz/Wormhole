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


async def table_exists(conn, table: str) -> bool:
    result = await conn.execute(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name = :name"),
        {"name": table}
    )
    return result.first() is not None


async def add_deleted_at_to_posts(conn):
    if await column_exists(conn, "posts", "deleted_at"):
        return
    await conn.execute(text("ALTER TABLE posts ADD COLUMN deleted_at DATETIME"))


async def add_share_code_expiry(conn):
    if not await column_exists(conn, "share_codes", "expires_at"):
        await conn.execute(text("ALTER TABLE share_codes ADD COLUMN expires_at DATETIME"))
    if not await column_exists(conn, "share_codes", "used"):
        await conn.execute(text("ALTER TABLE share_codes ADD COLUMN used BOOLEAN DEFAULT 0"))


async def add_user_avatar(conn):
    if await column_exists(conn, "user_aliases", "avatar_url"):
        return
    await conn.execute(text("ALTER TABLE user_aliases ADD COLUMN avatar_url TEXT"))

async def add_user_theme_preference(conn):
    if await column_exists(conn, "user_aliases", "theme_preference"):
        return
    await conn.execute(text("ALTER TABLE user_aliases ADD COLUMN theme_preference TEXT"))


async def add_message_media_columns(conn):
    if not await column_exists(conn, "messages", "message_type"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text'"))
    if not await column_exists(conn, "messages", "media_url"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN media_url TEXT"))
    if not await column_exists(conn, "messages", "media_duration"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN media_duration INTEGER"))


async def add_soft_delete_columns(conn):
    if not await column_exists(conn, "spaces", "deleted_at"):
        await conn.execute(text("ALTER TABLE spaces ADD COLUMN deleted_at DATETIME"))
    if not await column_exists(conn, "messages", "deleted_at"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN deleted_at DATETIME"))
    if not await column_exists(conn, "notes", "deleted_at"):
        await conn.execute(text("ALTER TABLE notes ADD COLUMN deleted_at DATETIME"))
    if not await column_exists(conn, "comments", "deleted_at"):
        await conn.execute(text("ALTER TABLE comments ADD COLUMN deleted_at DATETIME"))


async def add_operation_logs(conn):
    if not await table_exists(conn, "operation_logs"):
        await conn.execute(text(
            """
            CREATE TABLE operation_logs (
                id INTEGER PRIMARY KEY,
                user_id TEXT,
                action TEXT NOT NULL,
                page TEXT,
                detail TEXT,
                space_id INTEGER,
                ip TEXT,
                user_agent TEXT,
                created_at DATETIME DEFAULT (datetime('now'))
            )
            """
        ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_operation_logs_user_id ON operation_logs(user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_operation_logs_action ON operation_logs(action)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_operation_logs_page ON operation_logs(page)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_operation_logs_space_id ON operation_logs(space_id)"))


async def add_space_member_read_columns(conn):
    if not await column_exists(conn, "space_members", "last_read_message_id"):
        await conn.execute(text("ALTER TABLE space_members ADD COLUMN last_read_message_id INTEGER"))
    if not await column_exists(conn, "space_members", "last_read_at"):
        await conn.execute(text("ALTER TABLE space_members ADD COLUMN last_read_at DATETIME"))


async def add_message_reply_columns(conn):
    if not await column_exists(conn, "messages", "reply_to_id"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER"))
    if not await column_exists(conn, "messages", "reply_to_user_id"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN reply_to_user_id TEXT"))
    if not await column_exists(conn, "messages", "reply_to_content"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN reply_to_content TEXT"))
    if not await column_exists(conn, "messages", "reply_to_type"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN reply_to_type TEXT"))


async def add_notify_channels(conn):
    if not await table_exists(conn, "notify_channels"):
        await conn.execute(text(
            """
            CREATE TABLE notify_channels (
                id INTEGER PRIMARY KEY,
                space_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'feishu',
                target TEXT NOT NULL,
                remark TEXT,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                notify_chat BOOLEAN NOT NULL DEFAULT 1,
                notify_feed BOOLEAN NOT NULL DEFAULT 1,
                cooldown_seconds INTEGER NOT NULL DEFAULT 600,
                disguise_type TEXT NOT NULL DEFAULT 'market',
                custom_title TEXT,
                custom_body TEXT,
                skip_when_online BOOLEAN NOT NULL DEFAULT 1,
                last_notified_at DATETIME,
                created_at DATETIME DEFAULT (datetime('now')),
                updated_at DATETIME
            )
            """
        ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notify_channels_space_id ON notify_channels(space_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notify_channels_user_id ON notify_channels(user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notify_channels_enabled ON notify_channels(enabled)"))


MIGRATIONS = [
    ("202401_add_deleted_at_to_posts", add_deleted_at_to_posts),
    ("202402_add_share_code_expiry", add_share_code_expiry),
    ("202402_add_user_alias_avatar", add_user_avatar),
    ("202602_add_user_theme_preference", add_user_theme_preference),
    ("202402_add_message_media", add_message_media_columns),
    ("202601_add_operation_logs", add_operation_logs),
    ("202601_add_soft_delete_columns", add_soft_delete_columns),
    ("202601_add_space_member_read_columns", add_space_member_read_columns),
    ("202601_add_message_reply_columns", add_message_reply_columns),
    ("202602_add_notify_channels", add_notify_channels),
]


async def run_migrations(conn):
    await ensure_migrations_table(conn)
    for name, handler in MIGRATIONS:
        if await has_migration(conn, name):
            continue
        await handler(conn)
        await mark_migration(conn, name)
