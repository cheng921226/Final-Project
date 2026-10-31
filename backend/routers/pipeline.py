import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.pipeline_runner import (
    PipelineStepError,
    run_youtube_ai_pipeline as run_pipeline,
)
from services.transcription import DEFAULT_MODEL_SIZE

from .security import get_current_user
from .teacher_access import require_lecture_manager, require_teacher

router = APIRouter()
logger = logging.getLogger(__name__)


class YoutubePipelineRequest(BaseModel):
    url: str
    language: str | None = None
    model_size: str = DEFAULT_MODEL_SIZE
    word_timestamps: bool = False
    save_to_db: bool = True
    skip_existing_transcript: bool = True
    skip_existing_ai: bool = True


@router.post("/lectures/{lecture_id}/ai-pipeline-youtube")
def run_youtube_ai_pipeline(
    lecture_id: int,
    payload: YoutubePipelineRequest,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_lecture_manager(lecture_id, teacher)
    logger.info("Starting YouTube AI pipeline lecture_id=%s", lecture_id)
    try:
        result = run_pipeline(
            lecture_id,
            url=payload.url,
            language=payload.language,
            model_size=payload.model_size,
            word_timestamps=payload.word_timestamps,
            save_to_db=payload.save_to_db,
            skip_existing_transcript=payload.skip_existing_transcript,
            skip_existing_ai=payload.skip_existing_ai,
        )
        logger.info(
            "Completed YouTube AI pipeline lecture_id=%s status=%s",
            lecture_id,
            result.get("status", "unknown"),
        )
        if result.get("status") == "partial_success":
            ai_generation = result.get("ai_generation") or {}
            failed_components = [
                component
                for component, step in ai_generation.items()
                if isinstance(step, dict) and step.get("status") == "failed"
            ]
            logger.warning(
                "YouTube AI pipeline partially succeeded lecture_id=%s failed_components=%s",
                lecture_id,
                ",".join(failed_components) or "unknown",
            )
        return result
    except PipelineStepError as exc:
        logger.error(
            "YouTube AI pipeline failed lecture_id=%s step=%s",
            lecture_id,
            exc.code,
        )
        raise HTTPException(
            status_code=500, detail={"code": exc.code, "message": str(exc)}
        ) from exc
    except Exception as exc:
        logger.exception("YouTube AI pipeline failed lecture_id=%s", lecture_id)
        raise HTTPException(
            status_code=500,
            detail={"code": "PIPELINE_FAILED", "message": f"AI pipeline failed: {exc}"},
        ) from exc
