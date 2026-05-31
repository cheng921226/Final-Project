import os
import tempfile

from database.supabase import supabase
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from typing import Any
from services.transcription import save_transcript_segments, transcribe_media

router = APIRouter()

# =====================================================================
# 🗂️ 課程總表相關 (Courses)
# =====================================================================

class CourseCreate(BaseModel):
    title: str
    teacher_id: int | None = None

@router.get("/courses")
def get_courses(keyword: str = None):
    query = supabase.table("courses").select("*")
    if keyword:
        query = query.ilike("title", f"%{keyword}%")
    res = query.execute()
    return res.data

@router.post("/courses")
def create_course(body: CourseCreate):
    res = supabase.table("courses").insert({
        "title": body.title,
        "teacher_id": body.teacher_id,
    }).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="新增課程失敗")
    return res.data[0]

@router.get("/courses/{course_id}/lectures")
def get_lectures_by_course(course_id: int):
    res = supabase.table("lectures").select("*").eq("course_id", course_id).order("id").execute()
    return res.data


# =====================================================================
# 🎬 單一小節影片內部功能 (Lectures)
# =====================================================================

class LectureCreate(BaseModel):
    title: str
    media_url: str
    course_id: int
    status: str = "uploaded"

@router.get("/lectures/{lecture_id}")
def get_selected_lecture(lecture_id: int):
    res = supabase.table("lectures").select("*").eq("id", lecture_id).execute()
    return res.data

@router.post("/lectures")
def create_lecture(body: LectureCreate):
    res = supabase.table("lectures").insert({
        "title": body.title,
        "media_url": body.media_url,
        "course_id": body.course_id,
        "status": body.status,
    }).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="新增小節失敗")
    return res.data[0]

@router.get("/lectures/{lecture_id}/transcripts")
def get_lecture_transcript(lecture_id: int):
    res = supabase.table("transcripts").select("*").eq("lecture_id", lecture_id).execute()
    return res.data

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

@router.get("/lectures/{lecture_id}/knowledge_points")
def get_lecture_knowledge_points(lecture_id: int):
    res = (
        supabase.table("knowledge_points")
        .select("*")
        .eq("lecture_id", lecture_id)
        .execute()
    )
    return res.data

@router.get("/lectures/{lecture_id}/mindmaps")
def get_lecture_mindmap(lecture_id: int):
    res = supabase.table("mindmaps").select("*").eq("lecture_id", lecture_id).execute()
    return res.data


# =====================================================================
# 📊 學習事件紀錄 (Learning Events)
# =====================================================================

class LearningEventCreate(BaseModel):
    student_id: int
    lecture_id: int
    event_type: str
    event_data: dict[str, Any] = {}

@router.post("/learning_events")
def create_learning_event(body: LearningEventCreate):
    res = supabase.table("learning_events").insert({
        "student_id": body.student_id,
        "lecture_id": body.lecture_id,
        "event_type": body.event_type,
        "event_data": body.event_data,
    }).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="記錄學習事件失敗")
    return res.data[0]

@router.get("/learning_events/{lecture_id}")
def get_learning_events(lecture_id: int, student_id: int | None = None):
    query = supabase.table("learning_events").select("*").eq("lecture_id", lecture_id)
    if student_id:
        query = query.eq("student_id", student_id)
    res = query.execute()
    return res.data


# =====================================================================
# 📈 影片觀看進度 (Video Progresses)
# =====================================================================

class VideoProgressCreate(BaseModel):
    student_id: int
    lecture_id: int
    last_position: int = 0
    watched_seconds: int = 0
    completed: bool = False

@router.post("/video_progresses")
def upsert_video_progress(body: VideoProgressCreate):
    # 先查有沒有已存在的紀錄
    existing = (
        supabase.table("video_progresses")
        .select("id")
        .eq("student_id", body.student_id)
        .eq("lecture_id", body.lecture_id)
        .execute()
    )

    if existing.data:
        # 已存在 → 更新
        res = (
            supabase.table("video_progresses")
            .update({
                "last_position": body.last_position,
                "watched_seconds": body.watched_seconds,
                "completed": body.completed,
            })
            .eq("student_id", body.student_id)
            .eq("lecture_id", body.lecture_id)
            .execute()
        )
    else:
        # 不存在 → 新增
        res = supabase.table("video_progresses").insert({
            "student_id": body.student_id,
            "lecture_id": body.lecture_id,
            "last_position": body.last_position,
            "watched_seconds": body.watched_seconds,
            "completed": body.completed,
        }).execute()

    if not res.data:
        raise HTTPException(status_code=500, detail="儲存進度失敗")
    return res.data[0]

@router.get("/video_progresses/{lecture_id}")
def get_video_progress(lecture_id: int, student_id: int = Query(...)):
    res = (
        supabase.table("video_progresses")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .single()
        .execute()
    )
    return res.data


# =====================================================================
# 🎙️ 逐字稿轉錄
# =====================================================================

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
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if "temp_path" in locals() and os.path.exists(temp_path):
            os.remove(temp_path)