from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.pipeline_runner import PipelineStepError, run_youtube_ai_pipeline as run_pipeline

router = APIRouter()


class YoutubePipelineRequest(BaseModel):
    url: str
    language: str | None = None
    model_size: str = "tiny"
    word_timestamps: bool = False
    save_to_db: bool = True
    skip_existing_transcript: bool = True
    skip_existing_ai: bool = True

@router.post("/lectures/{lecture_id}/ai-pipeline-youtube")
def run_youtube_ai_pipeline(lecture_id: int, payload: YoutubePipelineRequest):
    try:
        return run_pipeline(
            lecture_id,
            url=payload.url,
            language=payload.language,
            model_size=payload.model_size,
            word_timestamps=payload.word_timestamps,
            save_to_db=payload.save_to_db,
            skip_existing_transcript=payload.skip_existing_transcript,
            skip_existing_ai=payload.skip_existing_ai,
        )
    except PipelineStepError as exc:
        raise HTTPException(
            status_code=500, detail={"code": exc.code, "message": str(exc)}
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "PIPELINE_FAILED", "message": f"AI pipeline failed: {exc}"},
        ) from exc
