from typing import Any

from database.supabase import supabase
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()


# =====================================================================
# 課程總表相關 (Courses)
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
    res = supabase.table("lectures").select("*").eq("course_id", course_id).execute()
    return res.data


# =====================================================================
# 單一小節影片內部功能 (Lectures)
# =====================================================================

class LectureCreate(BaseModel):
    title: str
    media_url: str
    course_id: int
    status: str = "uploaded"


@router.get("/lectures")
def get_lectures(keyword: str = None):
    query = supabase.table("lectures").select("*")
    if keyword:
        query = query.ilike("title", f"%{keyword}%")
    res = query.execute()
    return res.data


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
# 學習事件紀錄 (Learning Events)
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
