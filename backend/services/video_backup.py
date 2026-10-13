import os
import re
import shutil
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from database.supabase import supabase_admin
from services.transcription import download_youtube_video


BACKUP_BUCKET = os.getenv("SUPABASE_VIDEO_BACKUP_BUCKET", "lecture-video-backups")
MAX_BACKUP_BYTES = int(os.getenv("VIDEO_BACKUP_MAX_BYTES", str(48 * 1024**2)))


def safe_storage_filename(value: Any, fallback: str) -> str:
    """Build the user-facing filename kept in the object's metadata."""
    name = unicodedata.normalize("NFKC", str(value or "")).strip()
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", name)
    name = re.sub(r"\s+", " ", name).strip(" .-_")
    name = re.sub(r"\s*-+\s*", "-", name)
    return (name or fallback)[:80].rstrip(" .-_") or fallback


def safe_storage_key_part(value: Any, fallback: str) -> str:
    """Build an ASCII-only key part accepted by Supabase Storage."""
    name = unicodedata.normalize("NFKD", str(value or ""))
    name = name.encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-_")
    return (name or fallback)[:80].rstrip(".-_") or fallback


def claim_lecture_backup(lecture_id: int) -> bool:
    try:
        response = supabase_admin.rpc(
            "claim_lecture_backup", {"p_lecture_id": lecture_id}
        ).execute()
        return bool(response.data)
    except Exception:
        return False


def _update_backup(lecture_id: int, **values: Any) -> None:
    values["backup_updated_at"] = datetime.now(timezone.utc).isoformat()
    supabase_admin.table("lectures").update(values).eq("id", lecture_id).execute()


def backup_lecture_video(lecture_id: int, youtube_url: str) -> None:
    """Download and upload a private backup. All failures stay isolated here."""
    temp_dir = tempfile.mkdtemp(prefix=f"lecture_backup_{lecture_id}_")
    storage_path: str | None = None
    existing = (
        supabase_admin.table("lectures")
        .select("backup_storage_path,title,course_id")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
        .data
        or {}
    )
    previous_path = existing.get("backup_storage_path")
    try:
        _update_backup(
            lecture_id,
            backup_status="processing",
            backup_error=None,
        )
        result = download_youtube_video(youtube_url, output_dir=temp_dir)
        file_path = Path(result["file_path"])
        if not file_path.exists():
            raise RuntimeError("下載完成後找不到影片檔案")
        file_size = file_path.stat().st_size
        if file_size > MAX_BACKUP_BYTES:
            raise RuntimeError(
                f"影片大小 {file_size} bytes 超過免費版備份上限 "
                f"{MAX_BACKUP_BYTES} bytes，請縮短影片或改用付費儲存空間"
            )

        course_id = existing.get("course_id")
        course_title = None
        if course_id is not None:
            try:
                course = (
                    supabase_admin.table("courses")
                    .select("title")
                    .eq("id", course_id)
                    .maybe_single()
                    .execute()
                    .data
                    or {}
                )
                course_title = course.get("title")
            except Exception:
                course_title = None

        course_name = safe_storage_filename(
            course_title, f"課程-{course_id or '未知'}"
        )
        lecture_name = safe_storage_filename(
            existing.get("title"), f"小節-{lecture_id}"
        )
        extension = file_path.suffix.lower() or ".mp4"
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        display_filename = f"{course_name}-{lecture_name}-{version}{extension}"
        lecture_key = safe_storage_key_part(
            existing.get("title"), f"lecture-{lecture_id}"
        )
        storage_filename = (
            f"course-{course_id or 'unknown'}-{lecture_key}-{version}{extension}"
        )
        storage_path = f"lectures/{lecture_id}/{storage_filename}"
        content_type = "video/mp4" if extension == ".mp4" else "video/webm"
        with file_path.open("rb") as video_file:
            supabase_admin.storage.from_(BACKUP_BUCKET).upload(
                storage_path,
                video_file,
                {
                    "content-type": content_type,
                    "upsert": "true",
                    "metadata": {
                        "display_name": display_filename,
                        "course_name": course_name,
                        "lecture_name": lecture_name,
                    },
                },
            )

        _update_backup(
            lecture_id,
            backup_status="completed",
            backup_storage_path=storage_path,
            backup_error=None,
        )
        if previous_path and previous_path != storage_path:
            try:
                supabase_admin.storage.from_(BACKUP_BUCKET).remove([previous_path])
            except Exception:
                pass
    except Exception as exc:
        if storage_path:
            try:
                supabase_admin.storage.from_(BACKUP_BUCKET).remove([storage_path])
            except Exception:
                pass
        try:
            if previous_path:
                _update_backup(
                    lecture_id,
                    backup_status="completed",
                    backup_storage_path=previous_path,
                    backup_error=f"重新備份失敗：{exc}"[:2000],
                )
            else:
                _update_backup(
                    lecture_id,
                    backup_status="failed",
                    backup_storage_path=None,
                    backup_error=str(exc)[:2000],
                )
        except Exception:
            pass
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def create_backup_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    response = (
        supabase_admin.storage.from_(BACKUP_BUCKET)
        .create_signed_url(storage_path, expires_in)
    )
    url = response.get("signedURL") or response.get("signedUrl")
    if not url:
        raise RuntimeError("無法建立備份影片的限時播放連結")
    return url


def backup_file_exists(storage_path: str) -> bool:
    parent, filename = storage_path.rsplit("/", 1)
    rows = supabase_admin.storage.from_(BACKUP_BUCKET).list(
        parent, {"search": filename, "limit": 10}
    )
    return any(row.get("name") == filename for row in (rows or []))
