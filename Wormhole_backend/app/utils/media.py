import json

from app.config import settings
from app.storage.oss import append_oss_process, strip_oss_process, get_access_url


def strip_url(url: str | None) -> str | None:
    return strip_oss_process(url)


def strip_urls(urls: list[str | dict] | None) -> list[str | dict]:
    if not urls:
        return []
    cleaned: list[str | dict] = []
    for item in urls:
        if isinstance(item, str):
            stripped = strip_oss_process(item)
            if stripped:
                cleaned.append(stripped)
            continue
        if isinstance(item, dict):
            cover = strip_oss_process(item.get("cover_url"))
            video = strip_oss_process(item.get("video_url"))
            if cover and video:
                cleaned.append({"cover_url": cover, "video_url": video})
    return cleaned


def process_avatar_url(url: str | None) -> str | None:
    return append_oss_process(url, settings.OSS_IMAGE_PROCESS_AVATAR, force_image=True)


def process_message_media_url(url: str | None, message_type: str | None) -> str | None:
    if (message_type or "").lower() != "image":
        return get_access_url(url)
    return append_oss_process(url, settings.OSS_IMAGE_PROCESS_CHAT, force_image=True)


def process_feed_media_urls(urls: list[str | dict] | None, media_type: str | None) -> list[str | dict]:
    if (media_type or "").lower() == "live":
        processed: list[dict] = []
        for item in (urls or []):
            if isinstance(item, str):
                try:
                    parsed = json.loads(item)
                except Exception:
                    parsed = {}
            else:
                parsed = item if isinstance(item, dict) else {}
            cover = append_oss_process(parsed.get("cover_url"), settings.OSS_IMAGE_PROCESS_FEED, force_image=True)
            video = get_access_url(parsed.get("video_url"))
            if cover and video:
                processed.append({"cover_url": cover, "video_url": video})
        return processed
    if (media_type or "").lower() != "image":
        return [get_access_url(url) or url for url in (urls or [])]
    processed = []
    for url in (urls or []):
        processed_url = append_oss_process(url, settings.OSS_IMAGE_PROCESS_FEED, force_image=True)
        if processed_url:
            processed.append(processed_url)
    return processed


def process_upload_url(
    url: str | None,
    *,
    category: str | None = None,
    message_type: str | None = None,
    media_type: str | None = None,
    content_type: str | None = None,
) -> str | None:
    if not url:
        return url
    is_image_content = bool(content_type and content_type.startswith("image/"))
    if content_type and not is_image_content:
        return get_access_url(url)
    if (category or "").lower() == "avatars":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_AVATAR, force_image=True)
    if (message_type or "").lower() == "image":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_CHAT, force_image=True)
    if (media_type or "").lower() == "image":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_FEED, force_image=True)
    if is_image_content:
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_FEED, force_image=True)
    return get_access_url(url)


def encode_live_media(cover_url: str | None, video_url: str | None) -> str | None:
    cover = strip_oss_process(cover_url)
    video = strip_oss_process(video_url)
    if not cover or not video:
        return None
    try:
        return json.dumps({"cover_url": cover, "video_url": video}, ensure_ascii=False)
    except Exception:
        return None


def parse_live_media(media_url: str | None) -> tuple[str | None, str | None]:
    if not media_url:
        return None, None
    raw = (media_url or "").strip()
    if not raw:
        return None, None
    data = None
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                data = parsed
        except Exception:
            data = None
    if not data:
        return None, None
    cover = data.get("cover_url")
    video = data.get("video_url")
    if not cover or not video:
        return None, None
    return str(cover), str(video)


def process_live_media_urls(media_url: str | None) -> tuple[str | None, str | None]:
    cover_raw, video_raw = parse_live_media(media_url)
    if not cover_raw or not video_raw:
        return None, None
    cover = append_oss_process(cover_raw, settings.OSS_IMAGE_PROCESS_CHAT, force_image=True)
    video = get_access_url(video_raw)
    return cover, video
