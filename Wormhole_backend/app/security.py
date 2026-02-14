import logging

from fastapi import HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from models.space import Space, SpaceMember


def _split_header_names(raw_value: str, fallback: list[str]) -> list[str]:
    names = [item.strip().lower() for item in (raw_value or "").split(",") if item.strip()]
    return names or fallback


USER_HEADER_NAMES = _split_header_names(
    settings.AUTH_USER_HEADERS,
    ["x-user-id", "x-openid", "x-userid"],
)
TOKEN_HEADER_NAMES = _split_header_names(
    settings.AUTH_TOKEN_HEADERS,
    ["authorization", "x-auth-token"],
)
JWT_SECRET = settings.AUTH_JWT_SECRET or settings.WECHAT_APP_SECRET or "wormhole-dev-secret"
JWT_ALGORITHM = settings.AUTH_JWT_ALGORITHM or "HS256"
logger = logging.getLogger("wormhole.security")


def _mask_user_id(user_id: str | None) -> str:
    value = (user_id or "").strip()
    if not value:
        return "-"
    if len(value) <= 8:
        return value
    return f"{value[:4]}...{value[-4:]}"


def _audit_auth_failure(
    request: Request | None,
    reason: str,
    *,
    claimed_user_id: str | None = None,
    declared_user_id: str | None = None,
    token_present: bool | None = None,
) -> None:
    if not request:
        logger.warning("AUTH_DENY reason=%s", reason)
        return
    path = getattr(getattr(request, "url", None), "path", "-")
    method = getattr(request, "method", "-")
    client = getattr(request, "client", None)
    ip = getattr(client, "host", "-") if client else "-"
    if declared_user_id is None:
        declared_user_id = _extract_declared_user_id(request)
    if token_present is None:
        token_present = bool(_extract_auth_token(request))
    logger.warning(
        "AUTH_DENY reason=%s method=%s path=%s ip=%s claimed=%s declared=%s token_present=%s",
        reason,
        method,
        path,
        ip,
        _mask_user_id(claimed_user_id),
        _mask_user_id(declared_user_id),
        int(bool(token_present)),
    )


def _audit_auth_fallback(
    request: Request | None,
    *,
    user_id: str | None,
    source: str,
) -> None:
    if not request:
        return
    path = getattr(getattr(request, "url", None), "path", "-")
    method = getattr(request, "method", "-")
    client = getattr(request, "client", None)
    ip = getattr(client, "host", "-") if client else "-"
    logger.info(
        "AUTH_FALLBACK source=%s method=%s path=%s ip=%s user=%s",
        source,
        method,
        path,
        ip,
        _mask_user_id(user_id),
    )


def _extract_declared_user_id(request: Request) -> str | None:
    if not request:
        return None
    headers = getattr(request, "headers", None)
    if not headers:
        return None
    for name in USER_HEADER_NAMES:
        value = headers.get(name)
        if value:
            return value.strip()
    return None


def _extract_query_user_id(request: Request) -> str | None:
    if not request:
        return None
    query = getattr(request, "query_params", None)
    if not query:
        return None
    for key in ("user_id", "operator_user_id", "auth_user", "openid"):
        value = query.get(key)
        if value:
            return value.strip()
    return None


def _extract_auth_token(request: Request) -> str | None:
    if not request:
        return None
    headers = getattr(request, "headers", None)
    token = None
    if headers:
        for name in TOKEN_HEADER_NAMES:
            value = headers.get(name)
            if not value:
                continue
            raw = value.strip()
            if not raw:
                continue
            if name == "authorization":
                if raw.lower().startswith("bearer "):
                    raw = raw.split(" ", 1)[1].strip()
                elif " " in raw:
                    # 仅支持 Bearer 格式，其他 scheme 直接跳过
                    continue
            token = raw
            if token:
                break
    if not token:
        query = getattr(request, "query_params", None)
        if query:
            token = query.get("token") or query.get("access_token")
            if token:
                token = token.strip()
    return token or None


def _decode_token_user_id(token: str | None, *, strict: bool, request: Request | None = None) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        if strict:
            _audit_auth_failure(request, "invalid_token", token_present=True)
            raise HTTPException(status_code=401, detail="无效登录凭证")
        return None
    subject = payload.get("sub")
    if not subject:
        if strict:
            _audit_auth_failure(request, "token_missing_sub", token_present=True)
            raise HTTPException(status_code=401, detail="登录凭证缺少用户信息")
        return None
    return str(subject)


def get_header_user_id(request: Request) -> str | None:
    token_user_id = _decode_token_user_id(_extract_auth_token(request), strict=False, request=request)
    declared_user_id = _extract_declared_user_id(request)
    query_user_id = _extract_query_user_id(request)
    if token_user_id and declared_user_id and token_user_id != declared_user_id:
        _audit_auth_failure(
            request,
            "token_declared_mismatch",
            claimed_user_id=token_user_id,
            declared_user_id=declared_user_id,
            token_present=True,
        )
        return None
    if token_user_id and query_user_id and token_user_id != query_user_id:
        _audit_auth_failure(
            request,
            "token_query_mismatch",
            claimed_user_id=query_user_id,
            declared_user_id=token_user_id,
            token_present=True,
        )
        return None
    if declared_user_id and query_user_id and declared_user_id != query_user_id:
        _audit_auth_failure(
            request,
            "declared_query_mismatch",
            claimed_user_id=query_user_id,
            declared_user_id=declared_user_id,
            token_present=bool(token_user_id),
        )
        return None
    if query_user_id and not (token_user_id or declared_user_id):
        _audit_auth_fallback(request, user_id=query_user_id, source="query")
    return token_user_id or declared_user_id or query_user_id


def verify_request_user(
    request: Request,
    claimed_user_id: str | None = None,
    *,
    required: bool = True,
) -> str | None:
    token = _extract_auth_token(request)
    token_user_id = _decode_token_user_id(token, strict=bool(token), request=request)
    declared_user_id = _extract_declared_user_id(request)
    query_user_id = _extract_query_user_id(request)

    if token_user_id and declared_user_id and token_user_id != declared_user_id:
        _audit_auth_failure(
            request,
            "token_declared_mismatch",
            claimed_user_id=claimed_user_id,
            declared_user_id=declared_user_id,
            token_present=True,
        )
        raise HTTPException(status_code=403, detail="登录凭证与用户头不匹配")

    if claimed_user_id and query_user_id and claimed_user_id != query_user_id:
        _audit_auth_failure(
            request,
            "claimed_query_mismatch",
            claimed_user_id=claimed_user_id,
            declared_user_id=query_user_id,
            token_present=bool(token),
        )
        raise HTTPException(status_code=403, detail="请求用户参数不匹配")

    header_user_id = token_user_id or declared_user_id
    fallback_user_id = claimed_user_id or query_user_id
    if claimed_user_id and header_user_id and claimed_user_id != header_user_id:
        _audit_auth_failure(
            request,
            "claimed_mismatch",
            claimed_user_id=claimed_user_id,
            declared_user_id=declared_user_id,
            token_present=bool(token),
        )
        raise HTTPException(status_code=403, detail="用户身份不匹配")
    if query_user_id and header_user_id and query_user_id != header_user_id:
        _audit_auth_failure(
            request,
            "query_mismatch",
            claimed_user_id=query_user_id,
            declared_user_id=header_user_id,
            token_present=bool(token),
        )
        raise HTTPException(status_code=403, detail="请求用户身份不匹配")
    if header_user_id:
        return claimed_user_id or header_user_id
    if fallback_user_id:
        _audit_auth_fallback(
            request,
            user_id=fallback_user_id,
            source="claimed" if claimed_user_id else "query",
        )
        return fallback_user_id
    if required:
        _audit_auth_failure(
            request,
            "missing_identity",
            claimed_user_id=claimed_user_id,
            declared_user_id=declared_user_id,
            token_present=bool(token),
        )
        raise HTTPException(status_code=401, detail="缺少用户身份")
    return None


async def require_space_member(
    db: AsyncSession,
    space_id: int,
    user_id: str,
    *,
    allow_owner: bool = True,
) -> Space:
    if not user_id:
        raise HTTPException(status_code=401, detail="缺少用户身份")
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if allow_owner and space.owner_user_id == user_id:
        return space
    member = (await db.execute(
        select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id)
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="无权限访问该空间")
    return space


async def require_space_owner(db: AsyncSession, space_id: int, user_id: str) -> Space:
    space = await require_space_member(db, space_id, user_id, allow_owner=True)
    if space.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="仅房主可操作")
    return space
