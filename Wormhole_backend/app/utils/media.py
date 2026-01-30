from app.config import settings
from app.storage.oss import append_oss_process, strip_oss_process


def strip_url(url: str | None) -> str | None:
    return strip_oss_process(url)


def strip_urls(urls: list[str] | None) -> list[str]:
    if not urls:
        return []
    cleaned = []
    for url in urls:
        stripped = strip_oss_process(url)
        if stripped:
            cleaned.append(stripped)
    return cleaned


def process_avatar_url(url: str | None) -> str | None:
    return append_oss_process(url, settings.OSS_IMAGE_PROCESS_AVATAR, force_image=True)


def process_message_media_url(url: str | None, message_type: str | None) -> str | None:
    if (message_type or "").lower() != "image":
        return url
    return append_oss_process(url, settings.OSS_IMAGE_PROCESS_CHAT, force_image=True)


def process_feed_media_urls(urls: list[str] | None, media_type: str | None) -> list[str]:
    if (media_type or "").lower() != "image":
        return urls or []
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
        return url
    if (category or "").lower() == "avatars":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_AVATAR, force_image=True)
    if (message_type or "").lower() == "image":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_CHAT, force_image=True)
    if (media_type or "").lower() == "image":
        return append_oss_process(url, settings.OSS_IMAGE_PROCESS_FEED, force_image=True)
    return append_oss_process(url, settings.OSS_IMAGE_PROCESS_FEED, force_image=is_image_content)
