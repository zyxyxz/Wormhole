from datetime import datetime
from sqlalchemy import inspect, text


def is_sqlite(conn) -> bool:
    return conn.dialect.name == "sqlite"


async def ensure_migrations_table(conn):
    if is_sqlite(conn):
        await conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT DEFAULT (datetime('now'))
            )
            """
        ))
        return
    await conn.execute(text(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
    if not is_sqlite(conn):
        def _has_column(sync_conn):
            inspector = inspect(sync_conn)
            return any(col.get("name") == column for col in inspector.get_columns(table))

        return await conn.run_sync(_has_column)

    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    for row in result.mappings():
        if row.get("name") == column:
            return True
    return False


async def table_exists(conn, table: str) -> bool:
    if not is_sqlite(conn):
        def _has_table(sync_conn):
            return inspect(sync_conn).has_table(table)

        return await conn.run_sync(_has_table)

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


async def add_operation_log_composite_indexes(conn):
    """Composite indexes that match the queries on the logs admin page.

    Listing by space + recency, or by action + recency, both rely on these
    leading-edge indexes; without them the planner falls back to single-column
    indexes plus a sort.
    """
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_operation_logs_space_created "
        "ON operation_logs(space_id, created_at)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_operation_logs_action_created "
        "ON operation_logs(action, created_at)"
    ))


async def add_hot_path_composite_indexes(conn):
    """Composite indexes that match hot read paths on chat history and feed.

    - messages by (space_id, id) for `WHERE space_id=? ORDER BY id DESC LIMIT ?`
    - messages by (space_id, deleted_at) for soft-delete filter on the same path
    - posts by (space_id, id) for paginated feed listing
    - posts by (space_id, deleted_at) for soft-delete filter on the same path
    - comments by (post_id, id) for per-post comment listing
    - comments by (post_id, deleted_at) for soft-delete filter on the same path

    `post_likes` already has a UNIQUE(post_id, user_id) index so no extra
    composite is needed there.
    """
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_messages_space_id_id ON messages(space_id, id)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_messages_space_deleted ON messages(space_id, deleted_at)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_posts_space_id_id ON posts(space_id, id)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_posts_space_deleted ON posts(space_id, deleted_at)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_comments_post_id_id ON comments(post_id, id)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_comments_post_deleted ON comments(post_id, deleted_at)"
    ))


async def add_space_member_read_columns(conn):
    if not await column_exists(conn, "space_members", "last_read_message_id"):
        await conn.execute(text("ALTER TABLE space_members ADD COLUMN last_read_message_id INTEGER"))
    if not await column_exists(conn, "space_members", "last_read_at"):
        await conn.execute(text("ALTER TABLE space_members ADD COLUMN last_read_at DATETIME"))


async def add_messages_edit_columns(conn):
    if not await column_exists(conn, "messages", "edited_at"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN edited_at DATETIME"))
    if not await column_exists(conn, "messages", "edit_history"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN edit_history TEXT"))


async def add_messages_mentions_column(conn):
    """Task 29: @mentions stored as JSON list of user_id strings."""
    if not await column_exists(conn, "messages", "mentions"):
        await conn.execute(text("ALTER TABLE messages ADD COLUMN mentions TEXT"))


async def add_messages_fts5(conn):
    """Task 30: FTS5 virtual table + AI/AU/AD triggers for messages.content.

    Uses an external-content table linked by ``rowid='id'`` so storage isn't
    doubled — the content lives in ``messages`` and FTS5 only stores the
    inverted index. Triggers keep the index in sync on insert/update/delete,
    and a single-shot backfill seeds rows that pre-date this migration.

    SQLite must be compiled with FTS5 (true for the standard distribution
    used in tests/CI/prod). If FTS5 is missing, the CREATE VIRTUAL TABLE
    statement raises and the migration aborts cleanly — surfacing the
    misconfiguration loudly is better than masking it.
    """
    await conn.execute(text(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            content='messages',
            content_rowid='id',
            tokenize='unicode61'
        )
        """
    ))
    await conn.execute(text(
        """
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END
        """
    ))
    await conn.execute(text(
        """
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
        END
        """
    ))
    await conn.execute(text(
        """
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        END
        """
    ))
    # Backfill rows that already exist in `messages`. We use FTS5's
    # documented `'rebuild'` command instead of an explicit
    # `INSERT INTO messages_fts(rowid, content) SELECT ...` because the
    # explicit form's `WHERE id NOT IN (SELECT rowid FROM messages_fts)`
    # subquery interacts badly with the AI trigger on `messages` — under
    # SQLite + aiosqlite the inverted index is left empty even though the
    # rowid/content pairs land in the index docstore. `'rebuild'` is
    # idempotent and the canonical first-run path for external-content FTS5
    # tables.
    await conn.execute(text(
        "INSERT INTO messages_fts(messages_fts) VALUES('rebuild')"
    ))


async def add_message_reactions_table(conn):
    """Task 28: emoji reactions on messages.

    Unique constraint on (message_id, user_id, emoji) prevents duplicate
    reactions; the index on message_id supports the batch fetch used by
    GET /api/chat/history.
    """
    if not await table_exists(conn, "message_reactions"):
        await conn.execute(text(
            """
            CREATE TABLE message_reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now')),
                UNIQUE (message_id, user_id, emoji),
                FOREIGN KEY (message_id) REFERENCES messages(id)
            )
            """
        ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_message_reactions_message_id ON message_reactions(message_id)"
    ))


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


async def add_emoji_diary_entries(conn):
    if not await table_exists(conn, "emoji_diary_entries"):
        await conn.execute(text(
            """
            CREATE TABLE emoji_diary_entries (
                id INTEGER PRIMARY KEY,
                space_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                entry_date TEXT NOT NULL,
                emoji TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at DATETIME DEFAULT (datetime('now')),
                updated_at DATETIME
            )
            """
        ))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_emoji_diary_space_user_date ON emoji_diary_entries(space_id, user_id, entry_date)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_emoji_diary_space_id ON emoji_diary_entries(space_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_emoji_diary_user_id ON emoji_diary_entries(user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_emoji_diary_entry_date ON emoji_diary_entries(entry_date)"))


async def add_chat_stickers(conn):
    if not await table_exists(conn, "chat_stickers"):
        await conn.execute(text(
            """
            CREATE TABLE chat_stickers (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL,
                media_url TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now')),
                updated_at DATETIME
            )
            """
        ))
    await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_stickers_user_media ON chat_stickers(user_id, media_url)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_stickers_user_id ON chat_stickers(user_id)"))


async def add_comments_parent_id(conn):
    """Task 31: nested replies (max 2 levels) on feed comments.

    Adds a self-referential ``parent_id`` so a reply can target a top-level
    comment. The route layer enforces the 2-level cap by rejecting parents
    whose own ``parent_id`` is non-null. The index supports the per-post
    fan-out used when grouping replies under their parents on the client.
    """
    if not await column_exists(conn, "comments", "parent_id"):
        await conn.execute(text("ALTER TABLE comments ADD COLUMN parent_id INTEGER"))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_comments_parent_id ON comments(parent_id)"
    ))


async def add_space_member_last_read_post_id(conn):
    """2026-05-07 unread state machine: track last_read_post_id on SpaceMember.

    Used by /api/feed/unread-count to count posts.id > last_read_post_id, and
    by /api/feed/mark-read to advance the pointer when a user enters the
    feed page. Backfills existing rows to MAX(post.id) for the same space so
    users don't see a 99+ badge on the first deploy after this lands —
    "everything before the deploy is considered already-seen".
    """
    if not await column_exists(conn, "space_members", "last_read_post_id"):
        await conn.execute(text(
            "ALTER TABLE space_members ADD COLUMN last_read_post_id INTEGER DEFAULT 0"
        ))
        # Backfill: pin every existing membership to the current MAX(post.id)
        # in their space. New posts created after the deploy will appear as
        # unread; pre-deploy posts are treated as already seen.
        await conn.execute(text(
            """
            UPDATE space_members
            SET last_read_post_id = COALESCE(
                (SELECT MAX(p.id) FROM posts p WHERE p.space_id = space_members.space_id),
                0
            )
            WHERE last_read_post_id IS NULL OR last_read_post_id = 0
            """
        ))


async def add_chat_reads_table(conn):
    """Task 32: per-device chat read tracking.

    Composite PK ``(space_id, user_id, device_id)`` is the natural identity:
    one row per device session, so unread counts can take MIN across a
    user's devices instead of collapsing to a single per-user pointer.
    """
    if not await table_exists(conn, "chat_reads"):
        await conn.execute(text(
            """
            CREATE TABLE chat_reads (
                space_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                last_read_message_id INTEGER DEFAULT 0,
                last_read_at DATETIME,
                PRIMARY KEY (space_id, user_id, device_id)
            )
            """
        ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_chat_reads_space_user ON chat_reads(space_id, user_id)"
    ))


async def add_vault_tables(conn):
    if not await table_exists(conn, "vault_spaces"):
        await conn.execute(text(
            """
            CREATE TABLE vault_spaces (
                id INTEGER PRIMARY KEY,
                space_id INTEGER UNIQUE,
                created_by TEXT,
                kdf_algo TEXT DEFAULT 'pbkdf2-sha256',
                kdf_iterations INTEGER DEFAULT 30000,
                key_salt TEXT,
                check_nonce TEXT,
                check_ciphertext TEXT,
                check_tag TEXT,
                created_at DATETIME DEFAULT (datetime('now')),
                updated_at DATETIME
            )
            """
        ))
    if not await table_exists(conn, "vault_files"):
        await conn.execute(text(
            """
            CREATE TABLE vault_files (
                id INTEGER PRIMARY KEY,
                space_id INTEGER,
                uploader_user_id TEXT,
                object_key TEXT,
                encrypted_name TEXT,
                name_nonce TEXT,
                name_tag TEXT,
                encrypted_meta TEXT,
                meta_nonce TEXT,
                meta_tag TEXT,
                file_nonce TEXT,
                file_tag TEXT,
                cipher_algo TEXT DEFAULT 'chacha20-hmac-sha256',
                original_size INTEGER DEFAULT 0,
                encrypted_size INTEGER DEFAULT 0,
                content_type TEXT DEFAULT 'application/octet-stream',
                created_at DATETIME DEFAULT (datetime('now')),
                deleted_at DATETIME
            )
            """
        ))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vault_spaces_space_id ON vault_spaces(space_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vault_spaces_created_by ON vault_spaces(created_by)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vault_files_space_id ON vault_files(space_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vault_files_uploader_user_id ON vault_files(uploader_user_id)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_vault_files_object_key ON vault_files(object_key)"))


MIGRATIONS = [
    ("202401_add_deleted_at_to_posts", add_deleted_at_to_posts),
    ("202402_add_share_code_expiry", add_share_code_expiry),
    ("202402_add_user_alias_avatar", add_user_avatar),
    ("202602_add_user_theme_preference", add_user_theme_preference),
    ("202402_add_message_media", add_message_media_columns),
    ("202601_add_operation_logs", add_operation_logs),
    ("202602_add_operation_log_composite_indexes", add_operation_log_composite_indexes),
    ("202601_add_soft_delete_columns", add_soft_delete_columns),
    ("202601_add_space_member_read_columns", add_space_member_read_columns),
    ("202601_add_message_reply_columns", add_message_reply_columns),
    ("202602_add_notify_channels", add_notify_channels),
    ("202603_add_emoji_diary_entries", add_emoji_diary_entries),
    ("202603_add_chat_stickers", add_chat_stickers),
    ("202604_add_vault_tables", add_vault_tables),
    ("202605_add_hot_path_composite_indexes", add_hot_path_composite_indexes),
    ("202606_add_messages_edit_columns", add_messages_edit_columns),
    ("202607_add_message_reactions_table", add_message_reactions_table),
    ("202608_add_messages_mentions_column", add_messages_mentions_column),
    ("202609_add_messages_fts5", add_messages_fts5),
    ("202610_add_comments_parent_id", add_comments_parent_id),
    ("202611_add_chat_reads_table", add_chat_reads_table),
    ("202612_add_space_member_last_read_post_id", add_space_member_last_read_post_id),
]


async def run_migrations(conn):
    await ensure_migrations_table(conn)
    if not is_sqlite(conn):
        # PostgreSQL deployments are initialized from SQLAlchemy metadata.
        # The legacy migration bodies below are SQLite-specific (PRAGMA,
        # sqlite_master, FTS5 triggers), so mark them as applied instead of
        # executing incompatible DDL on Railway Postgres.
        for name, _handler in MIGRATIONS:
            if not await has_migration(conn, name):
                await mark_migration(conn, name)
        return

    for name, handler in MIGRATIONS:
        if await has_migration(conn, name):
            continue
        await handler(conn)
        await mark_migration(conn, name)
