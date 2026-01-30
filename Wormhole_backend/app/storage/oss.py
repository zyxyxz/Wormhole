import mimetypes
import os
import re
import uuid
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.config import settings

_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9_-]")
_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]")
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def is_configured() -> bool:
    return all([
        settings.OSS_ACCESS_KEY_ID,
        settings.OSS_ACCESS_KEY_SECRET,
        settings.OSS_ENDPOINT,
        settings.OSS_BUCKET,
    ])


def _normalize_endpoint(endpoint: str) -> str:
    endpoint = (endpoint or "").strip()
    if not endpoint:
        return ""
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint
    return f"https://{endpoint}"


def get_bucket():
    if not is_configured():
        return None
    import oss2
    auth = oss2.Auth(settings.OSS_ACCESS_KEY_ID, settings.OSS_ACCESS_KEY_SECRET)
    endpoint = _normalize_endpoint(settings.OSS_ENDPOINT)
    return oss2.Bucket(auth, endpoint, settings.OSS_BUCKET)


def get_base_url() -> str:
    if settings.OSS_BASE_URL:
        return settings.OSS_BASE_URL.rstrip("/")
    endpoint = (settings.OSS_ENDPOINT or "").strip()
    bucket = (settings.OSS_BUCKET or "").strip()
    if not endpoint or not bucket:
        return ""
    scheme = "https"
    host = endpoint
    if endpoint.startswith("http://"):
        scheme = "http"
        host = endpoint[len("http://"):]
    elif endpoint.startswith("https://"):
        scheme = "https"
        host = endpoint[len("https://"):]
    if host.startswith(f"{bucket}."):
        return f"{scheme}://{host}".rstrip("/")
    return f"{scheme}://{bucket}.{host}".rstrip("/")


def get_public_url(object_key: str) -> str:
    base = get_base_url()
    if not base:
        return ""
    return f"{base}/{object_key.lstrip('/')}"


def sanitize_segment(value: str, default: str = "") -> str:
    cleaned = _SEGMENT_RE.sub("", value or "")
    return cleaned or default


def sanitize_filename(name: str) -> str:
    base = os.path.basename(name or "")
    cleaned = _FILENAME_RE.sub("", base)
    return cleaned or f"{uuid.uuid4().hex}"


def build_object_key(
    category: str,
    filename: str | None,
    *,
    space_id: int | None = None,
    user_id: str | None = None,
    subdir: str | None = None,
    dt: datetime | None = None,
    use_original_name: bool = False,
) -> str:
    parts: list[str] = []
    prefix = (settings.OSS_PREFIX or "").strip("/")
    if prefix:
        parts.append(prefix)
    category_segment = sanitize_segment(category, "misc")
    if category_segment:
        parts.append(category_segment)
    if space_id is not None:
        parts.append(str(space_id))
    if user_id:
        user_segment = sanitize_segment(user_id)
        if user_segment:
            parts.append(user_segment)
    if subdir:
        sub_segment = sanitize_segment(subdir)
        if sub_segment:
            parts.append(sub_segment)
    dt = dt or datetime.utcnow()
    parts.append(dt.strftime("%Y"))
    parts.append(dt.strftime("%m"))
    if use_original_name and filename:
        name = sanitize_filename(filename)
    else:
        ext = os.path.splitext(filename or "")[1].lower()
        name = f"{uuid.uuid4().hex}{ext}"
    parts.append(name)
    return "/".join(parts)


def guess_content_type(filename: str | None, provided: str | None = None) -> str:
    if provided:
        return provided
    guessed, _ = mimetypes.guess_type(filename or "")
    return guessed or "application/octet-stream"


def strip_oss_process(url: str | None) -> str | None:
    if not url or "x-oss-process" not in url:
        return url
    parts = urlsplit(url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    query_pairs = [(k, v) for k, v in query_pairs if k != "x-oss-process"]
    new_query = urlencode(query_pairs, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))


def is_oss_url(url: str | None) -> bool:
    if not url:
        return False
    base = get_base_url()
    if not base:
        return False
    return url.startswith(base)


def is_image_url(url: str | None, *, force: bool = False) -> bool:
    if force and url:
        return True
    if not url:
        return False
    ext = os.path.splitext(urlsplit(url).path)[1].lower()
    return ext in _IMAGE_EXTS


def append_oss_process(url: str | None, process: str, *, force_image: bool = False) -> str | None:
    if not url or not process:
        return url
    if "x-oss-process" in url:
        return url
    if not is_oss_url(url):
        return url
    if not is_image_url(url, force=force_image):
        return url
    parts = urlsplit(url)
    query = parts.query
    joiner = "&" if query else ""
    new_query = f"{query}{joiner}x-oss-process={process}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
