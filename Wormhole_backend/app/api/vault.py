from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.security import require_space_member, verify_request_user
from app.storage.oss import build_object_key, get_bucket, get_signed_url, guess_content_type, is_configured
from app.utils.limiter import limiter
from app.utils.operation_log import add_operation_log
from models.vault import VaultFile, VaultSpace
from schemas.vault import (
    VaultDownloadResponse,
    VaultFileResponse,
    VaultFilesResponse,
    VaultInitRequest,
    VaultResetRequest,
    VaultResetResponse,
    VaultStatusResponse,
)

router = APIRouter()


def _max_file_bytes() -> int:
    return int(settings.VAULT_MAX_FILE_BYTES or 10 * 1024 * 1024)


def _build_file_response(item: VaultFile) -> VaultFileResponse:
    return VaultFileResponse(
        id=item.id,
        space_id=item.space_id,
        uploader_user_id=item.uploader_user_id,
        encrypted_name=item.encrypted_name or "",
        name_nonce=item.name_nonce or "",
        name_tag=item.name_tag or "",
        encrypted_meta=item.encrypted_meta or "",
        meta_nonce=item.meta_nonce or "",
        meta_tag=item.meta_tag or "",
        file_nonce=item.file_nonce or "",
        file_tag=item.file_tag or "",
        cipher_algo=item.cipher_algo or "chacha20-hmac-sha256",
        original_size=int(item.original_size or 0),
        encrypted_size=int(item.encrypted_size or 0),
        content_type=item.content_type or "application/octet-stream",
        created_at=item.created_at,
        created_at_ts=int(item.created_at.timestamp() * 1000) if item.created_at else None,
    )


def _build_status(vault: VaultSpace | None) -> VaultStatusResponse:
    if not vault:
        return VaultStatusResponse(initialized=False, max_file_bytes=_max_file_bytes())
    return VaultStatusResponse(
        initialized=True,
        key_salt=vault.key_salt,
        kdf_algo=vault.kdf_algo or "pbkdf2-sha256",
        # Fall back to 100000 only when a row somehow has NULL/0; existing
        # rows from before the 2026-05-06 audit keep whatever value they
        # were created with so the client can still derive the correct key.
        kdf_iterations=int(vault.kdf_iterations or 100000),
        check_nonce=vault.check_nonce,
        check_ciphertext=vault.check_ciphertext,
        check_tag=vault.check_tag,
        max_file_bytes=_max_file_bytes(),
    )


@router.get("/status", response_model=VaultStatusResponse)
@limiter.limit("30/minute")
async def vault_status(
    space_id: int,
    request: Request,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    # Rate-limited per docs/audits/2026-05-vault.md F4: this endpoint emits
    # the salt + check ciphertext that an offline brute-forcer needs, so
    # cap the rate at which a compromised member can scrape it.
    actor_user_id = verify_request_user(request, user_id)
    await require_space_member(db, space_id, actor_user_id)
    vault = (
        await db.execute(select(VaultSpace).where(VaultSpace.space_id == space_id))
    ).scalar_one_or_none()
    return _build_status(vault)


@router.post("/init", response_model=VaultStatusResponse)
@limiter.limit("10/minute")
async def init_vault(payload: VaultInitRequest, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, payload.user_id)
    await require_space_member(db, payload.space_id, actor_user_id)
    existing = (
        await db.execute(select(VaultSpace).where(VaultSpace.space_id == payload.space_id))
    ).scalar_one_or_none()
    if existing:
        return _build_status(existing)
    vault = VaultSpace(
        space_id=payload.space_id,
        created_by=actor_user_id,
        kdf_algo=payload.kdf_algo,
        kdf_iterations=payload.kdf_iterations,
        key_salt=payload.key_salt,
        check_nonce=payload.check_nonce,
        check_ciphertext=payload.check_ciphertext,
        check_tag=payload.check_tag,
    )
    db.add(vault)
    await db.commit()
    await db.refresh(vault)
    add_operation_log(
        db,
        user_id=actor_user_id,
        action="vault_init",
        space_id=payload.space_id,
        detail={},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    return _build_status(vault)


@router.get("/files", response_model=VaultFilesResponse)
@limiter.limit("60/minute")
async def list_vault_files(
    space_id: int,
    request: Request,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, user_id)
    await require_space_member(db, space_id, actor_user_id)
    rows = await db.execute(
        select(VaultFile)
        .where(VaultFile.space_id == space_id, VaultFile.deleted_at.is_(None))
        .order_by(VaultFile.created_at.desc(), VaultFile.id.desc())
    )
    return VaultFilesResponse(files=[_build_file_response(item) for item in rows.scalars().all()])


@router.post("/upload", response_model=VaultFileResponse)
@limiter.limit("10/minute")
async def upload_vault_file(
    request: Request,
    file: UploadFile = File(...),
    space_id: int = Form(...),
    user_id: str = Form(...),
    encrypted_name: str = Form(...),
    name_nonce: str = Form(...),
    name_tag: str = Form(...),
    encrypted_meta: str = Form(...),
    meta_nonce: str = Form(...),
    meta_tag: str = Form(...),
    file_nonce: str = Form(...),
    file_tag: str = Form(...),
    original_size: int = Form(0),
    content_type: str = Form("application/octet-stream"),
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, user_id)
    await require_space_member(db, int(space_id), actor_user_id)
    vault = (
        await db.execute(select(VaultSpace).where(VaultSpace.space_id == int(space_id)))
    ).scalar_one_or_none()
    if not vault:
        raise HTTPException(status_code=400, detail="保密柜尚未初始化")
    if not is_configured():
        raise HTTPException(status_code=500, detail="OSS未配置")
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="空文件")
    if len(file_bytes) > _max_file_bytes() + 1024:
        raise HTTPException(status_code=413, detail="文件超过保密柜大小限制")
    object_key = build_object_key(
        "vault",
        file.filename or "vault.bin",
        space_id=int(space_id),
        user_id=actor_user_id,
        subdir="cipher",
    )
    bucket = get_bucket()
    if not bucket:
        raise HTTPException(status_code=500, detail="OSS未配置")
    try:
        bucket.put_object(
            object_key,
            file_bytes,
            headers={"Content-Type": guess_content_type(file.filename, file.content_type)},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="保密文件上传失败")
    item = VaultFile(
        space_id=int(space_id),
        uploader_user_id=actor_user_id,
        object_key=object_key,
        encrypted_name=encrypted_name,
        name_nonce=name_nonce,
        name_tag=name_tag,
        encrypted_meta=encrypted_meta,
        meta_nonce=meta_nonce,
        meta_tag=meta_tag,
        file_nonce=file_nonce,
        file_tag=file_tag,
        cipher_algo="chacha20-hmac-sha256",
        original_size=max(0, int(original_size or 0)),
        encrypted_size=len(file_bytes),
        content_type=content_type or "application/octet-stream",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    add_operation_log(
        db,
        user_id=actor_user_id,
        action="vault_upload",
        space_id=int(space_id),
        detail={"file_id": item.id, "encrypted_size": item.encrypted_size},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    return _build_file_response(item)


@router.get("/files/{file_id}/download", response_model=VaultDownloadResponse)
@limiter.limit("30/minute")
async def get_vault_download(
    file_id: int,
    request: Request,
    user_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, user_id)
    item = (
        await db.execute(
            select(VaultFile).where(VaultFile.id == file_id, VaultFile.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="保密文件不存在")
    await require_space_member(db, item.space_id, actor_user_id)
    url = get_signed_url(item.object_key)
    if not url:
        raise HTTPException(status_code=500, detail="下载链接生成失败")
    return VaultDownloadResponse(url=url, file=_build_file_response(item))


@router.post("/reset", response_model=VaultResetResponse)
@limiter.limit("3/minute")
async def reset_vault(payload: VaultResetRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Permanently wipe the vault for this space.

    Use case: a member who has forgotten the shared passphrase. Since the
    vault is end-to-end encrypted with a key derived from the passphrase, the
    server has no way to recover the contents — the only way out is to drop
    everything and let the space initialise a fresh vault with a new
    passphrase.

    Caller must:
      - be a member of the space (require_space_member)
      - send `confirm == '重置'` in the body so a stray POST can't wipe the vault

    Effect:
      - Soft-delete (deleted_at) every VaultFile row in the space + best-effort
        delete of the OSS object so the ciphertext is actually gone.
      - Delete the VaultSpace row (the salt + check ciphertext) so the next
        /status call returns initialized=False and the page falls into
        "create vault" mode.
    """
    actor_user_id = verify_request_user(request, payload.user_id)
    await require_space_member(db, payload.space_id, actor_user_id)
    if (payload.confirm or "").strip() != "重置":
        raise HTTPException(status_code=400, detail="确认文本不正确")
    vault = (
        await db.execute(select(VaultSpace).where(VaultSpace.space_id == payload.space_id))
    ).scalar_one_or_none()
    if not vault:
        # Already empty — return success rather than 404 so the UI can move
        # on to "set new passphrase" without spurious error toasts.
        return VaultResetResponse(success=True, deleted_files=0)
    files = (
        await db.execute(
            select(VaultFile).where(
                VaultFile.space_id == payload.space_id,
                VaultFile.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    bucket = get_bucket()
    now = datetime.utcnow()
    for item in files:
        item.deleted_at = now
        if bucket and item.object_key:
            try:
                bucket.delete_object(item.object_key)
            except Exception:
                pass
    await db.delete(vault)
    add_operation_log(
        db,
        user_id=actor_user_id,
        action="vault_reset",
        space_id=payload.space_id,
        detail={"deleted_files": len(files)},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return VaultResetResponse(success=True, deleted_files=len(files))


@router.delete("/files/{file_id}")
@limiter.limit("10/minute")
async def delete_vault_file(
    file_id: int,
    request: Request,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, user_id)
    item = (
        await db.execute(
            select(VaultFile).where(VaultFile.id == file_id, VaultFile.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="保密文件不存在")
    await require_space_member(db, item.space_id, actor_user_id)
    item.deleted_at = datetime.utcnow()
    bucket = get_bucket()
    if bucket and item.object_key:
        try:
            bucket.delete_object(item.object_key)
        except Exception:
            pass
    add_operation_log(
        db,
        user_id=actor_user_id,
        action="vault_delete",
        space_id=item.space_id,
        detail={"file_id": item.id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return {"success": True}
