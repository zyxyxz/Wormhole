from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from models.notes import Note as DBNote
from models.user import UserAlias
from schemas.notes import NoteCreate, NoteResponse, NoteListResponse, NoteBase, NoteUpdate
from fastapi import Query
from datetime import datetime
from app.utils.operation_log import add_operation_log

router = APIRouter()

@router.get("", response_model=NoteListResponse)
async def get_notes(
    space_id: int,
    db: AsyncSession = Depends(get_db)
):
    query = select(DBNote).where(DBNote.space_id == space_id, DBNote.deleted_at.is_(None)).order_by(DBNote.created_at.desc())
    result = await db.execute(query)
    notes = result.scalars().all()
    # 别名映射
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    resp = [
        NoteResponse(
            id=n.id,
            space_id=space_id,  # not declared but harmless in BaseModel; keep only required
            title=n.title,
            content=n.content,
            user_id=n.user_id,
            alias=alias_map.get(n.user_id),
            created_at=n.created_at,
            updated_at=n.updated_at or n.created_at,
        ) for n in notes
    ]
    return NoteListResponse(notes=resp)

@router.post("/create", response_model=NoteResponse)
async def create_note(
    note: NoteCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    db_note = DBNote(**note.dict())
    db.add(db_note)
    await db.commit()
    await db.refresh(db_note)
    # 确保返回有updated_at
    if not db_note.updated_at:
        db_note.updated_at = db_note.created_at
    # 构造响应，附带别名
    alias = None
    alias_row = await db.execute(select(UserAlias).where(UserAlias.space_id == db_note.space_id, UserAlias.user_id == db_note.user_id))
    ua = alias_row.scalar_one_or_none()
    alias = ua.alias if ua else None
    add_operation_log(
        db,
        user_id=db_note.user_id,
        action="note_create",
        space_id=db_note.space_id,
        detail={"note_id": db_note.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return NoteResponse(
        id=db_note.id,
        title=db_note.title,
        content=db_note.content,
        user_id=db_note.user_id,
        alias=alias,
        created_at=db_note.created_at,
        updated_at=db_note.updated_at,
    )

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
    # 权限：作者本人可以编辑全部；他人仅在 editable_by_others=True 时可改 title/content，不可改 editable_by_others
    is_author = (note.user_id == db_note.user_id)
    if not is_author and not getattr(db_note, 'editable_by_others', True):
        raise HTTPException(status_code=403, detail="无权限编辑该笔记")
    data = note.dict(exclude_unset=True)
    # 防止非作者修改 editable_by_others
    if not is_author and 'editable_by_others' in data:
        data.pop('editable_by_others')
    # user_id 参数不写回
    data.pop('user_id', None)
    for key, value in data.items():
        setattr(db_note, key, value)
    
    await db.commit()
    await db.refresh(db_note)
    alias = None
    alias_row = await db.execute(select(UserAlias).where(UserAlias.space_id == db_note.space_id, UserAlias.user_id == db_note.user_id))
    ua = alias_row.scalar_one_or_none()
    alias = ua.alias if ua else None
    add_operation_log(
        db,
        user_id=note.user_id,
        action="note_update",
        space_id=db_note.space_id,
        detail={"note_id": db_note.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return NoteResponse(
        id=db_note.id,
        title=db_note.title,
        content=db_note.content,
        user_id=db_note.user_id,
        alias=alias,
        created_at=db_note.created_at,
        updated_at=db_note.updated_at or db_note.created_at,
    )

@router.delete("/{note_id}")
async def delete_note(note_id: int, request: Request, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    q = select(DBNote).where(DBNote.id == note_id, DBNote.deleted_at.is_(None))
    r = await db.execute(q)
    db_note = r.scalar_one_or_none()
    if not db_note:
        raise HTTPException(status_code=404, detail="笔记不存在")
    if user_id != db_note.user_id:
        raise HTTPException(status_code=403, detail="仅作者可删除")
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
