from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.security import verify_request_user, require_space_member
from models.wallet import Wallet, Transaction
from models.user import UserAlias
from schemas.wallet import WalletInfo, WalletResponse, TransactionResponse
from pydantic import BaseModel
from decimal import Decimal
import uuid
from app.ws import event_manager

router = APIRouter()

@router.get("/info", response_model=WalletInfo)
async def get_wallet_info(
    space_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    query = select(Wallet).where(Wallet.space_id == space_id)
    result = await db.execute(query)
    wallet = result.scalar_one_or_none()
    
    if not wallet:
        wallet = Wallet(space_id=space_id)
        db.add(wallet)
        await db.commit()
        await db.refresh(wallet)
    
    # 生成支付二维码URL
    pay_code = str(uuid.uuid4())
    pay_code_url = f"/api/wallet/pay/{pay_code}"
    
    return WalletInfo(
        balance=wallet.balance,
        pay_code_url=pay_code_url
    )

@router.get("/transactions", response_model=WalletResponse)
async def get_transactions(
    space_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    wallet_query = select(Wallet).where(Wallet.space_id == space_id)
    wallet_result = await db.execute(wallet_query)
    wallet = wallet_result.scalar_one_or_none()
    
    if not wallet:
        raise HTTPException(status_code=404, detail="钱包不存在")
    
    trans_query = select(Transaction).where(
        Transaction.wallet_id == wallet.id
    ).order_by(Transaction.created_at.desc())
    trans_result = await db.execute(trans_query)
    transactions = trans_result.scalars().all()
    # 别名映射
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    
    resp = [
        TransactionResponse(
            id=t.id,
            amount=t.amount,
            type=t.type,
            user_id=t.user_id or "",
            alias=alias_map.get(t.user_id),
            created_at=t.created_at,
        ) for t in transactions
    ]
    return WalletResponse(balance=wallet.balance, transactions=resp)

class AmountRequest(BaseModel):
    space_id: int
    amount: Decimal
    user_id: str | None = None

@router.post("/recharge")
async def recharge(payload: AmountRequest, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, payload.user_id, required=True)
    await require_space_member(db, payload.space_id, actor_user_id)
    payload.user_id = actor_user_id
    wallet_res = await db.execute(select(Wallet).where(Wallet.space_id == payload.space_id))
    wallet = wallet_res.scalar_one_or_none()
    if not wallet:
        wallet = Wallet(space_id=payload.space_id, balance=Decimal("0"))
        db.add(wallet)
        await db.commit()
        await db.refresh(wallet)
    wallet.balance = (wallet.balance or Decimal("0")) + payload.amount
    db.add(Transaction(wallet_id=wallet.id, amount=payload.amount, type="recharge", user_id=(payload.user_id or "")))
    await db.commit()
    # 广播余额更新事件
    await event_manager.broadcast(payload.space_id, {
        "type": "wallet_update",
        "space_id": payload.space_id,
        "balance": str(wallet.balance),
        "op": "recharge"
    })
    return {"success": True, "balance": str(wallet.balance)}

@router.post("/pay")
async def pay(payload: AmountRequest, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, payload.user_id, required=True)
    await require_space_member(db, payload.space_id, actor_user_id)
    payload.user_id = actor_user_id
    wallet_res = await db.execute(select(Wallet).where(Wallet.space_id == payload.space_id))
    wallet = wallet_res.scalar_one_or_none()
    if not wallet:
        raise HTTPException(status_code=404, detail="钱包不存在")
    wallet.balance = (wallet.balance or Decimal("0")) - payload.amount
    db.add(Transaction(wallet_id=wallet.id, amount=-payload.amount, type="payment", user_id=(payload.user_id or "")))
    await db.commit()
    await event_manager.broadcast(payload.space_id, {
        "type": "wallet_update",
        "space_id": payload.space_id,
        "balance": str(wallet.balance),
        "op": "payment"
    })
    return {"success": True, "balance": str(wallet.balance)}
