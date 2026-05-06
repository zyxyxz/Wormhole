"""Search endpoints (SQLite FTS5-backed).

Task 30: full-text search over messages.content via the `messages_fts`
virtual table created in `app.migrations.add_messages_fts5`. Membership is
required — searches are scoped to a single space.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.security import require_space_member, verify_request_user
from app.utils.media import process_avatar_url

router = APIRouter()


@router.get("/messages")
async def search_messages(
    space_id: int,
    q: str,
    request: Request,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Full-text search across messages in a single space.

    Auth: caller must be a space member (or owner). The query is wrapped as
    an FTS5 phrase (`"..."`) so the inverted index handles substring/CJK
    matching via `unicode61` tokenisation; double-quotes inside `q` are
    escaped by doubling them, the only character that matters for phrase
    syntax. Results are joined back to `messages` (and aliases) so the
    client receives a fully-shaped response without a second round-trip.
    """
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)

    cleaned_q = (q or "").strip()
    if not cleaned_q:
        return {"messages": []}
    if len(cleaned_q) > 100:
        raise HTTPException(status_code=400, detail="搜索关键词过长")

    safe_limit = max(1, min(int(limit or 20), 50))

    # Phrase-quote the query so FTS5 parses it as a single token sequence.
    # Doubling embedded `"` is the documented escape for FTS5 phrase syntax.
    safe_q = cleaned_q.replace('"', '""')
    fts_query = f'"{safe_q}"'

    rows = (await db.execute(text(
        """
        SELECT m.id, m.user_id, m.content, m.message_type, m.created_at, m.space_id,
               ua.alias, ua.avatar_url
        FROM messages_fts fts
        JOIN messages m ON m.id = fts.rowid
        LEFT JOIN user_aliases ua ON ua.space_id = m.space_id AND ua.user_id = m.user_id
        WHERE fts.content MATCH :q
          AND m.space_id = :space_id
          AND m.deleted_at IS NULL
        ORDER BY m.id DESC
        LIMIT :limit
        """
    ), {"q": fts_query, "space_id": space_id, "limit": safe_limit})).fetchall()

    return {
        "messages": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "content": r.content,
                "message_type": r.message_type,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "space_id": r.space_id,
                "alias": r.alias,
                "avatar_url": process_avatar_url(r.avatar_url),
            }
            for r in rows
        ],
    }
