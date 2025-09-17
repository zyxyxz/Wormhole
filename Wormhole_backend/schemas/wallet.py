from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime
from typing import List, Optional

class WalletInfo(BaseModel):
    balance: Decimal
    pay_code_url: str

class TransactionBase(BaseModel):
    amount: Decimal
    type: str

class TransactionResponse(TransactionBase):
    id: int
    user_id: str
    alias: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class WalletResponse(BaseModel):
    balance: Decimal
    transactions: List[TransactionResponse]
