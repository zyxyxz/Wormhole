from fastapi import APIRouter, UploadFile, File, HTTPException, Form

from app.storage.oss import (
    build_object_key,
    get_bucket,
    get_public_url,
    guess_content_type,
    is_configured,
)
from app.utils.media import process_upload_url

router = APIRouter()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form("misc"),
    space_id: int | None = Form(None),
    user_id: str | None = Form(None),
    message_type: str | None = Form(None),
    media_type: str | None = Form(None),
):
    if not is_configured():
        raise HTTPException(status_code=500, detail="OSS未配置")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="空文件")
    subdir = message_type or media_type or None
    object_key = build_object_key(
        category,
        file.filename,
        space_id=space_id,
        user_id=user_id,
        subdir=subdir,
    )
    content_type = guess_content_type(file.filename, file.content_type)
    bucket = get_bucket()
    if not bucket:
        raise HTTPException(status_code=500, detail="OSS未配置")
    try:
        bucket.put_object(object_key, file_bytes, headers={"Content-Type": content_type})
    except Exception:
        raise HTTPException(status_code=500, detail="文件上传失败")
    origin_url = get_public_url(object_key)
    if not origin_url:
        raise HTTPException(status_code=500, detail="OSS链接生成失败")
    display_url = process_upload_url(
        origin_url,
        category=category,
        message_type=message_type,
        media_type=media_type,
        content_type=content_type,
    )
    return {"url": display_url, "origin_url": origin_url, "key": object_key}
