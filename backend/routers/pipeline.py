import shutil
import tempfile
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ai_generation import run_ai_generation_pipeline
from services.transcription import (
    download_youtube_audio,
    save_transcript_segments,
    transcribe_media,
)

router = APIRouter()


class YoutubePipelineRequest(BaseModel):
    url: str
    language: str | None = None
    model_size: str = "tiny"
    word_timestamps: bool = False
    save_to_db: bool = True
    skip_existing_transcript: bool = True
    skip_existing_ai: bool = True


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


@router.post("/lectures/{lecture_id}/ai-pipeline-youtube")
def run_youtube_ai_pipeline(lecture_id: int, payload: YoutubePipelineRequest):
    download_dir = None

    try:
        existing_segments = (
            get_existing_transcript_segments(lecture_id)
            if payload.skip_existing_transcript
            else None
        )

        if existing_segments:
            youtube_info = {
                "title": None,
                "webpage_url": payload.url,
            }
            transcript_result = {
                "language": payload.language,
                "language_probability": None,
                "duration": None,
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
        else:
            download_dir = tempfile.mkdtemp(prefix="youtube_pipeline_")
            youtube_info = download_youtube_audio(payload.url, output_dir=download_dir)
            transcript_result = transcribe_media(
                youtube_info["file_path"],
                model_size=payload.model_size,
                language=payload.language or None,
                word_timestamps=payload.word_timestamps,
            )

            db_result = {"saved_to_db": False, "inserted": 0, "db_error": None}
            if payload.save_to_db:
                db_result = save_transcript_segments(
                    lecture_id, transcript_result["segments"]
                )
                if not db_result.get("saved_to_db"):
                    raise RuntimeError(
                        f"Transcript database save failed: {db_result.get('db_error')}"
                    )

        ai_steps = run_ai_generation_pipeline(
            lecture_id,
            transcript_result["segments"],
            skip_existing=payload.skip_existing_ai,
        )
        has_ai_error = any(
            step.get("status") == "failed"
            for step in ai_steps.values()
            if isinstance(step, dict)
        )

        return {
            "status": "partial_success" if has_ai_error else "success",
            "lecture_id": lecture_id,
            "source": "youtube",
            "youtube_title": youtube_info["title"],
            "youtube_url": youtube_info["webpage_url"],
            "transcription": {
                "language": transcript_result["language"],
                "language_probability": transcript_result["language_probability"],
                "duration": transcript_result["duration"],
                "text": transcript_result["text"],
                "segments": transcript_result["segments"],
                **db_result,
            },
            "ai_generation": ai_steps,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"AI pipeline failed: {exc}"
        ) from exc
    finally:
        if download_dir:
            shutil.rmtree(download_dir, ignore_errors=True)
