from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from models.space import Space, SpaceMapping, SpaceCode, ShareCode
import random
import string

router = APIRouter()

@router.post("/space/modify-code")
async def modify_space_code(
    space_id: int,
    new_code: str,
    db: AsyncSession = Depends(get_db)
):
    if not new_code.isdigit() or len(new_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")
    
    # 检查新空间号是否已被使用
    existing_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == new_code))).scalar_one_or_none()
    if existing_alias:
        raise HTTPException(status_code=400, detail="该空间号已被使用")
    
    # 更新空间号
    space_query = select(Space).where(Space.id == space_id)
    result = await db.execute(space_query)
    space = result.scalar_one_or_none()
    
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    
    space.code = new_code
    await db.commit()
    
    return {"success": True, "message": "空间号修改成功"}

@router.post("/space/delete")
async def delete_space(
    space_id: int,
    db: AsyncSession = Depends(get_db)
):
    # 删除空间及相关数据
    await db.execute(delete(Space).where(Space.id == space_id))
    await db.commit()
    
    return {"success": True, "message": "空间删除成功"}

@router.post("/space/share")
async def share_space(
    space_id: int,
    db: AsyncSession = Depends(get_db)
):
    # 生成8位随机分享码
    while True:
        share_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        exists = await db.execute(select(ShareCode).where(ShareCode.code == share_code))
        if not exists.scalar_one_or_none():
            break

    db.add(ShareCode(space_id=space_id, code=share_code))
    await db.commit()
    return {"share_code": share_code}
