import os
import shutil
import tempfile

from database.supabase import supabase
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from services.transcription import (
    download_youtube_audio,
    save_transcript_segments,
    transcribe_media,
)

router = APIRouter()


class YoutubeTranscribeRequest(BaseModel):
    url: str
    language: str | None = None
    model_size: str = "tiny"
    word_timestamps: bool = False
    save_to_db: bool = True


# 上傳影片/音檔並轉成有時間戳的逐字稿
@router.post("/lectures/{lecture_id}/transcribe")
async def transcribe_lecture_media(
    lecture_id: int,
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    model_size: str = Form(default="tiny"),
    word_timestamps: bool = Form(default=False),
    save_to_db: bool = Form(default=True),
):
    suffix = os.path.splitext(file.filename or "")[1] or ".media"

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)

        result = transcribe_media(
            temp_path,
            model_size=model_size,
            language=language or None,
            word_timestamps=word_timestamps,
        )

        db_result = {"saved_to_db": False, "inserted": 0, "db_error": None}
        if save_to_db:
            db_result = save_transcript_segments(lecture_id, result["segments"])

        return {
            "lecture_id": lecture_id,
            "filename": file.filename,
            **result,
            **db_result,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Transcription failed: {exc}"
        ) from exc
    finally:
        if "temp_path" in locals() and os.path.exists(temp_path):
            os.remove(temp_path)


# 輸入 YouTube 連結並轉成有時間戳的逐字稿
@router.post("/lectures/{lecture_id}/transcribe-youtube")
def transcribe_lecture_youtube(lecture_id: int, payload: YoutubeTranscribeRequest):
    download_dir = tempfile.mkdtemp(prefix="youtube_transcribe_")

    try:
        youtube_info = download_youtube_audio(payload.url, output_dir=download_dir)
        result = transcribe_media(
            youtube_info["file_path"],
            model_size=payload.model_size,
            language=payload.language or None,
            word_timestamps=payload.word_timestamps,
        )

        db_result = {"saved_to_db": False, "inserted": 0, "db_error": None}
        if payload.save_to_db:
            db_result = save_transcript_segments(lecture_id, result["segments"])

        return {
            "lecture_id": lecture_id,
            "source": "youtube",
            "youtube_title": youtube_info["title"],
            "youtube_url": youtube_info["webpage_url"],
            **result,
            **db_result,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"YouTube transcription failed: {exc}"
        ) from exc
    finally:
        shutil.rmtree(download_dir, ignore_errors=True)
