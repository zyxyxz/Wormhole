from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from models.logs import OperationLog
from schemas.logs import LogCreateRequest, LogListResponse, LogEntry
from app.api.settings import verify_admin

router = APIRouter()


@router.post("/track")
async def track_log(payload: LogCreateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not payload.user_id or not payload.action:
        raise HTTPException(status_code=400, detail="缺少用户或动作")
    ip = request.client.host if request.client else None
    log = OperationLog(
        user_id=payload.user_id,
        action=payload.action,
        page=payload.page,
        detail=payload.detail,
        space_id=payload.space_id,
        ip=ip,
        user_agent=request.headers.get("user-agent")
    )
    db.add(log)
    return {"success": True}


@router.get("/admin/list", response_model=LogListResponse)
async def admin_list_logs(
    user_id: str,
    room_code: str,
    target_user_id: str | None = None,
    action: str | None = None,
    page: str | None = None,
    space_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    verify_admin(user_id, room_code)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    filters = []
    if target_user_id:
        filters.append(OperationLog.user_id == target_user_id)
    if action:
        filters.append(OperationLog.action == action)
    if page:
        filters.append(OperationLog.page == page)
    if space_id is not None:
        filters.append(OperationLog.space_id == space_id)

    total = (await db.execute(select(func.count(OperationLog.id)).where(*filters))).scalar() or 0

    rows = await db.execute(
        select(OperationLog)
        .where(*filters)
        .order_by(OperationLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    logs = rows.scalars().all()

    return LogListResponse(
        logs=[
            LogEntry(
                id=log.id,
                user_id=log.user_id,
                action=log.action,
                page=log.page,
                detail=log.detail,
                space_id=log.space_id,
                ip=log.ip,
                created_at=log.created_at,
            ) for log in logs
        ],
        total=total,
        limit=limit,
        offset=offset
    )
