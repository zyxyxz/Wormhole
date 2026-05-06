from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.security import require_space_member, verify_request_user
from app.utils.media import process_avatar_url
from models.emoji_diary import EmojiDiaryEntry
from models.user import UserAlias
from schemas.emoji_diary import (
    EmojiDiaryEntryResponse,
    EmojiDiaryMonthResponse,
    EmojiDiaryUpsertRequest,
    EmojiDiaryUpsertResponse,
)

router = APIRouter()


def _next_month(year: int, month: int) -> tuple[int, int]:
    if month >= 12:
        return year + 1, 1
    return year, month + 1


def _normalize_entry_date(value: str) -> str:
    raw = (value or "").strip()
    try:
        dt = datetime.strptime(raw, "%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="日期格式需为 YYYY-MM-DD")
    return dt.strftime("%Y-%m-%d")


def _build_entry_response(row: EmojiDiaryEntry, alias_map: dict[str, UserAlias] | None = None) -> EmojiDiaryEntryResponse:
    alias_entry = (alias_map or {}).get(row.user_id)
    editor_alias = (alias_entry.alias or "").strip() if alias_entry else ""
    editor_display_name = editor_alias or (row.user_id or "")
    return EmojiDiaryEntryResponse(
        id=row.id,
        space_id=row.space_id,
        user_id=row.user_id,
        editor_alias=editor_alias or None,
        editor_avatar_url=process_avatar_url(alias_entry.avatar_url if alias_entry else None),
        editor_display_name=editor_display_name or None,
        entry_date=row.entry_date,
        emoji=row.emoji or "",
        note=row.note or "",
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _entry_version(row: EmojiDiaryEntry) -> tuple[float, int]:
    dt = row.updated_at or row.created_at
    ts = 0.0
    if isinstance(dt, datetime):
        try:
            ts = dt.timestamp()
        except Exception:
            ts = 0.0
    return ts, int(row.id or 0)


def _pick_latest_entries(rows: list[EmojiDiaryEntry]) -> list[EmojiDiaryEntry]:
    latest_map: dict[str, EmojiDiaryEntry] = {}
    for row in rows or []:
        if not row or not row.entry_date:
            continue
        current = latest_map.get(row.entry_date)
        if not current or _entry_version(row) > _entry_version(current):
            latest_map[row.entry_date] = row
    return [latest_map[key] for key in sorted(latest_map.keys())]


async def _load_alias_map(db: AsyncSession, space_id: int, user_ids: set[str]) -> dict[str, UserAlias]:
    if not user_ids:
        return {}
    result = await db.execute(
        select(UserAlias).where(
            UserAlias.space_id == space_id,
            UserAlias.user_id.in_(list(user_ids)),
        )
    )
    return {row.user_id: row for row in result.scalars().all()}


@router.get("/month", response_model=EmojiDiaryMonthResponse)
async def get_month_entries(
    space_id: int,
    year: int,
    month: int,
    request: Request,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if year < 1970 or year > 2100:
        raise HTTPException(status_code=400, detail="年份不合法")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="月份不合法")
    actor_user_id = verify_request_user(request, user_id, required=True)
    await require_space_member(db, space_id, actor_user_id)
    start = f"{year:04d}-{month:02d}-01"
    next_year, next_month = _next_month(year, month)
    end = f"{next_year:04d}-{next_month:02d}-01"
    result = await db.execute(
        select(EmojiDiaryEntry).where(
            and_(
                EmojiDiaryEntry.space_id == space_id,
                EmojiDiaryEntry.entry_date >= start,
                EmojiDiaryEntry.entry_date < end,
            )
        )
    )
    rows = _pick_latest_entries(result.scalars().all())
    alias_map = await _load_alias_map(db, space_id, {row.user_id for row in rows if row.user_id})
    return EmojiDiaryMonthResponse(
        year=year,
        month=month,
        entries=[_build_entry_response(row, alias_map) for row in rows],
    )


@router.post("/upsert", response_model=EmojiDiaryUpsertResponse)
async def upsert_entry(
    payload: EmojiDiaryUpsertRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, payload.user_id, required=True)
    await require_space_member(db, payload.space_id, actor_user_id)
    entry_date = _normalize_entry_date(payload.entry_date)
    emoji = (payload.emoji or "").strip()
    note = (payload.note or "").strip()

    existing_rows = (
        await db.execute(
            select(EmojiDiaryEntry).where(
                EmojiDiaryEntry.space_id == payload.space_id,
                EmojiDiaryEntry.entry_date == entry_date,
            )
        )
    ).scalars().all()

    existing = None
    redundant_rows: list[EmojiDiaryEntry] = []
    if existing_rows:
        existing = next((row for row in existing_rows if row.user_id == actor_user_id), None)
        if not existing:
            existing = max(existing_rows, key=_entry_version)
        redundant_rows = [row for row in existing_rows if row.id != existing.id]

    if not emoji and not note:
        for row in existing_rows:
            await db.delete(row)
        if existing_rows:
            await db.commit()
        return EmojiDiaryUpsertResponse(success=True, removed=True, entry=None)

    if existing:
        existing.user_id = actor_user_id
        existing.emoji = emoji
        existing.note = note
        existing.updated_at = datetime.utcnow()
        for row in redundant_rows:
            await db.delete(row)
        await db.commit()
        await db.refresh(existing)
        alias_map = await _load_alias_map(db, payload.space_id, {existing.user_id} if existing.user_id else set())
        return EmojiDiaryUpsertResponse(
            success=True,
            removed=False,
            entry=_build_entry_response(existing, alias_map),
        )

    row = EmojiDiaryEntry(
        space_id=payload.space_id,
        user_id=actor_user_id,
        entry_date=entry_date,
        emoji=emoji,
        note=note,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    alias_map = await _load_alias_map(db, payload.space_id, {row.user_id} if row.user_id else set())
    return EmojiDiaryUpsertResponse(
        success=True,
        removed=False,
        entry=_build_entry_response(row, alias_map),
    )
