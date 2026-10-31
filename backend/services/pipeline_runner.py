import logging
import shutil
import tempfile
from typing import Any

from database.supabase import supabase_admin
from services.ai_generation import run_ai_generation_pipeline
from services.lecture_processing import set_generation_status
from services.transcription import (
    DEFAULT_MODEL_SIZE,
    download_youtube_audio,
    get_youtube_metadata,
    save_lecture_duration,
    save_transcript_segments,
    transcribe_media,
)


logger = logging.getLogger(__name__)


class PipelineStepError(RuntimeError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def get_existing_transcript_segments(lecture_id: int) -> list[dict[str, Any]] | None:
    response = (
        supabase_admin.table("transcripts")
        .select("segments_json")
        .eq("lecture_id", lecture_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not response.data:
        return None

    segments = response.data[0].get("segments_json")
    if isinstance(segments, list) and segments:
        return segments

    return None


def run_media_ai_pipeline(
    lecture_id: int,
    *,
    file_path: str | None,
    source: str,
    source_metadata: dict[str, Any] | None = None,
    language: str | None = None,
    model_size: str = DEFAULT_MODEL_SIZE,
    word_timestamps: bool = False,
    save_to_db: bool = True,
    skip_existing_transcript: bool = True,
    skip_existing_ai: bool = True,
) -> dict[str, Any]:
    """Run the shared transcription and AI generation stages for any media."""
    metadata = source_metadata or {}
    steps: dict[str, Any] = {}
    existing_segments = (
        get_existing_transcript_segments(lecture_id)
        if skip_existing_transcript
        else None
    )

    if existing_segments:
        transcript_result = {
            "language": language,
            "language_probability": None,
            "duration": metadata.get("duration"),
            "text": " ".join(
                segment.get("text", "")
                for segment in existing_segments
                if isinstance(segment, dict)
            ),
            "segments": existing_segments,
        }
        db_result = {
            "saved_to_db": False,
            "inserted": 0,
            "db_error": None,
            "status": "cached",
        }
        set_generation_status(lecture_id, "transcript", "completed")
    else:
        if not file_path:
            raise PipelineStepError("MEDIA_MISSING", "找不到可供轉錄的媒體檔案")
        set_generation_status(lecture_id, "transcript", "processing")
        try:
            transcript_result = transcribe_media(
                file_path,
                model_size=model_size,
                language=language or None,
                word_timestamps=word_timestamps,
            )
        except Exception as exc:
            logger.exception("Transcription failed lecture_id=%s", lecture_id)
            set_generation_status(lecture_id, "transcript", "failed", error=str(exc))
            raise PipelineStepError(
                "TRANSCRIPTION_FAILED", f"逐字稿轉換失敗：{exc}"
            ) from exc

        db_result = {"saved_to_db": False, "inserted": 0, "db_error": None}
        if save_to_db:
            db_result = save_transcript_segments(
                lecture_id, transcript_result["segments"]
            )
            if not db_result.get("saved_to_db"):
                set_generation_status(
                    lecture_id,
                    "transcript",
                    "failed",
                    error=str(db_result.get("db_error")),
                )
                raise PipelineStepError(
                    "TRANSCRIPT_SAVE_FAILED",
                    f"逐字稿寫入資料庫失敗：{db_result.get('db_error')}",
                )
        set_generation_status(lecture_id, "transcript", "completed")

    duration = metadata.get("duration") or transcript_result.get("duration")
    if duration is not None:
        try:
            save_lecture_duration(lecture_id, duration)
        except Exception as exc:
            logger.warning(
                "Failed to save lecture duration lecture_id=%s error_type=%s",
                lecture_id,
                type(exc).__name__,
                exc_info=True,
            )
            steps["duration"] = {
                "status": "failed",
                "code": "DURATION_SAVE_FAILED",
                "error": str(exc),
            }

    try:
        ai_steps = run_ai_generation_pipeline(
            lecture_id,
            transcript_result["segments"],
            skip_existing=skip_existing_ai,
        )
    except Exception as exc:
        raise PipelineStepError(
            "AI_GENERATION_FAILED", f"AI 生成流程失敗：{exc}"
        ) from exc

    steps.update(ai_steps)
    has_ai_error = any(
        step.get("status") == "failed"
        for step in ai_steps.values()
        if isinstance(step, dict)
    )
    pipeline_status = "partial_success" if has_ai_error else "success"
    logger.info(
        "%s AI pipeline completed lecture_id=%s status=%s",
        source,
        lecture_id,
        pipeline_status,
    )
    return {
        "status": pipeline_status,
        "lecture_id": lecture_id,
        "source": source,
        "transcription": {
            "language": transcript_result["language"],
            "language_probability": transcript_result["language_probability"],
            "duration": transcript_result["duration"],
            "text": transcript_result["text"],
            "segments": transcript_result["segments"],
            **db_result,
        },
        "ai_generation": steps,
    }


def run_youtube_ai_pipeline(
    lecture_id: int,
    url: str,
    language: str | None = None,
    model_size: str = DEFAULT_MODEL_SIZE,
    word_timestamps: bool = False,
    save_to_db: bool = True,
    skip_existing_transcript: bool = True,
    skip_existing_ai: bool = True,
) -> dict[str, Any]:
    download_dir = None

    try:
        existing_segments = (
            get_existing_transcript_segments(lecture_id)
            if skip_existing_transcript
            else None
        )

        if existing_segments:
            try:
                youtube_info = get_youtube_metadata(url)
            except Exception as exc:
                logger.exception(
                    "YouTube metadata lookup failed lecture_id=%s",
                    lecture_id,
                )
                youtube_info = {
                    "title": None,
                    "webpage_url": url,
                    "duration": None,
                }

            media_path = None
        else:
            download_dir = tempfile.mkdtemp(prefix="youtube_pipeline_")
            try:
                youtube_info = download_youtube_audio(url, output_dir=download_dir)
            except Exception as exc:
                logger.exception(
                    "YouTube audio download failed lecture_id=%s", lecture_id
                )
                set_generation_status(lecture_id, "transcript", "failed", error=str(exc))
                raise PipelineStepError(
                    "DOWNLOAD_FAILED", f"無法下載 YouTube 音訊：{exc}"
                ) from exc

            media_path = youtube_info["file_path"]

        result = run_media_ai_pipeline(
            lecture_id,
            file_path=media_path,
            source="youtube",
            source_metadata=youtube_info,
            language=language,
            model_size=model_size,
            word_timestamps=word_timestamps,
            save_to_db=save_to_db,
            skip_existing_transcript=skip_existing_transcript,
            skip_existing_ai=skip_existing_ai,
        )
        return {
            **result,
            "youtube_title": youtube_info["title"],
            "youtube_url": youtube_info["webpage_url"],
        }
    finally:
        if download_dir:
            shutil.rmtree(download_dir, ignore_errors=True)
