import argparse
import json
import os
import re
import sqlite3
from datetime import datetime
from urllib.parse import urlparse

from app.config import settings
from app.storage.oss import build_object_key, get_bucket, get_public_url, guess_content_type, is_configured

STATIC_MARKERS = ("/static/uploads/", "static/uploads/")
STATIC_URL_RE = re.compile(r"(https?://[^\s\"')]+)?(/static/uploads/[^\s\"')]+)")


def parse_datetime(value):
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.utcfromtimestamp(value)
        except Exception:
            return None
    text = str(value).strip()
    if not text:
        return None
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def extract_filename(url):
    if not url:
        return None
    path = urlparse(url).path if "://" in url else url
    path = path.replace("\\", "/")
    for marker in STATIC_MARKERS:
        if marker in path:
            suffix = path.split(marker, 1)[1]
            return os.path.basename(suffix)
    return None


def ensure_bucket():
    if not is_configured():
        raise RuntimeError("OSS not configured in .env")
    bucket = get_bucket()
    if not bucket:
        raise RuntimeError("OSS not configured in .env")
    base_url = get_public_url("test")
    if not base_url:
        raise RuntimeError("OSS base URL not configured")
    return bucket


def upload_local_file(bucket, local_path, *, category, space_id=None, user_id=None, subdir=None, dt=None, use_original_name=True, cache=None, dry_run=False):
    if cache is None:
        cache = {}
    cache_key = (category, space_id, user_id, subdir, local_path)
    if cache_key in cache:
        return cache[cache_key]
    if not os.path.exists(local_path):
        return None
    object_key = build_object_key(
        category,
        os.path.basename(local_path),
        space_id=space_id,
        user_id=user_id,
        subdir=subdir,
        dt=dt,
        use_original_name=use_original_name,
    )
    url = get_public_url(object_key)
    if not url:
        return None
    if not dry_run:
        content_type = guess_content_type(local_path, None)
        bucket.put_object_from_file(object_key, local_path, headers={"Content-Type": content_type})
    cache[cache_key] = url
    return url


def migrate_messages(conn, bucket, static_dir, dry_run=False):
    rows = conn.execute(
        "SELECT id, space_id, message_type, media_url, created_at FROM messages WHERE media_url IS NOT NULL AND media_url != ''"
    ).fetchall()
    updated = 0
    cache = {}
    for row in rows:
        old_url = row["media_url"]
        filename = extract_filename(old_url)
        if not filename:
            continue
        local_path = os.path.join(static_dir, filename)
        new_url = upload_local_file(
            bucket,
            local_path,
            category="messages",
            space_id=row["space_id"],
            subdir=row["message_type"] or None,
            dt=parse_datetime(row["created_at"]),
            cache=cache,
            dry_run=dry_run,
        )
        if new_url and new_url != old_url:
            updated += 1
            if not dry_run:
                conn.execute("UPDATE messages SET media_url = ? WHERE id = ?", (new_url, row["id"]))
    return updated


def migrate_posts(conn, bucket, static_dir, dry_run=False):
    rows = conn.execute(
        "SELECT id, space_id, media_type, media_urls, created_at FROM posts WHERE media_urls IS NOT NULL AND media_urls != ''"
    ).fetchall()
    updated = 0
    cache = {}
    for row in rows:
        try:
            urls = json.loads(row["media_urls"] or "[]")
        except Exception:
            continue
        changed = False
        new_urls = []
        for url in urls:
            filename = extract_filename(url)
            if not filename:
                new_urls.append(url)
                continue
            local_path = os.path.join(static_dir, filename)
            new_url = upload_local_file(
                bucket,
                local_path,
                category="notes",
                space_id=row["space_id"],
                subdir=row["media_type"] or None,
                dt=parse_datetime(row["created_at"]),
                cache=cache,
                dry_run=dry_run,
            )
            if new_url:
                new_urls.append(new_url)
                if new_url != url:
                    changed = True
            else:
                new_urls.append(url)
        if changed:
            updated += 1
            if not dry_run:
                conn.execute("UPDATE posts SET media_urls = ? WHERE id = ?", (json.dumps(new_urls), row["id"]))
    return updated


def migrate_avatars(conn, bucket, static_dir, dry_run=False):
    rows = conn.execute(
        "SELECT id, space_id, user_id, avatar_url, created_at FROM user_aliases WHERE avatar_url IS NOT NULL AND avatar_url != ''"
    ).fetchall()
    updated = 0
    cache = {}
    for row in rows:
        old_url = row["avatar_url"]
        filename = extract_filename(old_url)
        if not filename:
            continue
        local_path = os.path.join(static_dir, filename)
        new_url = upload_local_file(
            bucket,
            local_path,
            category="avatars",
            space_id=row["space_id"],
            user_id=row["user_id"],
            dt=parse_datetime(row["created_at"]),
            cache=cache,
            dry_run=dry_run,
        )
        if new_url and new_url != old_url:
            updated += 1
            if not dry_run:
                conn.execute("UPDATE user_aliases SET avatar_url = ? WHERE id = ?", (new_url, row["id"]))
    return updated


def migrate_note_content(conn, bucket, static_dir, dry_run=False):
    rows = conn.execute(
        "SELECT id, space_id, content, created_at FROM notes WHERE content IS NOT NULL AND content != ''"
    ).fetchall()
    updated = 0
    cache = {}
    for row in rows:
        content = row["content"] or ""
        if "/static/uploads/" not in content:
            continue

        def replace_match(match):
            full = (match.group(1) or "") + match.group(2)
            filename = extract_filename(full)
            if not filename:
                return full
            local_path = os.path.join(static_dir, filename)
            new_url = upload_local_file(
                bucket,
                local_path,
                category="notes-content",
                space_id=row["space_id"],
                subdir=f"note_{row['id']}",
                dt=parse_datetime(row["created_at"]),
                cache=cache,
                dry_run=dry_run,
            )
            return new_url or full

        new_content = STATIC_URL_RE.sub(replace_match, content)
        if new_content != content:
            updated += 1
            if not dry_run:
                conn.execute("UPDATE notes SET content = ? WHERE id = ?", (new_content, row["id"]))
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=settings.DATABASE_PATH, help="SQLite database path")
    parser.add_argument("--static-dir", default=os.path.join(os.getcwd(), "static", "uploads"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-avatars", action="store_true")
    parser.add_argument("--skip-notes-content", action="store_true")
    args = parser.parse_args()

    bucket = ensure_bucket()
    db_path = args.db
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.getcwd(), db_path)
    static_dir = args.static_dir

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        msg_updated = migrate_messages(conn, bucket, static_dir, dry_run=args.dry_run)
        post_updated = migrate_posts(conn, bucket, static_dir, dry_run=args.dry_run)
        avatar_updated = 0
        if not args.skip_avatars:
            avatar_updated = migrate_avatars(conn, bucket, static_dir, dry_run=args.dry_run)
        notes_updated = 0
        if not args.skip_notes_content:
            notes_updated = migrate_note_content(conn, bucket, static_dir, dry_run=args.dry_run)
        if not args.dry_run:
            conn.commit()
    finally:
        conn.close()

    print(f"messages updated: {msg_updated}")
    print(f"posts updated: {post_updated}")
    if args.skip_avatars:
        print("avatars skipped")
    else:
        print(f"avatars updated: {avatar_updated}")
    if args.skip_notes_content:
        print("notes content skipped")
    else:
        print(f"notes content updated: {notes_updated}")


if __name__ == "__main__":
    main()
