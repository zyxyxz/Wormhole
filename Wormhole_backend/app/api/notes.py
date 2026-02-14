from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.security import verify_request_user, require_space_member
from models.notes import Note as DBNote
from models.user import UserAlias
from schemas.notes import NoteCreate, NoteResponse, NoteListResponse, NoteUpdate
from fastapi import Query
from datetime import datetime
from app.utils.operation_log import add_operation_log

router = APIRouter()


def _build_note_response(note: DBNote, alias_map: dict[str, str], viewer_user_id: str | None = None) -> NoteResponse:
    owner_id = note.user_id or ""
    can_edit = bool(viewer_user_id and (viewer_user_id == owner_id or bool(note.editable_by_others)))
    return NoteResponse(
        id=note.id,
        space_id=note.space_id,
        title=note.title or "",
        content=note.content or "",
        user_id=owner_id,
        alias=alias_map.get(owner_id),
        editable_by_others=bool(note.editable_by_others),
        can_edit=can_edit,
        created_at=note.created_at,
        updated_at=note.updated_at or note.created_at,
    )


@router.get("", response_model=NoteListResponse)
async def get_notes(
    space_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    query = (
        select(DBNote)
        .where(DBNote.space_id == space_id, DBNote.deleted_at.is_(None))
        .order_by(DBNote.updated_at.desc(), DBNote.id.desc())
    )
    result = await db.execute(query)
    notes = result.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    resp = [_build_note_response(n, alias_map, actor_user_id) for n in notes]
    return NoteListResponse(notes=resp)


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note_detail(
    note_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request)
    note = (
        await db.execute(
            select(DBNote).where(DBNote.id == note_id, DBNote.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    await require_space_member(db, note.space_id, actor_user_id)
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == note.space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    return _build_note_response(note, alias_map, actor_user_id)


@router.post("/create", response_model=NoteResponse)
async def create_note(
    note: NoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request, note.user_id)
    await require_space_member(db, note.space_id, actor_user_id)
    db_note = DBNote(**note.dict())
    db.add(db_note)
    await db.commit()
    await db.refresh(db_note)
    if not db_note.updated_at:
        db_note.updated_at = db_note.created_at
    alias_row = await db.execute(select(UserAlias).where(UserAlias.space_id == db_note.space_id, UserAlias.user_id == db_note.user_id))
    ua = alias_row.scalar_one_or_none()
    alias_map = {db_note.user_id: (ua.alias if ua else None)}
    add_operation_log(
        db,
        user_id=db_note.user_id,
        action="note_create",
        space_id=db_note.space_id,
        detail={"note_id": db_note.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return _build_note_response(db_note, alias_map, actor_user_id)

@router.put("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: int,
    note: NoteUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    query = select(DBNote).where(DBNote.id == note_id, DBNote.deleted_at.is_(None))
    result = await db.execute(query)
    db_note = result.scalar_one_or_none()
    
    if not db_note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    actor_user_id = verify_request_user(request, note.user_id)
    await require_space_member(db, db_note.space_id, actor_user_id)
    is_author = (note.user_id == db_note.user_id)
    if not is_author and not bool(db_note.editable_by_others):
        raise HTTPException(status_code=403, detail="无权限编辑该笔记")
    data = note.dict(exclude_unset=True)
    if not is_author and 'editable_by_others' in data:
        data.pop('editable_by_others')
    data.pop('user_id', None)
    for key, value in data.items():
        setattr(db_note, key, value)
    
    await db.commit()
    await db.refresh(db_note)
    alias = None
    alias_row = await db.execute(select(UserAlias).where(UserAlias.space_id == db_note.space_id, UserAlias.user_id == db_note.user_id))
    ua = alias_row.scalar_one_or_none()
    alias_map = {db_note.user_id: (ua.alias if ua else None)}
    add_operation_log(
        db,
        user_id=note.user_id,
        action="note_update",
        space_id=db_note.space_id,
        detail={"note_id": db_note.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return _build_note_response(db_note, alias_map, actor_user_id)

@router.delete("/{note_id}")
async def delete_note(note_id: int, request: Request, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, user_id)
    q = select(DBNote).where(DBNote.id == note_id, DBNote.deleted_at.is_(None))
    r = await db.execute(q)
    db_note = r.scalar_one_or_none()
    if not db_note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if user_id != db_note.user_id:
        raise HTTPException(status_code=403, detail="仅作者可删除")
    await require_space_member(db, db_note.space_id, actor_user_id)
    db_note.deleted_at = datetime.utcnow()
    add_operation_log(
        db,
        user_id=user_id,
        action="note_delete",
        space_id=db_note.space_id,
        detail={"note_id": db_note.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    await db.commit()
    return {"success": True}
