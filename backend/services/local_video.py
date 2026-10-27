import os
import uuid
from pathlib import Path

from database.supabase import supabase_admin
from services.video_backup import safe_storage_key_part


LOCAL_VIDEO_BUCKET = os.getenv("SUPABASE_LOCAL_VIDEO_BUCKET", "lecture-videos")
MAX_LOCAL_VIDEO_BYTES = int(
    os.getenv("LOCAL_VIDEO_MAX_BYTES", str(48 * 1024**2))
)
ALLOWED_VIDEO_TYPES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}


def validate_local_video(filename: str | None, content_type: str | None) -> tuple[str, str]:
    extension = Path(filename or "").suffix.lower()
    expected_type = ALLOWED_VIDEO_TYPES.get(extension)
    if not expected_type:
        raise ValueError("只支援 MP4 或 WebM 影片")
    if content_type and content_type not in {
        expected_type,
        "application/octet-stream",
    }:
        raise ValueError("影片格式與檔案副檔名不一致")
    return extension, expected_type


def upload_local_video(
    file_path: str,
    *,
    course_id: int,
    original_filename: str,
    content_type: str,
) -> str:
    extension = Path(original_filename).suffix.lower()
    stem = safe_storage_key_part(Path(original_filename).stem, "video")
    storage_path = (
        f"courses/{course_id}/{uuid.uuid4().hex}-{stem}{extension}"
    )
    with open(file_path, "rb") as source:
        supabase_admin.storage.from_(LOCAL_VIDEO_BUCKET).upload(
            storage_path,
            source,
            {"content-type": content_type, "upsert": "false"},
        )
    return storage_path


def remove_local_video(storage_path: str) -> None:
    supabase_admin.storage.from_(LOCAL_VIDEO_BUCKET).remove([storage_path])


def create_local_video_signed_url(
    storage_path: str, expires_in: int = 3600
) -> str:
    response = (
        supabase_admin.storage.from_(LOCAL_VIDEO_BUCKET)
        .create_signed_url(storage_path, expires_in)
    )
    url = response.get("signedURL") or response.get("signedUrl")
    if not url:
        raise RuntimeError("無法建立本機上傳影片的限時播放連結")
    return url
