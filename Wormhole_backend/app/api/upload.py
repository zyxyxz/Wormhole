from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
import os, uuid

router = APIRouter()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    # 保存到本地 static/uploads 目录，返回可访问URL
    base_dir = os.path.join(os.getcwd(), "static", "uploads")
    os.makedirs(base_dir, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    fname = f"{uuid.uuid4().hex}{ext}"
    fpath = os.path.join(base_dir, fname)
    try:
        with open(fpath, "wb") as f:
            f.write(await file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail="文件保存失败")
    url = f"/static/uploads/{fname}"
    return {"url": url}

