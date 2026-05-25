import os
import tempfile

from database.supabase import supabase
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from services.transcription import save_transcript_segments, transcribe_media

router = APIRouter()

# =====================================================================
# 🗂️ 課程總表相關 (Courses)
# =====================================================================


# 💡 修改：改為取得所有「課程」 + 關鍵字搜尋課程名稱
@router.get("/courses")
def get_courses(keyword: str = None):
    query = supabase.table("courses").select("*")

    if keyword:
        query = query.ilike("title", f"%{keyword}%")

    res = query.execute()
    return res.data


# 💡 修改：點進特定課程後，取得該課程底下的「所有小節影片清單」
@router.get("/courses/{course_id}/lectures")
def get_lectures_by_course(course_id: int):
    # 撈取 lectures 表中，所有 course_id 符合的小節
    res = supabase.table("lectures").select("*").eq("course_id", course_id).execute()
    return res.data


# =====================================================================
# 🎬 單一小節影片內部功能 (Lectures) - 維持使用 lecture_id
# =====================================================================


# 💡 修改：取得特定「小節影片」的詳細資訊
@router.get("/lectures/{lecture_id}")
def get_selected_lecture(lecture_id: int):
    res = supabase.table("lectures").select("*").eq("id", lecture_id).execute()
    return res.data


# 取得該小節的逐字稿
@router.get("/lectures/{lecture_id}/transcripts")
def get_lecture_transcript(lecture_id: int):
    res = (
        supabase.table("transcripts").select("*").eq("lecture_id", lecture_id).execute()
    )
    return res.data


# 取得該小節的摘要
@router.get("/lectures/{lecture_id}/summaries")
def get_lecture_summary(lecture_id: int):
    res = (
        supabase.table("summaries")
        .select("*")
        .eq("lecture_id", lecture_id)
        .single()
        .execute()
    )
    return res.data


# 取得該小節的知識點
@router.get("/lectures/{lecture_id}/knowledge_points")
def get_lecture_knowledge_points(lecture_id: int):
    res = (
        supabase.table("knowledge_points")
        .select("*")
        .eq("lecture_id", lecture_id)
        .execute()
    )
    return res.data


# 取得該小節的心智圖
@router.get("/lectures/{lecture_id}/mindmaps")
def get_lecture_mindmap(lecture_id: int):
    res = supabase.table("mindmaps").select("*").eq("lecture_id", lecture_id).execute()
    return res.data


# 上傳單一小節的影片/音檔並轉成有時間戳的逐字稿
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
