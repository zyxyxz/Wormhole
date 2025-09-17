from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from models.space import Space, SpaceMapping
from models.space import Space as DBSpace
from models.space import Space
from models.space import SpaceMapping
from models.space import SpaceCode, ShareCode, SpaceMember, SpaceBlock
from models.chat import Message
from models.notes import Note
from models.wallet import Wallet, Transaction
from pydantic import BaseModel
from schemas.space import SpaceEnterRequest, SpaceEnterResponse, MembersListResponse, MemberResponse, RemoveMemberRequest, BlockMemberRequest, UnblockMemberRequest, BlocksListResponse
import random

router = APIRouter()

class ShareRequest(BaseModel):
    space_id: int

class ModifyCodeRequest(BaseModel):
    space_id: int
    new_code: str

class DeleteRequest(BaseModel):
    space_id: int
    operator_user_id: str

class JoinByShareRequest(BaseModel):
    share_code: str
    new_code: str

class SpaceInfoResponse(BaseModel):
    space_id: int
    code: str
    owner_user_id: str | None = None

@router.post("/enter", response_model=SpaceEnterResponse)
async def enter_space(
    request: SpaceEnterRequest,
    db: AsyncSession = Depends(get_db)
):
    # 验证空间号格式
    if not request.space_code.isdigit() or len(request.space_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")
    
    # 先查主空间码
    query = select(Space).where(Space.code == request.space_code)
    result = await db.execute(query)
    space = result.scalar_one_or_none()

    # 再查别名空间码
    if not space:
        alias_q = select(SpaceCode).where(SpaceCode.code == request.space_code)
        alias_res = await db.execute(alias_q)
        alias = alias_res.scalar_one_or_none()
        if alias:
            space_q = select(Space).where(Space.id == alias.space_id)
            space_res = await db.execute(space_q)
            space = space_res.scalar_one_or_none()
    
    if not space:
        # 创建新空间
        space = Space(code=request.space_code, owner_user_id=request.user_id)
        db.add(space)
        await db.commit()
        await db.refresh(space)
    else:
        # 若尚无房主且本次有用户，设为房主
        if not space.owner_user_id and request.user_id:
            space.owner_user_id = request.user_id
            await db.commit()
    # 黑名单校验
    if request.user_id:
        blk = await db.execute(select(SpaceBlock).where(SpaceBlock.space_id == space.id, SpaceBlock.user_id == request.user_id))
        if blk.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="你已被房主移出该空间")
    # 记录成员
    if request.user_id:
        mem_res = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space.id, SpaceMember.user_id == request.user_id))
        mem = mem_res.scalar_one_or_none()
        if not mem:
            db.add(SpaceMember(space_id=space.id, user_id=request.user_id))
            await db.commit()
    
    return SpaceEnterResponse(
        success=True,
        message="进入空间成功",
        space_id=space.id
    )

@router.post("/share")
async def share_space(payload: ShareRequest, db: AsyncSession = Depends(get_db)):
    # 校验空间存在
    result = await db.execute(select(Space).where(Space.id == payload.space_id))
    space = result.scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")

    # 生成唯一分享码
    while True:
        code = ''.join(random.choices('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=8))
        exists = await db.execute(select(ShareCode).where(ShareCode.code == code))
        if not exists.scalar_one_or_none():
            break

    share = ShareCode(space_id=payload.space_id, code=code)
    db.add(share)
    await db.commit()
    return {"share_code": code}

@router.post("/join-by-share")
async def join_by_share(payload: JoinByShareRequest, db: AsyncSession = Depends(get_db)):
    # 校验新空间号
    if not payload.new_code.isdigit() or len(payload.new_code) != 6:
        raise HTTPException(status_code=400, detail="新空间号必须是6位数字")
    # 校验分享码
    res = await db.execute(select(ShareCode).where(ShareCode.code == payload.share_code))
    share = res.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="分享口令无效")
    # 新空间号是否被使用（主表或别名表）
    exist_main = (await db.execute(select(Space).where(Space.code == payload.new_code))).scalar_one_or_none()
    exist_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == payload.new_code))).scalar_one_or_none()
    if exist_main or exist_alias:
        raise HTTPException(status_code=400, detail="该空间号已被使用")
    # 创建别名
    alias = SpaceCode(space_id=share.space_id, code=payload.new_code)
    db.add(alias)
    await db.commit()
    return {"success": True, "space_id": share.space_id}

@router.post("/modify-code")
async def modify_space_code(payload: ModifyCodeRequest, db: AsyncSession = Depends(get_db)):
    if not payload.new_code.isdigit() or len(payload.new_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")
    # 校验新空间号在主表和别名表中不可用
    exist_main = (await db.execute(select(Space).where(Space.code == payload.new_code))).scalar_one_or_none()
    exist_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == payload.new_code))).scalar_one_or_none()
    if exist_main or exist_alias:
        raise HTTPException(status_code=400, detail="该空间号已被使用")
    res = await db.execute(select(Space).where(Space.id == payload.space_id))
    space = res.scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    space.code = payload.new_code
    await db.commit()
    return {"success": True, "message": "空间号修改成功"}

@router.post("/delete")
async def delete_space(payload: DeleteRequest, db: AsyncSession = Depends(get_db)):
    # 级联删除相关数据
    # 权限：仅房主可删除
    sp = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not sp:
        raise HTTPException(status_code=404, detail="空间不存在")
    if sp.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    await db.execute(delete(Message).where(Message.space_id == payload.space_id))
    await db.execute(delete(Note).where(Note.space_id == payload.space_id))
    # 删除钱包及交易
    wallet_res = await db.execute(select(Wallet).where(Wallet.space_id == payload.space_id))
    wallet = wallet_res.scalar_one_or_none()
    if wallet:
        await db.execute(delete(Transaction).where(Transaction.wallet_id == wallet.id))
        await db.execute(delete(Wallet).where(Wallet.id == wallet.id))
    # 删除别名与分享码
    await db.execute(delete(SpaceCode).where(SpaceCode.space_id == payload.space_id))
    await db.execute(delete(ShareCode).where(ShareCode.space_id == payload.space_id))
    # 删除空间
    await db.execute(delete(Space).where(Space.id == payload.space_id))
    await db.commit()
    return {"success": True, "message": "空间删除成功"}

@router.get("/info", response_model=SpaceInfoResponse)
async def space_info(space_id: int, db: AsyncSession = Depends(get_db)):
    space = (await db.execute(select(Space).where(Space.id == space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    return SpaceInfoResponse(space_id=space.id, code=space.code, owner_user_id=space.owner_user_id)

@router.get("/members", response_model=MembersListResponse)
async def get_members(space_id: int, db: AsyncSession = Depends(get_db)):
    mem_rows = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space_id))
    members = mem_rows.scalars().all()
    # 映射别名
    from models.user import UserAlias
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    return MembersListResponse(members=[MemberResponse(user_id=m.user_id, alias=alias_map.get(m.user_id)) for m in members])

@router.post("/remove-member")
async def remove_member(payload: RemoveMemberRequest, db: AsyncSession = Depends(get_db)):
    # 只有房主可操作
    space = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    await db.execute(delete(SpaceMember).where(SpaceMember.space_id == payload.space_id, SpaceMember.user_id == payload.member_user_id))
    await db.commit()
    return {"success": True}

@router.get("/blocks", response_model=BlocksListResponse)
async def list_blocks(space_id: int, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(SpaceBlock).where(SpaceBlock.space_id == space_id))
    blocks = rows.scalars().all()
    return BlocksListResponse(blocks=[MemberResponse(user_id=b.user_id, alias=None) for b in blocks])

@router.post("/block-member")
async def block_member(payload: BlockMemberRequest, db: AsyncSession = Depends(get_db)):
    space = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    # 先从成员列表移除
    await db.execute(delete(SpaceMember).where(SpaceMember.space_id == payload.space_id, SpaceMember.user_id == payload.member_user_id))
    # 加入黑名单
    exist = (await db.execute(select(SpaceBlock).where(SpaceBlock.space_id == payload.space_id, SpaceBlock.user_id == payload.member_user_id))).scalar_one_or_none()
    if not exist:
        db.add(SpaceBlock(space_id=payload.space_id, user_id=payload.member_user_id))
    await db.commit()
    return {"success": True}

@router.post("/unblock-member")
async def unblock_member(payload: UnblockMemberRequest, db: AsyncSession = Depends(get_db)):
    space = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    await db.execute(delete(SpaceBlock).where(SpaceBlock.space_id == payload.space_id, SpaceBlock.user_id == payload.member_user_id))
    await db.commit()
    return {"success": True}
