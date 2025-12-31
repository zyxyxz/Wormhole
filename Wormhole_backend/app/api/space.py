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
from models.user import UserAlias
from pydantic import BaseModel
from schemas.space import SpaceEnterRequest, SpaceEnterResponse, MembersListResponse, MemberResponse, RemoveMemberRequest, BlockMemberRequest, UnblockMemberRequest, BlocksListResponse
import random
from datetime import datetime, timedelta
from app.config import settings

router = APIRouter()


def is_super_admin(user_id: str | None) -> bool:
    if not user_id:
        return False
    admin_ids = [i.strip() for i in (settings.SUPER_ADMIN_OPENIDS or '').split(',') if i.strip()]
    return user_id in admin_ids

class ShareRequest(BaseModel):
    space_id: int
    operator_user_id: str

class ModifyCodeRequest(BaseModel):
    space_id: int
    new_code: str

class DeleteRequest(BaseModel):
    space_id: int
    operator_user_id: str

class JoinByShareRequest(BaseModel):
    share_code: str
    new_code: str
    user_id: str

class SpaceInfoResponse(BaseModel):
    space_id: int
    code: str
    owner_user_id: str | None = None

@router.post("/enter", response_model=SpaceEnterResponse)
async def enter_space(
    request: SpaceEnterRequest,
    db: AsyncSession = Depends(get_db)
):
    # 需要明确的用户身份，才能保证空间号仅在用户范围内唯一
    if not request.user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")

    # 验证空间号格式
    if not request.space_code.isdigit() or len(request.space_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")

    # 管理员隐形入口
    admin_code = settings.SUPER_ADMIN_ROOM_CODE or ''
    if admin_code and request.space_code == admin_code and is_super_admin(request.user_id):
        return SpaceEnterResponse(
            success=True,
            message="管理员入口",
            admin_entry=True
        )

    # 先在当前用户的空间中查找，保证不同用户互不影响
    query = select(Space).where(
        Space.code == request.space_code,
        Space.owner_user_id == request.user_id
    )
    result = await db.execute(query)
    space = result.scalar_one_or_none()

    # 再查别名空间码（被分享的空间）
    if not space:
        alias_q = select(SpaceCode).where(SpaceCode.code == request.space_code)
        alias_res = await db.execute(alias_q)
        alias = alias_res.scalar_one_or_none()
        if alias:
            space_q = select(Space).where(Space.id == alias.space_id)
            space_res = await db.execute(space_q)
            space = space_res.scalar_one_or_none()
    
    if not space:
        # 当前用户首次使用该空间号，创建属于自己的空间
        space = Space(code=request.space_code, owner_user_id=request.user_id)
        db.add(space)
        await db.commit()
        await db.refresh(space)
    # 黑名单校验
    if request.user_id:
        blk = await db.execute(select(SpaceBlock).where(SpaceBlock.space_id == space.id, SpaceBlock.user_id == request.user_id))
        if blk.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="你已被房主移出该空间")
    # 记录成员与空间映射
    commit_needed = False
    if request.user_id:
        mem_res = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space.id, SpaceMember.user_id == request.user_id))
        mem = mem_res.scalar_one_or_none()
        if not mem:
            db.add(SpaceMember(space_id=space.id, user_id=request.user_id))
            commit_needed = True
        # 保存用户使用的空间码（用于分享场景清理别名）
        if space.owner_user_id != request.user_id:
            map_res = await db.execute(
                select(SpaceMapping).where(
                    SpaceMapping.space_id == space.id,
                    SpaceMapping.user_id == request.user_id,
                    SpaceMapping.space_code == request.space_code
                )
            )
            mapping = map_res.scalar_one_or_none()
            if not mapping:
                db.add(SpaceMapping(space_id=space.id, user_id=request.user_id, space_code=request.space_code))
                commit_needed = True
    if commit_needed:
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

    if not payload.operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")

    # 生成唯一分享码
    while True:
        code = ''.join(random.choices('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=8))
        exists = await db.execute(select(ShareCode).where(ShareCode.code == code))
        if not exists.scalar_one_or_none():
            break

    expires_at = datetime.utcnow() + timedelta(minutes=5)
    share = ShareCode(space_id=payload.space_id, code=code, expires_at=expires_at, used=False)
    db.add(share)
    await db.commit()
    return {"share_code": code, "expires_in": 300}

@router.post("/join-by-share")
async def join_by_share(payload: JoinByShareRequest, db: AsyncSession = Depends(get_db)):
    # 校验新空间号
    if not payload.new_code.isdigit() or len(payload.new_code) != 6:
        raise HTTPException(status_code=400, detail="新空间号必须是6位数字")
    if not payload.user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    # 校验分享码
    res = await db.execute(select(ShareCode).where(ShareCode.code == payload.share_code))
    share = res.scalar_one_or_none()
    if not share:
        raise HTTPException(status_code=404, detail="分享口令无效")
    now = datetime.utcnow()
    if share.used:
        raise HTTPException(status_code=400, detail="分享口令已被使用")
    if share.expires_at and share.expires_at < now:
        raise HTTPException(status_code=400, detail="分享口令已过期")
    # 新空间号仅需确保未作为分享别名被占用
    exist_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == payload.new_code))).scalar_one_or_none()
    if exist_alias:
        raise HTTPException(status_code=400, detail="该空间号已被使用")
    # 该用户若已使用该空间号（自己创建的空间），需提示
    owned_space = (await db.execute(
        select(Space).where(
            Space.code == payload.new_code,
            Space.owner_user_id == payload.user_id
        )
    )).scalar_one_or_none()
    if owned_space:
        raise HTTPException(status_code=400, detail="该空间号已存在，请删除后再使用")
    # 同一用户多次加入时，移除旧的映射/别名
    await db.execute(delete(SpaceMapping).where(SpaceMapping.space_id == share.space_id, SpaceMapping.user_id == payload.user_id))
    await db.execute(delete(SpaceCode).where(SpaceCode.space_id == share.space_id, SpaceCode.code == payload.new_code))

    # 创建别名并记录用户映射
    alias = SpaceCode(space_id=share.space_id, code=payload.new_code)
    db.add(alias)
    db.add(SpaceMapping(space_id=share.space_id, user_id=payload.user_id, space_code=payload.new_code))
    share.used = True
    await db.commit()
    return {"success": True, "space_id": share.space_id}

@router.post("/modify-code")
async def modify_space_code(payload: ModifyCodeRequest, db: AsyncSession = Depends(get_db)):
    if not payload.new_code.isdigit() or len(payload.new_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")
    # 校验新空间号未被分享别名占用
    exist_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == payload.new_code))).scalar_one_or_none()
    if exist_alias:
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
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    member_payload = []
    for m in members:
        alias_entry = alias_map.get(m.user_id)
        member_payload.append(MemberResponse(
            user_id=m.user_id,
            alias=alias_entry.alias if alias_entry else None,
            avatar_url=alias_entry.avatar_url if alias_entry else None
        ))
    return MembersListResponse(members=member_payload)

@router.post("/remove-member")
async def remove_member(payload: RemoveMemberRequest, db: AsyncSession = Depends(get_db)):
    # 只有房主可操作
    space = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    # 房主不可移除自己
    if payload.member_user_id == space.owner_user_id:
        raise HTTPException(status_code=400, detail="房主不可移除自己")
    await db.execute(delete(SpaceMember).where(SpaceMember.space_id == payload.space_id, SpaceMember.user_id == payload.member_user_id))
    # 清理成员关联的分享空间号
    mapping_rows = await db.execute(select(SpaceMapping).where(SpaceMapping.space_id == payload.space_id, SpaceMapping.user_id == payload.member_user_id))
    mappings = mapping_rows.scalars().all()
    if mappings:
        codes = [m.space_code for m in mappings if m.space_code]
        await db.execute(delete(SpaceMapping).where(SpaceMapping.space_id == payload.space_id, SpaceMapping.user_id == payload.member_user_id))
        if codes:
            await db.execute(delete(SpaceCode).where(SpaceCode.space_id == payload.space_id, SpaceCode.code.in_(codes)))
    await db.commit()
    return {"success": True}

@router.get("/blocks", response_model=BlocksListResponse)
async def list_blocks(space_id: int, db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(SpaceBlock).where(SpaceBlock.space_id == space_id))
    blocks = rows.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    block_payload = []
    for b in blocks:
        alias_entry = alias_map.get(b.user_id)
        block_payload.append(MemberResponse(
            user_id=b.user_id,
            alias=alias_entry.alias if alias_entry else None,
            avatar_url=alias_entry.avatar_url if alias_entry else None
        ))
    return BlocksListResponse(blocks=block_payload)

@router.post("/block-member")
async def block_member(payload: BlockMemberRequest, db: AsyncSession = Depends(get_db)):
    space = (await db.execute(select(Space).where(Space.id == payload.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != payload.operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    # 先从成员列表移除并清理空间号映射
    await db.execute(delete(SpaceMember).where(SpaceMember.space_id == payload.space_id, SpaceMember.user_id == payload.member_user_id))
    mapping_rows = await db.execute(select(SpaceMapping).where(SpaceMapping.space_id == payload.space_id, SpaceMapping.user_id == payload.member_user_id))
    mappings = mapping_rows.scalars().all()
    if mappings:
        codes = [m.space_code for m in mappings if m.space_code]
        await db.execute(delete(SpaceMapping).where(SpaceMapping.space_id == payload.space_id, SpaceMapping.user_id == payload.member_user_id))
        if codes:
            await db.execute(delete(SpaceCode).where(SpaceCode.space_id == payload.space_id, SpaceCode.code.in_(codes)))
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
