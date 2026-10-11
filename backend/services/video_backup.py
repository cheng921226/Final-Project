import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from database.supabase import supabase_admin
from services.transcription import download_youtube_video, extract_youtube_video_id


BACKUP_BUCKET = os.getenv("SUPABASE_VIDEO_BACKUP_BUCKET", "lecture-video-backups")
MAX_BACKUP_BYTES = int(os.getenv("VIDEO_BACKUP_MAX_BYTES", str(2 * 1024**3)))


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
        .select("backup_storage_path")
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
                f"影片大小 {file_size} bytes 超過備份上限 {MAX_BACKUP_BYTES} bytes"
            )

        video_id = extract_youtube_video_id(youtube_url) or f"lecture-{lecture_id}"
        extension = file_path.suffix.lower() or ".mp4"
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        storage_path = f"lectures/{lecture_id}/{video_id}-{version}{extension}"
        content_type = "video/mp4" if extension == ".mp4" else "video/webm"
        with file_path.open("rb") as video_file:
            supabase_admin.storage.from_(BACKUP_BUCKET).upload(
                storage_path,
                video_file,
                {"content-type": content_type, "upsert": "true"},
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
    response = supabase_admin.storage.from_(BACKUP_BUCKET).create_signed_url(
        storage_path, expires_in
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
