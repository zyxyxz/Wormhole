from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.security import require_space_member, verify_request_user
from models.emoji_diary import EmojiDiaryEntry
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


def _build_entry_response(row: EmojiDiaryEntry) -> EmojiDiaryEntryResponse:
    return EmojiDiaryEntryResponse(
        id=row.id,
        space_id=row.space_id,
        user_id=row.user_id,
        entry_date=row.entry_date,
        emoji=row.emoji or "",
        note=row.note or "",
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


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
    target_user_id = user_id or actor_user_id
    start = f"{year:04d}-{month:02d}-01"
    next_year, next_month = _next_month(year, month)
    end = f"{next_year:04d}-{next_month:02d}-01"
    result = await db.execute(
        select(EmojiDiaryEntry).where(
            and_(
                EmojiDiaryEntry.space_id == space_id,
                EmojiDiaryEntry.user_id == target_user_id,
                EmojiDiaryEntry.entry_date >= start,
                EmojiDiaryEntry.entry_date < end,
            )
        ).order_by(EmojiDiaryEntry.entry_date.asc())
    )
    rows = result.scalars().all()
    return EmojiDiaryMonthResponse(
        year=year,
        month=month,
        entries=[_build_entry_response(row) for row in rows],
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

    existing = (
        await db.execute(
            select(EmojiDiaryEntry).where(
                EmojiDiaryEntry.space_id == payload.space_id,
                EmojiDiaryEntry.user_id == actor_user_id,
                EmojiDiaryEntry.entry_date == entry_date,
            )
        )
    ).scalar_one_or_none()

    if not emoji and not note:
        if existing:
            await db.delete(existing)
            await db.commit()
        return EmojiDiaryUpsertResponse(success=True, removed=True, entry=None)

    if existing:
        existing.emoji = emoji
        existing.note = note
        existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        return EmojiDiaryUpsertResponse(
            success=True,
            removed=False,
            entry=_build_entry_response(existing),
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
    return EmojiDiaryUpsertResponse(
        success=True,
        removed=False,
        entry=_build_entry_response(row),
    )
