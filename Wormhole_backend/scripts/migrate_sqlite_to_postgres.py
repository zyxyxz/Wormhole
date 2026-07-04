"""One-shot data migration from the local SQLite DB to Railway Postgres.

Usage:
    DATABASE_URL=postgresql://... python scripts/migrate_sqlite_to_postgres.py \
        --sqlite ./wormhole.db --truncate
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sqlite3
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import asyncpg
from sqlalchemy import Boolean, DateTime, Numeric

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import Base  # noqa: E402

import models.chat  # noqa: F401, E402
import models.chat_read  # noqa: F401, E402
import models.chat_sticker  # noqa: F401, E402
import models.emoji_diary  # noqa: F401, E402
import models.feed  # noqa: F401, E402
import models.logs  # noqa: F401, E402
import models.message_reaction  # noqa: F401, E402
import models.notes  # noqa: F401, E402
import models.notify  # noqa: F401, E402
import models.space  # noqa: F401, E402
import models.system  # noqa: F401, E402
import models.user  # noqa: F401, E402
import models.vault  # noqa: F401, E402
import models.wallet  # noqa: F401, E402


def postgres_url_for_asyncpg(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + url[len("postgresql+asyncpg://"):]
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def sqlite_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {row[0] for row in rows}


def sqlite_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({quote_ident(table_name)})")}


def parse_datetime(value: Any) -> Any:
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


def convert_value(value: Any, column) -> Any:
    if isinstance(column.type, Boolean):
        if value is None or isinstance(value, bool):
            return value
        return bool(value)
    if isinstance(column.type, DateTime):
        return parse_datetime(value)
    if isinstance(column.type, Numeric):
        if value is None or isinstance(value, Decimal):
            return value
        return Decimal(str(value))
    return value


async def truncate_tables(pg: asyncpg.Connection, table_names: list[str]) -> None:
    if not table_names:
        return
    joined = ", ".join(quote_ident(name) for name in table_names)
    await pg.execute(f"TRUNCATE {joined} RESTART IDENTITY CASCADE")


async def reset_sequences(pg: asyncpg.Connection, table_names: list[str]) -> None:
    for table_name in table_names:
        await pg.execute(
            """
            SELECT setval(
                pg_get_serial_sequence($1, $2),
                COALESCE((SELECT MAX(id) FROM """ + quote_ident(table_name) + """), 1),
                (SELECT MAX(id) FROM """ + quote_ident(table_name) + """) IS NOT NULL
            )
            WHERE pg_get_serial_sequence($1, $2) IS NOT NULL
            """,
            table_name,
            "id",
        )


async def migrate(args: argparse.Namespace) -> None:
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite DB not found: {sqlite_path}")

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    tables_in_sqlite = sqlite_tables(sqlite_conn)

    ordered_tables = [table for table in Base.metadata.sorted_tables if table.name in tables_in_sqlite]
    table_names = [table.name for table in ordered_tables]

    pg = await asyncpg.connect(postgres_url_for_asyncpg(database_url))
    try:
        if args.truncate:
            await truncate_tables(pg, list(reversed(table_names)))

        for table in ordered_tables:
            table_name = table.name
            available_columns = sqlite_columns(sqlite_conn, table_name)
            columns = [column for column in table.columns if column.name in available_columns]
            if not columns:
                print(f"skip {table_name}: no matching columns")
                continue

            column_names = [column.name for column in columns]
            select_sql = (
                "SELECT "
                + ", ".join(quote_ident(name) for name in column_names)
                + f" FROM {quote_ident(table_name)}"
            )
            if "id" in available_columns:
                select_sql += " ORDER BY id"
            rows = sqlite_conn.execute(select_sql).fetchall()
            if not rows:
                print(f"{table_name}: 0 rows")
                continue

            insert_sql = (
                f"INSERT INTO {quote_ident(table_name)} "
                + "("
                + ", ".join(quote_ident(name) for name in column_names)
                + ") VALUES ("
                + ", ".join(f"${index}" for index in range(1, len(column_names) + 1))
                + ") ON CONFLICT DO NOTHING"
            )

            values = [
                tuple(convert_value(row[column.name], column) for column in columns)
                for row in rows
            ]
            await pg.executemany(insert_sql, values)
            pg_count = await pg.fetchval(f"SELECT COUNT(*) FROM {quote_ident(table_name)}")
            print(f"{table_name}: sqlite={len(rows)} postgres={pg_count}")

        await reset_sequences(pg, table_names)
    finally:
        await pg.close()
        sqlite_conn.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", default=str(BACKEND_ROOT / "wormhole.db"))
    parser.add_argument("--database-url", default="")
    parser.add_argument("--truncate", action="store_true")
    args = parser.parse_args()
    asyncio.run(migrate(args))


if __name__ == "__main__":
    main()
